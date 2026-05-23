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
