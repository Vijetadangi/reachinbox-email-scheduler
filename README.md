# ReachInbox — Full-Stack Email Job Scheduler

A production-grade email scheduling system built for the ReachInbox engineering assignment. It lets you schedule single or bulk emails via a clean dashboard, backed by BullMQ + Redis for persistent job queuing and PostgreSQL for durable state.

---

## What's inside

```
ReachInbox/
├── backend/          Express + BullMQ + PostgreSQL + Ethereal
├── frontend/         Next.js 14 + Tailwind CSS + TypeScript
└── docker-compose.yml  PostgreSQL + Redis via Docker
```

---

## Quick start

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL on `5432` and Redis on `6379`, with persistent volumes so data survives restarts.

### 2. Backend setup

```bash
cd backend
cp .env.example .env
# Fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (see Google OAuth section below)
npm install

# Run DB migrations (creates all tables)
npm run migrate

# Start the API server
npm run dev

# In a separate terminal — start the BullMQ worker
npm run worker
```

The server starts on `http://localhost:4000`.

### 3. Frontend setup

```bash
cd frontend
cp .env.local.example .env.local
# Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to your Google OAuth client ID
npm install
npm run dev
```

The frontend starts on `http://localhost:3000`.

---

## Environment variables

### Backend `.env`

| Variable | Description | Default |
|---|---|---|
| `PORT` | API server port | `4000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/reachinbox` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `JWT_SECRET` | JWT signing secret | *(change this)* |
| `GOOGLE_CLIENT_ID` | Google OAuth app client ID | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth app client secret | — |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | `http://localhost:4000/api/auth/google/callback` |
| `FRONTEND_URL` | Frontend base URL for CORS + redirects | `http://localhost:3000` |
| `ETHEREAL_USER` | Ethereal SMTP user (optional — auto-created if blank) | — |
| `ETHEREAL_PASS` | Ethereal SMTP password | — |
| `MAX_EMAILS_PER_HOUR` | Global hourly email limit | `200` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Per-sender hourly limit | `50` |
| `WORKER_CONCURRENCY` | BullMQ worker concurrency | `5` |
| `MIN_SEND_DELAY_MS` | Minimum gap between consecutive sends (ms) | `2000` |

### Frontend `.env.local`

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API base URL |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth client ID |

---

## Google OAuth setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create an OAuth 2.0 Client ID (Web application).
3. Add `http://localhost:4000/api/auth/google/callback` as an authorized redirect URI.
4. Copy the Client ID and Secret into `backend/.env`.

---

## Ethereal Email setup

Ethereal is a fake SMTP service — emails are captured for inspection but never actually delivered. It's perfect for testing.

**Auto-setup (recommended):** Leave `ETHEREAL_USER` and `ETHEREAL_PASS` blank in `.env`. On first start, the server automatically creates a test account and logs the credentials:

```
[INFO]: Ethereal credentials (save these to .env):
  ETHEREAL_USER: youruser@ethereal.email
  ETHEREAL_PASS: generatedpassword
```

Copy those into `.env` to reuse the same inbox across restarts.

