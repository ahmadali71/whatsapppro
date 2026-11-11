# WhatsApp Pro — API & WebSocket Reference

- **Base URL**: `http://localhost:3001/api/v1` (or via Nginx at `http://localhost/api/v1`)
- **Swagger / OpenAPI UI**: `http://localhost:3001/api/docs`
- **Authentication**: Bearer JWT (`Authorization: Bearer <accessToken>`). Header `X-Device-Id` is supported for multi-device tracking.
- **Validation**: Global `ValidationPipe` (`whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`).

---

## 1. Authentication (`/api/v1/auth`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Register a new phone number + display name |
| `POST` | `/auth/send-otp` | Public | Generate & send 6-digit SMS OTP via Twilio (rate-limited: max 3 / 10 min) |
| `POST` | `/auth/verify-otp` | Public | Verify 6-digit OTP (max 5 attempts) & issue access (15m) + refresh (30d) tokens |
| `POST` | `/auth/login` | Public | Login with phone / device info (triggers 2FA challenge if enabled) |
| `POST` | `/auth/refresh` | Public (Refresh JWT) | Rotate refresh token (`authentication_sessions`) and issue new token pair |
| `POST` | `/auth/logout` | Bearer JWT | Revoke current or specified authentication session |
| `POST` | `/auth/two-factor/enable` | Bearer JWT | Enable/update 6-digit 2FA PIN (12-round bcrypt) + optional recovery email |
| `POST` | `/auth/two-factor/verify` | Public / JWT | Verify 2FA PIN challenge |

---

## 2. Users, Contacts & Devices (`/api/v1/users`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/users/me` | Bearer JWT | Get authenticated user's profile & settings |
| `PATCH` | `/users/me` | Bearer JWT | Update display name, username, about, avatar URL, or push token |
| `DELETE` | `/users/me` | Bearer JWT | Soft-delete own user account & revoke active sessions |
| `POST` | `/users/change-number` | Bearer JWT | Migrate account to a new verified phone number |
| `GET` | `/users/search?q=` | Bearer JWT | Search active users by phone number, username, or display name |
| `GET` | `/users/:id/profile` | Bearer JWT | View another user's profile (enforces `PrivacySetting` & `BlockedUser`) |
| `POST` | `/users/contacts/sync` | Bearer JWT | Bulk match phone numbers against registered WhatsApp Pro users |
| `GET` | `/users/contacts` | Bearer JWT | List synced contacts |
| `POST` | `/users/block/:id` | Bearer JWT | Block a user |
| `DELETE` | `/users/block/:id` | Bearer JWT | Unblock a user |
| `GET` | `/users/blocked` | Bearer JWT | List blocked users |
| `GET` | `/users/devices` | Bearer JWT | List linked devices (`user_devices`) |
| `DELETE` | `/users/devices/:deviceId` | Bearer JWT | Unlink / deactivate a device |

---

## 3. E2EE Key Exchange (`/api/v1/keys`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/keys/bundle` | Bearer JWT | Upload/update device Signal Protocol key bundle (`registrationId`, `identityKey`, `signedPreKey`, `oneTimePreKeys`) |
| `GET` | `/keys/bundle/:userId` | Bearer JWT | Fetch recipient's public key bundle & atomically consume one one-time pre-key in a DB transaction |

---

