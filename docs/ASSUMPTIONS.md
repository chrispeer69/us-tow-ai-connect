# Engineering Assumptions — Sessions 21, 22 & 23

Companion to the root `ASSUMPTIONS.md`. Captures non-obvious decisions taken
during the Command Center (S21), Digital Dispatch (S22), and Driver Pings +
Live ETA (S23) builds.

## Session 27 — Multi-Tenant Readiness (Bundle C)

### Bundle B (Session 26) absent — fallbacks chosen

The expected Bundle B `audit_log` table, richer rate-limiter, and digest
email service are not present on `main` (see `docs/BLOCKERS.md`). To
unblock Session 27:

- Added a **minimal `audit_log` table** in migration `0012_onboarding.sql`
  with the columns Session 27 actually writes (`tenant_id`, `actor`,
  `event_type`, `payload jsonb`, `created_at`). Bundle B is expected to
  later replace or extend this — kept the column set narrow so a merge
  is straightforward.
- Re-used the existing `RateLimitGuard` for the tenant-scoped surface and
  added a sibling **`OnboardingRateLimitGuard`** that keys by client IP
  (3 signups / hr) for the public onboarding endpoints. Mirrors the
  Redis `incr + expire` pattern so when Bundle B replaces the limiter
  both guards can be deleted in one shot.
- Welcome email goes through the existing `NotificationService.send`
  which already gracefully degrades to stdout when `SENDGRID_API_KEY`
  is unset. No new "email service" abstraction created.

### Onboarding draft lifecycle

- `onboarding_drafts.expires_at` defaults to **48 hours** after creation.
  Long enough to walk away mid-wizard and come back the next morning,
  short enough that abandoned drafts don't accumulate forever.
- Drafts are looked up by `id` (returned to the client on
  `POST /v1/onboarding/start`); we deliberately do NOT trust `email` as
  the lookup key because the form lets the user change it on step 2.
- `status` is `draft | submitted | completed | abandoned`. Cron-driven
  abandonment cleanup is out of scope for this session; a future operator
  can `DELETE FROM onboarding_drafts WHERE expires_at < NOW() AND status =
  'draft'` manually.

### Captcha gating

- `SIGNUP_CAPTCHA_KEY` env (Cloudflare Turnstile / hCaptcha secret) gates
  the `POST /v1/onboarding/complete` endpoint. When **unset**, the
  endpoint falls back to per-IP rate limiting (3/hr) — same effective
  abuse protection as the spec calls for, just less robust against a
  determined attacker. When **set**, the endpoint also requires a
  `captchaToken` body field which is verified against the provider's
  siteverify endpoint. Both Turnstile and hCaptcha expose the same
  `siteverify` POST shape, so a single fetch handles either.

### Branding schema & storage

- **`branding` lives on the `tenants` table as JSONB**, not in a
  side table, because every read of a tenant already hydrates the row
  and a JSONB column avoids an N+1 join on every page load. Trade-off:
  no per-field indexes. Acceptable — branding is never queried by
  inner fields; the whole blob is read together.
- **CSS variables, not Tailwind theme tokens.** The admin UI ships with
  a fixed Tailwind config and changing it would require a rebuild per
  tenant. CSS custom properties (`--brand-primary`, …) are set on
  `:root` at runtime by `BrandingProvider` and consumed by existing
  Tailwind classes via the `[--brand-primary:var(--brand-primary)]`
  arbitrary-value pattern where they need to win over a Tailwind
  default. The default values (the existing zinc-950 / blue-500
  palette) live in `globals.css` so SSR HTML is never blank during
  hydration.
- **Asset storage is filesystem-first** with an env-toggle escape to
  Railway Volume / S3. Logo + favicon are written under
  `data/branding/<tenant_id>/` and served by the API at
  `/branding/:tenant_id/logo.png` (and `/favicon.ico`). The fallback
  path is documented in `docs/BLOCKERS.md` for the operator. Multer is
  not added as a dep — uploads are accepted via the existing Nest
  `@nestjs/platform-express` body parser with a tight 2 MB limit. A
  PNG-only allowlist keeps the surface small.
- **`hide_powered_by` defaults `false`** — Thinkrr's white-label resale
  flow needs this on for end-customer agents but the default tenant
  (Roadside Towing) is happy to leave it on. Surfacing it in the
  branding admin lets either side flip it without a code change.

### Knowledge Pack v2

- **New `tenant_knowledge_pack` table**, not an alter of
  `ai_agent_configs.knowledge_pack`. Reasons:
  1. The new schema is structurally different (sections like `fleet`,
     `transfer_rules`, `pricing_policy` that the JSONB blob never had).
  2. A `draft` / `published` split needs two JSONB columns and a
     `published bool`, which would balloon the agent config row.
  3. Tenant zero's existing `ai_agent_configs.knowledge_pack` is left
     intact; the v2 endpoint reads from the new table first and falls
     back to the v1 blob if no v2 row exists. Migration `0013` seeds a
     v2 row for tenant zero from the existing v1 blob.
- **Markdown renderer lives in `branding/knowledge-rendering/`**, not
  in the existing `knowledge-endpoint` module. Reason: the existing
  `KnowledgeEndpointService` is owned by Session 3 and is currently
  the v1 surface (Thinkrr's existing agent points at `profile.md`
  already). The v2 endpoint is additive (`profile.md` re-rendered from
  the v2 blob when present, plus a new `profile.json`).