**Manual:** Create an account at [ethereal.email](https://ethereal.email) and paste credentials.

View captured emails at `https://ethereal.email/messages` after logging in.

---

## API reference

### Auth

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/google` | Redirect to Google consent screen |
| `GET` | `/api/auth/google/callback` | OAuth callback — issues JWT |
| `POST` | `/api/auth/google/token` | Exchange Google ID token for JWT (SPA flow) |
| `GET` | `/api/auth/me` | Get current user |
| `POST` | `/api/auth/logout` | Client-side logout |

### Emails

All email routes require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/emails/schedule` | Schedule a single email |
| `POST` | `/api/emails/schedule/bulk` | Schedule a bulk campaign (CSV or JSON list) |
| `POST` | `/api/emails/parse-csv` | Parse a CSV and return detected email addresses |
| `GET` | `/api/emails/scheduled` | List scheduled emails (paginated) |
| `GET` | `/api/emails/sent` | List sent/failed emails (paginated) |
| `GET` | `/api/emails/:id` | Get a single email job |
| `DELETE` | `/api/emails/:id` | Cancel a scheduled email |
| `GET` | `/api/emails/stats/queue` | BullMQ queue statistics |
| `GET` | `/api/emails/stats/rate-limit` | Current rate limit counters |

### Senders

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/senders` | List your email senders |
| `POST` | `/api/senders` | Create a new sender (auto-creates Ethereal account) |
| `DELETE` | `/api/senders/:id` | Delete a sender |

---

## Architecture overview

### How scheduling works

```
User submits form
      │
      ▼
POST /api/emails/schedule
      │
      ├─ Write job record to PostgreSQL (status = 'scheduled')
      │
      └─ Add delayed job to BullMQ queue in Redis
              │  (delay = scheduledAt - now)
              │
              ▼  [at scheduled time]
         BullMQ Worker picks up job
              │
              ├─ Idempotency check (skip if already sent)
              ├─ Rate limit check (Redis counter)
              ├─ Enforce min delay between sends (2s)
              ├─ Send via Ethereal SMTP
              └─ Update PostgreSQL (status = 'sent', preview_url)
```

BullMQ stores delayed jobs as entries in a Redis sorted set, keyed by their fire timestamp. When the worker polls Redis and the timestamp has passed, the job moves to the active queue and gets processed. **This all happens in Redis, not in memory**, so server restarts don't lose any scheduled work.

### How persistence on restart is handled

- All job state lives in two places: PostgreSQL (source of truth) and Redis (BullMQ queue).
- BullMQ's Redis persistence is durable because Docker Redis is configured with `appendonly yes` (AOF).
- If the server restarts before a job fires, BullMQ re-hydrates from Redis and the job fires on schedule.
- If Redis is also lost (unlikely with AOF), jobs can be recovered from the `email_jobs` table. Any job with `status = 'scheduled'` and a future `scheduled_at` can be re-enqueued with a simple recovery script.

### How rate limiting works

Rate limiting uses **Redis atomic counters** — safe across multiple workers and multiple server instances.

**Key format:** `rate_limit:{senderId}:{YYYY-MM-DD-HH}` with a 1-hour TTL.

When a worker picks up a job:
1. It atomically `INCR` the per-sender and global counters using a Redis pipeline.
2. If either counter exceeds its limit, both are rolled back (`DECR`) and the job is moved to delayed with `retryAfterMs = ms until next hour window`.
3. Jobs are **never dropped** — they get rescheduled to the next hour, preserving relative order as much as BullMQ's delay mechanism allows.

**BullMQ limiter** is also configured as a secondary safety net, capping total job starts per hour at the global limit.

**Delay between sends:** The worker tracks `lastSendTime` and waits if less than `MIN_SEND_DELAY_MS` has elapsed since the previous send. Set to `2000ms` by default.

### Behavior under load (1000+ emails)

When 1000 emails are scheduled for the same time:

1. All 1000 jobs enter the BullMQ delayed queue at once (just Redis sorted set entries — cheap).
2. At fire time, BullMQ moves them to active, respecting the `concurrency` setting (default 5 concurrent workers).
3. The first batch of workers to execute check Redis counters. Once the per-sender limit (50/hour) is hit, those workers reschedule excess jobs to the next hour window.
4. The `MIN_SEND_DELAY_MS` enforcement ensures sends are spaced out even within the concurrency window.
5. No jobs are lost — they cascade through hour windows until all are sent.

This trades throughput for safety, which matches real-world email provider expectations.

### Idempotency

Every email job gets an `idempotency_key` (deterministic for bulk campaigns: `campaign:{id}:{email}:{time}`). Before any send attempt, the worker checks if a job with that key already has `status = 'sent'`. If so, it skips silently. This prevents double-sends on:
- Worker crashes and restarts
- BullMQ job retries
- Accidental duplicate API calls

---

## Features implemented

### Backend
- [x] Express REST API with TypeScript
- [x] PostgreSQL schema with migrations
- [x] BullMQ delayed jobs (no cron)
- [x] Persistent job queue (survives restarts via Redis AOF)
- [x] Single email scheduling
- [x] Bulk email scheduling from CSV or JSON list
- [x] BullMQ worker with configurable concurrency (default: 5)
- [x] Minimum delay between sends (default: 2000ms)
- [x] Per-sender rate limiting via Redis atomic counters
- [x] Global rate limiting via Redis atomic counters
- [x] Rate-exceeded jobs rescheduled to next hour (never dropped)
- [x] Idempotency — duplicate sends blocked by key check
- [x] Ethereal SMTP integration with preview URLs
- [x] Multiple sender support (each sender = separate Ethereal account)
- [x] Google OAuth 2.0 (real, not mocked)
- [x] JWT authentication middleware
- [x] CSV parsing endpoint
- [x] Cancel scheduled email endpoint
- [x] Queue stats endpoint
- [x] Graceful shutdown handling
- [x] Structured logging with Winston

### Frontend
- [x] Google OAuth login (real flow)
- [x] JWT session management with localStorage
- [x] Auth context with auto-restore on refresh
- [x] Dashboard with tab navigation
- [x] Compose modal — single and bulk modes
- [x] CSV upload with email count preview
- [x] Scheduled emails table with cancel action
- [x] Sent emails table with Ethereal preview links
- [x] Queue stats bar (auto-refreshes every 10s)
- [x] Pagination on both tables
- [x] Loading states and empty states
- [x] Toast notification system
- [x] Sender management (create/select)
- [x] Fully typed with TypeScript
- [x] Responsive layout

---

## Trade-offs and assumptions

- **Ethereal for all SMTP** — real credentials aren't needed because Ethereal captures everything. In production you'd swap nodemailer transport for SendGrid/SES/Postmark.
- **In-memory `lastSendTime` per worker** — the minimum delay between sends is tracked per worker process, not globally. If you run 3 worker processes, each independently enforces the delay. This is acceptable for the assignment but in production you'd use a Redis lock or a BullMQ limiter for global enforcement.
- **JWT without refresh tokens** — tokens expire after 7 days. Production systems would use short-lived access tokens + refresh tokens.
- **No email template engine** — the body field accepts raw HTML. A production system would use Handlebars or MJML.
- **Single-tenant rate limiting key** — the global key uses `rate_limit:global:{hour}`. Multi-tenant production systems would key by organization ID.
