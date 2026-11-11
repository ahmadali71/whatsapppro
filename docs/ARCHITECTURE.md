# WhatsApp Pro — System Architecture

## 1. High-Level Overview

WhatsApp Pro is structured as an npm workspaces monorepo:
- `packages/shared-types` — Canonical TypeScript interfaces, enums, and Socket.IO event constants shared across backend, web, and mobile.
- `apps/backend` — Modular NestJS REST + WebSocket API backed by PostgreSQL (Prisma ORM, 32 models) and Redis (`ioredis`).
- `apps/web` — React 18 + Vite + TailwindCSS + Zustand desktop/mobile web app and Admin Dashboard.
- `apps/mobile` — React Native + Expo mobile app with biometric lock, Expo notifications, and WebRTC support.
- `nginx` — Reverse proxy routing `/api/` and `/socket.io/` to the backend and `/` to the web client.

```
┌─────────────────┐      ┌─────────────────┐
│   Web Client    │      │  Mobile Client  │
│  React + Vite   │      │  Expo / RN      │
└────────┬────────┘      └────────┬────────┘
         │  HTTPS / WSS           │  HTTPS / WSS
         └───────────┬────────────┘
                     ▼
              ┌─────────────┐
              │    Nginx    │
              └──────┬──────┘
           ┌─────────┴─────────┐
           ▼                   ▼
   ┌──────────────┐    ┌────────────────────────────────┐
   │  Web Static  │    │  NestJS Backend (REST + WS)    │
   └──────────────┘    └───┬────────────┬───────────────┘
                           │            │
              ┌────────────▼──┐      ┌──▼────────────┐
              │ PostgreSQL 16 │      │    Redis 7    │
              │  (32 Models)  │      │ Presence/OTP/ │
              └───────────────┘      │ Offline Queue │
                                     └───────────────┘
```

---

## 2. Backend Module Architecture

`AppModule` (`apps/backend/src/app.module.ts`) registers:
- **Core Global Modules**: `ConfigModule`, `ThrottlerModule`, `PrismaModule`, `RedisModule`.
- **Auth & Identity**: `AuthModule`, `OtpModule`, `UsersModule`, `KeysModule`.
- **Messaging & Media**: `ChatsModule`, `GatewayModule`, `MediaModule`.
- **Collaboration & Calling**: `GroupsModule`, `CommunitiesModule`, `CallsModule`, `NotificationsModule`.
- **Engagement & Compliance**: `StatusesModule`, `PrivacyModule`, `SearchModule`, `SettingsModule`, `ReportsModule`, `AdminModule`, `TasksModule`.

---

## 3. Data Layer & Redis Design

### PostgreSQL (Prisma Schema — 32 Models)
- **Identity & Security**: `User` (`UserRole.USER | ADMIN`), `UserProfile`, `UserDevice`, `AuthenticationSession`, `UserKeyBundle`, `BlockedUser`, `Contact`.
- **Messaging**: `Conversation`, `ConversationMember`, `Message` (supports `isEncrypted` + `encryptionMetadata`), `MessageReceipt`, `MessageReaction`, `MessageAttachment`, `MessageEdit`, `StarredMessage`, `ArchivedChat`.
- **Groups & Communities**: `Group`, `GroupMember`, `GroupInvite`, `Community`, `CommunityMember`.
- **Stories & Calls**: `Status`, `StatusView`, `StatusReaction`, `Call`, `CallParticipant`.
- **Preferences & Governance**: `Notification`, `PrivacySetting`, `ChatSetting`, `Report`, `AuditLog`, `SystemConfig`.

### Redis Usage
- `otp:{phone}` (5 min TTL) & `otp_rate:{phone}` (10 min window, max 3)
- `online:{userId}` (24h TTL) & `typing:{conversationId}:{userId}` (5s TTL)
- `offline_queue:{userId}` — queued message IDs/payloads flushed on Socket.IO reconnect
- `deleted_for_me:{userId}` & `pinned:{conversationId}` — per-user hidden messages & pinned message sets

---

## 4. End-to-End Encryption (Signal Protocol)

1. **Key Registration**: On login/onboarding, each client generates an identity key pair, registration ID, signed pre-key + signature, and a batch of one-time pre-keys, storing private keys locally (`IndexedDB`/`localStorage` on web, `expo-secure-store` on mobile) and uploading public keys via `POST /api/v1/keys/bundle`.
2. **Session Establishment (X3DH)**: When Alice initiates a 1:1 encrypted chat with Bob, Alice calls `GET /api/v1/keys/bundle/:bobId`. The backend executes an atomic `prisma.$transaction` to return Bob's bundle and pop one `oneTimePreKey` so it is never reused.
3. **Message Encryption (Double Ratchet)**: Alice encrypts plaintext client-side before sending via REST or `send_message` Socket.IO event, setting `isEncrypted: true` and `encryptionMetadata` (sender key / ratchet header). The server stores and relays ciphertext without access to plaintext keys.

---

## 5. WebRTC Call Signaling & Media Topology

- **Signaling**: `CallsController` manages persistent `Call` and `CallParticipant` records and STUN/TURN configuration (`GET /api/v1/calls/ice-servers`). `CallsGateway` authenticates sockets via JWT middleware and relays `call_offer`, `call_answer`, and `ice_candidate` payloads inside `call:{callId}` rooms.
- **Topology**:
  - **1:1 Calls (2 participants)**: Direct Peer-to-Peer (`RTCPeerConnection`) via STUN/TURN.
  - **Small Group Calls (3–8 participants)**: Full-mesh peer connections between participants.
  - **Large Group Calls (>8 participants)**: Designed to transition to an SFU (Selective Forwarding Unit such as `mediasoup`) for bandwidth scalability.

---

## 6. Privacy-Preserving Admin Guarantees

- **Strict RBAC**: All `/api/v1/admin/*` routes are guarded by `JwtAuthGuard` + `AdminGuard` (`UserRole.ADMIN` + active, non-banned account check).
- **Zero Plaintext Message Access**: Admin stats, user inspection, and abuse report endpoints query aggregate counts and metadata only (`id`, `senderId`, `messageType`, `sentAt`, `isDeletedForEveryone`, `isEncrypted`) — `Message.content` and `MessageAttachment.fileUrl` are intentionally excluded from admin responses.
- **Auditability**: Administrative actions (suspend, restore, delete user, report review, system config updates) write immutable entries to `audit_logs`.
