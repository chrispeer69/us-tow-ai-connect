# Engineering Assumptions & Decisions

This document captures every non-obvious decision taken while building US Tow AI-Connect across Sessions 1, 2, 4, 5, 6, 7, 8 (skipping 3, 9, 10) per the founder's mandate.

Note: the BUILD_SESSIONS.md document was updated upstream during this build. The first attempt at Session 1 used the older adapter shape (`lookupByPhone`); after pulling the updated spec, Session 1 was rewritten to match the new `login() / scrapeAllActiveJobs() / testConnection()` interface. The original Session 1 commit on `main` is the rewritten version that aligns with the updated spec.

## Session 1 — Adapter engine, Playwright, session manager

- **Adapter interface** matches the new spec verbatim: `login`, `scrapeAllActiveJobs`, `testConnection`. Returns `ActiveJob[]` instead of single ETA lookup.
- **Playwright launch args.** Headless Chromium with `--no-sandbox`, `--disable-dev-shm-usage` — required for containerized headless use (Railway/Docker).
- **Session TTL.** 1 hour in Redis per `SESSION_TTL_SECONDS = 3600` (matches spec table in Session 2).
- **Jobs cache TTL.** 5 minutes (`jobs:towbook:{tenantId}` key).
- **Row selectors.** The spec's CSS selectors (`.call-row, .dispatch-row, tr[data-callid]`) and column-index fallbacks are passed through unchanged. Result-row extraction is best-effort because TOWBOOK_DOM_MAP.md doesn't pin down exact selectors. Flagged for human verification against a live Towbook account.
- **Tabs scanned.** `#atActive`, `#atWaiting`, `#atCurrent`. Missing tabs are tolerated. De-duplication by `jobId` (or composite key when no ID).
- **EncryptionUtil.** AES-256-GCM. The spec sketch reuses the same IV + authTag for two ciphertexts, which is cryptographically invalid (GCM auth tag is per-ciphertext). I deviated: each encrypt generates a fresh 12-byte IV and produces its own authTag; the credentials table stores `<u-iv>:<p-iv>` and `<u-tag>:<p-tag>` in single text columns so the schema shape remains as the spec suggests but cryptography stays sound. The `decrypt(uEnc, pEnc, ivPair, tagPair)` helper splits these and decrypts each independently.
- **Dev fallback for ENCRYPTION_KEY.** If unset or malformed, derives a fixed dev key from the constant `ustow-dev-key-do-not-use-in-prod`. Production must set a 64-hex `ENCRYPTION_KEY`.
- **SessionManagerService.refreshExpiringSessions.** `@Cron('0 */15 * * * *')` per spec. Skipped when `DATABASE_URL` is unset (allows API to boot without DB). Refresh when TTL < 600s (10 min) or missing. On failure: sets `session_status=FAILED` and dispatches `NotificationService.sendSessionAlert`.
- **NotificationService.** Soft-imports `@sendgrid/mail`. Falls back to Pino/console logging if the package or `SENDGRID_API_KEY` is unavailable.
- **AdapterFactory.** Switches on `SoftwareType`. Only Towbook is wired; other types throw a clear "not implemented" error rather than silently fall back.

## Session 2 — Active job poller

- **Cron expression.** `@Cron('*/60 * * * * *')` — every 60 seconds, per spec.
- **Overlap guard.** `isRunning` flag. If the prior cycle hasn't finished, the new firing logs and returns.
- **Concurrency.** Process tenants 5 at a time with `Promise.allSettled`. Failures isolated per tenant.
- **Session-expired fallback.** When a tenant's scrape throws `SessionExpiredException`, immediately calls `SessionManagerService.refreshExpiringSessions()` to recover that tenant (and any others that need it).

## Session 4 — Database schema & migrations

- **Drizzle ORM** with `node-postgres` driver. `drizzle.config.ts` reads `DATABASE_URL` from `.env`.
- **Credential storage columns.** Spec uses 32-char varchar for `encryption_iv` and `auth_tag`. I widened both to `text` to fit the IV/authTag pairs documented above.
- **`api_key_prefix` column.** Widened from 10 → 16 chars to accommodate the `usk_xxxxxxxx` (12-char) prefix used in `apiKeyHash` generation.
- **Timestamps.** All `timestamp` columns are `withTimezone: true` for unambiguous ISO serialization.
- **Outbound call logs.** Included in schema even though Session 9 is skipped, because the foreign-key relations live on `tenants`.
- **Relations.** All bidirectional relations defined so `db.query.tenants.findMany({ with: { credentials: true } })` works.