- **Publishing flow**: edit the draft, hit **Publish**, which copies
  `draft → content`, bumps `version`, sets `published=true`, writes an
  `audit_log` row, and optionally fires the Thinkrr KP refresh webhook
  (skipped + warned if `THINKRR_KP_REFRESH_WEBHOOK_URL` is unset).

### Super-admin + impersonation

- **`platform_role` is a new column on `users`** with values
  `tenant_user | tenant_admin | super_admin`. The existing
  `tenant_members.role` column (OWNER / ADMIN / MEMBER / VIEWER) is
  tenant-scoped; `platform_role` is platform-scoped. They're orthogonal:
  a super_admin can also be a MEMBER of a specific tenant.
- There is no `users` table yet — the codebase only has
  `tenant_members`. Migration `0014_platform_roles.sql` adds a `users`
  table keyed by `email` (lowercased, unique) and inserts
  `thechrispeer@gmail.com` with `platform_role='super_admin'` if not
  present (matches the seed identity in
  `db/seeds/roadside-tenant-zero.ts`). When a real auth system lands,
  the `users.id` should be FK'd from `tenant_members`.
- **Impersonation tokens** are short-lived (15 min) JWT-shaped strings
  (HS256 signed with `IMPERSONATION_SECRET` env, falls back to
  `ENCRYPTION_KEY` slice for dev). They carry `super_admin_email`,
  `target_tenant_id`, and `exp`. The admin UI surfaces a red "you are
  impersonating X" banner whenever the active session token is
  impersonated. **All impersonation start/stop events write to
  `audit_log`.**

### Thinkrr partner mode

- **`partner_account_id` is a single nullable text column on `tenants`.**
  Sufficient for Thinkrr's "white-label resale" use case — every
  end-customer tenant Thinkrr provisions through us carries Thinkrr's
  internal account ID for billing reconciliation. A future second
  partner would warrant a separate `partners` table; not built today.
- **`POST /v1/partner/tenants` requires `PARTNER_API_KEY` env**, checked
  via a tiny `PartnerApiKeyGuard` (constant-time compare against the env
  value). No multi-partner key issuance flow — when a second partner
  arrives, this guard graduates to a `partners` table lookup.
- The bulk endpoint creates **one tenant per request item** with a
  Thinkrr-scoped default routing rule (transfer back to Thinkrr's
  configured dispatch line). Returns the Knowledge Pack URLs so
  Thinkrr can wire them into their agent config without a second
  round-trip.

## Session 23 — Driver Pings + Live ETA

### Data model

- **Separate `driver_pings` table, not a column on Command Center's
  `drivers`.** S21's `drivers` table is uuid-keyed and depends on a
  populated roster; this module needs to work the moment the API ships,
  before any driver row exists. Natural key here is
  `(tenant_id, driver_phone)` in E.164. When S21 is finalized, a future
  migration can backfill `drivers.id` via the matching phone.
- **`lat` / `lng` are `numeric(10,6)`**, mirroring S21's `pickup_lat`. Same
  ±0.1 m precision is plenty for routing a tow truck.
- **`heading` / `speed_mph` / `accuracy_m` / `battery_pct` all nullable.**
  Older feature phones won't supply them; a manual operator ping won't
  either. The /eta path only relies on lat/lng/recorded_at.
- **`source` column** distinguishes `manual`, `phone_app`, `tablet`,
  `gps_tracker` for later debugging — does not gate behavior.
- **No update path; only insert.** Each ping is a row. Latest-per-driver is
  computed in SQL with `DISTINCT ON (driver_phone) … ORDER BY recorded_at
  DESC`. Keeps history for free, lets the admin UI scrub backwards in time
  without a separate history table.
- **`PING_FRESHNESS_SECONDS = 1200` (20 min)** in `ai-connect.service.ts`.
  Beyond 20 min the ping is dropped from the candidate list — better to
  fall back to the static default than confidently quote a stale truck
  location.
- **`MAX_CANDIDATE_DISTANCE_MILES = 60`.** Drivers further than that aren't
  considered for live ETA — at >1 hr drive, the operator's configured
  `default_eta_mins` is more honest than a Distance Matrix quote on a
  truck that's not really available.

### /v1/ai-connect/eta routing

- **Phone-keyed driver lookup, not uuid.** The Thinkrr agent doesn't know
  about driver uuids; it knows `+phone`. Keeps the API surface stable when
  S21 lands.
- **Top-3 shortlist by haversine, then Distance Matrix.** Straight-line
  distance isn't the same as driving time (river crossings, freeway
  on-ramps). Cheaper than asking Distance Matrix about all candidates;
  bounded API cost regardless of fleet size.
- **Prefer `duration_in_traffic` when present.** Requires
  `departure_time=now` on the Distance Matrix request, which we always
  send. Falls through to `duration` when traffic data isn't returned.
- **Triple fallback chain** with the `basis` field surfacing which branch
  fired, so the agent can phrase the response accurately:
  1. `distance_matrix` — live ping + Google driving time (best path).
  2. `haversine_estimate` — ping is fresh, but Distance Matrix unreachable
     (no API key, quota, network). Estimate at 30 mph surface streets.
  3. `default_eta_mins` — no fresh ping in range, or caller didn't supply
     coordinates. Returns the operator's configured static ETA.
