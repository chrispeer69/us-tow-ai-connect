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
