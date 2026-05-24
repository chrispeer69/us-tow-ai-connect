# S44 — Blockers

## Resolved during the session
- **B1. Local dev DB was down / deps not installed.** This repo's Postgres
  (port 5433) was not running and the worktree had no `node_modules`. A
  `towcommand-postgres` was up on 5432 but belongs to a **different project** —
  seeding into it was rejected (cross-project contamination). Resolution: started
  this repo's own isolated compose (`ustow-postgres:5433`, `ustow-redis:6380`),
  ran `pnpm install`, migrations, and the tenant-zero base seeds. No collision
  with the other project's containers. See `S44_DECISIONS.md` D1.

## Math bugs in reports.service.ts
- **None found.** All 6 aggregators validated against deterministic synthetic
  data (34/34 checks). `reports.service.ts` was treated as read-only and not
  modified. Details: `docs/sessions/S44_FINDINGS.md`.

## Out-of-scope follow-ups (separate sessions)
- **Revenue is stubbed** (`revenueCents: null`). Not a bug — no per-job monetary
  column in the schema. Wire to billing line items when that data exists.
- The "15 drivers × 50–200 completed each" target cannot coexist with the
  "5–30 jobs/day" volume cap (mutually exclusive math). Honored jobs-per-day as
  primary; documented in `S44_DECISIONS.md` D10 and `REPORTS_VALIDATION.md` §3.
