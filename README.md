# WhatsApp Pro 🟢

A production-ready, full-featured WhatsApp clone built with a modern monorepo architecture.

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | NestJS, Prisma ORM, Socket.IO, PostgreSQL 16, Redis 7 |
| **Web Frontend** | React 18, Vite, TailwindCSS, React Router v6, Zustand |
| **Mobile** | React Native (Expo), React Navigation |
| **Auth** | JWT (access + refresh tokens), OTP via Twilio |
| **Storage** | AWS S3 (media), PostgreSQL (data) |
| **Push Notifications** | Firebase Cloud Messaging |
| **Calls** | WebRTC + TURN server |
| **Containerisation** | Docker + Docker Compose |
| **API Docs** | Swagger / OpenAPI |

## Monorepo Structure

```
whatsapp-pro/
├── client/
│   ├── web/              # React + Vite web app (port 3000)
│   └── mobile/           # React Native + Expo mobile app
├── server/               # NestJS API server (port 3001)
├── packages/
│   └── shared-types/     # Canonical shared TypeScript types (mirrored into client/*/src/shared-types & server/src/shared-types)
├── nginx/                # Nginx reverse proxy config
├── docker-compose.yml    # Development stack
├── docker-compose.prod.yml # Production stack
└── .env.example          # Environment variable template
```

## Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **Docker** >= 24.0 & **Docker Compose** >= 2.0
- **PostgreSQL** 16 (or use Docker)
- **Redis** 7 (or use Docker)

## Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/your-org/whatsapp-pro.git
cd whatsapp-pro
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your actual values
```

### 3. Start Infrastructure (Docker)

```bash
# Start PostgreSQL and Redis
docker-compose up -d postgres redis

# Or start the full stack
docker-compose up -d
```

### 4. Database Setup

```bash
# Run migrations
npm run db:migrate

# Seed development data
npm run db:seed

# Open Prisma Studio (GUI)
npm run db:studio
```

### 5. Start Development Servers

```bash
# Start both backend and web concurrently
npm run dev

# Or individually:
npm run dev --workspace=server       # http://localhost:3001
npm run dev --workspace=client/web   # http://localhost:3000
```

### 6. Mobile (Expo)

```bash
cd client/mobile
npm install
npx expo start
```

## API Documentation

Once the backend is running, visit:
- **Swagger UI**: http://localhost:3001/api/docs
- **OpenAPI JSON**: http://localhost:3001/api/docs-json

## Environment Variables Reference

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `REDIS_URL` | Redis connection string | ✅ |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | ✅ |
| `JWT_REFRESH_SECRET` | JWT refresh token secret | ✅ |
| `AWS_S3_BUCKET` | S3 bucket for media storage | ✅ |
| `AWS_S3_REGION` | AWS region | ✅ |
| `AWS_ACCESS_KEY_ID` | AWS access key | ✅ |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | ✅ |
| `TWILIO_ACCOUNT_SID` | Twilio account SID for OTP | ✅ |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | ✅ |
| `TWILIO_PHONE_NUMBER` | Twilio sender phone number | ✅ |
| `FIREBASE_PROJECT_ID` | Firebase project ID | ✅ |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key | ✅ |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email | ✅ |
| `WEBRTC_TURN_SERVER_URL` | TURN server URL for WebRTC calls | ✅ |
| `WEBRTC_TURN_USERNAME` | TURN server username | ✅ |
| `WEBRTC_TURN_CREDENTIAL` | TURN server password | ✅ |
| `NODE_ENV` | `development` or `production` | ✅ |
| `PORT` | Backend server port (default: 3001) | ❌ |
| `FRONTEND_URL` | Web frontend URL for CORS | ✅ |
| `CORS_ORIGINS` | Comma-separated allowed origins | ✅ |

## Production Deployment

### Using Docker Compose (Recommended)

```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Start production stack
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f backend
```

### Manual Deployment

```bash
# Build all packages
npm run build

# Start backend in production mode
NODE_ENV=production node server/dist/src/main.js

# Serve web static files via nginx
# (see nginx/nginx.conf)
```

## Key Features

- 📱 **Real-time messaging** via Socket.IO
- 🔒 **End-to-end encryption** ready architecture  
- 📸 **Media sharing**: images, videos, documents, voice messages
- 🎥 **Audio/Video calls** via WebRTC
- 👥 **Groups & Communities** with admin controls
- 📊 **Status updates** (stories) with privacy controls
- 🔔 **Push notifications** via Firebase
- 📞 **Phone verification** via Twilio OTP
- 🌙 **Dark/Light mode** support
- 🗑️ **Disappearing messages**
- ⭐ **Starred messages**
- 📍 **Location sharing**
- 🗳️ **Polls**
- 👁️ **View once** media
- 🔇 **Mute conversations**
- 🚫 **Block users**
- 🔐 **Two-factor authentication**
- 📋 **Audit logs**
- 🛡️ **Report system**

## Development

### Running Tests

```bash
npm run test
npm run test --workspace=server      # backend only
npm run test --workspace=client/web  # web only
```

### Linting & Formatting

```bash
npm run lint
npm run format
```

### Database Management

```bash
# Create a new migration
npx prisma migrate dev --name your_migration_name --schema=server/prisma/schema.prisma

# Reset database (WARNING: destroys all data)
npx prisma migrate reset --schema=server/prisma/schema.prisma
```

## Architecture

```
Client (Web/Mobile)
       │
       ▼
   [ Nginx ]
   /       \
  ▼         ▼
[Web]    [Backend API + WebSocket]
              │
         ┌────┴────┐
         ▼         ▼
    [PostgreSQL]  [Redis]
         │
    [Prisma ORM]
```

## License

MIT © WhatsApp Pro Team
