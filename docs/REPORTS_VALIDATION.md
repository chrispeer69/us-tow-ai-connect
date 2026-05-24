# Reports Dashboard — Validation Guide (Session 44)

Validates the 6 operational charts at `/admin/reports` against 90 days of
deterministic synthetic data seeded into **tenant-zero**
(`00000000-0000-0000-0000-000000000001`).

- Seeder: `scripts/seed-reports.ts` → `packages/api/src/modules/reports/seed/{generate,run}.ts`
- Harness: `packages/api/src/modules/reports/seed/validate.ts` (drives the real
  `ReportsService`; **never** modifies `reports.service.ts`)
- Aggregator math inventoried from `reports.service.ts` (read-only).

All numbers below are from seed `44` at `now = 2026-05-24` (UTC). The seed is
deterministic — same seed ⇒ identical rows ⇒ identical expectations.

---

## 1. Seed / re-seed / clean up

Prereq (local dev): isolated Postgres + Redis on this repo's ports, schema
migrated, tenant-zero base rows present.

```bash
docker compose up -d                       # ustow-postgres:5433, ustow-redis:6380
export DATABASE_URL='postgresql://ustow:ustow_dev@localhost:5433/ustow'
export REDIS_URL='redis://localhost:6380'
pnpm --filter @ustow/api db:migrate
pnpm --filter @ustow/api db:seed:tenant-zero
pnpm --filter @ustow/api db:seed:command-center

# seed reports data
packages/api/node_modules/.bin/tsx scripts/seed-reports.ts             # DRY-RUN (default, no DB)
packages/api/node_modules/.bin/tsx scripts/seed-reports.ts --apply     # insert (idempotent)
packages/api/node_modules/.bin/tsx scripts/seed-reports.ts --cleanup   # wipe synthetic rows only

# validate
pnpm --filter @ustow/api exec tsx src/modules/reports/seed/validate.ts
```

- **`--apply` is idempotent**: it deletes prior synthetic rows (tenant_id + marker)
  then re-inserts the deterministic dataset, so re-running never grows the tables.
- After `--apply`/`--cleanup` the script flushes `reports:<tenant>:*` Redis keys so
  the 5-min cache doesn't serve stale data.
- **Remote DB safety**: if `DATABASE_URL` host ≠ localhost the script refuses
  unless `--tenant-zero-only` is passed. Every query is tenant-zero-scoped regardless.

### Synthetic markers (cleanup contract — matched together with `tenant_id`)

| Table          | Marker                                                                 |
|----------------|------------------------------------------------------------------------|
| `unified_jobs` | `source_job_id LIKE 's44-%'` **AND** `source_payload->>'synthetic'='true'` |
| `drivers`      | `phone LIKE '+1555044%'` (deterministic UUIDs `…-4d44-…`)              |
| `driver_pings` | `source = 'seed-s44'`                                                  |
| `sms_messages` | `twilio_sid LIKE 'SEED-S44-%'`                                         |

### Seed counts (seed 44)

| Entity        | Count | Notes |
|---------------|-------|-------|
| drivers       | 15    | deterministic UUIDs, `+1555044NNNN` phones |
| unified_jobs  | 1,929 | 90 days, 12–30/day |
| → accepted    | 1,151 | `accepted_at` set (≈60%) |
| → declined    | 472   | `auto_decision='decline'` (≈25%) |
| → expired     | 306   | `auto_decision='expired'` (≈15%) |
| → completed   | 1,005 | `completed_at` set → revenue + top-drivers |
| → en_route    | 52    | biased to last 3 days |
| sms_messages  | 3,558 | 1,521 inbound / 2,037 outbound (2–5 per completed job) |
| driver_pings  | 2,520 | hourly × 7 days × 15 drivers |

---

## 2. Per-chart validation

Legend: **PASS** verified by harness · **PASS\*** pass-with-note.

### jobs-per-day — `LineChart` (blue), default 30d
- **Source/math**: `count(unified_jobs)` by `created_at` UTC day, gap-filled; `total = Σ points`.
- **Expected (90d)**: 90 points, every day present, daily 12–30, **total = 1,929**, `total == Σ points`.
- **Axes/units**: X = `M/D` day ticks; Y = integer job count (`allowDecimals=false`).
- **CSV** `jobs-per-day_<range>.csv`: `date,jobs` — one row/day, CRLF.
- **Empty state**: 30 points, all `jobs=0`, `total=0`.
- **Result: PASS**

### win-rate — `BarChart` (green/amber), default 30d
- **Source/math**: per `source`, `offered=count(*)`, `accepted=count(accepted_at)`, `winRate=accepted/offered` (4dp).
- **Expected (90d)**: 3 bars `aaa/towbook/direct`; Σoffered=1,929; Σaccepted=1,151; each winRate ≈0.60.
- **Axes/units**: X = source; Y = `%` domain `[0,100]` (chart renders `winRate*100`, 1dp).
- **CSV** `win-rate_<range>.csv`: `source,offered,accepted,win_rate` (win_rate is 0–1 fraction).
  ```
  source,offered,accepted,win_rate
  aaa,834,499,0.5983
  towbook,670,411,0.6134
  direct,425,241,0.5671
  ```
- **Empty state**: `adapters: []` → no bars.
- **Result: PASS**

