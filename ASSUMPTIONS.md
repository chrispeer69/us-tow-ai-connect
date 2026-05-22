# Engineering Assumptions & Decisions

This document captures every non-obvious decision taken while building US Tow AI-Connect across Sessions 1, 2, 4, 5, 6, 7, 8 (skipping 3, 9, 10) per the founder's mandate.

Note: the BUILD_SESSIONS.md document was updated upstream during this build. The first attempt at Session 1 used the older adapter shape (`lookupByPhone`); after pulling the updated spec, Session 1 was rewritten to match the new `login() / scrapeAllActiveJobs() / testConnection()` interface. The original Session 1 commit on `main` is the rewritten version that aligns with the updated spec.

## Session 1 — Adapter engine, Playwright, session manager

- **Adapter interface** matches the new spec verbatim: `login`, `scrapeAllActiveJobs`, `testConnection`. Returns `ActiveJob[]` instead of single ETA lookup.
- **Playwright launch args.** Headless Chromium with `--no-sandbox`, `--disable-dev-shm-usage` — required for containerized headless use (Railway/Docker).
- **Session TTL.** 1 hour in Redis per `SESSION_TTL_SECONDS = 3600` (matches spec table in Session 2).
- **Jobs cache TTL.** 5 minutes (`jobs:towbook:{tenantId}` key).
- **Row selectors.** Verified 2026-05-22 against a live Towbook DS4 dashboard with 3 active jobs. Call rows are `<li class="entryRow" data-id="<callId>">` children of `<ul id="dcslist">` — the spec's `.call-row / .dispatch-row / tr[data-callid]` guesses match zero elements. Row selector is now `li.entryRow[data-id]`. Field extraction uses Towbook's legacy column-id model: `[columnid="2"]` vehicle, `[columnid="4"]` ETA, `[columnid="5"]` driver, `[columnid="14"]` status, `[columnid="22"]` contact (name + phone parsed via regex). No `destination` column exists on the DS4 row; field is left blank pending a separate detail-view scrape.
- **Tabs scanned.** None — all active calls render in `#dcslist` on the landing dispatch page. The earlier `#atActive` / `#atWaiting` / `#atCurrent` clicks targeted IDs that do not exist on DS4 and were silently swallowed. De-duplication by `jobId` (or composite key when no ID) is retained for safety.
- **Diagnostic dump.** Selector counts for the verified + legacy guesses are always logged (`[towbook-debug]` prefix) so DOM regressions surface immediately. Raw HTML is dumped to `os.tmpdir()` only when `TOWBOOK_DEBUG_DUMP=1`.
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

## Session 3 — Thinkrr Knowledge Pack URL + webhook receiver

- **Knowledge endpoint route.** `GET /public/knowledge/:tenantId/profile.md`. No auth guard. UUID-shaped tenantId enforced at the controller so the DB lookup is short-circuited on malformed paths. `Cache-Control: public, max-age=60` so Thinkrr's scraper sees current data within a minute.
- **Tenant resolution in webhook.** The spec only checks `tenants.assignedPhoneNumber` against `to_number || agent_phone`. I extended the resolver to fall through three options in priority order: explicit `tenant_id` in payload → `thinkrrAgentId` match on `agent_id` → assigned phone number. This means a tenant can be matched even if Thinkrr changes its phone-number field shape, and it lets ops include `tenant_id` directly when configuring the webhook URL per tenant.
- **Shared-secret verification via URL path.** Thinkrr cannot attach auth headers to webhooks, so the secret is carried in the path: `POST /webhooks/thinkrr/:secret/call-completed`. The Thinkrr dashboard is configured with `${PUBLIC_BASE_URL}/webhooks/thinkrr/${THINKRR_WEBHOOK_SECRET}/call-completed`. The handler does a `timingSafeEqual` against `process.env.THINKRR_WEBHOOK_SECRET`. If the env var is unset (dev), any value in the slot is accepted and a warning is logged. An unsecured legacy route `/webhooks/thinkrr/call-completed` is retained but returns 401 if the env var IS set, to nudge ops toward the secured URL.
  - **Earlier draft** used HMAC-SHA256 of the raw request body in `X-Webhook-Signature`, which required `express.json({ verify })` in `main.ts` to preserve `req.rawBody`. That `main.ts` change was reverted intentionally by the founder/linter, so the URL-secret approach was adopted instead — same goal (mutual secret), no global body-parser changes, and resilient to Thinkrr's lack of header support.
- **Webhook acceptance shape.** Returns HTTP 200 with `{ received: true, accepted: <bool>, reason?: <string> }` even for unknown tenants — Thinkrr should not retry on our miscategorization, only on real 5xx failures.
- **Summary truncation.** `interactionLogs.summary` is `text`, but I trim to 2000 chars to bound row size in case Thinkrr sends a full transcript when only a summary was requested.
- **`KnowledgeEndpointService.generateTenantMarkdown` fallback for activeRule.** Uses the related rows if available (loaded via `with: { routingRules }`), and falls back to a direct `routing_rules` query ordered by `priority_order` when none of the related rows have `is_active_now = true`. Matches the resolution that `AiConnectService.getActiveTransferRoute` performs for the authenticated `/v1/ai-connect/transfer-route` endpoint.
- **Body parser change.** Switched `main.ts` from Nest's default body parser to an explicit `express.json({ verify })` so the raw body is preserved on `req.rawBody` for HMAC verification. `urlencoded` is also re-registered so Twilio form-encoded webhooks (Session 9) continue to work.

