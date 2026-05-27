# Session 52 — Blockers

## 1. No live Omadi credentials at build time
- `OMADI_USERNAME` / `OMADI_PASSWORD` not set in the environment when the
  adapter was authored.
- Discovery script written and committed
  (`packages/api/scripts/discover-omadi-selectors.ts`) but **not run live**.
- **Impact:** every selector in the adapter is best-effort or placeholder.
  Login form fields, dispatch URL, row selectors, and Accept/Decline button
  accessible names all need spot-checking against a live account before any
  production tenant relies on them.
- **Mitigation:**
  - Adapter never throws on a missed selector — returns
    `{ success:false, error }` and screenshots to `/tmp`.
  - `docs/ADAPTER_SELECTORS.md` documents every guess with a confidence label
    (best-effort / placeholder) and a human verification checklist.

## 2. dispatchJob has no verified write surface
- Omadi is dispatch software for the operator's own jobs (they create/manage
  inside it); not a motor-club intake broker with a verified public REST or
  DOM-driven outbound dispatch path.
- **Mitigation:** Adapter `dispatchJob` returns a structured
  `{ success:false, error:'not-applicable: Omadi has no verified outbound dispatch write surface' }` —
  identical pattern to Towbook + TowLogs.

## 3. Reason-modal flow unverified
- The post-click reason/confirm modal pattern is borrowed from AAA and adapted
  to generic `[role="dialog"], .modal` scoping. Omadi's actual modal component
  may differ.
- **Mitigation:** Modal flow is best-effort and tolerant of absence. If the
  reason field doesn't resolve, the primary action click is still recorded;
  decline reason just doesn't transmit until selectors are verified.

## 4. Pre-existing failing test (not blocking — out of scope)
- `src/modules/digital-dispatch/conditions.spec.ts > distance_max_miles >
  rejects when no driver has a recent ping` fails on main as of 2026-05-27.
  File is in the S52 DO NOT TOUCH list. Documented here for visibility only.
