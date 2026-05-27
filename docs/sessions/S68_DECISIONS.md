# Session 68 — Retell outbound voice client

**Status:** built, awaiting smoke + PR
**Branch:** `session-68-retell-outbound`
**Date:** 2026-05-27

## Decision

Replace Thinkrr's REST-wrapped outbound voice with **direct Retell API calls**. Thinkrr stays on inbound (works, untouched). GHL native Voice AI removed from the outbound plan entirely.

## Why

- The Thinkrr outbound API surface was never exposed by G$D. Thinkrr's $3-5K "native API" quote was for direct access to the **same Retell endpoint we now call ourselves for free**.
- GHL native Voice AI is workflow-driven and scheduler-shaped — wrong fit for dispatch status updates. Tested live, rejected.
- Retell is the engine underneath both Thinkrr and GHL. Going direct removes two middle layers.

## Architecture

```
[Flip Engine] → [Command Center] → [OutboundVoiceService]
                                          ↓
                          OutboundVoiceProvider (interface)
                          ├── RetellOutboundClient   ← default
                          └── ThinkrrOutboundClient  ← kept for legacy rows + rollback
                                          ↓
                                       Phone rings
```

Provider chosen at module init by `pickOutboundVoiceProvider`:
1. `OUTBOUND_VOICE_PROVIDER=retell|thinkrr` (explicit override)
2. `RETELL_API_KEY` set → retell
3. `THINKRR_API_KEY` set → thinkrr
4. fallback → retell (log-only)

## Files changed

**New:**
- `packages/api/src/modules/outbound-voice/outbound-voice-provider.interface.ts`
- `packages/api/src/modules/outbound-voice/outbound-voice-provider.factory.ts`
- `packages/api/src/modules/outbound-voice/retell-outbound.client.ts`
- `packages/api/src/modules/outbound-voice/retell-webhook.controller.ts`
- `packages/api/src/db/migrations/0028_retell_call_id.sql`

**Modified:**
- `packages/api/src/modules/outbound-voice/outbound-voice.service.ts`
- `packages/api/src/modules/outbound-voice/outbound-voice.module.ts`

**Untouched:**
- `thinkrr-outbound.client.ts` (kept verbatim)
- `outbound-voice.controller.ts`
- `outbound-voice-webhook.controller.ts`
- `script-templates.ts`

## Database

Migration `0028_retell_call_id.sql`:
- `ADD COLUMN retell_call_id text NULL`
- `ADD COLUMN provider text NOT NULL DEFAULT 'thinkrr'` (existing rows backfill to thinkrr)
- Indexes on both new columns

## Live credentials (tenant zero, owned by chris@bluecolla...)

```
RETELL_API_KEY=key_1b1d0c4ece24ac0238803b2b9af4
RETELL_AGENT_ID=agent_c22b4105cef66b8a374fd54483
RETELL_LLM_ID=llm_3579497925274062dfb3f61aae2e
RETELL_FROM_NUMBER=+18447011345
RETELL_WEBHOOK_SECRET=<configure in Retell dashboard, then set on Railway>
RETELL_API_BASE_URL=https://api.retellai.com   # optional, defaults to this
OUTBOUND_VOICE_PROVIDER=retell                 # optional explicit pin
```

Smoke-tested via PowerShell + dashboard "Make an outbound call" — phone rang, agent spoke dispatch prompt, dynamic variables rendered correctly (`customer_name`, `outbound_body`, etc.).

## Webhook

Retell posts to `POST /webhooks/retell/outbound-result`.

Signature: HMAC SHA-256 over JSON body, `X-Retell-Signature` header, key = `RETELL_WEBHOOK_SECRET`. Verification skipped if secret unset (dev/staging) with a warning.

Event mapping:
- `call_started` → `in_progress`
- `call_ended` + `disconnection_reason=user_hangup|agent_hangup|call_transfer` → `completed`
- `call_ended` + `disconnection_reason=voicemail|dial_no_answer` → `no_answer`
- `call_ended` + `disconnection_reason=dial_busy` → `busy`
- `call_ended` + `disconnection_reason=dial_failed|error` → `failed`
- `call_analyzed` → terminal status + outcome merge

## Rollback path

Set on Railway:
```
OUTBOUND_VOICE_PROVIDER=thinkrr
```
Restart `@ustow/api`. Cron picks Thinkrr immediately. No data migration, no code revert. New calls route through Thinkrr; in-flight Retell calls continue to receive webhooks at `/webhooks/retell/outbound-result` and resolve normally.

## Open follow-ups

- Real raw-body middleware on `/webhooks/retell/outbound-result` for byte-exact HMAC verification (current path JSON-rounds-trip — fine for HMAC over canonical JSON, but Retell may sign raw bytes).
- Drizzle schema regen for `retell_call_id` + `provider` columns so we can drop the raw-SQL fallback in `dispatchOne` / `requeueCall`. Currently using `db.execute(sql\`...\`)` to avoid a schema-regen PR dependency.
- Per-tenant agent IDs once we onboard customer #2 — `tenant.outbound_voice_config.retell_outbound_agent_id` already wired, just no UI for it yet.
- Tests: `retell-outbound.client.spec.ts`, `retell-webhook.controller.spec.ts`, expand `outbound-voice.service.spec.ts` provider-agnostic cases. Service signature changed (now takes `RetellOutboundClient` + `OUTBOUND_VOICE_PROVIDER` token) — existing tests need their test modules updated.

## Costs

- $2/mo phone number (already provisioned: `+18447011345`)
- ~$0.14/min per call (voice + LLM + telephony)
- Pay-as-you-go, no monthly minimums
- Kill switch: Retell dashboard → release the number

vs Thinkrr's pitched $3-5K + $97-297/mo + marked-up minutes.
