# Session 51 — Blockers

## 1. No live TowLogs credentials at build time
- `TOWLOGS_USERNAME` / `TOWLOGS_PASSWORD` not set in the environment when the
  adapter was authored.
- Discovery script was written and committed
  (`packages/api/scripts/discover-towlogs-selectors.ts`) but **not run live**.
- **Impact:** every selector in the adapter is best-effort or placeholder.
  Login form fields, open-jobs URL, row selectors, and Accept/Decline button
  accessible names all need spot-checking against a live account before any
  production tenant relies on them.
- **Mitigation:**
  - Adapter never throws on a missed selector — returns
    `{ success:false, error }` and screenshots to `/tmp`.
  - `docs/ADAPTER_SELECTORS.md` documents every guess with a confidence label
    (best-effort / placeholder) and a human verification checklist.

## 2. dispatchJob has no verified write surface
- TowLogs marketing material treats the product as inbound-intake oriented (we
  accept jobs offered to us). No verified public REST/GraphQL or DOM-driven
  outbound dispatch path.
- **Mitigation:** Adapter `dispatchJob` returns a structured
  `{ success:false, error:'not-applicable: TowLogs is intake-only (no verified dispatch-out surface)' }` —
  identical pattern to Towbook's accept/decline no-ops. Audit trail captures
  the no-op cleanly; no fabricated click.

## 3. Reason-modal flow unverified
- The post-click reason/confirm modal pattern is borrowed from the AAA adapter
  and adapted to generic `[role="dialog"], .modal` scoping. TowLogs' actual
  modal component may differ.
- **Mitigation:** Modal flow is best-effort and tolerant of absence. If the
  reason field doesn't resolve, the primary action click is still recorded;
  decline reason just doesn't transmit until selectors are verified.

## 4. Pre-existing failing test (not blocking — out of scope)
- `src/modules/digital-dispatch/conditions.spec.ts > distance_max_miles >
  rejects when no driver has a recent ping` fails on main as of 2026-05-27.
  File is in the S51 DO NOT TOUCH list. Documented here for visibility only.
