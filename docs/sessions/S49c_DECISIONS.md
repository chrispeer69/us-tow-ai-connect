# Session 49c — Decisions

## Branch parent

Cut from `session/49b-shops-blocklist` (PR #18). When 49 + 49b merge,
49c rebases cleanly. If they merge out of order, only the journal needs
a 1-line renumber.

## Issue classifier is keyword-based, not LLM-driven

49c ships a deterministic regex/keyword matcher in
`issue-classifier.service.ts`. It returns the same shape an LLM
implementation would (`subcategory` + `confidence` + `signals`). We
chose this because:

- Zero external dependency. No Forge API, no Twilio, no Google call to
  classify a job — fast, free, and offline-testable.
- The 6 no-flip categories are well-defined keywords (single tire / jump
  start / lockout / fuel / winch / airbag); a classifier doing better
  than 90% on these is trivially achievable with patterns.
- Easy to swap later: anyone can replace the body of `classify()` with a
  Forge call returning the same shape and the rest of the engine keeps
  working.

## Destination classifier degrades silently when Google Places is unset

`destination-classifier.service.ts` reads `GOOGLE_PLACES_API_KEY` at runtime.
Missing → log once, fall through to a regex-residence-detector. The
flip pipeline still runs; it just can't tag `competitor_repair` vs
`auto_body` until the key is set. Until then most jobs will tag as
`unknown` and the engine will pick the safe path (no flip, hard CONVINI
pitch).

## Flip-decision engine is a pure function

`flip-decision.engine.ts` is intentionally a pure function with zero
side effects. Tests cover every branch. The orchestrator imports it and
the result drives the script renderer + outbound enqueue.

## `fetchPendingFlipJobs` is a stub

The orchestrator polls jobs via
`FlipEngineService.fetchPendingFlipJobs(tenantId)`. 49c ships this as a
returns-empty-array stub on purpose — wiring the existing JobPoller
into this method touches enough cross-cutting code to deserve its own
focused review. Once 49b + 49c merge, a follow-up commit (1 line in
`fetchPendingFlipJobs`) hooks the existing JobPoller queue.

This means **nothing actually fires** when you set
`OUTBOUND_FLIP_ENGINE_ENABLED=true` after 49c lands. The cron ticks,
the orchestrator runs, no jobs come out of the stub, no calls placed.
That's intentional — it lets us verify the orchestrator + classifiers
+ scripts in production read-traffic before we open the floodgates.

## Why we use OutboundVoiceService's `custom` template

The flip script is composed dynamically (confirm details + 0–3 offers +
CONVINI pitch). Rather than register a 7th canonical template in
Session 49, we render the full body in 49c and pass it via the existing
`custom` template's `{{body}}` slot. The orchestrator's enqueue call
looks identical to any other Session-49 outbound call from Thinkrr's
side; it only sees a fully rendered string.

## Audit-log row before enqueue

The orchestrator inserts the `outbound_call_logs` row BEFORE calling
`OutboundVoiceService.enqueueCall`. This means even if the enqueue
throws or Thinkrr is down, we have a permanent trail of the decision
that was made. On enqueue failure we mark the row
`flipOutcome = ENQUEUE_FAILED` for the daily summary to surface.

## Per-tenant config knobs are read every tick

The orchestrator reads `flip_engine_config` per-job rather than caching
it. Reason: a tenant tuning the no-flip threshold should see the change
take effect on the next tick (not a process restart). Cost: one extra
indexed SELECT per job; trivial.

## Tests rely on pure functions, not the orchestrator

49c ships 50 tests across 5 spec files but none of them exercise
`FlipOrchestratorService.handleJob` directly. Reason: that method
binds together 4 services + the DB + the OutboundVoice queue, and
testing it cleanly needs a deeper mocking layer than the v1 fake-DB
shim used by Session 49 supports. The decision engine, classifiers,
and scripts are all covered exhaustively as pure functions; the
orchestrator's shape is a thin composition above them.