- **GoogleDistanceMatrixService is its own injectable**, not buried in
  ai-connect.service. Lets the admin map view reuse it later for
  "approximate ETA per driver to a candidate job."
- **GOOGLE_PLACES_API_KEY drives both Places and Distance Matrix.** The
  build sessions doc explicitly says the same Google Cloud project is
  authorized for both. If they ever get split, the env var name should
  change to `GOOGLE_MAPS_API_KEY`.

### Auth model

- **POST /v1/driver-pings uses `TenantApiKeyGuard`,** same credential as
  the Thinkrr agent. Rationale: a phone-app driver client is a tenant-
  scoped device, not a user. Issuing per-driver bearer tokens is overkill
  for v1; rotate the tenant key to revoke. Rate limit applies (60/min).
- **GET /v1/admin/driver-pings/\* uses `AdminAuthGuard`,** same as the
  rest of the admin surface. No new auth primitives in this session.

## Session 21 — Command Center

### Data model

- **Source enum stored as `varchar(32)`** rather than a Postgres `ENUM`.
  Drizzle's pg enum support requires a one-shot migration to extend values;
  using varchar lets us add new adapters (`omadi`, `towlogs`, …) without a
  schema change. Trade-off: an invalid value is only caught at the
  application layer.
- **Status enum** likewise stored as varchar; the canonical set is
  `new | assigned | en_route | on_scene | in_tow | completed | canceled | declined`,
  enforced by the Zod schema in `@ustow/shared` and by `JobStatus` in the
  command-center service.
- **Lat/lng as `numeric(10,6)`**. PostGIS is overkill for a v1 dashboard
  that just wants markers on a Google Map. Numeric gives us ±0.1 m precision
  at any latitude with no extra extension.
- **`assigned_driver_id` / `assigned_truck_id` are nullable FKs** with
  `ON DELETE SET NULL`. Deleting a driver doesn't blow away historical jobs.
- **`unified_jobs.id` is a fresh UUID**, separate from `source_job_id`. The
  natural key `(tenant_id, source, source_job_id)` carries a UNIQUE index so
  the poller can upsert.
- **`source_payload` always populated** with the adapter's raw row dict so the
  rules engine can run jsonpath against fields we haven't promoted to first-
  class columns yet.
- **No `tenant_id` on `job_events`**: derivable from the join to `unified_jobs`
  and the cascade-delete keeps the table consistent.
- **No `tenant_id` FK on `tenant_credentials`-style unique index for trucks/
  drivers**: tenants can have arbitrarily many of each, no unique constraint
  beyond the PK.

### Adapter pipeline

- **Normalizers live in `modules/job-poller/normalizers/`** rather than under
  `modules/adapters/`. Adapters stay scraper-shaped (`ActiveJob`); the
  command center pipeline owns the mapping to `UnifiedJobInput`. Lets us
  add new normalizers without touching the adapter contract.
- **Geocoding gated by `GOOGLE_PLACES_API_KEY`**. If unset, the row is still
  upserted with `pickup_lat = pickup_lng = NULL`; the map view tolerates
  missing coords by listing the job in the side table without a marker.
- **Geocoding done synchronously per row, then cached on the row**. Re-runs
  of the poller see lat/lng already set and skip the API call. Future
  re-geocoding would require nulling those columns out.
- **Vehicle parsing**: `ActiveJob.vehicle` is a free-form string like
  `"2018 Honda Civic Red"`. The Towbook normalizer best-effort splits on
  spaces — year (4-digit prefix), make (next token), model (rest before
  color). The AAA normalizer leaves vehicle fields null when the scraper
  didn't capture them. Surprising splits are stored verbatim in
  `source_payload.vehicle` for forensic review.
- **Status mapping**. Towbook's free-form status strings map heuristically
  (`"Enroute" → en_route`, `"On Scene" → on_scene`, etc.); unknown strings
  default to `new` so the dispatch board still shows them. The original
  string is preserved in `source_payload.status_raw`.
- **`job_events` written on**: initial create, status transition (including
  poller-detected changes), and assignment changes.

### API + WebSocket

- **Socket.io chosen** over native ws because the spec calls it out and
  Nest's `@nestjs/websockets` + `@nestjs/platform-socket.io` is the
  best-supported combination. Adds `socket.io` + `@nestjs/websockets` deps.
- **Auth on websocket**: tenant resolved via `x-tenant-id` handshake header
  (same scheme as `AdminAuthGuard`). Real JWT flagged for future.
- **WS rooms are per-tenant** (`tenant:<uuid>`). A connected client only
  receives updates for its own tenant; jobs created in another tenant are
  invisible.
- **Broadcast cadence**: emitted on every successful UPSERT inside
  `CommandCenterService.upsertJob()`. No batching — load is bounded by the
  poller's 60s cadence × max ~50 active jobs/tenant.
- **REST list endpoint default page size = 50, max 200**, mirroring the
  existing `/v1/admin/interaction-logs` shape.
- **Manual job creation** writes `source = 'manual'` and generates the
  `source_job_id` as `manual:<nanoid>` to keep the unique key non-conflicting
  with adapter rows.

### Command Center UI

- **Google Maps loaded via the `@react-google-maps/api` package** added to
  `@ustow/web` deps. Falls back to a placeholder panel when
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is unset (read at build time).
- **Real-time updates via `socket.io-client`** added to web deps. The client
  connects to `${NEXT_PUBLIC_WS_URL}` (defaults to `/`) with path
  `/ws/command-center`.
