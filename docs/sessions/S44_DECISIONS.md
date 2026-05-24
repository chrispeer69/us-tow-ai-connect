# S44 — Decisions (additive log)

Session: 44 — Reports dashboard validation with synthetic data
Branch: `session/44-reports-validate`

## Environment
- **D1.** Local dev DB for this repo (port 5433, container `ustow-postgres`) was **down**; node_modules not installed in the worktree. A `towcommand-postgres` was running on 5432 — a **different project**. Decision: do NOT seed into the 5432 DB (cross-project contamination risk). Spun up *this repo's own* isolated compose (`docker compose up -d` → `ustow-postgres:5433`, `ustow-redis:6380`), `pnpm install`, ran migrations + base tenant-zero seeds. Fully isolated, no collision with other containers.

## Data model mapping (read from reports.service.ts — not modified)
- **D2.** `jobs-per-day` counts `unified_jobs.created_at` per UTC day → seed sets realistic `created_at` across 90 days.
- **D3.** `win-rate` = `count(accepted_at)/count(*)` per `source`. To hit ~60% accepted, `accepted_at` is set on 60% of jobs. Declined + expired offers get NO `accepted_at`.
- **D4.** `response-time` = `avg(dispatched_at - created_at)` bucketed by `dispatched_at` day. Seed sets `dispatched_at = created_at + responseSeconds`, `responseSeconds ∈ [90, 480]` (90s–8min per spec). `response-time` endpoint **defaults to 7d** — recent 7 days are kept dense with dispatched jobs.
- **D5.** `revenue` is a **documented stub** (`revenueCents: null`, `stubbed: true`) — plots completed-job counts by `completed_at` day. Validated as PASS-WITH-NOTE, not FAIL.
- **D6.** `top-drivers` = top 5 by `count(*)` where `completed_at` not null grouped by `assigned_driver_id`, joined to `drivers.name`.
- **D7.** `sms-volume` = `sms_messages` count by `created_at` day split on `direction`.

## Synthetic dataset shape
- **D8. Outcome mix:** accepted 60% / declined 25% / expired 15% (drives win-rate). Of accepted: completed ~88% / en_route ~5% (biased to recent days) / cancelled ~7%. Declined+expired → `status='cancelled'` (spec status set is completed/en_route/cancelled; no `expired` status exists, so the expiry is recorded via `auto_decision='expired'`).
- **D9. Daily volume:** `uniform[12,30]` jobs/day (within spec's 5–30) — chosen so total completed lands ~1000, enough to give all 15 drivers ≥50 completed jobs.
- **D10. CONFLICT — 5–30 jobs/day vs "15 drivers × 50–200 completed":** these are mutually exclusive at the high end (15×200=3000 completed needs ~33+ jobs/day for 90d). Conservative call: honor jobs-per-day as the literal primary spec. Completed jobs are assigned to drivers against a **precomputed per-driver target vector** (descending, every driver in [50,~82], summing to actual completed count) so the result is: every driver within the 50–200 band, a clean descending ranking, and a correct top-5 chart. The 200 ceiling is unreachable under a 5–30/day cap and is documented as such.
- **D11. Sources:** weighted aaa 45% / towbook 35% / direct 20%.
- **D12. SMS:** 2–5 messages per completed job, mixed inbound/outbound, timestamped within the job's lifecycle window.
- **D13. Driver pings:** hourly for the last 7 days × 15 drivers = 2,520 rows (extra realism; no report reads pings — kept small).

## Safety + idempotency
- **D14. Tenant guard:** `TENANT_ID` hardcoded to `00000000-…-0001`. Every read/write is tenant-scoped. Script asserts the tenant row exists before writing (clean error vs FK noise). If `DATABASE_URL` host ≠ localhost/127.0.0.1, the script **refuses** unless `--tenant-zero-only` is passed.
- **D15. Synthetic markers (cleanup keys — always matched together with tenant_id):**
  - `unified_jobs`: `source_payload->>'synthetic' = 'true'` AND `source_job_id LIKE 's44-%'`
  - `drivers`: deterministic UUIDs + `phone LIKE '+1555044%'`
  - `driver_pings`: `source = 'seed-s44'`
  - `sms_messages`: `twilio_sid LIKE 'SEED-S44-%'`
- **D16. Idempotency:** seeded deterministic RNG (default seed 44) → identical dataset every run. `--apply` deletes synthetic rows (tenant_id AND marker) before inserting, so re-running yields the same final state (no growth).
- **D17. Flags:** `--dry-run` is the **default** and needs no DB (prints planned counts + samples). `--apply` writes. `--cleanup` wipes synthetic rows only. After `--apply`/`--cleanup`, the script flushes `reports:<tenant>:*` Redis keys so the 5-min cache doesn't serve stale data during validation.

## Code layout
- **D18.** Full CLI lives in owned path `packages/api/src/modules/reports/seed/{generate,run}.ts`. `scripts/seed-reports.ts` is a thin shim that imports the runner (keeps `pg`/`tsx`/schema resolution inside the api package). `reports.service.ts`/`reports.controller.ts` were read-only — never modified.
</content>
</invoke>
