# Session 49 — Blockers

## Thinkrr outbound API contract is approximated

`ThinkrrOutboundClient.placeCall` POSTs to `/v1/outbound/call` with a body
shape inferred from the public Thinkrr docs and analogous voice-AI
platforms. When G$D publishes the production schema, swap the request /
response handling at the top of `thinkrr-outbound.client.ts`. The rest
of the orchestrator does not depend on the wire format.

**Action:** Operator confirms with Cody at G$D the exact path, request
body shape, and response shape for outbound call placement.

## Webhook signature is a header secret, not an HMAC

The verification path checks `x-thinkrr-secret` against
`THINKRR_WEBHOOK_SECRET`. If Thinkrr later publishes an HMAC scheme,
swap the check inside `outbound-voice-webhook.controller.ts`. Fail-closed
behaviour (401 on missing/mismatched header) already covers the gap.

## TCPA consent records not implemented

Tracked in S49_DECISIONS as a soft-compliance choice. Calls placed today
record `outcome.consent_check_skipped = true`. A follow-up session must
add a `consent_records` table and gate `dispatchOne` on it before
shipping to a tenant that has not explicitly green-lit unsolicited
outbound dialing.

## `dispatch_interval_seconds` is documented but not wired

The cron uses a fixed `@Cron('*/30 * * * * *')`. Per-tenant interval
tuning would require either a SchedulerRegistry-driven dynamic cron or
a manual loop. Out of scope this round.

## Runtime-blocking dependencies on operator action

None of the runtime dependencies fail closed in dev. With the env vars
unset, the service still inserts queued rows and the cron still ticks —
it just logs `thinkrr_unavailable_or_unconfigured` instead of placing
calls. Production needs `THINKRR_OUTBOUND_API_URL`, `THINKRR_API_KEY`,
`THINKRR_WEBHOOK_SECRET`, and `OUTBOUND_VOICE_DISPATCH_CRON_ENABLED=true`
set on the `@ustow/api` Railway service before the orchestrator dials
anything.
