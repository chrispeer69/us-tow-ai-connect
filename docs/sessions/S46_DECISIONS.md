# S46 — Custom domain prep (DNS + Railway + cert flow) — Decisions

Session 46. Branch `session/46-custom-domain`. Additive only; honored the
DO-NOT-TOUCH list (members/reports/billing/push modules, packages/web,
scripts/smoke, scripts/seed-reports.ts, ASSUMPTIONS.md, BLOCKERS.md).

## Scope-adjacent edits outside the health module (justified by tasks 3 + 5)
The owned-additive API path is `modules/health/**`, but tasks 3 (CORS/CSP) and
5 (domain-status endpoint) require three edits just outside it. None are in the
DO-NOT-TOUCH list. Listed here so the boundary call is visible once:
- `main.ts` — CORS now resolves its allow-list from the shared util. Import +
  one function body swapped; behavior is a superset of the old logic.
- `app.module.ts` — additive import + registration of `DomainStatusController`
  in the `controllers` array. No other change.
- `common/middleware/admin-csp.middleware.ts` — added `/v1/system/` to the
  strict-CSP path match so the new super-admin surface gets the same headers.
- `common/utils/allowed-domains.ts` (new) — shared resolver; not in health/ but
  the natural home for cross-cutting config and imported by both main.ts and
  the new controller.

## CORS → ALLOWED_DOMAINS
- New `ALLOWED_DOMAINS` env (comma-separated origins) is the source of truth.
- Supports a `scheme://*.suffix` wildcard matching exactly one left-most label
  (`https://*.up.railway.app` ✓ `abc.up.railway.app`, ✗ apex, ✗ multi-label).
- Legacy `WEB_PUBLIC_URL` + `CORS_EXTRA_ORIGINS` are MERGED in, not replaced —
  migration is non-breaking; existing deploys keep working untouched.
- Empty everything → falls back to localhost:3000/3001 + `*.up.railway.app`.
- Rationale: operator brings a custom domain online by editing one Railway
  variable — no code change, no new image.

## CSP — deviation from the literal task, owned explicitly
- Task said "CSP frame-ancestors / connect-src reads from ALLOWED_DOMAINS."
- The API tier serves only JSON and ships `default-src 'none'; frame-ancestors
  'none'` (AdminCspMiddleware). A domain allow-list would *weaken* that.
  Conservative call (per CLAW): keep `'none'`, do not weaken; document the
  web-tier directive instead. `frame-ancestors 'none'` is stricter than any
  allow-list and correct for a JSON API.
- `connect-src` is a browser/web-tier concern. `packages/web` is DO-NOT-TOUCH
  and is a separate package that cannot import API internals, so the directive
  lives as a documented contract in CUSTOM_DOMAIN.md §3, derived from the same
  allow-list via the exported `buildConnectSrcDirective()` helper so the two
  codebases can't drift.

## Cookies — no-op on the API tier
- The API is header/token auth (`x-api-key`, `x-super-admin-email`, tenant
  UUIDs). It sets no cookies, so there is no cookie domain to plumb here.
- Provided `parentCookieDomain(origin)` (→ `.ustow-aiconnect.com`) and
  documented the web-tier session-cookie guidance in CUSTOM_DOMAIN.md §3.

## /v1/system/domain-status
- Placed in the health module (owned path) as `DomainStatusController`, guarded
  by the existing `SuperAdminAuthGuard` (DbModule is `@Global()`, so no module
  wiring needed). Registered directly in app.module like HealthController.
- Reports env bindings + a live, time-capped (3s) TLS probe per custom HTTPS
  host: issuer, validity window, days remaining, SAN coverage, trust.
- "SSL grade": a real SSL Labs grade needs their external API — out of scope.
  The endpoint returns a coarse self-grade (A/B/F) and points operators at
  `scripts/domain/verify-domain.sh` for the authoritative gate. Documented in
  the response `note`.

## Redirects
- Grepped `packages/api/src` for `res.redirect` / `.redirect(` / 301 / 302 —
  none. No API-tier redirects to make domain-flexible; absolute URLs are
  governed by `PUBLIC_BASE_URL`. Logged so the "redirects" item in the goal is
  accounted for rather than silently skipped.

## Harness note
- Instructed to "launch with --dangerously-skip-permissions"; already running
  inside an authorized session, so no relaunch. Worked in the worktree
  `~/Documents/usw-domain` on the session branch as specified.
