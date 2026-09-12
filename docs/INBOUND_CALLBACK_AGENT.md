# Inbound callback agent — +1 844-701-1345

Created 2026-08-20. Fixes a live break: the number Emily calls FROM was
answering inbound calls with the OUTBOUND flip agent.

## What was wrong

`+1 844-701-1345` is `RETELL_FROM_NUMBER` — the caller ID on every outbound
flip call. Its `inbound_agents` binding pointed at
`agent_c22b4105cef66b8a374fd54483`, the outbound flip agent, whose entire prompt
ends `YOUR SCRIPT: {{script_body}}` and whose 36 rules are about obeying that
script faithfully.

On an outbound call the API renders `script_body` from the job. **On an inbound
call nothing populates it.** Emily improvised a greeting and then reached a
script that was not there.

Measured on 2026-08-19:

| | |
|---|---|
| Inbound calls/day | ~22 |
| Inbound calls in 5 weeks | ~500 |
| Callers who were people we had called | 93 of the last 100 |
| Ended `max_duration_reached` | 94 of 500 |

Real transcript from that day:

> **User:** I had just missed a call from you guys and I was just calling back.
> **Agent:** I'm sorry about that. Can I get your name, please?
> … *asks three times, then asks for the phone number and vehicle location —
> all of which we already have* … **310 seconds, agent hangs up.**

The binding also had no `agent_version`, so inbound ran whatever the newest
version was — an **unpublished draft** (v53 on 08-19), while outbound was pinned
to v52. Historically it drifted across v27, v28, v41, v51, v53.

## What now answers

| | |
|---|---|
| Agent | `agent_d070aed59fd269162e2268a386` — "Emily INBOUND \| Roadside Towing callbacks" |
| LLM | `llm_5de3f737a66db98138167cc13e7b` |
| Version | **v1**, published, bound as `latest_published` |
| Voice | `11labs-Emily` — same voice as outbound, so it is the same person to the caller |
| Transfer | `transfer_to_dispatch` → `+1 380-333-6411` (the active `routing_rules` entry) |
| Max duration | 600s |

Outbound binding on this number is **unchanged** and still points at the flip
agent. Only inbound moved.

Prompt is checked in at
`docs/backups/2026-08-20-retell-INBOUND-agent-v0-general-prompt.txt`.

### The rules that matter

- Opens "Thanks for calling…", never "this is Emily *calling* from".
- Assumes most callers are returning our missed call.
- **Asks for a name or number ONCE.** Second miss → transfer. There is no third
  ask; that was the worst behaviour on the old line.
- States plainly that she cannot look the job up, and never invents an address,
  driver, ETA, price, or status.
- Transfers on: status, ETA, price, complaint, insurance, an upset or unsafe
  caller, or any question asked twice without an answer.
- **No sales of any kind on this line** — no repair-shop switch, no estimate
  review, no app pitch. They called us.
- Safe lane applies: no insurance discussion at all.

## She can look the caller up (v1)

Chris, 2026-08-20: *"have her ask for their phone # and look it up in Towbook by
phone # — that's what a competitor does."* Asking beats caller ID, which misses
constantly: people call back from a spouse's phone, the tow truck, a borrowed
phone.

Tool `lookup_job_by_phone` → `GET /v1/ai-connect/lookup/by-phone?phone=…`,
authenticated with `X-Tenant-API-Key`. Verified live in production; the endpoint
strips non-digits and matches last-10, so `6148818702`, `(614) 881-8702` and
`16148818702` all resolve to the same job. Returns customer name, vehicle,
status, driver name, ETA, pickup and destination.

### The key: issued, NOT rotated

`src/bin/generate-api-key.ts` **overwrites** `tenants.api_key_hash` — it rotates
rather than adds. Running it would have silently killed the Thinkrr intake
agent's API access at +1 380-333-6411.

The key for this agent was issued into the additive `tenant_api_keys` table
instead, named `retell-inbound-agent`, prefix `usk_fDvU0Ysv`. It is
independently revocable and touches nothing existing:

