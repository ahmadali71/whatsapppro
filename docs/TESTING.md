# WhatsApp Pro — Testing & Acceptance Verification Guide

## 1. Automated Test Suites

### Install Dependencies & Build Shared Types
```bash
npm install
npm run build --workspace=@whatsapp-pro/shared-types
```

### Validate & Generate Prisma Client
```bash
cd apps/backend
npx prisma validate
npx prisma generate
```

### Run Backend Build & Jest Test Suites
```bash
cd apps/backend
npm run build
npm test
```

The Jest suite in `apps/backend/test/` includes 5 integration/unit test files covering all backend modules with mocked `PrismaService`, `RedisService`, Twilio, AWS S3, and Firebase:
1. `apps/backend/test/auth-otp.spec.ts` — Registration, OTP generation/rate-limiting/verification, JWT rotation, 2FA setup & challenge.
2. `apps/backend/test/users-keys.spec.ts` — User search, contact sync, blocking, privacy visibility enforcement, Signal key bundle upload & atomic one-time pre-key consumption.
3. `apps/backend/test/chats-gateway-media.spec.ts` — Direct chats, messaging, receipts, reactions, edits, delete for me/everyone, forwarding, starring, WebSocket presence/typing/offline flush, media upload validation.
4. `apps/backend/test/groups-calls.spec.ts` — Group creation, permissions, invite links, member management, WebRTC call initiation, ICE servers, signaling relay, reject/end.
5. `apps/backend/test/statuses-admin-reports.spec.ts` — Status privacy filtering, views, replies, report creation, AdminGuard RBAC, metadata-only enforcement, audit logs.

### Typecheck Web & Mobile Apps
```bash
# Web
cd apps/web
npx tsc --noEmit
npm run build

# Mobile
cd apps/mobile
npx tsc --noEmit
```

---

## 2. Final Acceptance Tests Checklist (17 End-to-End Scenarios)

| # | Scenario | Verification Steps |
|---|---|---|
| 1 | **Phone Registration & OTP** | `POST /auth/register` + `POST /auth/send-otp` + `POST /auth/verify-otp` issues access + refresh JWTs; >3 OTPs in 10m returns `429`. |
| 2 | **Two-Step Verification (2FA)** | `POST /auth/two-factor/enable` hashes PIN; subsequent login requires `POST /auth/two-factor/verify`. |
| 3 | **Profile & Linked Devices** | `PATCH /users/me` updates profile; `GET /users/devices` lists devices; `DELETE /users/devices/:deviceId` revokes device. |
| 4 | **Contact Sync & Discovery** | `POST /users/contacts/sync` matches registered users; `GET /users/search` excludes blocked users. |
| 5 | **Signal E2EE Key Exchange** | `POST /keys/bundle` uploads bundle; `GET /keys/bundle/:userId` returns bundle and atomically removes one one-time pre-key; encrypted messages store `isEncrypted: true`. |
| 6 | **Real-Time 1:1 Messaging** | `send_message` via Socket.IO persists message, broadcasts `new_message` to `conversation:{id}`, and increments unread count. |
| 7 | **Receipts & Typing Indicators** | `typing_start`/`typing_stop` emit `typing_indicator`; `message_delivered` and `message_read` transition `SENT -> DELIVERED -> READ` and update `GET /messages/:id/info`. |
| 8 | **Rich Message Actions** | Edit (`PATCH /messages/:id` saves `MessageEdit`), React (`POST /messages/:id/reactions`), Star, Pin, Forward, Delete for me / everyone, Poll voting. |
| 9 | **Media Upload & Thumbnails** | `POST /media/upload` accepts valid images/videos/audio/docs, rejects oversized files, compresses images with `sharp`, and extracts video thumbnails. |
| 10 | **Offline Reconnect Sync** | Messages sent while recipient is offline are queued in Redis `offline_queue:{userId}` and flushed automatically on socket reconnect. |
| 11 | **Groups & Invite Links** | `POST /groups` creates group + conversation; `onlyAdminsCanMessage` blocks non-admins; `POST /groups/join/:inviteCode` adds member; revoking link blocks subsequent joins. |
| 12 | **Communities** | `POST /communities`, link/unlink groups via `/communities/:id/groups`, manage community members. |
| 13 | **Statuses (Stories)** | `POST /statuses` creates 24h status; `GET /statuses` filters by privacy/blocks; `POST /statuses/:id/views` & `/reply` work; hourly cron deletes expired statuses. |
| 14 | **Audio & Video Calls (WebRTC)** | `GET /calls/ice-servers` returns STUN/TURN; `POST /calls` emits `call_incoming`; `call_offer`/`call_answer`/`ice_candidate` relay in `call:{id}`; `POST /calls/:id/end` records `durationSeconds`. |
| 15 | **Privacy & Disappearing Messages** | `PATCH /privacy/settings` hides last seen / online / profile photo / about for restricted viewers; `POST /privacy/disappearing-messages/:conversationId` schedules expiry cleanup. |
| 16 | **Global Search & Settings** | `GET /search?q=...` returns scoped matches across contacts, messages, groups, media; `PATCH /settings/chat` persists theme/wallpaper/font size. |
| 17 | **Abuse Reports & Privacy-Preserving Admin** | `POST /reports` notifies admins; non-admin receives `403` on `/admin/*`; admin endpoints return aggregates, report metadata, health, config, and audit logs with zero plaintext message content. |
