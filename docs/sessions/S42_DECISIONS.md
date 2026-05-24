# S42 — Decisions log (Tenant-zero E2E smoke harness)

Per CLAW.md: every call made without the owner, additive. Branch
`session/42-smoke-e2e`, worktree `~/Documents/usw-smoke`.

## Decisions

1. **Worktree created.** `~/Documents/usw-smoke` did not exist; created it as a
   git worktree off `origin/main` on branch `session/42-smoke-e2e` (honors the
   brief's WORKTREE directive + isolation from parallel sessions).

2. **Intake endpoint reality.** Brief's `POST /v1/ai-connect/intake` does not
   exist. The real "simulated inbound call" is
   `POST /webhooks/thinkrr/<secret>/call-completed` (matches the brief's wording
   "Thinkrr inbound webhook"). Used that for S6. `POST /v1/ai-connect/dispatch-request`
   is the downstream agent call → kept as a separate step (S7).

3. **Persistence reality.** `dispatch-request` persists to `dispatch_requests`
   and returns `data.id` (not `job_id` in `unified_jobs`). `unified_jobs` is fed
   by adapter ingestion, not the public intake. Assert on `data.id`; documented
   in E2E_TENANT_ZERO.md.

4. **ETA is GET, not POST.** `GET /v1/ai-connect/eta?lat&lng`. Assert
   `eta_minutes ≤ 60` (S8).

5. **Decision pipeline is not synchronous from intake (BLOCKER).** Neither the
   Thinkrr webhook (writes only `call_interactions`/`interaction_logs`) nor
   `dispatch-request` feeds `dispatch_decisions`. S9 polls; if a decision shows
   up it asserts shape, otherwise **SKIP** (precondition: a decision-eligible
   `unified_job`) — not a FAIL of a by-design gap. See S42_BLOCKERS.md #2.

6. **SKIP vs FAIL discipline.** SKIP only for documented-absent preconditions
   (prod-readonly mode, `TENANT_API_KEY` unset, no decision-eligible job).
   FAIL for action-ran-but-effect-missing (incl. the prod decisions 500). Never
   let prod-readonly tolerance leak into local full-flow.

7. **Admin auth.** Probed prod: `x-tenant-id` is accepted (audit-log → 200).
   Harness uses `x-tenant-id` for admin GETs (no JWT minting needed).

8. **prod-readonly is the captured run.** Local full boot needs
   Postgres+Redis+migrations+seeds+a minted tenant key — high-failure setup not
   worth the session budget when prod-readonly already yields real signal (it
   caught the S5 500). Local full flow is written + documented, executed via the
   documented command. Logged as a deliberate scope call.

9. **tsx invocation.** `pnpm tsx <path>` from repo root does NOT resolve — tsx
   is only in `@ustow/api`'s node_modules. Documented working form:
   `pnpm --filter @ustow/api exec tsx scripts/smoke/tenant-zero-e2e.ts`.
   Did **not** modify root `package.json` (shared, parallel-session risk).

10. **post-deploy hook placement.** `scripts/post-deploy-smoke.sh` already
    exists (HTTP probes) and is outside my owned paths. Did not clobber it;
    created `scripts/smoke/post-deploy-smoke.sh` (owned) that drives the TS
    harness in `--prod-readonly`, and documented Railway wiring. Brief named
    `scripts/post-deploy-smoke.sh`; deviated to owned path to avoid touching a
    shared file.

11. **Cleanup (BLOCKER).** No black-box DELETE / mark-test exists for
    `dispatch_requests` or `flip_accept_requests`. Degraded to tagging test rows
    with `SMOKE-E2E <runId>` in caller/notes fields for manual purge; S12 always
    SKIPs (best-effort per brief). See S42_BLOCKERS.md #3.

12. **Dependency-free harness.** Global `fetch` + node builtins only, so it runs
    under any tsx without monorepo wiring and in a fresh worktree (no install).

13. **Diagnostics path.** Brief specifies `docs/diagnostics/` (not in my
    exclusive-owned list, but the task explicitly sanctions writing the results
    file there). Additive new file only; resolved repo-root-relative from the
    script location so it's cwd-independent.

## Captured prod-readonly run (2026-05-24)
`SMOKE_BASE_URL=https://ustowapi-production.up.railway.app … --prod-readonly`
- S1 health — PASS (200, `status=ok`)
- S2 health/ready — PASS (200, db=true redis=true, sms=false in prod)
- S3 knowledge profile.md — PASS (200, 330 bytes md)
- S4 audit-log baseline — PASS (200, total=0)
- S5 dispatch decisions — **FAIL (500)** → S42_BLOCKERS.md #1
- S6–S12 — SKIP (prod-readonly)
- Result: 4 passed, 1 failed, 7 skipped. Exit 1 (correct — gates on the 500).
- Report: `docs/diagnostics/smoke-20260524-180836.json`