## 4. Chats & Messages (`/api/v1/chats`, `/api/v1/messages`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/chats` | Bearer JWT | List user's active/archived conversations with last message & unread counts |
| `POST` | `/chats` | Bearer JWT | Create or fetch existing `DIRECT` conversation with target user |
| `GET` | `/chats/:id` | Bearer JWT | Get conversation details & member list |
| `POST` | `/chats/:id/archive` | Bearer JWT | Archive conversation for current user |
| `DELETE` | `/chats/:id/archive` | Bearer JWT | Unarchive conversation |
| `GET` | `/chats/:id/messages?cursor=&limit=` | Bearer JWT | Cursor-paginated message history |
| `POST` | `/chats/:id/messages` | Bearer JWT | Send message (`TEXT`, `IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT`, `LOCATION`, `CONTACT`, `STICKER`, `GIF`, `VOICE`, `POLL`, plus `isEncrypted` / `encryptionMetadata`) |
| `POST` | `/chats/:id/read` | Bearer JWT | Mark conversation messages as `READ` & reset unread count |
| `GET` | `/chats/:id/pinned` | Bearer JWT | Get pinned messages in conversation |
| `GET` | `/chats/link-preview?url=` | Bearer JWT | Fetch OpenGraph link metadata (with SSRF protection) |
| `GET` | `/messages/starred` | Bearer JWT | List user's starred messages |
| `GET` | `/messages/:id/info` | Bearer JWT | Get per-member `SENT` / `DELIVERED` / `READ` receipt timestamps |
| `PATCH` | `/messages/:id` | Bearer JWT | Edit own message & record `MessageEdit` history |
| `DELETE` | `/messages/:id?scope=me\|everyone` | Bearer JWT | Delete message for self (Redis `deleted_for_me:{userId}`) or for everyone |
| `POST` | `/messages/:id/reactions` | Bearer JWT | Add/toggle emoji reaction |
| `DELETE` | `/messages/:id/reactions/:emoji` | Bearer JWT | Remove emoji reaction |
| `POST` | `/messages/:id/star` | Bearer JWT | Star message |
| `DELETE` | `/messages/:id/star` | Bearer JWT | Unstar message |
| `POST` | `/messages/:id/pin` | Bearer JWT | Pin message in conversation |
| `DELETE` | `/messages/:id/pin` | Bearer JWT | Unpin message in conversation |
| `POST` | `/messages/:id/forward` | Bearer JWT | Forward message to one or more target conversations |
| `POST` | `/messages/:id/poll-vote` | Bearer JWT | Vote on a `POLL` message option |

---

## 5. Media (`/api/v1/media`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/media/upload` | Bearer JWT | Multipart upload (`memoryStorage`). Validates limits (16MB image/voice, 100MB video/document), optimizes images (`sharp`), generates video thumbnails (`ffmpeg`), stores in S3 |
| `GET` | `/media/presigned-url?key=` | Bearer JWT | Generate temporary presigned S3 URL |
| `DELETE` | `/media?key=` | Bearer JWT | Delete media object from S3 |

---

## 6. Calls (`/api/v1/calls`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/calls/ice-servers` | Bearer JWT | Return STUN & configured TURN server credentials |
| `GET` | `/calls/history` | Bearer JWT | Cursor-paginated call history |
| `GET` | `/calls/active` | Bearer JWT | Get active call for current user (if any) |
| `POST` | `/calls` | Bearer JWT | Initiate `AUDIO` or `VIDEO` call, create participants, emit `call_incoming`, send push notification |
| `POST` | `/calls/:id/join` | Bearer JWT | Join active call |
| `POST` | `/calls/:id/end` | Bearer JWT | End call & compute `durationSeconds` |
| `POST` | `/calls/:id/reject` | Bearer JWT | Reject incoming call |

---

## 7. Groups & Communities (`/api/v1/groups`, `/api/v1/communities`)

