# S44 — Findings (deltas from the validation walkthrough)

Seed 44 · `now = 2026-05-24` (UTC) · all 6 charts driven through the real
`ReportsService` via `packages/api/src/modules/reports/seed/validate.ts`.

## Verdict: 34/34 checks PASS — no math bugs found

`reports.service.ts` was **not** modified (out of scope). Every aggregator's
output matched the deterministic generator's expectations exactly.

| Chart          | Result   | Key check |
|----------------|----------|-----------|
| jobs-per-day   | PASS     | 90 pts, gap-filled, total = Σ points = 1,929 |
| win-rate       | PASS     | aaa 59.8% / towbook 61.3% / direct 56.7% (target 60%); Σoffered 1,929, Σaccepted 1,151 |
| response-time  | PASS     | 7d default dense (7/7 days); window avg 282s (4.7m) ∈ [90,480]; 90d samples 1,151 = accepted |
| revenue        | PASS\*   | stub: `revenueCents=null`, `stubbed=true`; Σ completed 1,005 |
| top-drivers    | PASS     | 5 rows, descending 84→74, all in band, names resolved |
| sms-volume     | PASS     | inbound 1,521 / outbound 2,037 = 3,558 |

Cross-cutting: empty state (zero-data tenant) zero-fills correctly for all
charts; date presets 7/30/90 + custom behave (7d ≤ 30d ≤ 90d totals); Redis
cache key present after read with TTL = 300s; all 6 CSV exports have correct
headers, CRLF, and `<metric>_<range>.csv` filenames.

## Observations (not bugs — no action required here)
- **Revenue is a deliberate stub** (PASS\*). Known schema gap: no per-job
  monetary column. Chart correctly advertises this via `stubbed`/`note`.
- **top-drivers renders only the top 5**; drivers ranked 6–15 (50–72 completed)
  never appear in the chart — expected behavior (`LIMIT 5`).
- **Unmatched `assigned_driver_id`** would surface as "Unknown driver" in
  top-drivers. Not exercised — every synthetic job points at a real seeded
  driver. Worth a future test if jobs can outlive a deleted driver row.
- **response-time bucketing uses `dispatched_at`**, while jobs-per-day uses
  `created_at`. A job created at 23:59 and dispatched at 00:03 next day lands in
  different day buckets across the two charts — correct by design, but worth
  noting when eyeballing day-over-day alignment.

No entries needed in `docs/sessions/S44_BLOCKERS.md` for report math.
