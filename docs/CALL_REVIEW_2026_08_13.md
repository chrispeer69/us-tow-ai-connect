# Outbound Flip Programme — Status, 13 August 2026

Prepared for Chris Peer, Alpha Automotive management, and Sidd.
All figures pulled from production `outbound_call_logs` on 2026-08-13.

---

## 1. Executive summary

**Yesterday was the best day the programme has had.** 12 August: 83 calls, 25
flip-eligible, **7 wins** — 28% of eligible, 8.4% of all calls, and 41% of calls
where an offer was actually made. For context, the whole of July produced 38 wins
across 1,485 calls (2.6%), and the `competitor_repair` destination type — which
produced all 7 of yesterday's wins — had gone **0-for-878** across June and July.
The zero-win defect on that segment is fixed.

**Today has produced no wins, and that is mostly ordinary variance — but it is
masking a real problem.** As of 11:35 ET we have made only **5 offers** against
17 yesterday. Four were declined, one call never connected. Five offers at our
observed ~35% acceptance rate produces zero wins roughly one time in eight. The
decline rate is not the story.

**The story is that the top of the funnel has halved.** Among competitor-repair
calls that had a partner shop on file, the share we treat as eligible has fallen
from a 10-day average of ~57% to 42% yesterday to **28% today**. We are not
losing the pitch; we are not reaching it.

**Two decisions are waiting on management** (section 5). Both are policy, not
engineering, and both are currently costing wins.

---

## 2. Where the wins come from

| Date | Calls | Eligible | Offers made | Wins | Win rate (of offers) |
|---|---:|---:|---:|---:|---:|
| Aug 3 | 49 | 22 | 19 | 1 | 5% |
| Aug 4 | 73 | 36 | 29 | 4 | 14% |
| Aug 5 | 82 | 27 | 26 | 2 | 8% |
| Aug 6 | 72 | 23 | 16 | 1 | 6% |
| Aug 7 | 68 | 25 | 21 | 2 | 10% |
| Aug 8 | 37 | 12 | 9 | 1 | 11% |
| Aug 10 | 64 | 27 | 24 | 0 | 0% |
| Aug 11 | 96 | 32 | 27 | 2 | 7% |
| **Aug 12** | **83** | **19** | **17** | **7** | **41%** |
| Aug 13 (to 11:35) | 43 | 7 | 5 | 0 | 0% |

Yesterday's jump is real and the mechanism is understood: script 2.0→2.2 fixed
defects that were killing calls before the offer landed — spoken `{{destination}}`
placeholders, a full tire set being read as "a flat tire", and offers built on
shops that did not exist. Those were broken things that got unbroken.

**Caution on the "28% of eligible" figure.** The eligible denominator changed
meaning on 12 August when collision and glass work stopped counting. Win rates
measured against *eligible* are not comparable across that date. Wins per call
and wins per offer made are, and those are the two columns to watch.

---

## 3. The eligibility collapse — the thing to look at

Restricted to `competitor_repair` destinations that had a partner shop available,
so this is like-for-like:

| Date | Competitor-repair calls | Treated as eligible | % |
|---|---:|---:|---:|
| Aug 3–11 (avg) | ~44/day | ~26/day | **~57%** |
| Aug 12 | 45 | 19 | 42% |
| Aug 13 | 25 | 7 | **28%** |

The drop tracks the eligibility rules tightened on 12 August. The effect is that
offer volume fell from 19–29/day to 5 so far today. Even at yesterday's excellent
41% conversion, five offers cannot produce yesterday's seven wins.

The largest single contributor is rule 18 in the agent prompt, which excludes
"only needs a single flat tire changed" from any repair-shop offer. The 11 August
review flagged that same exclusion as a **defect**, noting that one of that day's
two wins was a tire blowout. We are currently excluding a category that has
demonstrably produced wins. See section 5.

---

## 4. Calls where we presented nothing at all

Chris's directive: *every call must present some offer, even if only a soft
mention of the app.* Measured over the last 14 days, a call "presented something"
if it either made a flip offer or sent the app link.

**323 of 848 calls (38%) presented nothing.** Roughly 23 per day.

But the population splits into two very different halves:

| Bucket | Calls | Addressable? |
|---|---:|---|
| Never dialled / no duration | 18 | No — dialling problem |
| Under 15s (no contact) | 58 | No — voicemail, no answer |
| 15–45s (phone tree / early hangup) | 160 | **Partly** — see below |
| 45s+ (a real conversation) | **87** | **Yes — this is the target** |

**The honest read: you cannot make an offer to a phone tree.** 236 of the 323
never reached a human. The rule worth adopting is *every **connected** call
presents an offer* — and separately, fix why we are dialling businesses.

**The 160-call middle bucket is the biggest single loss** and it is not a script
problem. We are repeatedly dialling businesses instead of customers. Today alone:
Proto Towing Service's IVR, Advance Auto Parts twice, the Mercedes Easton parts
counter, and the Germain Lexus parts centre. The agent then tries to navigate the
menu by *speaking* the digit ("One, please") instead of sending a touch tone,
which cannot work, and the line drops. Two fixes, both engineering:

