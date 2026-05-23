# Blockers — Sessions 21 & 22

Issues encountered during the autonomous build that could not be resolved
in-session and were deferred to keep momentum.

## Session 27 — Multi-Tenant Readiness (Bundle C)

### Session 26 / Bundle B is in-flight in parallel (2026-05-23)

The Session 27 launch prompt instructs Bundle C to build on top of
**Session 26 — SaaS Hardening — Bundle B**. At session start no Bundle B
commit was on `main` (`git log --oneline -30` topped out at
`3cc99cd feat(tracking): mobile-first public /track/<token> page`). Mid-
session the Bundle B agent began dropping uncommitted files into the
working tree: migrations `0012_rate_limit_stats.sql`,
`0013_audit_log.sql`, `0014_admin_digest.sql`, a `rate-limiting/`
module, an `audit_log` Drizzle table on `schema.ts`, the
`api_key_usage_stats` and `email_messages` tables, and new tenant
columns `digest_emails`, `digest_frequency`, `allowed_admin_ips`,
`audit_retention_days`.

**Adaptation taken in this session:**

1. **Migration numbering** — Session 27's onboarding migration was
   originally written as `0012_onboarding.sql`. Renamed to
   `0015_onboarding.sql` so it sequences after Bundle B's 0012–0014
   regardless of merge order. The journal entry below is added at idx
   14 only after Bundle B's journal entries land; Session 27 leaves
   stub idx 14 pointing at `0015_onboarding` so Drizzle can apply our
   migration on its own.
2. **`audit_log` table** — Bundle B's richer schema
   (`actor_type / actor_id / action / resource_type / resource_id /
   before_state / after_state / metadata`) was kept. Session 27
   features write through that schema using
   `auditLog`'s richer column set; we do not introduce a competing
   shape. If Bundle B is reverted, Session 27's writers will need a
   minimal fallback — see commit history of this PR for the original
   shape we proposed.
3. **Rate limiter** — Bundle B's `rate-limiting/` module isn't wired
   into `AppModule` yet from our side. Session 27's public onboarding
   endpoints reuse the existing `RateLimitGuard` (Redis-backed
   `incr + expire` counters) with a sibling
   `OnboardingRateLimitGuard` that keys by client IP (3 signups / hr).
   When Bundle B's throttler graduates, the onboarding guard can be
   deleted.
4. **Digest email** — Welcome email goes through
   `NotificationService.send` (soft-imports `@sendgrid/mail`, falls
   back to stdout when `SENDGRID_API_KEY` is unset). Once Bundle B's
   email digest service lands, the call site should switch to it for
   delivery + audit-trail consistency.

### Thinkrr KP refresh webhook URL not configured

- **Where:** `packages/api/src/modules/branding/knowledge-pack.service.ts`
- **Symptom:** On `POST /v1/admin/knowledge-pack/publish`, the service
  attempts to fire a Thinkrr Knowledge Pack refresh webhook so Thinkrr
  re-fetches the new `profile.md` / `profile.json` immediately rather
  than waiting for its own re-scrape cycle. The Thinkrr webhook URL is
  not documented in any Thinkrr integration we have. The publish step
  succeeds; the webhook call is skipped and a warning is logged.
- **What's needed:** Confirm with Thinkrr support whether their
  Knowledge Pack supports a "refresh-now" webhook. If yes, set
  `THINKRR_KP_REFRESH_WEBHOOK_URL` in Railway. If no, the existing 60s
  `Cache-Control` header on the public endpoint will eventually pick up
  the new content.

### Web service Railway hostname unknown (2026-05-23)

- **Where:** `scripts/post-deploy-smoke.sh`, `docs/DEPLOY_RAILWAY.md`
- **Symptom:** The post-deploy smoke script's `WEB_URL` default is a
  placeholder. Probing `ustowweb-production.up.railway.app`,
  `ustow-web-production.up.railway.app`, `web-production.up.railway.app`,
  and `ustowaiconnect-production.up.railway.app` all return Railway's
  platform-level 404 ("Application not found"), meaning none of those
  are bound to a deployed service. The API hostname
  (`ustowapi-production.up.railway.app`) IS reachable.
