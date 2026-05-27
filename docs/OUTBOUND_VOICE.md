# Outbound Voice Orchestrator (Session 49)

## Overview

US Tow AI-Connect places outbound voice calls through the Thinkrr outbound
agent. Five canonical purposes are wired today, each backed by a script
template stored in code: customer status updates, ETA confirmation, post-job
follow-ups, driver escalation, and motor-club status updates. A sixth purpose
(`custom`) is reserved for tenants who need a free-form body without standing
up a new template.

The module owns the full call lifecycle:

1. **Enqueue.** A controller route, a public service method, or a lifecycle
   hook from another module inserts a row in `outbound_calls` with status
   `queued`.
2. **Dispatch.** A 30-second cron picks the oldest queued + due rows for
   tenants where `outbound_voice_enabled = true`, renders the template, and
   POSTs to Thinkrr. On success the row transitions to `dialing`; on failure
   it either stays `queued` (under max attempts) or transitions to `failed`.
3. **Webhook.** Thinkrr POSTs progress events to
   `/webhooks/thinkrr/outbound-result`. The handler is idempotent on
   `thinkrr_call_id` and maps Thinkrr's status vocabulary to our canonical
   statuses (`dialing` → `in_progress` → `completed` / `no_answer` / `busy` /
   `rejected` / `failed`).
4. **Retry.** A 5-minute cron re-queues rows that failed transiently
   (Thinkrr unavailable) and still have attempts remaining. Permanent
   failures (template render errors, bad data) terminate immediately.

## Architecture

```
modules/outbound-voice/
├── outbound-voice.module.ts                # @Global, mirrors OutboundSmsModule
├── outbound-voice.service.ts               # enqueue, dispatch cron, webhook handler, lifecycle hooks
├── outbound-voice.controller.ts            # /v1/admin/outbound-voice/* (AdminAuthGuard)
├── outbound-voice-webhook.controller.ts    # /webhooks/thinkrr/outbound-result (signature-verified)
├── thinkrr-outbound.client.ts              # HTTP wrapper, returns null when unconfigured, never throws
├── script-templates.ts                     # 6 templates + renderTemplate()
└── *.spec.ts                               # vitest unit coverage (18 tests)
```

The DB schema lives in `packages/api/src/db/schema.ts` (`outboundCalls`
table + `tenants.outboundVoiceEnabled / outboundVoiceConfig`) with the SQL
migration in `0024_outbound_voice.sql`.

## API Endpoints

| Method   | Path                                                    | Description                                |
|----------|---------------------------------------------------------|--------------------------------------------|
| `POST`   | `/v1/admin/outbound-voice/calls`                        | Enqueue a new outbound call                |
| `GET`    | `/v1/admin/outbound-voice/calls`                        | List calls (filters: purpose, status)      |
| `GET`    | `/v1/admin/outbound-voice/calls/:id`                    | Fetch a single call                        |
| `POST`   | `/v1/admin/outbound-voice/calls/:id/cancel`             | Cancel a queued/dialing/in-progress call   |
| `POST`   | `/v1/admin/outbound-voice/calls/:id/retry`              | Re-queue a failed/no-answer/busy call      |
| `DELETE` | `/v1/admin/outbound-voice/calls/:id`                    | Alias for cancel (audit log forbids true delete) |
| `GET`    | `/v1/admin/outbound-voice/config`                       | Read tenant config + available purposes    |
| `PATCH`  | `/v1/admin/outbound-voice/config`                       | Toggle enable + tweak per-tenant settings  |
| `POST`   | `/webhooks/thinkrr/outbound-result`                     | Public webhook (header-secret verified)    |

Admin routes pass through `AdminAuthGuard` (x-tenant-id or JWT). The webhook
is public and verifies the `x-thinkrr-secret` header against
`THINKRR_WEBHOOK_SECRET`.

## Script Templates

| Key                       | Required Variables                                      |
|---------------------------|---------------------------------------------------------|
| `customer_status_update`  | `customer_name`, `company_name`, `job_id`, `status`     |
| `eta_confirmation`        | `customer_name`, `company_name`, `driver_first_name`, `eta_minutes` |
| `post_job_followup`       | `customer_name`, `company_name`                         |
| `driver_escalation`       | `driver_first_name`, `job_id`, `company_name`, `reason` |
| `motor_club_update`       | `motor_club`, `job_id`, `status`, `company_name`        |
| `custom`                  | `body`                                                  |

`renderTemplate(key, vars)` raises `MissingVariableError` when a required
variable is undefined / null / empty string. The `enqueueCall` path catches
this and refuses the insert, so we never dial with `{{...}}` literals on the
wire.

## Lifecycle Hooks

The service exposes five public methods that other modules can call when a
business event happens. None of them throw; they swallow errors and log so
that an outbound-voice failure can never break the dispatching flow that
triggered it.

```ts
voice.notifyJobDispatched({ tenantId, customerName, customerPhone, companyName, jobId })
voice.notifyJobOnScene   ({ tenantId, customerName, customerPhone, companyName, driverFirstName, etaMinutes })
voice.notifyJobComplete  ({ tenantId, customerName, customerPhone, companyName })
voice.notifyDriverEscalation({ tenantId, driverFirstName, driverPhone, companyName, jobId, reason })
voice.notifyMotorClubUpdate ({ tenantId, motorClub, motorClubPhone, companyName, jobId, status })
```

### Recommended integration points (NOT modified in this session)

- `command-center` job state transitions (`pending` → `dispatched`,
  `dispatched` → `on_scene`, `on_scene` → `completed`).
- `flip-accept` manager-approval outcome → optional motor-club update call.
- `digital-dispatch` decisions service → driver escalation when no driver
  responds within the SLA window.

