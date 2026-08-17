# Redialling a call that died mid-pitch

> Chris, 2026-08-17: *"If a call dies with a sales logic pitch I want the agent to
> immediately call the customer back again — we must complete the call — no less
> than 3 attempts."*

## Why it did nothing before

`OutboundVoiceService` has always had retry machinery — `attempts`,
`max_attempts` (default 3), a `retryFailed` cron — but it only fired on
`['failed', 'no_answer', 'busy', 'rejected']`: calls that **never connected**.

A call that connects, runs nineteen seconds and dies mid-intake reports
`disconnection_reason: user_hangup`, which maps to `completed`. It was never
retried. On the morning of 2026-08-17, 6 of the first 12 calls ended under 35
seconds and **one** of ten flip-eligible jobs ever heard an offer. None of those
were failed dials. They were abandoned conversations, and they were invisible.

## The hard part is not retrying — it is not retrying too much

Three calls that morning were tagged `agent_judged_flip_not_appropriate` after a
full ~200-second intake, and in each case **the agent was right and the club
ticket was wrong**:

- ticket said *Steagalls Mobile Auto Service*; customer said *"Yes, her
  residence"* — the car was going home
- ticket said *AutoZone Auto Parts*; customer said *"storage facility"*, after
  *"Got into a car accident"*

Redialling those customers three times to pitch a repair shop they have no use
for is worse than losing the flip. So the verdict turns on **whether the
conversation reached a resolution**, never on whether we got what we wanted.

## The four verdicts

`judgePitchCompletion` in `pitch-completion.ts`, checked in this order. Only
`ABANDONED` redials.

| Verdict | When | Redial? |
|---|---|---|
| `BLOCKED` | The **customer** asked us to stop calling | Never, at any attempt count |
| `NOT_APPLICABLE` | Our pre-call gate said the job was never flip-eligible (auto body, our own shop, no partner in range) | No — there was no pitch to finish |
| `RESOLVED` | Flip accepted; **or** an offer was ACCEPTED/DECLINED; **or** the agent reached its closing block; **or** the agent judged the flip inapplicable *after a full intake* | No |
| `ABANDONED` | Anything else on a flip-eligible job | Yes, while `attempts < max(max_attempts, 3)` |

Three details that carry most of the safety:

- **Opt-out is matched against the customer's turns only.** A regex over the raw
  transcript would eventually match the agent's own script and silently mute
  redials for everyone. `extractUserSpeech` splits speakers first.
- **A DECLINE is a resolution.** We do not re-pitch someone who said no; that is
  harassment dressed as persistence.
- **`agent_judged_flip_not_appropriate` is ambiguous and is disambiguated by
  duration.** Past `OUTBOUND_RETRY_INTAKE_COMPLETE_SECONDS` (default 150s) it
  means *the agent decided*; below it, it means *the call died*. The floor sits
  above the 111-second mark under which no win has ever occurred.

## Missing webhooks — reconciliation

While building this, 12 of 32 calls on 2026-08-17 were found stuck in
`in_progress` with **no duration, no transcript and no analysis**, `updated_at`
unchanged since `call_started`. Retell's `call_ended` / `call_analyzed` webhooks
never landed for **37% of the day's calls**, so those calls were absent from the
win count, absent from the daily review, and unjudgeable.

Every one of those rows already held a `retell_call_id`, so
`reconcileStalledCalls` now asks: `GET /v2/get-call/{id}`, then feeds the snapshot
back through `handleProviderWebhookEvent` — the same path a webhook takes, so
pull and push cannot drift (the shared mapping lives in `retell-call-mapping.ts`).
This runs **before** the redial sweep, so judgement happens on real data rather
than on nulls.

## Two crons, and why the split matters

- `reconcileStalledCallsCron` (every 3 min) — pull the truth for stalled rows.
- `retryAbandonedPitchesCron` (every 2 min) — the safety net for calls the
  webhook path could not judge.

The sweep will only touch a `completed` row after
`OUTBOUND_ABANDONED_PITCH_SWEEP_MIN_AGE_SECONDS`, or a `dialing` / `in_progress`
row after `OUTBOUND_ABANDONED_PITCH_STUCK_MINUTES` (30). Without that split, a
call redialled two minutes ago and **currently ringing** looks exactly like a
stale one, and the sweep dials the customer a second time while the first call is
still live.

## Configuration

| Env var | Default | Notes |
|---|---|---|
| `OUTBOUND_ABANDONED_PITCH_RETRY` | `true` | Master switch. |
| `OUTBOUND_ABANDONED_PITCH_MIN_ATTEMPTS` | `3` | A **floor** over the row's own `max_attempts`, so an old row enqueued with 1 still gets its three tries. |
| `OUTBOUND_ABANDONED_PITCH_DELAY_SECONDS` | `60` | Chris asked for "immediately"; see below. |
| `OUTBOUND_RETRY_INTAKE_COMPLETE_SECONDS` | `150` | The judged-vs-died threshold. |
| `OUTBOUND_ABANDONED_PITCH_LOG_WINDOW_HOURS` | `6` | How far from a call's own timestamp we look for its flip log row. |
| `OUTBOUND_ABANDONED_PITCH_STUCK_MINUTES` | `30` | When in-flight becomes stuck. |
| `OUTBOUND_RECONCILE_MIN_AGE_SECONDS` | `300` | Before asking Retell what happened. |

**On "immediately".** The delay defaults to 60 seconds rather than 0, which is a
deliberate departure from the request: dialling a customer back within a second
or two of them hanging up reads as a malfunction to the person on the other end,
and Retell needs a moment to finalise the record we just judged. Sixty seconds is
still "right away" to someone standing next to a broken car. Set
`OUTBOUND_ABANDONED_PITCH_DELAY_SECONDS=0` for literal immediacy — it will then
fire on the next 30-second dispatch tick.

## A defect fixed on the way past

`retryFailed` re-queued rows without resetting `created_at`, but `dispatchQueued`
only considers rows created in the last 15 minutes. Re-queued rows were dropped
back into a window they had already fallen out of: the status flipped to `queued`
and they were **never dialled**. The webhook retry path had always reset
`created_at`; this one did not.

## Expected volume

Replayed over the 32 real calls of 2026-08-17, the judge redials **20** of them
(and correctly leaves alone both accepted-offer calls, both declines, the two
long correct suppressions, and every non-eligible job). That is a material
increase in dial volume — roughly two extra attempts on two thirds of calls.
`OUTBOUND_ABANDONED_PITCH_MIN_ATTEMPTS=2` is the lever if that proves too much.
