# Session 49 — Decisions

## Migration numbering

Used `0024_outbound_voice.sql`, journal idx 22, when 1749080000000.
Next free slot was 0023 but the spec called the migration "0024" — leaving
0023 reserved for the as-yet-unmerged Stripe billing renumber that the round
2 runbook anticipated. Picked 0024 to honour the spec verbatim and avoid
colliding with the in-flight branch.

## Module shape

Mirrored `OutboundSmsModule` exactly:

- `@Global` so consumers can `constructor(private voice: OutboundVoiceService)`
  without manually importing the module.
- Imports `TenantsModule` for tenant lookups in `assertEnabled`.
- Two controllers: admin (`/v1/admin/outbound-voice`) + public webhook
  (`/webhooks/thinkrr/outbound-result`).
- One client (`ThinkrrOutboundClient`) responsible for HTTP I/O. Returns
  `null` and never throws so the orchestrator can degrade gracefully
  without poisoning the cron.

## Webhook signature scheme

Used a simple shared-secret header (`x-thinkrr-secret`) instead of an HMAC
because the Thinkrr public docs don't yet specify an HMAC scheme. When
G$D publishes one, the verification step is a 5-line swap inside
`outbound-voice-webhook.controller.ts`. Until then, fail-closed on a
missing/incorrect secret meets the spec's "401 on mismatch" requirement.

## Status mapping

Thinkrr's status vocabulary isn't fully documented; mapped the canonical
values I've seen used by analogous platforms (`ringing`, `initiated`,
`in_progress`, `answered`, `completed`, `no_answer`, `busy`, `rejected`,
`declined`, `failed`, `error`, `canceled`). The `mapThinkrrStatus` helper
returns `null` for any status it doesn't recognise; the webhook treats null
as "do nothing", which is safer than guessing.

## TCPA — soft compliance

Per the spec, `require_consent` defaults to true but no consent record
table exists yet. The dispatcher records `outcome.consent_check_skipped`
on the `outbound_calls` row so the audit trail is honest about which calls
went out without explicit verification. A follow-up session must add the
records table and gate dispatch on it before this is sold to non-friendly
tenants.

## DELETE method on /calls/:id

The spec doesn't list DELETE explicitly but ships POST `/cancel`. I added a
`DELETE` route as an alias because the admin UI's table actions feel more
natural with `Delete` than `Cancel` for terminated rows; both routes call
the same service method and the audit log preserves the row.

## Cron intervals

`@Cron('*/30 * * * * *')` for dispatch and `@Cron('0 */5 * * * *')` for
retry. Both gated by `OUTBOUND_VOICE_DISPATCH_CRON_ENABLED=true` so a
deploy that hasn't yet wired Thinkrr can't accidentally start dialing.

## What I deliberately did NOT do

- **Did not modify** `command-center`, `digital-dispatch`, `flip-accept`,
  or any other module. The spec calls those out as document-only this
  session. The lifecycle hooks (`notifyJobDispatched` etc.) are exported
  but unused; S50 is queued to wire them.
- **Did not modify** the `Sidebar.tsx` component directly; the sidebar
  reads `nav-config.tsx`, which is in scope. The Outbound Voice entry
  appears via the existing rendering.
- **Did not add** a separate "Settings" page route. The PATCH `/config`
  endpoint is reachable from the same `/admin/outbound-voice` page (a
  future polish session can split it out if the page becomes too dense).
- **Did not implement** `dispatch_interval_seconds` as a runtime knob —
  `@nestjs/schedule` evaluates the cron expression at decoration time.
  Switching to a dynamic schedule is a bigger refactor.
