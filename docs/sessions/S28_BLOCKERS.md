# Session 28 — Blockers (Stripe billing)

Conservative path taken for each; build continued.

- **B1 — No real Stripe account / keys available in this environment.** Cannot
  create live products, prices, or a webhook signing secret, and cannot
  hardcode a tenant-zero test key (would leak a secret into git). **Path:**
  Stripe client is nullable (D6) — API boots without keys; checkout/portal/
  webhook return 503 until the operator sets env on Railway. All wiring + tests
  use a mocked Stripe SDK. See `S28_OPERATOR_TODO.md`.

- **B2 — Cannot run the migration against prod from here.** **Path:** migration
  0020 ships in the branch and is marked NOT-yet-applied; it runs on the next
  deploy via the startup migrator. Idempotent (`IF NOT EXISTS`), safe to re-run.

- **B3 — `current_period_start/end` location varies by Stripe API version.**
  **Path:** `readPeriod()` reads from the subscription or its first item,
  whichever is present, so plan transitions record a period regardless of the
  account's pinned API version.

## Pre-existing issues observed (NOT introduced here, NOT in scope)
- **P1 — `digital-dispatch/conditions.spec.ts` has 1 failing test**
  (`distance_max_miles > rejects when no driver has a recent ping`). A 60-min-old
  ping is no longer treated as stale by the freshness threshold. This module is
  on the Session 28 DO-NOT-TOUCH list and is untouched by this branch
  (`git diff` confirms). Left for the owning session. Full API suite otherwise:
  **162 passing**, incl. the 11 new billing tests.
- **P2 — `packages/web` e2e typecheck fails** (`@playwright/test` not installed,
  implicit-any in `tests/e2e/**` + `playwright.config.ts`). Pre-existing, unrelated
  to billing. App/source typecheck (incl. the billing page) is clean.
