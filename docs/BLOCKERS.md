# Blockers — Sessions 21 & 22

Issues encountered during the autonomous build that could not be resolved
in-session and were deferred to keep momentum.

## Open

### AAA Salesforce portal — Accept/Decline button selectors unknown

- **Where:** `packages/api/src/modules/adapters/aaa-portal/aaa-portal.adapter.ts`
- **Symptom:** `acceptJob()` / `declineJob()` log a `NotImplementedError`
  with the job ID and return success=false. The dispatch_decisions row is
  still written, but no side effect lands on the AAA portal.
- **What's needed:** Run a Playwright codegen pass against the AAA portal's
  Work Order detail view with a real account, capture the selectors for
  Accept, Decline, and the Decline-Reason modal, and replace the stub.
- **Workaround:** Decisions are written for audit, and a human can still
  Accept/Decline manually in the AAA portal. The engine continues to flag
  jobs that no rule matches.

### Google Maps API key — not verified to be present in env

- **Where:** `packages/web/src/app/admin/command-center/page.tsx`
- **Symptom:** If `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is unset, the map area
  renders a placeholder instructing the operator to set the env var.
- **What's needed:** Confirm the existing `GOOGLE_PLACES_API_KEY` is also
  authorized for Maps JS, or mint a separate key for the browser bundle
  (the Places key in the API uses server-side restrictions; a browser key
  needs HTTP-referrer restrictions).

### `estimated_payout` field path in AAA source_payload

- **Where:** `packages/api/src/modules/digital-dispatch/conditions.ts`
- **Symptom:** The `estimated_payout_min` condition reads
  `source_payload.estimated_payout || source_payload.payout || source_payload.amount`.
  Until live AAA data lands, we don't know which key (if any) Salesforce
  actually exposes.
- **What's needed:** Capture a real AAA job row in `source_payload` and
  update the field path or add a dedicated column.