### Groups
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/groups` | Bearer JWT | Create group + backing `GROUP` conversation |
| `POST` | `/groups/join/:inviteCode` | Bearer JWT | Join group via invite code |
| `GET` | `/groups/:id` | Bearer JWT | Get group info & settings |
| `PATCH` | `/groups/:id` | Bearer JWT | Update group name, description, avatar, or admin-only permissions |
| `DELETE` | `/groups/:id` | Bearer JWT | Soft-delete group (Owner only) |
| `GET` | `/groups/:id/members` | Bearer JWT | List active group members |
| `POST` | `/groups/:id/members` | Bearer JWT | Add members (Admin/Owner) |
| `DELETE` | `/groups/:id/members/:userId` | Bearer JWT | Remove member or leave group |
| `PATCH` | `/groups/:id/members/:userId/role` | Bearer JWT | Promote/demote member role (`MEMBER`, `ADMIN`, `OWNER`) |
| `POST` | `/groups/:id/invite-link` | Bearer JWT | Generate or reset group invite link |
| `DELETE` | `/groups/:id/invite-link` | Bearer JWT | Revoke group invite link |
| `GET` | `/groups/:id/media` | Bearer JWT | List shared media attachments in group |

### Communities
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/communities` | Bearer JWT | Create community |
| `GET` | `/communities/:id` | Bearer JWT | Get community details |
| `PATCH` | `/communities/:id` | Bearer JWT | Update community details |
| `DELETE` | `/communities/:id` | Bearer JWT | Soft-delete community |
| `GET` | `/communities/:id/members` | Bearer JWT | List community members |
| `POST` | `/communities/:id/members` | Bearer JWT | Add community members |
| `DELETE` | `/communities/:id/members/:userId` | Bearer JWT | Remove community member |
| `POST` | `/communities/:id/groups` | Bearer JWT | Link a group to the community |
| `DELETE` | `/communities/:id/groups/:groupId` | Bearer JWT | Unlink a group from the community |

---

## 8. Statuses / Stories (`/api/v1/statuses`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/statuses` | Bearer JWT | Create text, image, or video status (24h TTL, privacy: `ALL`/`CONTACTS`/`SELECTED`/`NONE`) |
| `GET` | `/statuses` | Bearer JWT | Get visible contacts' active statuses |
| `GET` | `/statuses/mine` | Bearer JWT | Get own active statuses with view counts |
| `DELETE` | `/statuses/:id` | Bearer JWT | Delete own status |
| `POST` | `/statuses/:id/views` | Bearer JWT | Record view (`status_views`) |
| `GET` | `/statuses/:id/viewers` | Bearer JWT | List viewers (status owner only) |
| `POST` | `/statuses/:id/reactions` | Bearer JWT | React to status with emoji |
| `POST` | `/statuses/:id/reply` | Bearer JWT | Reply to status (creates/uses direct conversation & sends message) |

---

## 9. Privacy, Search, Settings, Notifications & Reports

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/privacy/settings` | Bearer JWT | Get own `PrivacySetting` |
| `PATCH` | `/privacy/settings` | Bearer JWT | Update last seen, online, profile photo, about, status, read receipts, disappearing default |
| `POST` | `/privacy/disappearing-messages/:conversationId` | Bearer JWT | Set disappearing timeout (`24h`, `7d`, `90d`, `off`) |
| `GET` | `/privacy/sessions` | Bearer JWT | List active authentication sessions |
| `DELETE` | `/privacy/sessions/:id` | Bearer JWT | Revoke specific session |
| `DELETE` | `/privacy/sessions` | Bearer JWT | Revoke all other sessions |
| `GET` | `/search?q=&type=all\|contacts\|messages\|groups\|media` | Bearer JWT | Global search across contacts, messages, groups, and media |
| `GET` | `/settings/chat` | Bearer JWT | Get `ChatSetting` (theme, font size, wallpaper, auto-download, backup) |
| `PATCH` | `/settings/chat` | Bearer JWT | Update `ChatSetting` |
| `GET` | `/settings/notifications` | Bearer JWT | Get per-conversation mute/notification preferences |
| `PATCH` | `/settings/notifications/:conversationId` | Bearer JWT | Mute/unmute conversation |
| `GET` | `/settings/storage` | Bearer JWT | Storage usage breakdown per conversation |
| `DELETE` | `/settings/storage/:conversationId` | Bearer JWT | Clear chat media for conversation |
| `POST` | `/settings/backup` | Bearer JWT | Trigger chat backup |
| `GET` | `/notifications` | Bearer JWT | List user notifications |
| `PATCH` | `/notifications/read-all` | Bearer JWT | Mark all notifications read |
| `PATCH` | `/notifications/:id/read` | Bearer JWT | Mark single notification read |
| `POST` | `/reports` | Bearer JWT | Submit abuse report (`reportedUserId`, `reportedMessageId?`, `reason`, `description?`) |

---

## 10. Admin Dashboard (`/api/v1/admin`)

> **Requires `UserRole.ADMIN` via `AdminGuard`**. All endpoints strictly return metadata/aggregates only — plaintext message content and full conversation histories are never exposed.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/stats` | Platform metrics (total users, active users, messages today, groups, pending reports) |
| `GET` | `/admin/users` | Paginated user metadata list with filters |
| `GET` | `/admin/users/:id` | Single user metadata, devices, and report counts |
| `POST` | `/admin/users/:id/suspend` | Suspend/ban user (`isBanned: true`) & write `AuditLog` |
| `POST` | `/admin/users/:id/restore` | Restore suspended user & write `AuditLog` |
| `DELETE` | `/admin/users/:id` | Delete user account & write `AuditLog` |
| `GET` | `/admin/reports` | Paginated abuse reports queue |
| `GET` | `/admin/reports/:id` | Report details & flagged message metadata (no plaintext content) |
| `PATCH` | `/admin/reports/:id` | Update report status (`REVIEWED`, `RESOLVED`, `DISMISSED`) |
| `GET` | `/admin/audit-logs` | Filterable audit log entries |
| `GET` | `/admin/health` | Infrastructure health check (PostgreSQL, Redis, AWS S3) |
| `GET` | `/admin/storage` | Aggregate platform media storage statistics |
| `GET` | `/admin/config` | Read `SystemConfig` entries |
| `POST` | `/admin/config` | Update `SystemConfig` & write `AuditLog` |