- **No external charts/state library**. The stats strip computes from the
  fetched jobs list on the client; the dedicated `/stats` endpoint is also
  exposed for the future Digital Dispatch tab.
- **Empty state** detection: zero rows → onboarding hint with a link to
  `/admin/integrations`.

## Session 22 — Digital Dispatch

### Schema

- **`dispatch_rules.conditions` is a JSONB array of `{type, ...args}` objects**
  rather than a tree of boolean nodes. ALL conditions in the array must match
  (implicit AND). This keeps the visual builder simple — OR-style rules are
  expressed by creating two rules with the same action and adjacent
  priorities. Trade-off: complex boolean expressions require multiple rules.
- **`dispatch_decisions.rule_id` is nullable + `ON DELETE SET NULL`**. A user
  deleting a stale rule doesn't lose the audit trail for past decisions.
- **`unified_jobs.auto_decision` mirrors the latest decision** for quick
  filtering in the Command Center without joining to `dispatch_decisions`.

### Engine

- **First-match-wins, ordered by `priority` ASC** then `created_at` ASC for
  determinism. A rule with `priority: 0` runs before `priority: 10`.
- **Default when no rule matches = `flag`**. Better to over-flag than to
  silently auto-anything.
- **Engine triggered from `CommandCenterService.upsertJob`** on the FIRST
  insert of a job whose source is a configured motor club (currently:
  `aaa_salesforce`). Updates do NOT re-run the engine — once a decision is
  made, it sticks until manually overridden.
- **Driver-count condition** counts drivers with `status = 'available'` for
  the tenant. Does NOT currently factor in distance to job (would require
  haversine cross-join).
- **Distance condition uses Haversine** against the geocoded pickup and
  each driver's `current_lat/current_lng`. Skips drivers without a recent
  ping (last_ping_at older than 30 min). If no driver has coords, the
  condition evaluates `false`.
- **Payout extraction**: `estimated_payout_min` reads
  `source_payload.estimated_payout || source_payload.payout || source_payload.amount`.
  AAA's actual payload key is unknown until live data lands; flagged.
- **Caller phone blacklist** uses digits-only comparison after stripping
  non-digit characters from both sides.
- **`custom_jsonpath` uses `jsonpath-plus`** added as a dep; failure to
  parse or evaluate the expression marks the condition as `false` with
  reason captured in `evaluatedConditions` for debugging.
- **Time-of-day** evaluated in the **tenant's timezone** (`tenants.timezone`).
  We don't ship `date-fns-tz` to keep deps small; the engine uses
  `Intl.DateTimeFormat` with the IANA zone instead.

### Adapter accept/decline

- **AAA portal** does not have a verified selector for the Accept/Decline
  buttons in the local DOM map. The adapter therefore logs the action,
  writes the decision row, and records the gap to `docs/BLOCKERS.md`. The
  rules engine still runs; only the side effect is deferred.
- **Towbook accept/decline are stubs** — Towbook is a dispatch-out system,
  not a motor-club intake. They exist for symmetry and future-proofing.

### Digital Dispatch UI

- **Visual condition builder** uses dropdowns + value inputs per condition
  type. Raw JSON only exposed for `custom_jsonpath`. Non-power users never
  need to write a `{type: …}` literal.
- **Stats charts** are SVG, hand-built — no `recharts`/`chart.js` dep added.
  Two charts: a bar chart of decisions/day for the last 14 days, and a pie
  chart of total counts by decision type.
- **Test sandbox** posts to `POST /rules/:id/test`; decision result is
  rendered side-by-side with the evaluated conditions trace.

## Items flagged for human review

1. **AAA Accept/Decline selectors** are unverified — Playwright actions log
   a `NotImplementedError` and write to `BLOCKERS.md`. Verify against the
   live AAA portal before turning on auto-accept in production.
2. **WebSocket auth** uses the same `x-tenant-id` header placeholder as the
   admin REST guard. Wire to real JWT before multi-tenant launch.
3. **`estimated_payout_min` field path** in AAA's source_payload is a best
   guess (`estimated_payout || payout || amount`). Confirm with a live AAA
   payload sample.
4. **Vehicle string parsing** in the Towbook normalizer is heuristic. Year/
   make/model splits will be wrong for unusual values; the original string
   is preserved in `source_payload.vehicle` for inspection.
5. **No driver-distance integration** in the AAA accept decision — adding a
   "closest available driver is within X miles" predicate would require the
   Geocoding pass to complete before the rules engine fires.

## Session 10 — Production deployment (Railway)

### Platform choice

- **Railway** chosen over Render/Fly/Vercel-for-API for two reasons: (a)
  the spec calls it out explicitly, and (b) Railway's first-class managed
  Postgres + Redis + GitHub-app integration removes the need for any
  GitHub Actions secret. The downside is Railway's headed Playwright story
  is RAM-hungry — flagged in `docs/DEPLOY_RAILWAY.md` as requiring the
  **Pro 8 GB** tier minimum.
- **`railway.toml` at the repo root with two `[[services]]` blocks**
  (`api`, `web`) rather than per-service `railway.json` files. The TOML
  format is the documented config-as-code shape on Railway as of
  2026-Q1; switching to JSON would only matter if a single service needed
  override-via-env. Postgres + Redis are **not** declared in the file —
  they're added via the Railway dashboard as plugins and exposed to the
  `api` service via the `${{Postgres.DATABASE_URL}}` /
  `${{Redis.REDIS_URL}}` reference syntax.
