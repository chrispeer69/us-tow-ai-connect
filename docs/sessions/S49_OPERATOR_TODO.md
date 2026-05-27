# Session 49 — Operator TODO

These steps require either the Thinkrr console, Railway dashboard, or
legal review and cannot be performed from the codebase.

## 1. Thinkrr — outbound agent provisioning

- [ ] Log into the Thinkrr admin console (https://ava.thinkrr.ai).
- [ ] Confirm the Agency Unlimited plan with outbound enabled and minute
      balance ≥ 100 (current balance is 2,470+, so this is likely
      already satisfied).
- [ ] Create or identify the outbound agent that will read scripts from
      the `script_body` payload. Note its `agent_id` for the per-tenant
      config entry below.
- [ ] Generate an outbound API key. Copy the value once — it can't be
      shown again.
- [ ] Configure a webhook destination pointing at
      `${PUBLIC_BASE_URL}/webhooks/thinkrr/outbound-result` with header
      `x-thinkrr-secret: <secret>` (see step 3).

## 2. Railway — env vars on the `@ustow/api` service

| Variable                                  | Value                                           |
|-------------------------------------------|-------------------------------------------------|
| `THINKRR_OUTBOUND_API_URL`                | Confirm with Cody — production base URL         |
| `THINKRR_API_KEY`                         | The outbound key from step 1                    |
| `THINKRR_OUTBOUND_FROM_NUMBER`            | `+18783563281` (or whatever the tenant uses)    |
| `THINKRR_WEBHOOK_SECRET`                  | A random 32+ byte string (`openssl rand -hex 32`) |
| `OUTBOUND_VOICE_DISPATCH_CRON_ENABLED`    | `true`                                          |

`PUBLIC_BASE_URL` is already required by the rest of the API; confirm it
matches the Railway production hostname before flipping the cron.

## 3. Tenant flip + first call

- [ ] In the admin dashboard, navigate to **Communications → Outbound
      Voice**, click the settings affordance, and set
      `outboundVoiceEnabled = true` for tenant zero.
- [ ] Optionally narrow `enabled_purposes` to a subset while testing.
- [ ] Optionally set `thinkrr_outbound_agent_id` in the config jsonb to
      point at the agent provisioned in step 1.
- [ ] Place a test call (the **+ Place call** CTA) targeting your
      personal cell. Confirm:
      - The row appears in the table with status `dialing` within 30 s.
      - The phone rings and Thinkrr reads the rendered script.
      - The webhook posts back; the row transitions to `completed`.

## 4. TCPA / legal review (before broad rollout)

- [ ] Have counsel review the soft-compliance choice documented in
      `docs/OUTBOUND_VOICE.md` (we record `consent_check_skipped` rather
      than blocking the dial).
- [ ] If counsel insists on hard-blocking, file a follow-up session to
      add the `consent_records` table and gate `dispatchOne` on it.
- [ ] Update `outbound_voice_config.require_consent` per tenant once the
      policy is in writing.

## 5. Optional — rate-limiting

- [ ] Decide on per-tenant outbound caps (e.g. ≤ 100 calls per hour) and
      consider adding a guard if abuse / cost control becomes a concern.
      Not implemented this session.
