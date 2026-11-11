# WhatsApp Pro — Deployment Guide

This guide covers local development with Docker Compose as well as production deployment with SSL/TLS, PostgreSQL migrations & backups, Redis, AWS S3, Twilio, Firebase FCM / APNs, and Coturn TURN/STUN servers.

---

## 1. Environment Configuration

Copy `.env.example` to `.env` at the monorepo root and populate all required secrets:

```bash
cp .env.example .env
```

Required production secrets:
- `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `REDIS_URL`, `REDIS_PASSWORD`
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (minimum 32 random bytes each)
- `AWS_S3_BUCKET`, `AWS_S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`
- `WEBRTC_TURN_SERVER_URL`, `WEBRTC_TURN_USERNAME`, `WEBRTC_TURN_CREDENTIAL`
- `FRONTEND_URL`, `CORS_ORIGINS`

---

## 2. Development Stack (`docker-compose.yml`)

```bash
# Start Postgres 16, Redis 7, NestJS Backend (3001), Vite Web (3000), and Nginx (80)
docker-compose up -d

# Run Prisma migrations & seed data
npm run db:migrate
npm run db:seed
```

---

## 3. Production Stack (`docker-compose.prod.yml`)

`docker-compose.prod.yml` builds multi-stage production containers for `backend` and `web`, enables resource limits, configures health checks, and disables direct port exposure for PostgreSQL/Redis.

```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Start services in detached mode
docker-compose -f docker-compose.prod.yml up -d

# Verify running containers and healthchecks
docker-compose -f docker-compose.prod.yml ps
```

The backend container entrypoint runs `npx prisma migrate deploy && node dist/main.js` automatically on startup.

---

## 4. Nginx & HTTPS / SSL Setup

1. Place TLS certificates (`fullchain.pem`, `privkey.pem`) in `./nginx/certs/` (mounted read-only into the Nginx container at `/etc/nginx/certs`).
2. Issue certificates with Certbot on the host:

```bash
certbot certonly --standalone -d chat.example.com
cp /etc/letsencrypt/live/chat.example.com/fullchain.pem ./nginx/certs/
cp /etc/letsencrypt/live/chat.example.com/privkey.pem ./nginx/certs/
```

3. Update `nginx/nginx.conf` to add a `listen 443 ssl http2;` server block and redirect port `80` to HTTPS. Keep `proxy_http_version 1.1`, `Upgrade $http_upgrade`, `Connection "upgrade"`, and `proxy_read_timeout 86400s` on `/socket.io/` so WebSockets remain persistent.

---

## 5. PostgreSQL Migrations & Backups

### Running Migrations
```bash
npx prisma migrate deploy --schema=apps/backend/prisma/schema.prisma
```

### Automated Daily Backups
Schedule a host cron job using `pg_dump`:
```bash
0 2 * * * docker exec whatsapp-pro-postgres pg_dump -U postgres whatsapp_pro | gzip > /backups/whatsapp_pro_$(date +\%F).sql.gz
```

---

## 6. Redis Configuration

`docker-compose.prod.yml` runs `redis:7-alpine` with:
- `--appendonly yes` (AOF persistence)
- `--requirepass ${REDIS_PASSWORD}`
- `--maxmemory 512mb --maxmemory-policy allkeys-lru`

Redis stores OTPs, rate-limit counters, online presence (`online:{userId}`), typing indicators, pinned message sets, and offline message queues.

---

## 7. AWS S3 Setup (CORS & IAM)

### S3 Bucket CORS Policy
Configure CORS on your S3 bucket so web/mobile clients can upload/fetch media cleanly:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedOrigins": ["https://chat.example.com"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

### Minimal IAM Policy
Grant the backend IAM user `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, and `s3:ListBucket` scoped strictly to `arn:aws:s3:::<AWS_S3_BUCKET>/*`.

---

## 8. Twilio SMS, Firebase FCM & Apple APNs

- **Twilio**: Create a Messaging Service / purchase an SMS-capable phone number and set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.
- **Firebase Cloud Messaging (FCM)**: Generate a Firebase Service Account private key JSON and set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` (preserving `\n` escapes).
- **Apple APNs (optional native iOS)**: Supply APNs key/certificate env configuration if dispatching direct APNs payloads via `@parse/node-apn`; otherwise Expo / FCM handles iOS & Android delivery uniformly.

---

## 9. Coturn STUN/TURN Server (WebRTC Calls)

For reliable audio/video calls across symmetric NATs and corporate firewalls, deploy **Coturn**:

```ini
# /etc/turnserver.conf
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
realm=turn.example.com
user=<WEBRTC_TURN_USERNAME>:<WEBRTC_TURN_CREDENTIAL>
total-quota=100
stale-nonce=600
no-multicast-peers
```

Set in `.env`:
```env
WEBRTC_TURN_SERVER_URL=turn:turn.example.com:3478
WEBRTC_TURN_USERNAME=your-turn-username
WEBRTC_TURN_CREDENTIAL=your-turn-credential
```

The backend exposes STUN (`stun:stun.l.google.com:19302`) + your configured TURN servers via `GET /api/v1/calls/ice-servers`.