- **Domain `ustow-aiconnect.com` is not yet registered** (per existing
  blocker docs / project notes). The deploy doc therefore covers both
  paths: bootstrap on Railway-generated `*.up.railway.app` subdomains,
  then a clean CNAME flip when the domain lands. Env vars
  (`PUBLIC_BASE_URL`, `NEXT_PUBLIC_API_URL`, etc.) are documented as
  variables to update at flip time, not hard-coded.

### Dockerfile shape

- **Both services use `node:22-slim` + corepack-enabled pnpm 9**, mirroring
  the root `engines` field in `package.json`. Slim over Alpine because
  Playwright's `--with-deps` install assumes Debian's apt-based libgbm /
  libnss / libasound. Alpine works but needs a separate apk recipe and is
  more fragile across Playwright versions.
- **Multi-stage builds (deps → build → runtime)** so the production image
  ships without dev dependencies, source maps, or the build toolchain.
  The runtime stage runs as the unprivileged `node` user.
- **API Dockerfile installs Chromium with `--with-deps`** during the build
  stage and copies the entire `/ms-playwright` directory into the runtime
  stage. Runtime exports `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` so the
  adapter never tries to download a browser at first use.
- **`packages/shared` is built first** in the API/web build stages via
  `pnpm --filter @ustow/shared build` — the same `prebuild` hook the
  README documents — so the shared package's `dist/` is present before
  the API/web compile against it.
- **Web image uses Next.js `output: 'standalone'`** so the runtime stage
  only needs `.next/standalone` + `.next/static` + `public/`, dropping
  the multi-hundred-megabyte `node_modules` tree from the final image.
  The standalone server is started with `node packages/web/server.js`
  (Next emits it at that path inside the standalone bundle).

### Health checks

- **`/health` stays dependency-free** so Railway's bootstrap probe can
  succeed even while Postgres is still warming up; a separate
  `/health/ready` does the dep checks and is what Railway's
  `healthcheckPath` is pointed at. Splitting the two endpoints lets us
  add a separate Kubernetes-style liveness probe later without changing
  the URL contract.
- **Readiness pings Postgres with `SELECT 1`** (via the existing Drizzle
  client) and Redis with `client.ping()`. Latency is reported in the JSON
  response for ad-hoc debugging. Both checks have a hard 2-second budget
  enforced by `Promise.race`; a hung dep fails the check rather than
  hanging the probe forever (Railway would otherwise wait the full
  healthcheckTimeout).

### CORS + Helmet

- **Helmet** added via `helmet()` middleware on app bootstrap; the only
  non-default tweak is `crossOriginResourcePolicy: { policy: 'cross-origin' }`
  so the public Knowledge Pack endpoint can be loaded by Thinkrr's voice
  agent (which fetches from a different origin).
- **CORS allow-list** is `WEB_PUBLIC_URL` + an optional comma-separated
  `CORS_EXTRA_ORIGINS` env var. Webhook routes (`/webhooks/*`) and the
  public Knowledge Pack route (`/public/*`) are exempt — they're called
  by server-side integrations that don't honour CORS preflight anyway, so
  blocking them would only confuse debugging without adding security.
  The signed webhook secret is the real auth on `/webhooks/thinkrr/*`.
- **No console-log secret-scrub findings.** A grep of the API source
  shows only CLI tooling (the `generate-api-key.ts` print, plus boot/dev
  warnings) writes to console; none of it logs the value of a
  user-provided secret.

### GitHub Actions

- **CI does type-check + tests only.** Railway's GitHub app handles the
  actual build + deploy, so no `RAILWAY_TOKEN` lives in GitHub Secrets.
  This removes the most common "rotated token broke CI" failure mode.
- **`pnpm test` is invoked with `--if-present` semantics** by iterating
  the packages: only `@ustow/api` defines a `test` script today, so the
  workflow runs vitest there and skips the others without failing.
- **Single workflow file** (`deploy.yml`) — the name is preserved from the
  original spec even though it does not literally deploy; "deploy" reads
  as the post-merge gate that lets the deploy proceed.

### Smoke test

- **Bash + curl** rather than Node so the script can be invoked from a
  bare CI runner or operator's laptop with zero install. Each check is a
  single `curl -fsS -o /dev/null -w '%{http_code}'` against the
  production URL; the script `set -euo pipefail`s on the first failure.
- **Defaults to Railway-generated URLs** when `API_URL` / `WEB_URL` aren't
  set, so the script is usable immediately after the first deploy
  (before the custom domain lands).

### URL audit result (section 4)

A grep for `http://localhost` across `packages/api/src` returned exactly
one runtime reference: `TwilioOutboundService.baseUrl`, which already
reads `process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001'`. The
fallback only fires when the env is unset; in production Railway always
injects a value (see §3 of the runbook). The Knowledge Pack URL itself is
**never constructed by source code** — Thinkrr stores the absolute URL in
its agent config, and the controller (`KnowledgeEndpointController`) only
serves the path. Same story for the Thinkrr webhook URL: Thinkrr stores
the absolute URL pre-prefixed with `${PUBLIC_BASE_URL}`. The session 10
guard added in `main.ts` warns on boot when `NODE_ENV=production` AND any
URL env points at localhost.

### Files intentionally NOT touched

