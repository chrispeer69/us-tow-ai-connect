# Blockers — Sessions 21 & 22

Issues encountered during the autonomous build that could not be resolved
in-session and were deferred to keep momentum.

## Session 27 — Multi-Tenant Readiness (Bundle C)

### Session 26 / Bundle B hardening commit not present (2026-05-23)

The Session 27 launch prompt instructs Bundle C to build on top of
**Session 26 — SaaS Hardening — Bundle B** which is expected to ship the
`audit_log` table, a richer rate limiter, and a digest email service. A
scan of `git log --oneline -30` showed no Session 26 / Bundle B
commit on `main`. The most recent feature commit is
`3cc99cd feat(tracking): mobile-first public /track/<token> page` and the
last "session complete" commit is `869cc55 chore: sessions 21+22 complete
— command center + digital dispatch`.

**Adaptation in this session:**

1. **`audit_log` table** — created a new minimal `audit_log` table as part
   of the onboarding migration so onboarding / branding / KP-publish /
   super-admin impersonation events have somewhere to land. If Bundle B
   later introduces a richer audit table, the schemas should be merged
   (this one only carries the columns Session 27 actually needs).
2. **Rate limiter** — reused the existing `RateLimitGuard` (Redis-backed
   `ratelimit:<key>` counters with `incr + expire`) and added a per-IP
   variant for the public onboarding endpoints (`OnboardingRateLimitGuard`).
3. **Digest email** — no Bundle B digest service exists, so the welcome
   email path falls through to the existing `NotificationService.send`,
   which already soft-imports `@sendgrid/mail` and falls back to stdout
   when `SENDGRID_API_KEY` is unset. No new abstraction created.

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
