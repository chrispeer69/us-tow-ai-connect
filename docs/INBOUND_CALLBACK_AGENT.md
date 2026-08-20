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
| Version | v0, **published**, bound as `latest_published` |
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

## Known gap — she still cannot look anyone up

`GET /v1/ai-connect/lookup/by-phone` exists and would tell her who is calling
from the caller ID alone. It needs `X-Tenant-API-Key`, and tenant keys are
stored hashed (`tenant_api_keys.key_hash`) — there is no plaintext key to hand
Retell. Minting one via `pnpm --filter @ustow/api generate-api-key` and adding a
custom tool is the next increment, and it is what turns "I can't look that up"
into "I've got your Ford here, driver's on the way."

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