- Anything under `packages/api/src/modules/admin/**`,
  `packages/api/src/modules/command-center/**`,
  `packages/api/src/modules/digital-dispatch/**` — Sessions 21/22 own
  these and a sibling Claude Code session was actively editing them at
  the start of this work.
- Existing migration files under `packages/api/src/db/migrations/` — only
  additive new files would have been added, but Session 10 didn't need
  any.
- The `unified_jobs` / `drivers` / `trucks` / `job_events` /
  `dispatch_rules` / `dispatch_decisions` schema. The deploy story is
  schema-agnostic.

## Production Knowledge Pack recovery (2026-05-23)

### Root cause

`GET /public/knowledge/00000000-0000-0000-0000-000000000001/profile.md`
returned `500` in production because the Postgres database was empty — no
tables existed at all. `/health/ready` reported `db ok` because the
readiness check only runs `SELECT 1`.

`railway.toml` declared `[[services]] name = "api"` with the right
`preDeployCommand = "pnpm --filter @ustow/api run db:migrate:prod"`, but
the actual Railway service is named `@ustow/api` (verbatim). Railway only
merges service-scoped settings when the names match exactly, so the
preDeployCommand was silently ignored on every deploy and migrations
never ran.

### Fix applied

1. **`railway.toml`** — renamed both service entries from `api` / `web` to
   `@ustow/api` / `@ustow/web` so `preDeployCommand` actually wires up.
2. **`packages/api/Dockerfile`** — runtime `CMD` now chains
   `node dist/db/migrate.js && node dist/main.js`. Belt-and-suspenders: if
   anyone changes service names again in the future, the container itself
   guarantees migrations run before the server boots. Drizzle's migrator
   is idempotent (records applied filenames in `__drizzle_migrations`) so
   re-running on every start is safe.
3. **One-off recovery** — ran `pnpm db:migrate` and
   `pnpm db:seed:tenant-zero` locally against the public proxy URL
   (`kodama.proxy.rlwy.net:21521`) using the credentials from the
   Postgres service's `DATABASE_PUBLIC_URL`. The seed is idempotent
   (`ON CONFLICT … DO UPDATE`), so subsequent re-runs are no-ops.

### Why we did *not* auto-run the tenant-zero seed on startup

The seed is Roadside-Towing-specific (hard-coded UUID, brand list,
counties, transfer phone). Once additional tenants land, auto-seeding on
every container start would overwrite mutable rows for tenant zero on
every deploy. Migrations run automatically; seeding remains a manual
operator action (`pnpm db:seed:tenant-zero` with `DATABASE_URL` set).

## Session 25 — Driver Experience

### `driver_job_events` is the system-of-record, not `unified_jobs`

Driver-side state transitions (accept / decline / en_route / on_scene /
in_tow / completed / cancel) always write a row into `driver_job_events`
before attempting to update `unified_jobs`. Rationale:

- The Command Center session (S21) and the driver-jobs session (S25) ship
  on independent timelines. We can't assume `unified_jobs` will be
  populated when the driver app posts an event.
- A driver tapping "On Scene" at the curb shouldn't lose the audit trail
  just because the dispatch table hasn't been migrated on a given env.
- When Command Center is live, the unified_jobs update is best-effort and
  the audit row remains the canonical record of "what the driver said."

If you ever wire `driver_job_events.job_id` as a real FK to `unified_jobs`,
use `ON DELETE SET NULL` so the audit history survives a job-row purge.

### Driver lookup is by E.164 phone, never uuid

Same pattern as `driver_pings`: the driver client doesn't know the
Command Center's `drivers.id` uuid, just its own phone number. The
`/v1/driver/jobs/*` endpoints take `?driver_phone=` and JOIN through
`drivers.phone = $1` to reach `unified_jobs.assigned_driver_id`. The
Command Center populates `drivers.phone` when it onboards a driver.

### Convini parser is permissive on purpose

`ConviniService.parseBody` accepts:

- `CONVINI: KEY=value KEY="quoted value"` — the assumed Twilio-relayed form.
- `CONVINI# …` — alternative marker glyph.
- `JOB={…}` — embedded JSON blob, merged into `raw_fields`.

The real Convini wire format is unknown. Until Chris confirms it, the
parser is intentionally lenient so we capture *something* useful from
every inbound. `raw_body` is always preserved so historical rows can be
re-parsed once the format lands. See `docs/CONVINI_INTEGRATION.md`.

### Web Push is foundation-only this session

`POST /v1/driver/push/subscribe` persists subscriptions into
`driver_push_subscriptions` and de-dupes on `(tenant_id, endpoint)`. We
do NOT call `webpush.sendNotification(...)` anywhere yet because:

1. `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` aren't issued yet.
2. The `web-push` npm dep is not added — only adding it once the keys
   land keeps the prod bundle slim.

When VAPID keys are configured:

1. Generate keys: `npx web-push generate-vapid-keys`.
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` in Railway.
3. Add `web-push` to `packages/api/package.json`.
4. Build a `WebPushService` that reads subscriptions from
   `driver_push_subscriptions` and calls `webpush.sendNotification` per
   row, handling 410/Gone responses by deleting the stale subscription.
5. Surface `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the driver PWA so it can pass
   the same key to `pushManager.subscribe({ applicationServerKey })`.

### Driver PWA is mobile-first, no Next.js admin chrome

