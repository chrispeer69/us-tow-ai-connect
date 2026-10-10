# Outbound A/B: slim + Gemini 3.6 Flash vs legacy v61

Started 2026-10-10. Builds on `feat/slim-script-body` (SCRIPT_MODE / slim renderer).

## What runs where

| | slim_gemini arm | legacy arm |
|---|---|---|
| Retell agent | `Emily – slim-gemini` `agent_fdf19009fd7e5f33c46f503159` | live Emily `agent_c22b4105cef66b8a374fd54483` v61 |
| Model | gemini-3.6-flash | claude-5-sonnet |
| General prompt | `retell/core_prompt.md` | `scripts/emily-outbound-prompt.txt` (v61) |
| script_body | slim renderer | legacy renderer (always — SCRIPT_MODE cannot leak into this arm) |
| Knowledge base | `Emily slim KB` `knowledge_base_e0d70447f982ad42` (top_k 1, filter 0.6) | none |
| Handbook | off | v61 settings |
| Voice, webhook, post-call fields, call limits | identical to v61 | v61 |
| `script_version` stamp | `3.16-slim` | `3.16` |

The new agent's LLM is `llm_cb8efc7443ef676223bcbac4bb2c`. No phone number is bound to the new agent; calls reach it only through `override_agent_id` on create-phone-call.

## Switches (env on `@ustow/api`)

| Variable | Meaning |
|---|---|
| `AB_SLIM_GEMINI_PCT` | 0–100. Share of NEW jobs assigned to slim_gemini. Unset or 0 means off: exactly the pre-A/B behaviour, with no arm stamped. |
| `AB_SLIM_GEMINI_AGENT_ID` | `agent_fdf19009fd7e5f33c46f503159`. While unset, the arm is off. |
| `AB_SLIM_GEMINI_AGENT_VERSION` | The published version to pin, e.g. `0`. If unset, the call runs the agent's latest draft (the Retell client logs a warning). |
| `AB_ALERT_EMAILS` | Rollback alert recipients (comma-separated). Default `thechrispeer@gmail.com`. |

Leave `SCRIPT_MODE` unset during the A/B.

Arm assignment uses a salted FNV-1a hash of the job id. It is deterministic, so retries stay in their arm, and it is independent of the control/reframe split. Once a call is queued, its arm stays with it through retries, even after a rollback. A rollback stops only new assignments.

## Auto-rollback

A cron job runs every 30 minutes while `AB_SLIM_GEMINI_PCT` > 0. Once the slim arm has 50 connected calls (since the A/B started, 90-day window), it rolls back if either:
- slim $/min (Retell combined cost ÷ billed minutes) is above **$0.20**, or
- the slim offer-accepted rate is below **70% of legacy's** (accepted ÷ connected flip-eligible).

A rollback writes `platform_settings['ab_slim_gemini'] = { rolled_back: true, reason, … }`, which forces the effective share to 0 with no redeploy. It emails `AB_ALERT_EMAILS` once.

**To resume:** `delete from platform_settings where key = 'ab_slim_gemini';`

## Metrics (per day, per arm)

`/m/roadside` → "Outbound A/B" panel (CSV download). API: `GET /v1/admin/flip-engine/ab-slim-gemini?days=30`.

| Metric | Definition |
|---|---|
| connected | call longer than 30 s (excludes voicemail beeps) |
| offer made | `offer_1_result` DECLINED or ACCEPTED, ÷ connected flip-eligible |
| offer accepted | `flip_outcome` ACCEPTED (destination changed), ÷ connected flip-eligible |
| hard refusals | `flip_outcome` FAILED (every offer made was declined) |
| hangup before offer | connected eligible, no offer made, disconnection `user_hangup` |
| ETA violations | an agent turn states or confirms an arrival time (`agentStatedEta`) |
| $/min | Retell `combined_cost` ÷ billed minutes, summed over every dial attempt |
| LLM tokens | Retell `llm_token_usage.average` |
| latency p50/p95 | median across calls of Retell `latency.e2e` p50 / p95 (ms) |

Known limit: `offer_1_result` comes from Retell's post-call self-grade, which mislabels about 16% of offers as NOT_ATTEMPTED (2026-10-08 audit). This hits both arms, but the slim arm's grader also runs on the new agent.

## Data changes (migration 0063)

- `outbound_call_logs.ab_arm`
- `outbound_call_logs.outbound_call_id`: links each log row to its queued call, for every call from now on
- `retell_call_usage.latency_p50_ms` and `retell_call_usage.latency_p95_ms`