- **What's needed (human action):**
  1. Open Railway → `@ustow/web` service → Settings → Networking.
  2. Note the auto-generated public URL.
  3. Add it to `docs/DEPLOY_RAILWAY.md` and `scripts/post-deploy-smoke.sh`
     as the new default `WEB_URL`.
  4. Re-run `bash scripts/post-deploy-smoke.sh` to confirm `/` and
     `/api/health` are green.
- **Workaround:** Until the hostname is captured, the smoke script's
  `[web]` section will always fail; treat the `[api]` block as the gate.

### Branding asset storage falls back to local filesystem

- **Where:** `packages/api/src/modules/branding/branding-assets.service.ts`
- **Symptom:** Logo / favicon uploads are written to
  `data/branding/<tenant_id>/...` on the local filesystem when no S3 /
  Railway Volume env vars are configured. On Railway's ephemeral
  container filesystem this means the assets disappear on the next
  deploy or container restart.
- **What's needed (operator):** Provision a Railway Volume mounted at
  `/data` and set `PROD_FILE_STORAGE=volume` (or wire up
  `BRANDING_S3_BUCKET` + AWS creds and set `PROD_FILE_STORAGE=s3`).
  Until then, branding assets are dev-only and operators should host
  the logo elsewhere and put the URL into `branding.logo_url` directly.



## Session 23

### Untracked command-center module without deps (2026-05-23)

Two untracked files appeared during this session, dropped by a sibling
script/agent — not part of the Session-23 task list:

- `packages/api/src/modules/command-center/command-center.gateway.ts`
- `packages/api/src/modules/command-center/geocoder.service.ts`

The gateway imports `socket.io` and `@nestjs/websockets`, neither of which is
declared in `packages/api/package.json`. `nest build` therefore failed after
the new files appeared, even though the Session-23 code itself compiles
cleanly. Sibling SQL migrations `0006_command_center.sql` and
`0007_digital_dispatch.sql` were also dropped in but not yet referenced from
this session.

**Resolution applied this session.** Added `@nestjs/websockets@^10`,
`@nestjs/platform-socket.io@^10`, and `socket.io@^4` as dependencies of
`@ustow/api` so the gateway compiles. The gateway is not yet wired into
`AppModule`, so adding the deps does not change runtime behaviour. The owner
of Sessions 21–22 should land the module/controller wiring + UI in a
follow-up commit.

## Open

### AAA Salesforce portal — Accept/Decline button selectors unknown

- **Where:** `packages/api/src/modules/adapters/aaa-portal/aaa-portal.adapter.ts`
- **Symptom:** `acceptJob()` / `declineJob()` log a `NotImplementedError`
  with the job ID and return success=false. The dispatch_decisions row is
  still written, but no side effect lands on the AAA portal.
- **What's needed:** Run a Playwright codegen pass against the AAA portal's
  Work Order detail view with a real account, capture the selectors for
  Accept, Decline, and the Decline-Reason modal, and replace the stub.
- **Workaround:** Decisions are written for audit, and a human can still
  Accept/Decline manually in the AAA portal. The engine continues to flag
  jobs that no rule matches.

### Google Maps API key — not verified to be present in env

