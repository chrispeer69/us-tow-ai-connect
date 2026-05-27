# Session 49b — Decisions

## Branch parent

49b is cut from `origin/session/49-outbound-voice` (PR #15), not from
`main`. Reason: 49 ships migration `0024_outbound_voice` and 49b ships
`0025_alpha_shops` + `0026_aaa_branded_blocklist`. Cutting from 49 keeps
the migration chain intact. If 49 stalls in review, rebase 49b onto
main and renumber.

## Migration numbering

Used `0025_alpha_shops.sql` (idx 23) and `0026_aaa_branded_blocklist.sql`
(idx 24). Both entries appended to `meta/_journal.json` after 49's
0024 entry. Skipped 0023 because Stripe billing already uses 0021;
0024 was 49's reservation; the next free slot was 0025.

## Tenant-zero scoped seed

Both migrations seed only tenant
`00000000-0000-0000-0000-000000000001`. Alpha Automotive shops are not
"every tenant's data" — they're our data. The admin UI lets every other
tenant add their own shops.

The AAA blocklist is also tenant-scoped because regional brand variants
(e.g., AAA Care Plus vs AAA Auto Repair) may differ by market and we
don't want one tenant's customizations to leak into another's.

## Hard-coded `\bAAA\b` regex over a config-only check

The standalone-AAA-word regex is hard-coded inside
`aaa-branded.matcher.ts`. It runs before any DB lookup. If the database
is unreachable, slow, or wiped, the regex still protects against the
canonical case. The blocklist table is the override layer for edge
cases the regex misses.

## `FlipEngineModule` is `@Global`

49c's poller and 49d's notifier will both consume `FlipEngineService`
(for the AAA-branded check, the nearest-shop selector, and the tenant
config read). Marking the module global avoids forcing every consumer
to re-import it.

## Phone match: last 10 digits

The PHONE blocklist match compares the **last 10 digits** rather than
strict digits-only equality. Reason: US phone numbers commonly arrive
in two shapes — `+1 614 555 1212` (11 digits with country code) and
`614 555 1212` (10 digits). Comparing the last 10 makes the match
robust without forcing operators to enter a normalized form.

## `numeric()` lat/lng instead of `double precision`

The Drizzle table uses `numeric('lat', { precision: 10, scale: 6 })`
(returns string at runtime) so we coerce to `Number` in
`flip-engine.service.ts`. The migration uses `double precision`. This
is consistent with how other geo columns are stored in the codebase
(see `routing_rules` priority etc.). Net effect: 6 decimal places of
precision (~11 cm), more than enough for nearest-shop selection.

## Why the dispatch poller is NOT in 49b

49b ships only the data foundation. Adding the poller in this session
would have entangled it with the destination classifier (Google
Places) and the issue classifier (LLM-driven), both of which need
their own focused session. Keeping 49b small means it can merge fast
and the poller can iterate independently.

## What `FlipEngineService` does NOT own

- The 30/60-second cron poller — 49c
- The Google Places destination classifier — 49c
- The issue category + confidence classifier — 49c
- The 3-tier offer scripts — 49c
- The CONVINI pitch scripts — 49c
- The management SMS notifier (real-time / batch / daily) — 49d
- The flip activity admin page (transcript table, filters, drill-down) — 49d

49c imports `FlipEngineService` to call `checkAaaBranded` and
`pickNearestShop`. 49d imports it to read tenant config (which numbers
to text). Both wire into Session 49's outbound voice orchestrator.

## Operator overrides for the no-flip categories

The default `no_flip_categories` list (single_tire_issue, jump_start,
lockout, fuel_delivery, winch_out, accident_with_airbags) is set in
49c's classifier code. The Settings UI in 49b shows the threshold; it
does not yet expose per-category toggles. If operators need finer
control than "all categories share one threshold," 49c can add
per-category thresholds via JSON config without a schema change.
