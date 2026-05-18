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

## Build Sessions

This project is built in 10 sequential sessions. See `docs/BUILD_SESSIONS.md` for the exact engineering prompts for each session.