### response-time — `BarChart` (amber), **default 7d**
- **Source/math**: `avg(dispatched_at − created_at)` (seconds) bucketed by `dispatched_at` day; window mean is sample-weighted.
- **Expected (7d)**: 7 points, ≥6 days with samples (dense), window `avgSeconds` ≈ **282s (4.7 min)**, within 90–480s.
- **Expected (90d)**: Σ samples = 1,151 (every accepted job is dispatched).
- **Axes/units**: X = day; Y = minutes (`unit="m"`; chart divides seconds/60, 1dp). Tooltip shows sample count.
- **CSV** `response-time_<range>.csv`: `date,avg_seconds,samples` (seconds, not minutes).
- **Empty state**: all points `avgSeconds=0, samples=0`; window `avgSeconds=0`.
- **Result: PASS**

### revenue — `BarChart` (green), default 30d — **documented stub**
- **Source/math**: schema has no per-job monetary column → `stubbed:true`, `revenueCents:null`; plots `completedJobs` by `completed_at` day.
- **Expected (90d)**: `stubbed=true`, every `revenueCents=null`, Σ`completedJobs` = **1,005**.
- **Axes/units**: Y = completed-job count (integer). Chart label "Completed jobs".
- **CSV** `revenue_<range>.csv`: `date,completed_jobs,revenue_cents` (revenue_cents column always empty).
- **Empty state**: all `completedJobs=0`.
- **Result: PASS\*** — known schema gap, not a bug. Wire to billing line items when available (logged, out of scope this session).

### top-drivers — horizontal `BarChart` (purple), default 30d
- **Source/math**: top 5 by `count(*)` where `completed_at` not null & `assigned_driver_id` not null, grouped by driver, left-joined to `drivers.name`, `ORDER BY count DESC LIMIT 5`.
- **Expected (90d)**: exactly 5 rows, descending, all in 50–200 band, names resolved.
  ```
  driver_id,name,completed_jobs
  00000000-0000-4d44-8000-000000000001,Diego Alvarez,84
  00000000-0000-4d44-8000-000000000002,Tasha Brooks,82
  00000000-0000-4d44-8000-000000000003,Liam O'Connor,79
  00000000-0000-4d44-8000-000000000004,Priya Patel,77
  00000000-0000-4d44-8000-000000000005,Marcus Webb,74
  ```
- **Axes/units**: X = completed count (integer); Y = driver name (category, 120px).
- **CSV** `top-drivers_<range>.csv`: `driver_id,name,completed_jobs`.
- **Empty state**: `drivers: []` → no bars. (Unmatched driver IDs would render "Unknown driver" — not exercised here; all IDs resolve.)
- **Result: PASS** — see note on the 50–200 ceiling in §3.

### sms-volume — stacked `BarChart` (blue inbound / navy outbound), default 30d
- **Source/math**: `sms_messages` count by `created_at` day split on `direction`; `totalInbound`/`totalOutbound` summed.
- **Expected (90d)**: totalInbound=**1,521**, totalOutbound=**2,037**, sum=3,558.
- **Axes/units**: X = day; Y = message count (integer); legend Inbound/Outbound stacked.
- **CSV** `sms-volume_<range>.csv`: `date,inbound,outbound`.
- **Empty state**: all points `inbound=0, outbound=0`.
- **Result: PASS**

---

## 3. Cross-cutting behavior

### Date-range filter (`?range=`)
- `7d`→7 points, `30d`→30, `90d`→90; `custom&from=&to=`→inclusive day span (e.g. `2026-04-01..2026-04-30` = 30 points).
- Monotonic: 7d total ≤ 30d total ≤ 90d total (verified 147 ≤ 622 ≤ 1,929 for jobs-per-day).
- Bad/missing custom dates fall back to the endpoint default (no preset for `0d` — **empty state is validated against a zero-data tenant**, not a 0-day range).
- Per-endpoint defaults: response-time = `7d`; all others = `30d` (`reports.controller.ts`).

### Redis cache (5-min TTL)
- First read computes + writes `reports:<tenant>:<metric>:<range>:<fromIso>:<toIso>`; TTL observed = **300s**.
- Cache read/write failures are swallowed (report recomputed) — verified by code path; non-fatal.
- The seeder flushes these keys on `--apply`/`--cleanup` so a re-seed is visible immediately.

### CSV export (`?format=csv`)
- All 6 serializers: stable column order, RFC-4180 CRLF line endings, `attachment; filename="<metric>_<range>.csv"`. Header rows verified for all 6.

---

## 4. Result summary

**34/34 automated checks PASS** (`validate.ts`). All 6 charts: **5 PASS, 1 PASS\*** (revenue stub).
No math bugs found in `reports.service.ts` — see `docs/sessions/S44_FINDINGS.md`.

### Note: the 50–200-per-driver ceiling
"5–30 jobs/day" and "15 drivers × 50–200 completed each" are mutually exclusive at
the top end (15×200 = 3,000 completed needs ~33+ jobs/day for 90 days). The seed
honors jobs-per-day as the literal spec and assigns completed jobs against a
precomputed per-driver target so **every driver lands in [50, ~84] and the top-5
chart is cleanly ranked**. The 200 upper bound is unreachable under a 5–30/day cap
by construction. See `docs/sessions/S44_DECISIONS.md` (D9, D10).