1. Send real DTMF tones, and fall back to voicemail after two failed attempts.
2. Investigate why the dialled number is sometimes the destination business
   rather than the customer. Several of these destinations are parts stores,
   which suggests a data problem upstream in job ingestion.

**The 87 real conversations that presented nothing** are the addressable target —
about 6 a day. Reasons recorded: 186 calls had a competitor-repair destination
with **no recorded reason at all** for not offering, which is itself an
instrumentation gap now partly closed (section 6).

One further data note: `issue_type` is `'unknown'` on **all 323** of these calls,
consistent with the July finding that it is unset on 99.6% of calls. The script's
personalisation and issue-specific handling cannot fire without it. This has been
outstanding since July and should be scheduled.

---

## 5. Two decisions for management

**Decision 1 — do single flat tires get an offer?**
Rule 18 currently excludes them. The 11 August review called that exclusion a
defect and cited a tire blowout as one of that day's two wins. This exclusion is
a material part of the eligibility drop in section 3. *Recommendation: allow the
offer on tire jobs that require a shop (blowout, full set, no spare, damaged
rim), keep excluding a simple plug-or-swap at roadside.*

**Decision 2 — are the two body shops meant to be switched off?**
`Excite Collision Repair` and `T&C Body Shop` are both marked inactive in the
shop table while appearing as live locations on the Alpha website. If that was
the intended implementation of the 12 August collision/glass change, no action is
needed. If not, body-shop routing is silently off.

**Also needs an answer:** `Johns Auto Repair` (2088 Mock Rd) and `Wrench Recovery`
(3588 Westerville Rd) are active in the shop table and are being pitched to
customers, but neither appears in the Alpha location list. Partner shops, or
stale rows?

---

## 6. What shipped today

**Script 2.3 (server-side, deployed via Railway)**

- **Authorised answers for two objections the agent had been improvising.** Both
  confirmed as real policy: Roadside Towing absorbs an onward tow to the original
  destination if the repair does not go ahead, and the office will check an
  aftermarket policy with the customer's insurer. The agent had reached for both
  on a live call and invented the wording — the content was broadly right, the
  authorisation was not. Guardrails: no timeframe promised on the onward tow,
  insurance provider name only (never a policy number), never state whether a
  specific policy covers anything, and never mention who pays us or why a repair
  was declined.
- **The close now names both legs of the trip.** "Your driver is headed to
  {{destination}}" read as the truck's next stop; seven sampled customers heard it
  as the truck skipping them, costing 30–90 seconds of rework each.
- **Eligibility logging fixed** in the legacy dialer path, which had been
  recording calls as eligible with no partner shop attached — inflating both the
  "eligible" and "never pitched" counts in this report's predecessors.

**Retell agent v32 (published and live)** — six new rules, each one a behaviour
observed on a real call:

| Rule | Fixes |
|---|---|
| 21 | Agent speaking its own planning aloud, including opening with the literal word "AI:" |
| 22 | Agent inventing exclusions — refusing to pitch dealerships and tire shops on its own initiative |
| 23 | Agent closing out after a bare "no" instead of continuing the ladder (offer 2 was skipped on 9 of 11 declines) |
| 24 | Agent re-pitching a caller who said three times she could not understand English — a consent risk |
| 25 | Agent closing the call while the customer was still mid-answer |
| 26 | Agent ignoring "I'm on the freeway right now" and repeating its question |

Rollback for any of this is a single environment variable: repoint
`RETELL_AGENT_VERSION` to `31`. Each version holds its own prompt.

**Infrastructure** — Retell agent, pinned version and caller ID moved from
deployment-wide environment variables to per-tenant configuration. Previously a
script change could not be shipped to one company without moving every company at
once; with new tenants approaching, that would have made onboarding a
production-risk event.

**Data** — Wayne's Auto Repair Westerville had the Columbus phone number on file;
corrected to (614) 891-6368.

---

## 7. Still open

- **Shop address in the offer line.** Customers asked where the shop actually is
  and the agent had only a mileage figure; in one call it admitted it had no
  address. The addresses are already in the database — they are simply not passed
  to the script. Held back deliberately so it ships as its own version and its
  effect on win rate can be measured separately.
- **DTMF and the dialling investigation** (section 4) — the largest single loss.
- **`issue_type` unset on ~all calls** — outstanding since July.
- **Spanish-language handling.** Technically straightforward: Retell supports 55
  languages and language can be set per call. The constraint is not technical —
  the offer ladder ends in a recorded consent, so a machine-translated pitch is a
  compliance surface. Recommended sequence: confirmation flow in Spanish first,
  offer ladder only after a native speaker reviews it. Volume should be measured
  before building.

---

*Generated with Claude Code. Figures verified against production at time of
writing; the daily review at 06:15 ET regenerates the underlying analysis each
morning.*