The `/driver` route in `packages/web/src/app/driver/**` deliberately
doesn't share layout with `/admin/**`. The admin shell is dark-themed,
desktop-first, and uses keyboard chrome that doesn't translate to a tow
truck's phone screen. The driver layout is its own `app/driver/layout.tsx`
with mobile viewport meta, no sidebar, and a fixed bottom nav.

### Admin live-drivers map is not added to sidebar nav this session

The Command Center session (S21) owns `packages/web/src/app/admin/`'s
sidebar component. To avoid clobbering its in-flight edits, this session
links to `/admin/drivers-live` via the existing parallel route only — the
sidebar nav entry is left for the Command Center session to add when it
next touches the nav file. The page is fully reachable by direct URL.

---

## Session 24 — Caller Communication (2026-05-23)

### `manager_phones` is a JSONB array of E.164 strings, not a relational table

`tenants.manager_phones` could have been a `tenant_manager_phones` table
keyed by tenant_id. It's stored as a JSONB array on the tenants row
instead because (a) the list is small (≤5 phones per tenant for the
foreseeable future), (b) every read path needs the whole list (no row-level
queries make sense), and (c) the admin UI for editing it doesn't exist
yet — a single column is easier to seed and inspect. Convert to a proper
table the first time per-phone metadata (escalation order, on-call hours)
matters.

### `tracking_url_base` defaults to the API origin, not the web app

Default is `https://ustowapi-production.up.railway.app/track` because at
seed time the public web domain isn't decided yet, and the API runtime
already has SSL + a stable URL. Flip to the web origin via a one-line
SQL `UPDATE tenants` once the customer-facing domain is set up. See
`docs/CALLER_COMMUNICATION.md` for the command.

### Tracking-link tokens use a 56-char alphabet excluding `0OIl1`

Generating 12-char tokens from `[A-Za-z0-9]` minus the easily-confused
glyphs gives ~`56^12 ≈ 9e20` combinations — plenty for the foreseeable
caller base, and human-friendly if a caller reads the URL aloud. Implemented
in `TrackingService.generateToken` with retry-on-collision (5 attempts).

### Caller phone is exposed as last-4 only on the public tracking page

`GET /v1/tracking/:token` returns `caller_phone_last4` (or null), never the
full E.164 number. The page is public; we shouldn't leak the caller's
phone to anyone who guesses or shares the token. The full phone stays in
the DB for our internal dispatch use.

### Public tracking page status refresh is 10 s (not Socket.io)

The Command Center uses websockets because it needs sub-second multi-job
visibility for dispatchers. The caller-facing page only needs to feel
fresh; a 10 s poll with `cache: 'no-store'` keeps the page stateless and
the public web bundle small (no socket.io-client on a per-caller page).

### Sidebar nav entry for `/admin/sms-log` is intentionally not added

The admin sidebar component is owned by parallel sessions (Command Center
Terminal C). Adding `SMS Log` to the nav would require editing that file.
Following the same pattern as Session 25's `/admin/drivers-live`, the
page is reachable by direct URL until the nav owner adds the link.

### Inbound SMS resolves the request by manager-phone tenant match first, then newest pending

The first single-tenant rollout (Roadside) makes the resolver simple: try
to match the sender's E.164 against any tenant's `manager_phones`, then
fall back to the newest pending row across all tenants. Tighten to a strict
tenant match the first time we onboard a second AAA-style tenant.

### Adapter `acceptJob` / `declineJob` are still logged stubs

