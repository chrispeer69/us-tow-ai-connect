# Blockers — Sessions 21 & 22

Issues encountered during the autonomous build that could not be resolved
in-session and were deferred to keep momentum.

## Session 23

### Untracked command-center module without deps (2026-05-23)

Two untracked files appeared during this session, dropped by a sibling
script/agent — not part of the Session-23 task list:

- `packages/api/src/modules/command-center/command-center.gateway.ts`
- `packages/api/src/modules/command-center/geocoder.service.ts`

The gateway imports `socket.io` and `@nestjs/websockets`, neither of which is
declared in `packages/api/package.json`. `nest build` therefore failed after
the new files appeared, even though the Session-23 code itself compiles
cleanly. Sibling SQL migrations `0006_command_center.sql` and
`0007_digital_dispatch.sql` were also dropped in but not yet referenced from
this session.

**Resolution applied this session.** Added `@nestjs/websockets@^10`,
`@nestjs/platform-socket.io@^10`, and `socket.io@^4` as dependencies of
`@ustow/api` so the gateway compiles. The gateway is not yet wired into
`AppModule`, so adding the deps does not change runtime behaviour. The owner
of Sessions 21–22 should land the module/controller wiring + UI in a
follow-up commit.

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