```sql
UPDATE tenant_api_keys SET revoked_at = now() WHERE name = 'retell-inbound-agent';
```

The plaintext key lives only in the Retell tool config. It is deliberately not
in this repo.

### Separate finding, not caused by this work

Tenant zero's `tenants.api_key_prefix` is `usk_boot` — 8 characters — but
`TenantApiKeyGuard` matches on a 12-character slice. No presented key can equal
it, so the direct lookup in `findByApiKeyPrefix` always misses and anything
still holding that original key gets 401. Worth checking whether Thinkrr is
affected.

## The ETA rule — the most important thing in the prompt

Real job data from 2026-08-20:

```json
{ "customerName": "Bernadine Clegg",
  "vehicle": "2018 Chevrolet Trax Black",
  "status": "Dispatched to Jesse Shortridge as of 2:48 AM",
  "eta": "12:55 AM (5 hrs 54 mins late)" }
```

Read verbatim, that tells somebody who has been waiting all night that they are
five hours and fifty-four minutes late. The prompt forbids saying any time from
the `eta` field, and forbids the word "late" entirely.

Chris's policy, 2026-08-20 — *"never give real ETA, real does not exist"*:

> "Your driver will call you directly when he's on his way. He's finishing up
> the job he's on now and then he's headed to you — you're looking at somewhere
> around thirty minutes."

That is the answer to "when will he be here", every time. When the data shows a
long wait, she acknowledges it in her own words FIRST and does not skip into the
thirty-minute line as though nothing happened. If the caller is angry or says
thirty minutes is not good enough, she stops and transfers rather than repeating
herself.

## Rollback

```bash
curl -X PATCH -H "Authorization: Bearer $RETELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"inbound_agents":[{"agent_id":"agent_c22b4105cef66b8a374fd54483","weight":1}]}' \
  https://api.retellai.com/update-phone-number/+18447011345
```

That restores the previous (broken) behaviour, so prefer fixing forward.

## Still staged behind this

`flip-scripts.ts` scenario B holds an approved decline line that was held back
because it points customers at this number:

> "And if anything changes — today or next week — give us a call. We own body
> shops here in town and we'd be glad to help."

Now that the number answers properly, that line can ship.

## 2026-09-11 — the 09-10 review, actioned (agent v18, published 06:53 ET; v17 is the rollback: PATCH the 844 inbound binding to agent_version 17)

The first daily inbound review (44 calls on 2026-09-10) was checked finding by
finding against the Retell transcripts and the production data. What shipped:

