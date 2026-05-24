# S48 — Decisions log (decisions endpoint resilience + track API gaps)

Branch `session/48-api-resilience`, worktree `~/Documents/usw-api-resilience`.
Per CLAW.md: every call made without the owner.

## Decisions

1. **Filename discrepancy.** Brief's owned path `decisions.controller.ts (+ service)`
   does not exist — the decisions endpoint lives in
   `digital-dispatch.controller.ts` + `digital-dispatch.service.ts` (`@Get('decisions')`
   → `service.listDecisions`). Edited those (still within the digital-dispatch
   module the brief scoped).

2. **Decisions 500 — the brief's hypothesis is wrong, fix is still correct.**
   An `innerJoin` on empty data returns `[]`, it does **not** throw a 500. So
   "innerJoin throwing on empty" is not the cause. Applied both requested
   changes anyway:
   - `innerJoin → leftJoin` in `listDecisions`. Note: semantically a **no-op**
     here — the `where eq(unifiedJobs.tenantId, tenantId)` filter already
     requires the joined row, so left vs inner produce identical results. Kept
     per brief; harmless.
   - **The actual fix:** wrapped the two queries in try/catch. On error we
     `logger.error(message, stack)` and return `{ items: [], total: 0, limit,
     offset }`. The endpoint now degrades to an empty 200 instead of a 500.

3. **Root cause remains unconfirmed (BLOCKER #1).** Couldn't pull the prod stack
   trace — Railway CLI is not auth'd in this checkout (`invalid_grant`). The
   try/catch now logs the real error, so the next occurrence is diagnosable in
   Railway logs. Likely a column/JSONB/migration drift (e.g. selecting the whole
   `dispatchDecisions` row pulls a JSONB column absent in prod). The fix is
   **mitigation, not a root-cause fix.**

4. **Test intent is explicit (don't be fooled by green).**
   - *empty-data → empty page*: **contract** test. Passes against pre-fix code
     too (innerJoin on empty = []). Guards the contract, not the 500.
   - *throwing query → empty result, no exception*: the **regression** test that
     actually proves the 500 can't escape. The mock `.select()` throws
     synchronously; the test asserts the returned value. (The ERROR line in test
     output is this test exercising the logger — expected.)

5. **`driver_call_url` source = env `TWILIO_PROXY_NUMBER`.** No per-tenant relay
   storage exists. The `branding` jsonb is **strictly zod-parsed** by
   `BrandingSchema`, which strips unknown keys — so stashing a relay number there
   would silently vanish without a shared-schema change (out of owned paths).
   Resolution: deployment-level `TWILIO_PROXY_NUMBER`, formatted `tel:<number>`.
   Per-tenant override is a documented follow-up (BLOCKER #2).

6. **`driver_call_url` invariants.** Returns `null` unless a driver is assigned
   **and** a relay is configured; the no-driver check runs **before** any relay
   lookup. We **never** return the raw `assignedDriverPhone`. A dedicated test
   asserts the raw digits never appear in the URL.

7. **`tenant_id`** is taken straight off the tracking-link row (already loaded by
   `getByToken`) — no extra query, no branding fetch.

8. **Shared schema: no change, deliberately.** There is no shared zod schema /
   type for `TrackingStatusView` — the contract is the TS interface in
   `tracking.service.ts`. Both additions are new optional-to-consume fields;
   additive fields are backward-compatible, so `packages/web` (DO NOT TOUCH)
   keeps compiling. Task 3 ("update any shared schema") → nothing to update.

9. **Fresh-worktree build order.** `@ustow/shared` ships from `./dist`, which a
   fresh worktree lacks → the (untouched) `branding.service.spec.ts` failed to
   resolve `@ustow/shared` until I ran `pnpm --filter @ustow/shared build`.
   Environmental, not a code change. After building shared: **198/198 tests
   pass, `nest build` exits 0 (tsc clean).**

## Verification
- `pnpm --filter @ustow/api test` → 31 files, **198 passed**.
- New specs: `digital-dispatch.service.spec.ts` (3), `tracking.public-view.spec.ts` (4).
- `pnpm --filter @ustow/api build` → exit 0, `dist/main.js` produced.
- Did **not** touch `conditions.spec.ts`, reports/members/billing/push, or `packages/web`.
