# Session 49d — Blockers

## Outcome wire-up depends on Thinkrr offer-acceptance signal

`notifyFlipWin` exists, but we need a signal that an offer was
accepted on the call. Today the only post-call signal we get from
Thinkrr is the call-completed webhook with status + transcript. To
detect "Offer 1 accepted" we either:

- Train the Thinkrr agent to emit a structured outcome field in the
  webhook payload (preferred).
- Or post-process the transcript on our side (NLP keyword match for
  "yes" / "switch it" near the offer-1 line).

Until one of those is wired, the notifier's WIN SMS is dormant. The
batch + daily summaries still work because they read from
`outboundCallLogs.flipOutcome`, which today is set to
`ENQUEUE_FAILED` only.

**Action:** Coordinate with G$D on adding an outcome JSON field to
Thinkrr's webhook payload, OR ship the transcript post-processor as
a follow-up session.

## fetchPendingFlipJobs still stubbed (carried over from 49c)

Until the JobPoller wiring follow-up lands, no flip attempts fire.
Once wired, the notifier streams will populate from real data.

## Daily report cron is hourly with per-tenant gate

The cron runs every hour and emits to tenants whose configured
local-hour matches the current hour. Hosts in different timezones
(operator timezone vs Railway server timezone) need to be tested
once we have multi-region tenants. For tenant-zero (Eastern time)
this is a non-issue.
