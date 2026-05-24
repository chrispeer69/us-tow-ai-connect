# S42 — Blockers (Tenant-zero E2E smoke harness)

Findings surfaced by the harness that are **outside this session's owned paths**
or otherwise require an owner decision. Filed here per the brief (use
S42_BLOCKERS.md, not docs/BLOCKERS.md).

## #1 — `GET /v1/admin/digital-dispatch/decisions` returns 500 in production
- **Severity:** High (admin decisions list is unusable in prod).
- **Evidence:** `curl -H "x-tenant-id: <tenant-zero>" \
  https://ustowapi-production.up.railway.app/v1/admin/digital-dispatch/decisions?limit=5`
  → `HTTP 500 {"statusCode":500,"message":"Internal server error"}`.
  Same `x-tenant-id` against `/v1/admin/audit-log` → 200, so admin **auth is
  fine** — the decisions handler itself throws.
- **Likely cause:** `listDecisions` uses `innerJoin(unifiedJobs, …)` (and joins
  to `dispatch_rules`) in `packages/api/src/modules/digital-dispatch/digital-dispatch.service.ts`.
  Against an empty/partial tenant-zero dataset this is the prime suspect for the
  throw. Not confirmed — needs server logs.
- **Owner:** digital-dispatch module owner (NOT in S42 owned paths — not touched).
- **Harness behavior:** S5 reports **FAIL** (read-only) so the smoke gate catches
  this on every run until fixed.

## #2 — Public intake does not synchronously feed the decision engine
- **Severity:** Medium (limits black-box E2E coverage of the "→ decision" leg).
- **Evidence:** `webhook-receiver.service.ts` inserts only into
  `call_interactions` + `interaction_logs`; `ai-connect.service.ts` has no
  reference to the decision engine / `unified_jobs`. Decisions are produced from
  adapter-ingested `unified_jobs` (e.g. the TOWBOOK poller), not from a Thinkrr
  webhook or a `dispatch-request`.
- **Impact:** A pure black-box run cannot create a decision-eligible job, so the
  full intake→decision→adapter chain (brief steps c–e) can't be driven end-to-end
  from public endpoints.
- **Harness behavior:** S9 polls 30s; asserts shape if a decision appears,
  otherwise **SKIP** with this reference (a documented-absent precondition, not a
  regression).
- **Resolution options (owner):** (a) expose a test-only seed endpoint that
  inserts a `unified_jobs` row + triggers evaluation; or (b) run the adapter
  poller against a fixture in the local full-flow; or (c) accept the gap and keep
  S9 as a coverage marker.

## #3 — No black-box cleanup for test rows
- **Severity:** Low.
- **Evidence:** No `@Delete` / `mark-test` / `is_test` affordance on
  `dispatch_requests` or `flip_accept_requests`.
- **Mitigation:** Test rows are tagged `SMOKE-E2E <runId>` in caller/summary/notes
  fields for manual purge. S12 always SKIPs (cleanup is best-effort per brief).
- **Resolution option (owner):** add an `is_test`/`source='smoke'` column or a
  guarded purge endpoint so the harness can self-clean.

## #4 — tenant-zero has no Knowledge Pack v2 published (prod)
- **Severity:** Informational.
- **Evidence:** `GET /public/knowledge/<tz>/profile.json` → 404 `NOT_PUBLISHED`.
  The v1 markdown (`profile.md`) is served (200), which is what S3 asserts.
- **Action:** none required; publish KP v2 for tenant-zero if the JSON profile is
  expected by the voice agent.