## Session 9 — Outbound engine (Twilio + Google Places + flip logic)

- **Twilio SDK.** Added `twilio@^6` as a direct dep (was missing). Service constructor soft-fails when `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` are missing or still placeholders (`REPLACE_ME_*`); calls are then no-ops and a warning is logged, so the rest of the system keeps running locally without real Twilio credentials.
- **`PUBLIC_BASE_URL` vs spec's `API_BASE_URL`.** Spec uses `process.env.API_BASE_URL` in two TwiML callback URLs. We standardize on `PUBLIC_BASE_URL` (the variable established in Task 1) for both the Knowledge Pack URL and Twilio callbacks. `API_BASE_URL` is **not** referenced anywhere — fewer env vars, single source of truth.
- **TwiML escaping.** The spec interpolates `${customerName}`, `${vehicle}`, `${pickupLocation}`, `${destination}`, `${nearestOurShop}` directly into TwiML strings, which breaks if any value contains `&`, `<`, `>`, `"`, or `'`. Added an `escapeXml` helper applied to every interpolated value. Query-string params (`tenantId`, `phone`) are `encodeURIComponent`'d and the `&` between them is encoded as `&amp;` inside the TwiML attribute.
- **De-dup of processed jobs.** Spec uses an in-memory `Set<string>` capped at 10K; after a process restart, jobs would be re-dialed. Replaced with a per-job Redis key `outbound:processed-jobs:{tenantId}:{jobId}` using `SET ... NX EX 86400`. Survives restarts, atomic claim, auto-expires after 24h.
- **Concurrency guard.** Added an `isRunning` flag on the cron, matching the job-poller pattern, so a slow Twilio API call doesn't cause overlapping cycles.
- **Phone normalization.** Job's `customerPhone` may be digits-only or already E.164. Added `normalizePhone()` that converts 10-digit → `+1NNNNNNNNNN`, leaves `+1...` alone, prepends `+` for anything else with digits. Skips dialing (logs warn + still records to `outbound_call_logs`) when no usable phone.
- **Redis key parsing.** Spec assumes `jobs:*` key shape is `jobs:<adapter>:<tenantId>` and splits on `:` with `[2]`. Same parse here, with a length guard so malformed keys are skipped instead of dialing the wrong tenant.
- **`outbound_call_logs` write.** Spec only writes 9 fields; the schema has more. We additionally set `callRecordingUrl = "pending:${callSid}"` as a temporary marker so the call-status webhook can later upgrade the same row by matching on that marker. When `record:true` returns a real recording URL via the status callback, we overwrite to the recording URL.
- **Flip + Convini outcome persistence.** The webhook controller looks up the most-recent `outbound_call_logs` row matching `(tenantId, customerPhone)` and updates `flipOutcome` / `managementNotified` / `conviniLinkSent`. This is a reasonable approximation given that Twilio doesn't echo back our row id; a more robust mechanism would pass our log row id through the TwiML callback URL. Flagged for future iteration.
- **Convini SMS.** Spec leaves it as a TODO comment. Implemented via `TwilioOutboundService.sendConviniSms()` using the same `from` number, with a static body pointing to `https://convini.app/download` (placeholder URL — flagged for product to provide the real download URL).
- **Management notification on flip success.** Uses the existing `NotificationService.send(to, subject, text)` with `OPS_ALERT_EMAIL` env var (falls back to `alerts@ustowdispatch.com`). The spec called it `sendFlipNotification`, which didn't exist on `NotificationService`; rather than add a single-use method we use the general `send()`.
- **TwilioWebhookController content type.** TwiML responses set `Content-Type: text/xml` via `@Header()` decorator (Nest defaults to JSON which would break Twilio's TwiML parser).
- **Vehicle classes never reach the outbound script.** The TwiML script doesn't know which vehicle class the agent registered (the Knowledge Pack is the source of truth for inbound routing). Outbound calls don't currently personalize for vehicle class — flagged for product if needed.

## Items flagged for human review

1. Towbook DOM selectors for active rows are inherited from the spec but were not verified against a live account. Verify before production traffic.
2. Admin dashboard authentication is a placeholder (`x-tenant-id` header). Replace with a real JWT login flow before exposing to multiple tenants.
3. The `/v1/ai-connect/lookup-eta` endpoint from the older spec was intentionally omitted; the new architecture pushes data via the Knowledge Pack (Session 3, skipped). Confirm Thinkrr.ai consumption path is acceptable.
4. CORS policy on the API is permissive (`cors: true`) for development.
5. SendGrid sender domain authentication must be configured before alert emails will deliver.
6. Drizzle migration step requires a live Postgres at `DATABASE_URL`; CI/CD wiring for `pnpm db:migrate` is part of Session 10 (skipped).
7. EncryptionUtil deviates from the spec's IV/authTag sharing pattern for cryptographic correctness. Verify with the security-review skill before launch.
