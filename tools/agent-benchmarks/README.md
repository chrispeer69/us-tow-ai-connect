# Agent benchmarks

Our own test bench for the Retell voice agents. Public model benchmarks don't measure
our call logic (never read the ETA field, silent board check before booking, at most two
offers, no invented shops), so every prompt or model change is scored against it before
it ships, and outbound changes are then proven on win rate with a live A/B
(`retell_agent_version_b` / `retell_ab_percent_b` on the tenant).

## Inbound (`inbound_matrix.js`)
21 scenarios (status calls, live-job ETA, safety transfer, gates, full intakes day and
overnight, motor clubs, claims, messages, payment/membership). Each config is built as a
throwaway Retell chat agent with the write tools (`create_tow_job`,
`take_dispatch_message`) pointed at a mock, so nothing real is booked; lookups are real
and read-only. Every transcript is graded by fixed pass/fail checks.

    RETELL_API_KEY=... CONC=3 node inbound_matrix.js configs.json <runs> "" <tag>

configs.json: `[{ "name", "prompt": "orig"|<file>, "model", "kb"?, "top_k"?, "filter"?, "fixTransfer"? }]`

Keep CONC at 3 or less: lookups share the tenant API key's 120/min limit with live calls.
Tests 4/5/7/13 look up real jobs by phone/PO; refresh those numbers when the jobs age out.

## Outbound (`outbound_bench.js`)
Real recent call scripts (scenario A offer / B body-glass / C residence), a simulated
customer (Claude Haiku) in five personas, and an independent judge (Claude Sonnet) that
scores each call against the script's own rules.

    RETELL_API_KEY=... ANTHROPIC_API_KEY=... node outbound_bench.js "gpt-4.1-mini,claude-5-sonnet" <runs> <tag>

`model@v59` tests that model with the prompt saved from LLM version 59 (`ob_v59.txt`).

## Known chat-mode artifacts
A chat starts with empty history, unlike a call where the greeting is already spoken; both
harnesses tell the model the call has started. 0 of 680 real outbound calls showed the
"AI:" prefix or "Placeholder" seen in chat mode.

## Results (2026-10-01)
See the cost-engineering report. Inbound: v27 prompt + GPT-4.1 passed 18/21 every run
(live v24 config: 15/21). Outbound: GPT-4.1 mini 32/36 clean, 0 critical, offer handled
correctly 36/36, at ~$0.17/min vs ~$0.39 on Claude 5 Sonnet.