## Session 5 — REST endpoints & auth

- **API key shape.** `usk_<24 random base62>`. Prefix `usk_xxxxxxxx` (12 chars) stored in `apiKeyPrefix`; full key bcrypt-hashed (cost 10) in `apiKeyHash`.
- **`ApiKeyGuard`.** Extracts `x-api-key` header, looks up tenant by prefix, bcrypt-compares. Attaches `req.tenantId` and `req.tenant` on success. 401 on any failure.
- **`RateLimitGuard`.** Redis `INCR` + `EXPIRE` per 60s window keyed on `ratelimit:{apiKeyPrefix}` (per spec). 60 req/min. Returns 429 via `TooManyRequestsException` when exceeded.
- **JWT for admin.** The spec mentions `JwtAuthGuard` for the admin controller. Since no JWT issuance flow is specified, the admin guard accepts a `x-tenant-id` header in development (defaulting to `default-tenant`) and is documented as a placeholder. Flagged for human review.
- **Zod validation pipe** returns 400 with `{ status: 'error', code: 'VALIDATION_ERROR', errors: [...] }`. Used on `/log-interaction`, admin credentials save, routing-rule create, agent-config update.
- **`/lookup-eta` substitute.** The new spec's `/v1/ai-connect` only exposes `transfer-route` and `log-interaction`. The poller pushes job data into Redis for Thinkrr's Knowledge Pack (Session 3, intentionally skipped). I therefore did NOT build a `/lookup-eta` endpoint — the data lives in `jobs:towbook:{tenantId}` and would be served via the Knowledge Pack sync that Session 3 owns. Flagged: when Session 3 is built, that consumer can read directly from Redis.
- **Admin endpoints** wire to the same `db`+`encryption`+`adapter` services. `POST /v1/admin/credentials` encrypts username/password (independent IVs), upserts the tenant credentials row, marks `session_status=PENDING`. `POST /v1/admin/credentials/test` does an in-band Playwright login.

## Session 6 — Admin dashboard: integrations

- **Next.js 15 App Router** with Tailwind + shadcn/ui components copied locally under `src/components/ui/`.
- **Dark theme.** Body `bg-zinc-950 text-zinc-100`. Sidebar `bg-zinc-900`. Accent `emerald-500`.
- **API proxy.** Web routes call `/api/v1/...`; this is rewritten via `next.config.js` `rewrites()` to the NestJS service at `process.env.NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3001`). Means front-end and back-end can share the same origin in production behind a reverse proxy.
- **Auth in dashboard.** Sends a static `x-tenant-id` header in development, matching the API's placeholder JWT guard. Real JWT flow flagged.

## Session 7 — Routing rules & agent config screens

- **Service toggle state shape.** `{ [serviceKey]: { enabled: boolean, classes: { [vehicleClass]: 'AI_HANDLES' | 'TRANSFER' | 'NOT_OFFERED' } } }`. Persisted to `ai_agent_configs.service_toggles` JSONB.
- **Vehicle classes default** to `AI_HANDLES` once the master toggle flips on (matching the spec's default Select value).
- **Unsaved changes indicator.** Hooks: any toggle/input change sets `hasChanges=true`; `save()` resets to false on 2xx.

## Session 8 — Call logs screen

- **Pagination.** Server returns `{ items, total, page, totalPages }`. Hard-capped at 100 rows per page server-side; client requests 25.
- **CSV export.** Same endpoint with `format=csv` query param; server streams `text/csv` with RFC 4180 escaping.
- **Default date range.** Front-end does not send `date_from`/`date_to` unless the user picks them; server defaults to "all time" for the export and last 30 days for the table.

## Items flagged for human review

1. Towbook DOM selectors for active rows are inherited from the spec but were not verified against a live account. Verify before production traffic.
2. Admin dashboard authentication is a placeholder (`x-tenant-id` header). Replace with a real JWT login flow before exposing to multiple tenants.
3. The `/v1/ai-connect/lookup-eta` endpoint from the older spec was intentionally omitted; the new architecture pushes data via the Knowledge Pack (Session 3, skipped). Confirm Thinkrr.ai consumption path is acceptable.
4. CORS policy on the API is permissive (`cors: true`) for development.
5. SendGrid sender domain authentication must be configured before alert emails will deliver.
6. Drizzle migration step requires a live Postgres at `DATABASE_URL`; CI/CD wiring for `pnpm db:migrate` is part of Session 10 (skipped).
7. EncryptionUtil deviates from the spec's IV/authTag sharing pattern for cryptographic correctness. Verify with the security-review skill before launch.
