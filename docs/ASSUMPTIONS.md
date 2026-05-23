# Engineering Assumptions — Sessions 21 & 22

Companion to the root `ASSUMPTIONS.md`. Captures non-obvious decisions taken
during the Command Center (S21) and Digital Dispatch (S22) builds.

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