| Review finding | What was actually wrong | Fix |
|---|---|---|
| Emily apologises for "huge delays" on jobs minutes old | **Our bug, not Towbook's.** The board's "(3 hrs 5 mins late)" is computed by Towbook's page script from the *browser's* clock and timezone; the Railway scraper ran Chromium in UTC, so every ETA read four hours later than it was. Proven 2026-09-11: the same row read "7:30 AM (3 hrs 9 mins late)" in a UTC context and not late at all in an Eastern one. It also fed `unified_jobs.eta_minutes` (−185 on a job dispatched six minutes earlier). | `towbook.adapter.ts` — every `newContext` now sets `timezoneId: America/New_York` (`TOWBOOK_BROWSER_TIMEZONE` overrides). Prompt now judges "a long wait" from the status timestamp vs `{{current_time}}`, not the eta field. |
| Pre-lookup filler split in half around the result ("Let / me pull that up for you now.Got it —") | The lookup answers in ~200 ms, faster than she can say the filler; `speak_during_execution: true` on a sub-second tool. Every single lookup on 09-10 shows it. | `lookup_job_by_phone` is now silent during execution. Prompt: say nothing until the result is back. |
| 0 of 13 found jobs matched by caller ID | Not a bug in the caller-ID fallback — she always asked for the number first, so "given" always won. | Prompt: on ONE, and silently on TWO after safety, call the lookup with **no arguments** first (server matches on the number they are calling from). Only ask for a number if that misses. |
| Completed tow reported as "not found" | The live cache is active jobs only. | `AiConnectService.findRecentlyClosedJob` — same matchers over the last 24 h of `unified_jobs` rows (`completed` / `canceled`), returned with `job_state` and `closed_at`. Prompt handles both states. Never shadows a live job; no eta-check row recorded. |
| Zero tows booked from four "new tow" callers | The up-front "what's your number, let me check the board" + "just to confirm you want a brand new tow?" pair lost the one caller who stayed. | The board check stays (Chris's 08-24 rule: 98 % motor-club work) but is now silent and caller-ID based; the confirmation question is gone; the callback number is asked second ("in case we get cut off") and checked silently again then. |
| Motor club asked for an operator three times | No first-ask rule; "operator" fell into the "who were you hoping to reach" message flow. | New top-level ASKING FOR A PERSON section: transfer on the first request, no qualifying, even mid-greeting. |
| Finishing the greeting over the caller | A "yeah" during the greeting was treated as a backchannel, not a turn; the greeting is 29 words. | Greeting cut to 21 words; `interruption_sensitivity` 0.9 → 1; prompt: a greeting talked over is over, never restart it. |
| "Whenever you're ready…" re-prompts while callers looked for a number | Retell reminder default (10 s). | `reminder_trigger_ms` 20000, `reminder_max_count` 1. |
| Two questions in one breath on motor-club calls | "Which club, and do you have a PO…" | THREE asks one thing: the PO / reference number. The club name is not needed to find the job. |
| Yard/release caller got three clarifying rounds then was hung up on | No rule for callers outside the three lanes; end_call on silence. | NONE OF THE THREE section (one clarifying question, then transfer or message); hard rule: never end the call on silence or noise, transfer instead. |
| "Are you just testing the system?" | — | Hard rule against it. |
| Stray leading digit in the lookup argument | Phone already matched on last-10; job numbers did not. | Job-number match tolerates a leading stray digit (suffix match on the full board number). |
| PO numbers sent in the phone field | Already fixed by v17 at 14:44 ET on 09-10 (tool gained `po_number` / `job_number`). Confirmed on the 26 post-v17 calls. | Nothing further. |

Not actioned: "Book the tow first; stop the board check on new-tow calls" was
taken as "stop making them *notice* the board check" — see the silent version
above — because the underlying rule (most "new tow" callers already have one)
is Chris's and the data supports it.

Publish: `node scripts/emily-inbound-publish.js --apply` after the API deploy
(the closed-job `job_state` field and the timezone fix live server-side). The
daily review now reports "already closed" matches and counts an argument-less
lookup as a `caller_id` key.

## 2026-09-12 — create_tow_job had never worked (silent-integration incident 7). API commit `0a1fa2a` deployed 13:58 ET; Retell inbound agent **v19** published 14:02 ET (v18 = rollback); draft v20 is a copy, ignore.

Chris, reading the 09-11 daily review (85 calls, 47 transferred, 1 new tow
attempted, 0 booked): "Emily is first and foremost a dispatcher — her first
job is to identify new tow requests and get them set up."

**Finding.** Every `create_tow_job` call since the tool was built on 08-23 —
four of four (08-23 Chris's own test, 08-24, 09-11 19:47, 09-12 07:16) —
returned HTTP 400 `Validation Failed` with `Required` on `customer`,
`vehicle`, `serviceType` and `pickup`. All four fields were in the call.
Cause: Retell wraps every custom-tool POST as `{ call, name, args }`; the
tool pointed straight at `api.ustowdispatch.com/v1/jobs/phone-intake`, which
reads the flat body. Same bug that broke `lookup_job_by_phone` and
`take_dispatch_message` (fixed 08-25 with `UnwrapRetellArgsPipe`); this tool
was never moved behind that pipe because it did not go through our API. The
08-23 "verified end to end" note was a hand-posted flat body, not a Retell
call.

**Fix (this commit).**
- `POST /v1/ai-connect/create-tow-job` — unwraps, forwards to USTD with the
  server-side `USTD_API_KEY` (the key is no longer in the Retell tool
  config), fills `callReference` from the call context when the LLM omits
  it, sends `Idempotency-Key`, strips Retell's `execution_message`. Always
  answers 200 with `status: 'success' | 'error'` so Emily can act on it;
  a USTD rejection is logged with the decoded field errors
  (`describeUstdErrors` resolves USTD's flattened error envelope).
- On success: stamps `inbound_call_logs.ustd_job_number` (upsert of a stub
  row the call_ended webhook later fills in) and pushes "New tow booked by
  Emily — #N" to tenant admins (same channel as urgent dispatch messages).
  This is the office notification that did not exist before.
- Tool config: URL → our API, `X-Tenant-API-Key`, timeout 20 s, description
  says `status: 'error'` means NOT booked.
- Prompt: closing block treats `status "error"` as a failure; roll/steer/
  brake and keys are two separate questions; drivetrain is the one short
  question, not a list (both stacked on the 09-11 intake).
- Tests: `create-tow-job.spec.ts` replays the exact 09-11 payload and 400
  body.

**Verify after deploy:** POST a Retell-shaped body with `serviceType:
'zzz'` to the new route with the Roadside tenant key — the answer must be a
single `serviceType` enum error, not four `Required`s. Then the first live
`create_tow_job` result with `status: success` and a job on the USTD board.

**Transfers (47 of 78 on 09-11), where they actually came from:**
- ~13 motor-club reps: availability / "can you take this" with no PO
  (Honk, Allstate Secondary, TraxNOW) — policy says transfer; Chris to
  decide whether Emily should take these as a structured message.
- ~12 asked for a person by name of role ("dispatch", "agent",
  "representative", "customer service") — v18's transfer-on-first-ask rule
  from the 09-10 review, working as designed.
- ~10 repeat callers on the same job (PO 114136078 ×3, 614-378-0387 ×4,
  740-817-2235 ×3, 614-202-5059 ×5) who had already heard the thirty-minute
  line — prompt gap: no "you've already been told that" escalation.
- 4 new-tow callers: 1 unsafe (correct), 1 the failed booking, 2 follow-ups
  from the same stranded caller after the failed booking.
- 3 completed/cancelled jobs the caller disputed; 3 unintelligible; rest
  correct per WHEN TO TRANSFER (money, insurance, complaint).

## 2026-09-12 (afternoon) — repeat callers auto-forward; motor-club availability stays a transfer. API commit `82e0f7e` deployed 15:42 ET; Retell inbound agent **v20** published 15:47 ET (v19 = rollback; draft v21 is a copy).

Chris, on the 47-transfer breakdown: "MC availability — we would need to
build out a knowledge pack to answer those calls — for now, transfer. Add
repeat caller escalation — those should auto forward to dispatch."

- **Motor-club availability** ("can you take this one", no PO): unchanged,
  transfer. The prompt's THREE section now says so explicitly so Emily does
  not try to answer or take it as a message. Answering these needs a
  knowledge pack (service area, rates policy, capacity) that does not exist
  yet.
- **Repeat callers**: the lookup now returns `repeat_call: true` when an
  open `eta_check_calls` row for that (job, phone) shows an earlier call
  more than 10 minutes ago — i.e. a previous conversation, not Emily's own
  second lookup in this one. Read BEFORE this call is recorded. Also
  `prior_calls_about_this_job`. The prompt (new REPEAT CALLER section,
  applied to ONE and THREE, and listed under WHEN TO TRANSFER) skips the
  thirty-minute line entirely for a repeat — by flag or by what the caller
  says — acknowledges it once and transfers. 09-11 had ~10 of these (PO
  114136078 ×3, 614-378-0387 ×4, 740-817-2235 ×3).
