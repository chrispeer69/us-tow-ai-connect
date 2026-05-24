# Session 37 — Reporting + analytics dashboard — Decisions

Branch: `session/37-reporting`. All decisions made autonomously per CLAW.MD;
owner unavailable until PR open.

## Scope delivered
- API module `packages/api/src/modules/reports/**` (new).
- Web route `packages/web/src/app/admin/reports/**` (new).
- 6 charts, date-range selector, per-chart CSV export.

## Decisions

1. **No DB migration.** Reports are read-only aggregates over existing tables
   (`unified_jobs`, `sms_messages`, `drivers`). Nothing to migrate.

2. **Revenue is stubbed.** No per-job monetary column exists in the schema
   (`tenant_billing` is plan-level only). Decision: the `revenue` endpoint
   returns completed-job counts per day with `revenueCents: null`,
   `stubbed: true`, and an explanatory `note`. UI labels it
   "completed jobs (revenue not yet wired)". Wire to billing line items when
   that schema lands.

3. **Win rate = `accepted_at IS NOT NULL` / total offered, per `source`.**
   "Offered" = every job from an adapter in the window; "accepted" = jobs with
   a non-null `accepted_at`. Chosen over joining `dispatch_decisions` because
   `accepted_at` is the canonical signal on `unified_jobs` and avoids an extra
   join through a table that lacks `tenant_id`.

4. **Response time = `dispatched_at − created_at`,** bucketed by the UTC day of
   dispatch, jobs with null `dispatched_at` excluded. Window average is
   sample-weighted across days (not a mean-of-means).

5. **UTC day bucketing, JS gap-fill.** Postgres buckets via
   `to_char(col AT TIME ZONE 'UTC', 'YYYY-MM-DD')`; the service fills every day
   in the window so charts show zero-days instead of skipping them.

6. **Cache: Redis, 5-min TTL,** keyed
   `reports:{tenant}:{metric}:{range}:{from}:{to}`. Best-effort — read/write
   failures fall back to a live recompute rather than erroring. Payloads are
   plain JSON (no Date objects) so they round-trip through the cache cleanly.

7. **CSV per chart.** One serializer per metric, RFC-4180 CRLF, stable column
   order, snapshot-tested. Served from the same endpoint via `?format=csv`
   with `Content-Disposition` attachment headers; web blobs it client-side for
   a stable filename.

8. **Empty states everywhere.** Each aggregator is wrapped in a defensive
   try/catch returning a zero-filled report, mirroring `DigestMetricsService`.
   Fresh tenants render "No data for this range yet." rather than crashing.

9. **recharts ^3** added to web. Its v3 `Tooltip` `formatter`/`labelFormatter`
   generics are over-constrained; the custom formatters are cast (`as never`)
   at the call site. Runtime behaviour is correct; localized to chart file.

10. **Tenant scoping** reuses `AdminAuthGuard` (`req.tenantId`) exactly like
    the existing admin controller — no new auth surface.

## Out of scope / pre-existing (not touched)
- `digital-dispatch/conditions.spec.ts` has 1 failing test — sibling-owned,
  in this session's DO-NOT-TOUCH list, untouched here.
- Web `tsc` reports pre-existing errors in `tests/e2e/*` + `playwright.config.ts`
  (e2e test files, not app code; web ships `typescript.ignoreBuildErrors`).
  Reports files are `tsc`-clean.
- Sidebar `/reports` nav link is added by a sibling session (DO-NOT-TOUCH).

## Verification
- `tsc --noEmit` clean for the API package (0 errors).
- Reports web files `tsc`-clean.
- `vitest`: 17 reports tests pass (aggregators + range math + CSV snapshots);
  168/169 API tests pass (the 1 failure is the pre-existing sibling test above).
