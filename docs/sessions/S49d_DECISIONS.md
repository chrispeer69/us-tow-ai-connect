# Session 49d — Decisions

## Branch parent

Cut from `session/49c-flip-pipeline` (PR #21). When 49 → 49b → 49c
merge in order, this rebases cleanly onto main.

## Three notification streams (per spec)

1. **Real-time WIN SMS** — `notifyFlipWin(tenantId, win)`. Triggered
   from the orchestrator's outcome path (or the inbound webhook that
   confirms an offer was accepted; wiring that signal is a follow-up).
2. **Every-N batch summary** — `maybeSendBatchSummary(tenantId)`.
   Called after each flip attempt is finalized. Sends only when N
   attempts have accumulated since the last batch (mark stored in
   `flip_engine_config._batch_summary_last_sent_at`).
3. **Daily 24-hour summary** — `@Cron('0 0 * * * *')` ticks hourly,
   per-tenant local-hour gate, idempotent via
   `flip_engine_config._daily_report_last_sent_iso` mark.

## State marks live in `flip_engine_config` jsonb (not a new column)

To keep schema churn minimal, the batch-sent timestamp and
daily-sent timestamp live as underscore-prefixed keys inside the
existing `flip_engine_config` jsonb:

- `_batch_summary_last_sent_at`
- `_daily_report_last_sent_iso`

The trade-off: a tenant editing their config via the admin UI could
accidentally clear those marks. Acceptable for v1 — at worst it
re-sends a duplicate summary once. A future session can promote
these to dedicated columns if it becomes a real issue.

## Outcome bucketing is read at SQL + JS

`outboundCallLogs.flipOutcome` is a free-form varchar today. The
notifier and the activity controller both bucket via the regex
`/WIN|ACCEPTED/i` to determine win-vs-loss. Skipped (no flip
attempted) is detected via `flipEligible = false`.

When 49d's wiring fires for real, the orchestrator should write
`flipOutcome = 'WIN_OFFER_<n>'` on a successful offer accept, and
the offer-N-result columns should track each offer independently.
The bucket regex catches both the explicit "WIN" prefix and the
legacy "ACCEPTED" string (used by Session 9's offer-result columns).

## TwilioSmsService is the only outbound channel for v1

49d does not add an email channel. The existing
`Session 26 admin digest` already covers daily email digests for
operators; the flip notifier is text-first by spec.

## Manager phone list lives on `tenants.manager_phones` jsonb

Already populated by Session 24. The notifier reads it once per
send. No new schema. If the list is empty the stream is silently
skipped (logged, not errored).

## Activity controller is read-only

`/v1/admin/flip-engine/activity` is a GET-only feed. The activity
tab on the admin page lists rows; row drill-down (transcript +
audio playback) was already shipped in 49 (`/admin/outbound-voice`)
and 49d does not duplicate it.