The AAA Salesforce community DOM hasn't been captured for the Accept /
Decline buttons (called out by Session 22's `AAA_ADAPTER_BUILD.md`).
Flip-accept calls `acceptJob` anyway; it logs a `BLOCKERS.md` entry if
the call doesn't actually move the work order. The flip-accept row's
status reflects this distinction: `auto_dispatched` when the adapter
acknowledges, `approved` when only the audit row updated.

### Tracking creation never blocks dispatch creation

`AiConnectService.createDispatchRequest()` wraps the tracking-create call
in a try/catch. A tracking failure (DB blip, Twilio outage, malformed
phone) emits a warning log and the dispatch row still returns successfully
to Thinkrr. The human dispatcher still gets their SMS notification
independently, so the caller-facing tracking link is a value-add, not a
critical path.

## 2026-05-23 — Browser-only /admin/* 500 (web → API rewrite proxied to localhost)

### Symptom

Chris reported all `/admin/*` pages showing **HTTP 500 in browser**
(incognito) while `curl` against the same URLs returned **200**.

### Root cause

`packages/web/next.config.js` defined the rewrite target as:

```js
const apiTarget = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
async rewrites() { return [{ source: '/api/:path*', destination: `${apiTarget}/:path*` }]; }
```

On Railway, the `@ustow/web` service had **no `NEXT_PUBLIC_API_URL` env
var**, so every `/api/*` request the client made was server-side proxied
to `http://localhost:3001` inside the web container, which has nothing on
that port → `ECONNREFUSED` → Next emits 500.

Confirmed via Railway logs (saved to `docs/diagnostics/web-errors.txt`):

```
Failed to proxy http://localhost:3001/v1/admin/integrations/status [AggregateError: ] { code: 'ECONNREFUSED' }
Failed to proxy http://localhost:3001/v1/admin/command-center/jobs?... [AggregateError: ] { code: 'ECONNREFUSED' }
... (every /api/v1/admin/* call)
```

Curl on `/admin/integrations` returned 200 because the page itself is
`X-Nextjs-Prerender: 1` static HTML served from cache — only the
client-side XHR to `/api/*` (which the browser fires after hydrate) was
failing. The user's "header-gated" hypothesis was off — the bug is
proxy misconfiguration, not auth.

### Fix

Made the rewrite target resolution safe-by-default in
`packages/web/next.config.js`:

1. Prefer `NEXT_PUBLIC_API_URL` (canonical, still operator-set).
2. Fall back to `API_URL` (server-only alias).
3. **Fall back to `https://ustowapi-production.up.railway.app` whenever
   `NODE_ENV=production` or `RAILWAY_ENVIRONMENT` is set** — guarantees
   the proxy never silently routes to localhost in prod.
4. Local dev still gets `http://localhost:3001`.
5. Logs `[next.config] /api/* → <target> (env source: …)` at startup
   so future deploys make the routing obvious in Railway log scroll.

This is a safety net. The durable fix is for the operator to set
`NEXT_PUBLIC_API_URL` on the Railway `@ustow/web` service — see
`docs/BLOCKERS.md`.

### Also added: `packages/web/src/app/admin/error.tsx`

The previous error boundary was only at `app/error.tsx` (root segment),
which means any throw inside an admin page replaced the entire viewport
with the generic "Something went wrong" card and lost the sidebar.
Scoped boundary keeps the sidebar/nav visible and offers a "Reload
section" (calls `reset()`) and "Reload page" (window.location.reload)
without leaking the error message to the user.

## 2026-05-23 — API-side: missing `x-tenant-id` returns 401 (was 500)

### Root cause

`packages/api/src/common/guards/admin-auth.guard.ts` resolved the
tenant id with a string literal fallback:

```ts
const DEFAULT_TENANT_ID = process.env.DEFAULT_ADMIN_TENANT_ID ?? 'default-tenant';
const tenantId = (tenantFromJwt || tenantFromHeader || DEFAULT_TENANT_ID || '').trim();
if (!tenantId) throw new UnauthorizedException(...);
req.tenantId = tenantId;
```

When the request had no `x-tenant-id` header AND the Railway
`@ustow/api` service had no `DEFAULT_ADMIN_TENANT_ID` env var set
(confirmed via `railway variables --service @ustow/api`), `tenantId`
resolved to the literal string `'default-tenant'`. That's truthy, so
the 401 branch didn't fire. The value then flowed into every admin
service call (`.where(eq(tenants.id, 'default-tenant'))`), where
Postgres raised `invalid input syntax for type uuid: "default-tenant"`,
and Nest's default exception filter rendered it as a raw HTTP 500.

The web-side `lib/utils.ts` actually already flagged this exact failure
mode in a comment ("a non-UUID fallback … causes every admin endpoint
to 500 on the Postgres cast") and worked around it client-side with the
seed UUID. The API side still had the broken literal.

### Fix (`admin-auth.guard.ts`)

1. Replaced the `?? 'default-tenant'` literal fallback with a helper
   that only honours `DEFAULT_ADMIN_TENANT_ID` if it is itself
   UUID-shaped. An unset (or invalid) env yields `null`, not a poison
   string.
2. After resolving from JWT → header → env, the candidate is matched
   against a UUID-shape regex (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`).
   Anything else throws `UnauthorizedException({ code: 'UNAUTHORIZED',
   message: 'Invalid tenant identifier' })`.
3. Missing tenant (everything empty) → same exception with
   `'Missing tenant context'` message.
4. Both failure paths still call `recordAuthFailure(req, reason)` so
   `auth.failed` audit entries continue to land in the audit log.
5. Validation accepts UUIDs of any version (v1..v8 + the all-zero seed
   IDs the codebase uses, e.g. `00000000-0000-0000-0000-000000000001`).
   Strict v4-only would reject the seed/dev IDs that are used in
   every existing fixture.

### Why the guard is the right layer

Every one of the six failing routes (`/v1/admin/{company, members,
api-keys, billing, audit-log, digest}`) already passes through
`@UseGuards(AdminAuthGuard)`:

- `AdminController` — company/members/api-keys/billing
- `AuditLogController` — audit-log
- `AdminDigestController` — digest

So fixing the single guard covers all six (plus every other
`AdminAuthGuard`-protected admin route: command-center, digital-dispatch,
branding, knowledge-pack, driver-pings, sms-log, admin-system, etc.).
No per-controller pipe was needed.

### Test coverage

New `admin-auth.guard.spec.ts` (12 tests) asserts:
- valid header → 200 + `req.tenantId` stamped
- missing header → 401 (not 500), correct error body shape
- non-UUID header → 401 (the regression that caused this incident)
- malformed-UUID header → 401
- `DEFAULT_ADMIN_TENANT_ID=default-tenant` env → 401 (proves the bug
  doesn't regress on env-only operators)
- valid env default → 200
- header beats env, JWT beats header
- JWT with bad tenantId → 401
- uppercase + whitespace tolerated

Full API suite goes from **133 → 145** passing, no regressions.

### Out-of-scope finds (still in BLOCKERS)

`packages/api/src/modules/convini/convini.controller.ts:55` reads
`process.env.DEFAULT_ADMIN_TENANT_ID || …` directly, with a different
fallback chain. Not on the 6-route hit list and the guard there will
still reject non-UUID, but worth a follow-up to delete the redundant
read. Logged in BLOCKERS so future visibility is preserved.