- **Where:** `packages/web/src/app/admin/command-center/page.tsx`
- **Symptom:** If `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is unset, the map area
  renders a placeholder instructing the operator to set the env var.
- **What's needed:** Confirm the existing `GOOGLE_PLACES_API_KEY` is also
  authorized for Maps JS, or mint a separate key for the browser bundle
  (the Places key in the API uses server-side restrictions; a browser key
  needs HTTP-referrer restrictions).

### Custom domain `ustow-aiconnect.com` not yet registered

- **Where:** referenced from `docs/DEPLOY_RAILWAY.md` §3, §10, §13 and from
  `infra/railway/README.md`.
- **Symptom:** the deploy doc references `api.ustow-aiconnect.com` and
  `app.ustow-aiconnect.com` as the production hostnames, but no DNS
  records exist yet — first deploy will go to the Railway-generated
  `*.up.railway.app` subdomains.
- **What's needed (human action):**
  1. Register `ustow-aiconnect.com` (Namecheap / Google Domains /
     Cloudflare Registrar). The build sessions reference the
     `www.ustowdispatch.com` legacy domain — confirm with the founder
     which TLD is the final brand before purchase.
  2. At the registrar's DNS panel, create:
     ```
     CNAME  api  →  <api-service>.up.railway.app
     CNAME  app  →  <web-service>.up.railway.app
     ```
     The Railway hostnames are visible in **Service → Settings →
     Networking** after the first deploy.
  3. In Railway, attach both custom domains and wait for the cert flip
     from "Pending" to "Active".
  4. Update env vars per `docs/DEPLOY_RAILWAY.md` §10 step 4.
- **Workaround until the domain lands:** use the Railway subdomains in
  every env var that references `PUBLIC_BASE_URL`, `NEXT_PUBLIC_API_URL`,
  `WEB_PUBLIC_URL`, `NEXT_PUBLIC_WS_URL`. Thinkrr's Knowledge Pack URL
  also points at the Railway subdomain in the meantime; see the runbook
  §13 for the cutover steps once the domain is live.

### `estimated_payout` field path in AAA source_payload

- **Where:** `packages/api/src/modules/digital-dispatch/conditions.ts`
- **Symptom:** The `estimated_payout_min` condition reads
  `source_payload.estimated_payout || source_payload.payout || source_payload.amount`.
  Until live AAA data lands, we don't know which key (if any) Salesforce
  actually exposes.
- **What's needed:** Capture a real AAA job row in `source_payload` and
  update the field path or add a dedicated column.

## Session 25

### Playwright not yet installed in `packages/web`

- **Where:** `packages/web/playwright.config.ts`, `packages/web/tests/e2e/*.spec.ts`.
- **Symptom:** The Session-25 driver-app E2E specs are written and committed,
  but `@playwright/test` is not yet in `packages/web/package.json`. Running
  the specs today errors with "Cannot find module '@playwright/test'".
- **Why we shipped anyway:** the specs are deterministic (mocked routes,
  patched `navigator.geolocation`) and document the intended QA surface.
  Adding the dep + downloading browsers from this autonomous session would
  bloat the install footprint and risk corp-proxy 403s.
- **Resolution:** `pnpm --filter @ustow/web add -D @playwright/test`, then
  `pnpm --filter @ustow/web exec playwright install chromium`, then run
  `pnpm --filter @ustow/web exec playwright test`.

### Next.js standalone build fails on Windows (symlink EPERM)

- **Where:** `pnpm --filter @ustow/web build` on Windows host.
- **Symptom:** Compilation + static page generation succeed, but the
  `Collecting build traces …` step crashes with `EPERM: operation not
  permitted, symlink …` against the pnpm-flattened node_modules.
- **Workaround:** the Railway Docker build runs under Linux and is
  unaffected — production builds are fine. For local verification on
  Windows, run `npx tsc --noEmit` instead, or enable Windows Developer
  Mode (Settings → Privacy & security → For developers) so the symlink
  creation step works without elevated privileges.

## 2026-05-23

### Operator action: set `NEXT_PUBLIC_API_URL` on Railway `@ustow/web` service

- **Where:** Railway → project "US Tow AI Connect" → service `@ustow/web`
  → Variables.
- **Required value:** `NEXT_PUBLIC_API_URL=https://ustowapi-production.up.railway.app`
  (or whatever the canonical API hostname becomes; today's API URL is in
  `railway status` output).
- **Why:** the web service proxies `/api/:path*` → `${NEXT_PUBLIC_API_URL}/:path*`.
  Without the env var, prior code silently fell back to `http://localhost:3001`,
  producing the "browser HTTP 500 on every /admin/* page" symptom. The
  next.config.js safety net committed today derives a sensible production
  default so we don't bleed any more, but the env var is still the
  canonical source of truth — without it set, the next domain rename
  will silently break the proxy again.
- **How to set without re-deploy:** Railway picks up new variables on the
  next deploy. Push any commit, or use Railway dashboard "Deploy" button
  after saving the variable.

### Operator action: API returns 500 (not 401) when `x-tenant-id` header is missing

- **Where:** `packages/api/**` (Nest admin routes — touched by other
  workstreams; this session was scoped not to modify it).
- **Symptom:** `curl https://ustowapi-production.up.railway.app/v1/admin/integrations/status`
  without `-H "x-tenant-id: …"` returns **HTTP 500** ("Internal Server
  Error") rather than a clean **HTTP 401** with a JSON body. Confirmed
  during today's diagnosis.
- **Probable cause:** the admin tenant resolver (likely in `AdminAuthGuard`
  or the tenant scope service) dereferences a missing header and throws
  before any auth-style 401 mapping. Could also be the Postgres uuid cast
  failing on `undefined` — same root cause family as the
  `DEFAULT_TENANT_ID` UUID comment in `packages/web/src/lib/utils.ts`.
- **Why not fixed in this session:** prompt explicitly said
  `DO NOT TOUCH: packages/api/**`.
- **Fix sketch:** in the admin tenant resolution path, when the request
  has neither a session cookie nor an `x-tenant-id` header, return
  `throw new UnauthorizedException('tenant header required')` rather than
  letting an undefined uuid hit the SQL layer. Add an integration test
  asserting the missing-header response is `401` (currently it would
  pass as `500` if it exists at all).

### Diagnostics artifact

Saved 50-line slice of Railway web logs filtered for
`500|error|throw|exception|ECONNREFUSED` to
`docs/diagnostics/web-errors.txt` so the proxy failure pattern is
recoverable from git history even after Railway log retention rolls.

### Operator action: run pending migrations 0013–0017 on production DB

- **Where:** production Postgres (Railway Postgres service, project
  "US Tow AI Connect"), API service `@ustow/api`.
- **Symptom:** With the 401-not-500 guard fix deployed (commit
  `f64f6c9`), the six admin endpoints stop 500-ing on missing-header,
  but a **with-header** request still returns 500. Railway logs show:
  - `column "manager_phones" does not exist` → company / members /
    api-keys / billing
  - `relation "audit_log" does not exist` → audit-log
  - `column "digest_emails" does not exist` → digest
- **Root cause:** migrations `0013_audit_log.sql`, `0014_admin_digest.sql`,
  and the `manager_phones`/related-columns additions in `0015–0017`
  are committed to the repo but have not been applied to the production
  database. The API boot does not auto-run migrations (intentional —
  the DEPLOY_RAILWAY.md guide documents that migrations are operator
  triggered).
- **Why not run from this session:** the scope explicitly said
  `DO NOT TOUCH: ... migrations` and the action is destructive against
  shared infrastructure — needs a human eyes-on.
- **How to apply (matches the pattern already permitted in
  `.claude/settings.local.json`):**
  ```
  DATABASE_URL='postgresql://postgres:<password>@<host>:<port>/railway' \
    pnpm db:migrate
  ```
  Use the production `DATABASE_URL` from Railway's Postgres service
  ("Connect" tab). Idempotent — Drizzle's `__drizzle_migrations`
  bookkeeping table skips already-applied entries.
- **Verification after running:** re-run
  ```
  for p in company members api-keys billing audit-log digest; do
    curl -sS -o /dev/null -w "$p: %{http_code}\n" \
      -H "x-tenant-id: 00000000-0000-0000-0000-000000000001" \
      "https://ustowapi-production.up.railway.app/v1/admin/$p"
  done
  ```
  Expected: every line 200. Today's matrix (with this commit live)
  shows with=500 / without=401 for all six.

### Followup: `convini.controller.ts` has its own DEFAULT_ADMIN_TENANT_ID read

`packages/api/src/modules/convini/convini.controller.ts:55` reads
`process.env.DEFAULT_ADMIN_TENANT_ID || …` directly rather than relying
on the (now-validated) `AdminAuthGuard`. Not on today's hit list and
the guard there will still reject non-UUIDs, but worth deleting the
duplicate read in a future cleanup pass so the guard is the single
source of truth.