A follow-up session (S50) should wire each of those triggers explicitly.
This module exports the hooks via `OutboundVoiceModule` (which is `@Global`)
so consumers can `constructor(private readonly voice: OutboundVoiceService)`
without importing the module manually.

## Webhook Contract

```http
POST /webhooks/thinkrr/outbound-result
Content-Type: application/json
x-thinkrr-secret: ${THINKRR_WEBHOOK_SECRET}

{
  "call_id":          "thinkrr-abc123",
  "status":           "completed",         // ringing | in_progress | completed | failed | no_answer | busy | rejected | cancelled
  "duration_seconds": 42,
  "transcript":       "Hello…",
  "recording_url":    "https://…",
  "outcome":          { "key_pressed": "1" },
  "error":            null,
  "timestamp":        "2026-05-27T18:42:11Z"
}
```

Returns `200` with `{ status, data: { matched, previous_status, new_status } }`.
Idempotent on `call_id`; redelivered events are absorbed without
double-application.

Verification fails closed: a missing or wrong `x-thinkrr-secret` header
returns `401`. If `THINKRR_WEBHOOK_SECRET` is unset on the deployment, the
endpoint returns `401` for every request — operators must set the secret
before Thinkrr starts posting.

## TCPA Posture

`outbound_voice_config.require_consent` defaults to `true`. The dispatcher
does not gate on a consent record today; instead it sets
`outcome.consent_check_skipped = true` so the audit row records that the
soft-compliance path was taken. A future session should:

1. Add a `consent_records` table keyed on `(tenant_id, phone, purpose)`.
2. In `dispatchOne`, look up consent before placing the call. If
   `require_consent && !record`, transition to `failed` with
   `error = 'consent_required'` and surface in the admin UI.

This is intentionally deferred — getting the orchestrator live with soft
compliance unblocks the towing-company use cases (where the customer just
asked us to tow them, so consent is implied) without blocking the build on
the legal review around fully unsolicited calls.

## Environment Variables

| Variable                                   | Required | Default     | Notes                                       |
|--------------------------------------------|:--------:|-------------|---------------------------------------------|
| `THINKRR_OUTBOUND_API_URL`                 | Yes (prod) | —         | Base URL for Thinkrr's outbound endpoint    |
| `THINKRR_API_KEY`                          | Yes (prod) | —         | Bearer token sent in `Authorization` header |
| `THINKRR_OUTBOUND_FROM_NUMBER`             | No       | falls back to `TWILIO_PHONE_NUMBER` then `+1 (878) 356-3281` |  |
| `THINKRR_WEBHOOK_SECRET`                   | Yes (prod) | —         | Required for any webhook delivery           |
| `OUTBOUND_VOICE_DISPATCH_CRON_ENABLED`     | No       | `false`     | Master switch; cron is no-op when not `true` |
| `OUTBOUND_VOICE_DISPATCH_INTERVAL_SECONDS` | No       | `30` (cron schedule fixed in code) | Reserved for future tunable; cron currently fires every 30 s |
| `PUBLIC_BASE_URL`                          | Yes (prod) | `http://localhost:3001` | Used to build the webhook callback URL passed to Thinkrr |

When the Thinkrr keys are absent the client logs once and degrades to
log-only mode: enqueue + DB rows still work, but no actual call is placed.
This lets the entire flow be exercised in dev / staging without burning
Thinkrr minutes.

## Operator Runbook

1. Provision a Thinkrr outbound agent that reads scripts from the variables
   payload (no agent-side script library required — we ship the body).
2. Generate an outbound API key in the Thinkrr console; set
   `THINKRR_API_KEY` and `THINKRR_OUTBOUND_API_URL` on Railway.
3. Generate a webhook secret (random ≥32 bytes); set
   `THINKRR_WEBHOOK_SECRET` on Railway and configure the Thinkrr webhook
   destination as `${PUBLIC_BASE_URL}/webhooks/thinkrr/outbound-result`
   with header `x-thinkrr-secret: <secret>`.
4. Set `OUTBOUND_VOICE_DISPATCH_CRON_ENABLED=true` on the API service.
5. From the admin dashboard → Communications → Outbound Voice, flip the
   tenant's "Enabled" toggle and run a test call against a dispatcher's
   phone.

## Troubleshooting

- **All calls stay `queued`** — the cron is gated by
  `OUTBOUND_VOICE_DISPATCH_CRON_ENABLED`. Confirm it's set to the literal
  string `true` on Railway.
- **Calls flip to `failed` with `thinkrr_unavailable_or_unconfigured`** —
  Thinkrr API URL or key is missing on the deployment, or Thinkrr
  returned non-2xx. Check Railway logs for `[outbound-voice] Thinkrr returned`.
- **Webhook returns 401** — header secret missing/mismatched, or the
  `THINKRR_WEBHOOK_SECRET` env var is not set.
- **Calls never advance from `dialing`** — Thinkrr is not posting back. The
  callback URL it received is `${PUBLIC_BASE_URL}/webhooks/thinkrr/outbound-result`;
  if `PUBLIC_BASE_URL` is wrong (e.g. still pointing at localhost on a
  Railway deploy) Thinkrr can't reach us.

## Tests

`packages/api/src/modules/outbound-voice/*.spec.ts` covers:

- All 6 templates + 4 missing-variable scenarios + unknown template rejection
- `enqueueCall` happy-path + missing-variable + tenant-disabled refusal
- `handleWebhookEvent` dialing → in_progress → completed transition
- Webhook idempotency on a terminal status
- Webhook returning `matched=false` on unknown call id

The full API suite continues to pass alongside these new tests.