---

## 11. Socket.IO Real-Time Events (Namespace `/`)

Handshake authentication expects a valid JWT in `socket.handshake.auth.token` or `Authorization: Bearer <token>`.

### Client → Server Events
| Event | Payload | Description |
|---|---|---|
| `join_conversation` / `conversation:join` | `{ conversationId }` | Join `conversation:{id}` room after membership check |
| `leave_conversation` / `conversation:leave` | `{ conversationId }` | Leave `conversation:{id}` room |
| `send_message` / `message:send` | `{ conversationId, content, messageType, replyToId?, isEncrypted?, encryptionMetadata?, attachments? }` | Persist & broadcast message; queue offline if recipient disconnected |
| `typing_start` / `typing:start` | `{ conversationId }` | Set Redis `typing:{conversationId}:{userId}` (5s TTL) & broadcast |
| `typing_stop` / `typing:stop` | `{ conversationId }` | Clear typing key & broadcast |
| `message_delivered` / `message:delivered` | `{ messageId, conversationId }` | Update receipt to `DELIVERED` |
| `message_read` / `message:read` | `{ messageId?, conversationId }` | Update receipt(s) to `READ` |
| `mark_online` / `mark_offline` | `{}` | Explicit presence heartbeat |
| `live_location_update` | `{ conversationId, messageId, lat, lng, expiresAt }` | Broadcast live location coordinates to conversation |
| `call_join` / `join_call` | `{ callId, conversationId? }` | Join `call:{callId}` WebRTC signaling room |
| `call:accept` | `{ callId }` | Accept incoming call |
| `call_offer` / `call_answer` / `ice_candidate` / `call_signal` | `{ callId, targetUserId?, sdp?, candidate?, signal? }` | Relay WebRTC SDP/ICE signaling |
| `call_toggle_mute` / `call_toggle_video` | `{ callId, isMuted?, isVideoOn? }` | Broadcast participant media state |
| `call_reject` / `call_end` / `leave_call` | `{ callId, conversationId? }` | Reject or terminate call |

### Server → Client Events
- Messaging: `new_message`, `message_updated`, `message_deleted`, `message_reaction`, `message_receipt`, `message_pinned`, `message_unpinned`, `live_location_update`
- Presence & Groups: `typing_indicator`, `user_online`, `user_offline`, `group_updated`, `member_added`, `member_removed`
- Calls: `call_incoming`, `call_offer_received`, `call_answer_received`, `ice_candidate_received`, `call_signal_relay`, `call_rejected`, `call_ended`, `call_ended_notification`
