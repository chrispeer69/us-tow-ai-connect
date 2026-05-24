# S47 — Follow-up (deferred, not done this session)

Scoped out deliberately to keep the sweep low-risk and inside the session's
boundaries. None are blockers.

## PageHeader migration — remaining pages
These have headers woven into a flex/grid bar with inline controls, status
counts, or tab strips. Migrating them means relocating those controls into the
`PageHeader actions` slot (and, for tabbed pages, deciding whether the tab strip
sits above or below the header) — a feature-layout change beyond a header swap.

- `ai-agent` — header + right-aligned action button.
- `company` — header + right-aligned action button.
- `calls` — header + CSV export button + `aggregated/raw` tab strip.
- `audit-log` — `items-baseline justify-between` header with live entry count.
- `sms-log` — same pattern as audit-log.
- `drivers-live` — header lives inside a bordered panel with refresh controls.
- `command-center` — bespoke dashboard header (already token-based: eyebrow +
  display h1 + subtitle); closest to canonical already, lowest priority.

**Recommended:** add an `actions` prop usage + (where needed) a `tabs` slot
convention to `PageHeader`, then migrate these in one focused pass.

## Per-page boundaries — DO-NOT-TOUCH pages
- `admin/members/` and `admin/reports/` got no per-page `error.tsx`/`loading.tsx`
  (owned by other sessions). They still fall back to the segment-root
  `admin/error.tsx`. Add the two thin wrappers when those areas are next opened.

## EmptyState — remaining adoption
Ad-hoc empty strings still in place (low risk, cosmetic):
- `billing` ("No Stripe customer yet …"), `calls` ("No call interactions yet."),
  `digital-dispatch` ("No rules yet …"), `digest`, `knowledge-pack`,
  `integrations` ("No session recorded yet.").
Swap each to `<EmptyState>` next time the page is touched.

## Utility-bar placeholders → real features
The S47 utility bar ships labelled placeholders:
- **Cmd+K search** — focuses the affordance; needs a real command palette
  (route index + fuzzy match).
- **Notifications bell** — static dot; needs a feed (could ride the existing
  VAPID push channel from S29).
- **Tenant switcher** — shows current tenant; needs the multi-tenant switch
  action (super-admin impersonation already exists in the API — wire to it).

## Tables
`digital-dispatch` + `drivers-live` hand-roll `<table>`. Consider migrating to
the `ui/table` primitive for consistent styling — deferred (feature-adjacent).
