# Session 49b — Blockers

## None blocking the merge

Everything in 49b is data-foundation-only. No external dependency. No
operator action is required for the migrations to apply on Railway —
they are pure DDL with `IF NOT EXISTS` guards and an idempotent seed
that uses `ON CONFLICT DO NOTHING`.

## Items deferred to follow-up sessions (intentional, not blockers)

- **Dispatch board polling cron** — 49c. Without this, no flip is ever
  triggered automatically. Manual `POST /v1/admin/flip-engine/...` endpoints
  are not in scope this round; 49c builds the trigger.
- **Google Places destination classifier** — 49c. Without it, the
  `checkAaaBranded` check still works (it relies on the regex + blocklist),
  but residence-vs-repair-vs-body classification is missing.
- **Issue category + confidence classifier** — 49c. Today the no-flip rule
  cannot be evaluated without 49c.
- **Three-tier flip + CONVINI scripts** — 49c. Today `enqueueCall` from
  Session 49 still works for ad-hoc outbound calls; the structured flip
  flow is not yet wired.
- **Management SMS notifier (real-time / batch / daily)** — 49d.
- **Flip activity admin page (transcript drill-down)** — 49d.

## Operator items (do NOT block merge — happen in parallel)

- The 9 Alpha Automotive shop coordinates were sourced from public
  search and may need fine-tuning. The admin UI lets the operator
  edit lat/lng directly, or we can add a Google Places "geocode this
  address" button in 49c.
- The AAA blocklist seed is generic ("Car Care Plus", "Auto Repair").
  Operators with regional knowledge can add more specific entries via
  the admin UI.
