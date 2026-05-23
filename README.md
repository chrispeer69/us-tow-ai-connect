# US Tow AI-Connect

**Owner:** Blue Collar AI (Chris Peer)  
**Purpose:** Middleware connector bridging Thinkrr.ai voice agents with towing management software (Towbook, TowLogs, Omadi) via headless browser automation.  
**Domain:** www.ustowdispatch.com  

## Architecture

This is a **pnpm monorepo** with three packages:

```
us-tow-ai-connect/
├── packages/
│   ├── api/          # NestJS 10 backend (Node.js 22)
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── ai-connect/       # Thinkrr.ai API endpoints
│   │       │   ├── session-manager/   # Redis session pooling engine
│   │       │   └── adapters/          # The Adapter Layer (The Moat)
│   │       │       ├── adapter.interface.ts
│   │       │       ├── towbook/       # Playwright scraper for Towbook
│   │       │       ├── towlogs/       # Playwright scraper for TowLogs
│   │       │       ├── omadi/         # Playwright scraper for Omadi
│   │       │       └── native/        # Direct DB query (US Tow Dispatch)
│   │       └── common/
│   │           ├── guards/            # API Key AuthGuard
│   │           ├── decorators/        # Custom decorators
│   │           ├── utils/             # AES-256 encryption, helpers
│   │           └── dto/               # Zod-validated DTOs
│   ├── web/          # Next.js 15 admin dashboard (React 19)
│   │   └── src/app/
│   │       └── admin/
│   │           ├── integrations/      # Credential management
│   │           ├── routing/           # Transfer number rules
│   │           ├── calls/             # Call logs
│   │           ├── ai-agent/          # AI agent config (services, greeting)
│   │           ├── company/           # Company profile
│   │           ├── members/           # Team management
│   │           ├── api-keys/          # API key generation
│   │           └── billing/           # Stripe billing
│   └── shared/       # Shared Zod schemas & TypeScript types
│       └── src/
│           ├── schemas/               # Zod validation schemas
│           ├── types/                 # Shared TypeScript interfaces
│           └── constants/             # Enums, config constants
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .env.example
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Monorepo | pnpm workspaces |
| Language | TypeScript 5.4 (strict) |
| Backend | NestJS 10, Node.js 22 |
| Frontend | Next.js 15, React 19, Tailwind, shadcn/ui |
| Database | PostgreSQL 16 (Railway), Drizzle ORM |
| Browser Automation | Playwright 1.43+ |
| Cache | Redis 7 (Railway) |
| Auth | JWT + bcrypt (dashboard), API Key (Thinkrr) |
| Encryption | AES-256-GCM (credentials at rest) |
| Hosting | Railway |
| CI/CD | GitHub Actions |
| Observability | Sentry + Pino |

## Getting Started

```bash
pnpm install
cp .env.example .env
# Fill in your environment variables
pnpm dev:api   # Starts NestJS on port 3001
pnpm dev:web   # Starts Next.js on port 3000
```

## Build & Workspace Dependencies

`@ustow/api` and `@ustow/web` both depend on `@ustow/shared` (workspace package) for Zod schemas and shared types. `@ustow/shared` is consumed as its compiled output (`packages/shared/dist/`), **not** its source, so the API and web builds will fail with `TS2305: Module '"@ustow/shared"' has no exported member ...` whenever the dist is missing or stale.

To prevent that, the `api` and `web` packages have a `prebuild` script:

```json
"prebuild": "pnpm --filter @ustow/shared build"
```

pnpm runs `prebuild` automatically before `build`, so `pnpm --filter @ustow/api build` (or `... @ustow/web build`) will always compile `@ustow/shared` first. **Rule:** any time you add a new export to `packages/shared/src/`, do not run `tsc` directly in `packages/api` — use `pnpm --filter @ustow/api build` so the prebuild hook fires, or run `pnpm --filter @ustow/shared build` manually first.

## Deployment

The production deployment lives on [Railway](https://railway.app) — two app
services (`api`, `web`) plus managed Postgres and Redis. The repo ships
with everything Railway needs:

| File / dir                    | Purpose                                           |
|-------------------------------|---------------------------------------------------|
| `railway.toml`                | Service definitions + healthchecks + pre-deploy   |
| `packages/api/Dockerfile`     | Multi-stage NestJS build with Playwright Chromium |
| `packages/web/Dockerfile`     | Multi-stage Next.js standalone build              |
| `.github/workflows/deploy.yml`| Type-check + tests pre-deploy gate                |
| `infra/railway/README.md`     | Topology diagram                                  |
| `scripts/post-deploy-smoke.sh`| Hits prod URLs and fails on the first regression  |

Full step-by-step runbook (env vars, custom domain, migrations, rollback,
Thinkrr cutover): **`docs/DEPLOY_RAILWAY.md`**. Decisions and trade-offs
are captured in `docs/ASSUMPTIONS.md` (Session 10 section).

## Thinkrr.ai Integration

End-to-end integration with Thinkrr's voice agent is wired through three
surfaces (all introduced in Session 23 — see `docs/THINKRR_INTEGRATION.md`
for the full runbook):

### Public endpoints

| Verb / Path                                                  | Purpose                                  |
|--------------------------------------------------------------|------------------------------------------|
| `GET /public/knowledge/:tenantId/profile.md`                 | Knowledge Pack URL pulled by Thinkrr     |
| `POST /webhooks/thinkrr/:secret/call-completed`              | Call-completion webhook (URL secret)     |
| `POST /webhooks/thinkrr/call-completed`                      | Legacy unsecured route (dev only)        |

### Tenant-authenticated agent endpoints (`X-Tenant-API-Key`)

| Verb / Path                                       | Purpose                                              |
|---------------------------------------------------|------------------------------------------------------|
| `GET  /v1/ai-connect/transfer-route`              | Active dispatch transfer rule                        |
| `GET  /v1/ai-connect/lookup/by-phone?phone=…`     | Find an active Towbook/AAA job by caller phone       |
| `GET  /v1/ai-connect/eta?lat=…&lng=…`             | Default ETA (driver-GPS deferred — see ASSUMPTIONS)  |
| `GET  /v1/ai-connect/services`                    | Service list (merged toggles + knowledge pack)       |
| `POST /v1/ai-connect/dispatch-request`            | Create dispatch ticket + SMS the dispatcher          |
| `POST /v1/ai-connect/smart-action`                | Generic command pipe (CREATE_DISPATCH, TRANSFER_TO_HUMAN, …) |
| `POST /v1/ai-connect/log-interaction`             | Append to the legacy aggregated interaction_logs     |
| `POST /v1/driver-pings`                           | Driver location ping (Sessions 23)                   |
| `POST /v1/driver/push/subscribe`                  | Driver web-push subscription (Session 25)            |
| `GET  /v1/driver/jobs/active?driver_phone=`       | Driver's current active job (Session 25)             |
| `GET  /v1/driver/jobs/queue?driver_phone=`        | Driver's assigned but inactive jobs (Session 25)     |
| `GET  /v1/driver/jobs/history?driver_phone=`      | Driver's completed jobs, last 30 days (Session 25)   |
| `POST /v1/driver/jobs/:job_id/status?driver_phone=` | Driver state transition (Session 25)              |

### Admin endpoints (placeholder `x-tenant-id` header)

| Verb / Path                                  | Purpose                                                |
|----------------------------------------------|--------------------------------------------------------|
| `GET /v1/admin/interaction-logs`             | Aggregated, categorized call list (existing screen)    |
| `GET /v1/admin/call-interactions`            | Raw Thinkrr payloads w/ transcript, summary, match    |
| `GET /v1/admin/smart-actions`                | Audit log of agent-issued Smart Actions               |
| `GET /v1/admin/dispatch-requests`            | New tow requests created by the agent                 |
| `GET /v1/admin/driver-pings/latest`          | Latest ping per driver (Session 23)                    |
| `GET /v1/admin/driver-pings/:phone/history`  | Per-driver ping history (Session 23)                   |
| `GET /v1/admin/convini/incoming`             | Convini SMS landing pad (Session 25)                   |
| `GET /v1/admin/command-center/*`             | Sessions 21 dispatch board — see [COMMAND_CENTER](docs/COMMAND_CENTER.md) |
| `GET /v1/admin/digital-dispatch/*`           | Sessions 22 rules engine — see [DIGITAL_DISPATCH](docs/DIGITAL_DISPATCH.md) |

### Admin UI

| Path                            | Description                                          |
|---------------------------------|------------------------------------------------------|
| `/admin/command-center`         | Live dispatch board (map + table + side drawer)      |
| `/admin/digital-dispatch`       | Rules / decisions / stats / test sandbox             |
| `/admin/drivers-live`           | Live drivers map — table + map + history side panel (Session 25) |

### Driver App (Session 25)

| Path                       | Description                                            |
|----------------------------|--------------------------------------------------------|
| `/driver`                  | Mobile PWA — active job + queue + ping                 |
| `/driver/map`              | Full-screen Google Maps with driver + pickup markers   |
| `/driver/history`          | Completed jobs, last 30 days                           |
| `/driver/profile`          | Driver name, phone, ping interval, GPS accuracy        |

See [`docs/DRIVER_APP.md`](docs/DRIVER_APP.md) for the full workflow guide,
PWA install instructions, and the state-machine reference.

### Operational endpoints

| Verb / Path                          | Purpose                                            |
|--------------------------------------|----------------------------------------------------|
| `GET  /health`                       | Liveness — 200 once Nest finished booting          |
| `GET  /health/ready`                 | Readiness — 200 only when Postgres + Redis are up  |
| `POST /webhooks/twilio/flip-response`<br>`POST /webhooks/twilio/convini-response`<br>`POST /webhooks/twilio/call-status` | Twilio TwiML callbacks (HMAC-SHA1 signature required when `TWILIO_AUTH_TOKEN` is set) |
| `POST /webhooks/twilio/convini-sms-inbound` | Convini inbound SMS receiver (Session 25, stub) |

### Smoke test

```bash
BASE_URL=http://localhost:3001 \
TENANT_API_KEY=usk_xxxxxxxx... \
THINKRR_SECRET=<value from .env> \
scripts/smoke-test.sh
```

## Build Sessions

This project is built in sequential sessions. See `docs/BUILD_SESSIONS.md` for the engineering prompts and `docs/THINKRR_INTEGRATION.md` for the Session-23 Thinkrr runbook.
