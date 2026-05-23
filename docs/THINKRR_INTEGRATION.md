# Thinkrr.ai integration

US Tow AI-Connect is a middleware between **Thinkrr.ai** (voice agent
platform) and the tenant's tow-management software (Towbook, AAA portal,
…). This doc captures the contract between the API and Thinkrr.

Related runbook: `docs/DEPLOY_RAILWAY.md` §13 walks through cutting
Thinkrr over from a local ngrok URL to the production Railway URL.

## What Thinkrr fetches

For every active tenant, Thinkrr's voice agent loads a **Knowledge Pack**
from the API every time a call starts. The agent uses that markdown to
shape its greeting, service offerings, transfer rules, and fallback
language.

```
GET ${PUBLIC_BASE_URL}/public/knowledge/<tenantId>/profile.md
→ 200 text/markdown
   # Roadside Towing
   ## Company Information
   ...
```

The endpoint:

- Is **public** (no API key required). Tenant IDs are UUIDs so guessing is
  infeasible.
- Returns 404 for unknown tenant IDs or tenants flagged `is_active = false`.
- Sets `Cache-Control: public, max-age=60` so Thinkrr's edge can cache the
  body for up to a minute (acceptable since per-tenant config changes are
  rare relative to call volume).

Implementation: `packages/api/src/modules/knowledge-endpoint/knowledge-endpoint.controller.ts`.

## What Thinkrr pushes back

When a call finishes, Thinkrr posts a webhook to the API:

```
POST ${PUBLIC_BASE_URL}/webhooks/thinkrr/${THINKRR_WEBHOOK_SECRET}/call-completed
Content-Type: application/json

{ <ThinkrrCallPayload> }
```

The `THINKRR_WEBHOOK_SECRET` slot in the URL is a path-position secret
(Thinkrr cannot send custom headers). The receiver validates it with
`timingSafeEqual` against the env var of the same name.

Implementation: `packages/api/src/modules/webhook-receiver/webhook-receiver.controller.ts`.

## Production URLs (cutover from ngrok)

Until 2026-05, the URLs above pointed at a local ngrok tunnel that rotated
on every restart — see `docs/BUILD_SESSIONS.md` notes from Sessions 5–9.
**Production URL pattern is now:**

```
Knowledge Pack:
  https://api.ustow-aiconnect.com/public/knowledge/<tenantId>/profile.md

Webhook:
  https://api.ustow-aiconnect.com/webhooks/thinkrr/<THINKRR_WEBHOOK_SECRET>/call-completed
```

While the custom domain is still pending registration (see
`docs/BLOCKERS.md`), substitute the Railway-generated subdomain — the
path layout is identical:

```
Knowledge Pack:
  https://<api>.up.railway.app/public/knowledge/<tenantId>/profile.md

Webhook:
  https://<api>.up.railway.app/webhooks/thinkrr/<THINKRR_WEBHOOK_SECRET>/call-completed
```

## Cutover runbook (ngrok → production)

Authoritative version: `docs/DEPLOY_RAILWAY.md` §13.

Summary:

1. Smoke-test the production Knowledge Pack URL:
   ```
   curl -fsSL \
     https://api.ustow-aiconnect.com/public/knowledge/00000000-0000-0000-0000-000000000001/profile.md
   ```
   Must return a markdown body starting with `# Roadside Towing`.
2. In the Thinkrr dashboard for agent **15206**, update **Knowledge
   Pack URL** to the production URL.
3. Same screen, update the **Webhook URL** to the production webhook
   path with the new shared secret.
4. Place a test call from Thinkrr's "Test Agent" UI. Verify:
   - The Knowledge Pack request lands in `railway logs --service api`.
   - The post-call webhook lands in the same log stream.
5. Stop ngrok on your local laptop — the only thing keeping it alive
   was the Thinkrr integration.

If step 1 fails, **do not** flip Thinkrr — leave it on ngrok until the
smoke test in `scripts/post-deploy-smoke.sh` passes end-to-end.

## Rotating the webhook secret

1. `openssl rand -hex 32` → paste into Railway api service env as the new
   `THINKRR_WEBHOOK_SECRET`. The api service redeploys on save.
2. In the Thinkrr dashboard, edit the webhook URL to embed the new secret
   in the path.
3. The previous secret stops accepting requests as soon as the redeploy
   completes; there is no overlap window, so do (1) and (2)
   back-to-back.

---

# Session 23 — Hardened webhook + agent endpoints

This section documents the contract introduced in **Session 23 (May 2026)**
that takes Thinkrr from "Knowledge-Pack + webhook only" to a full
bidirectional integration where the agent can look up live job data, ETAs,
service catalogs, and create dispatch tickets mid-call.

> Tenant zero
> - UUID: `00000000-0000-0000-0000-000000000001`
> - Brand: **Roadside Towing** (also operating Auto Lyft USA, Excite Towing)
> - Thinkrr inbound number: **+1 380 333 6411**
> - Live dispatch transfer: **+1 (614) 832-6197**

## Endpoint map

### Public (no auth, called by Thinkrr's edge)

| Verb / Path                                                  | Purpose                                  |
|--------------------------------------------------------------|------------------------------------------|
| `GET /public/knowledge/:tenantId/profile.md`                 | Knowledge Pack URL (cached 60s)          |
| `POST /webhooks/thinkrr/:secret/call-completed`              | Call-completion webhook (URL secret)     |
| `POST /webhooks/thinkrr/call-completed`                      | Legacy unsecured route (dev only)        |

### Tenant-authenticated agent endpoints — `X-Tenant-API-Key`

| Verb / Path                                       | Purpose                                              |
|---------------------------------------------------|------------------------------------------------------|
| `GET  /v1/ai-connect/transfer-route`              | Active dispatch transfer rule                        |
| `GET  /v1/ai-connect/lookup/by-phone?phone=…`     | Find an active Towbook/AAA job by caller phone       |
| `GET  /v1/ai-connect/eta?lat=…&lng=…`             | Default ETA (driver-GPS deferred)                    |
| `GET  /v1/ai-connect/services`                    | Service list (merged toggles + knowledge pack)       |
| `POST /v1/ai-connect/dispatch-request`            | Create dispatch ticket + SMS the dispatcher          |
| `POST /v1/ai-connect/smart-action`                | Generic command pipe                                 |
| `POST /v1/ai-connect/log-interaction`             | Legacy aggregated interaction log                    |

### Admin (placeholder `x-tenant-id` header)

| Verb / Path                                  | Purpose                                                |
|----------------------------------------------|--------------------------------------------------------|
| `GET /v1/admin/interaction-logs`             | Aggregated, categorized call list                      |
| `GET /v1/admin/call-interactions`            | Raw Thinkrr payloads w/ transcript, summary, match     |
| `GET /v1/admin/smart-actions`                | Audit log of agent-issued Smart Actions                |
| `GET /v1/admin/dispatch-requests`            | New tow requests created by the agent                  |

## Agent setup in the Thinkrr dashboard

| Field                       | Value                                                                                       |
|-----------------------------|---------------------------------------------------------------------------------------------|
| Agent inbound number        | `+13803336411`                                                                              |
| Knowledge Pack URL          | `${PUBLIC_BASE_URL}/public/knowledge/00000000-0000-0000-0000-000000000001/profile.md`        |
| Call-completion webhook URL | `${PUBLIC_BASE_URL}/webhooks/thinkrr/${THINKRR_WEBHOOK_SECRET}/call-completed`               |
| Agent API base              | `${PUBLIC_BASE_URL}/v1/ai-connect`                                                          |
| Agent auth header           | `X-Tenant-API-Key: usk_<...>` (minted from `/v1/admin/api-keys`)                            |

## Knowledge Pack content (tenant zero)

Verified live with:

```bash
curl -fsSL ${PUBLIC_BASE_URL}/public/knowledge/00000000-0000-0000-0000-000000000001/profile.md
```

Contains:

- Brands: Roadside Towing, Auto Lyft USA, Excite Towing
- Hours: 24/7
- Service area: Central Ohio — Franklin, Delaware, Licking, Madison,
  Pickaway, Union counties
- 10 services: light/medium/heavy tow, roadside, jump start, lockout, tire
  change, fuel delivery, accident recovery, motor club work
- Default ETA: 45 minutes
- Transfer phone: `+16148326197`
- Impound policy: ask the dispatcher
- Payment methods: cash, all major credit cards, motor club accounts
  (AAA, Allstate, GEICO, others)

Source of truth: `packages/api/src/db/seeds/roadside-tenant-zero.ts`.
Re-run after edits with `pnpm --filter @ustow/api db:seed:tenant-zero`.

## Call webhook payload (accepted shape)

```json
{
  "call_id":         "thinkrr-call-uuid",
  "tenant_id":       "00000000-0000-0000-0000-000000000001",
  "agent_id":        "agent-roadside-1",
  "caller_phone":    "+16145551234",
  "called_number":   "+13803336411",
  "duration_sec":    75,
  "transcript":      "...",
  "summary":         "...",
  "structured_data": { "intent": "NEW_TOW_REQUEST" },
  "status":          "completed",
  "started_at":      "2026-05-23T13:00:00Z",
  "ended_at":        "2026-05-23T13:01:15Z"
}
```

Tenant resolution falls through `tenant_id → agent_id → called_number`.
Unknown tenants still return HTTP 200 to suppress Thinkrr retries.

Stored in two places:

1. **`call_interactions`** — full row (transcript, summary, structured
   data, raw_payload JSONB, matched_job_id). Caller phone is matched
   last-10-digits against Towbook + AAA Redis caches.
2. **`interaction_logs`** — legacy categorized row (summary truncated to
   2000 chars) used by the existing `/admin/calls` Aggregated tab.

The admin `/admin/calls` page has a **Raw Thinkrr Payloads** tab listing
the new `call_interactions` rows with expandable transcript/summary view.

## Smart Actions

The agent can fire a typed command back at us via:

```http
POST /v1/ai-connect/smart-action
X-Tenant-API-Key: usk_...
Content-Type: application/json

{
  "action_type": "CREATE_DISPATCH | TRANSFER_TO_HUMAN | REQUEST_CALLBACK | SEND_SMS | UPDATE_JOB | OTHER",
  "call_id":     "thinkrr-call-uuid (optional)",
  "payload":     { "...": "free-form per action_type" }
}
```

Every action is recorded to `smart_actions` with `status = PENDING` and
visible at `/v1/admin/smart-actions`. Type-specific handlers will land in
a follow-up session — for now this is an audit + queue surface.

## Lookup / ETA / Services examples

```bash
# Active job by phone
curl ${PUBLIC_BASE_URL}/v1/ai-connect/lookup/by-phone?phone=%2B16145551234 \
  -H "X-Tenant-API-Key: $TENANT_API_KEY"

# Default ETA
curl "${PUBLIC_BASE_URL}/v1/ai-connect/eta?lat=39.96&lng=-82.99" \
  -H "X-Tenant-API-Key: $TENANT_API_KEY"

# Service catalog
curl ${PUBLIC_BASE_URL}/v1/ai-connect/services \
  -H "X-Tenant-API-Key: $TENANT_API_KEY"
```

## Dispatch request from the agent

```bash
curl -X POST ${PUBLIC_BASE_URL}/v1/ai-connect/dispatch-request \
  -H "X-Tenant-API-Key: $TENANT_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "caller_name": "John Smith",
    "caller_phone": "+16145559999",
    "vehicle": { "year": "2018", "make": "Honda", "model": "Civic", "color": "Blue" },
    "location": "I-270 EB MM 23 near Polaris exit",
    "destination": "Roadside Towing yard",
    "reason": "Engine failure",
    "agent_notes": "Caller is safe off the road"
  }'
```

Response (201): `{ "status": "success", "data": { "dispatch_request_id", "status": "NEW", "dispatcher_notified": true|false } }`.

The dispatcher receives an SMS at the active routing-rule phone (Twilio).
When Twilio is not configured the SMS is logged to stdout and the row's
`dispatcher_notified` flag stays `false` — the dispatcher can still pick
the request up from `/admin/dispatch-requests`.

## Security summary

| Surface                                | Auth                                       |
|----------------------------------------|--------------------------------------------|
| `/public/knowledge/...`                | None (UUID gate + DB lookup)               |
| `/webhooks/thinkrr/:secret/...`        | URL-path secret (timing-safe equality)     |
| `/v1/ai-connect/*`                     | `X-Tenant-API-Key` (bcrypt)                |
| `/webhooks/twilio/*`                   | `X-Twilio-Signature` (HMAC-SHA1, new)      |
| `/v1/admin/*`                          | Placeholder `x-tenant-id` (real JWT TBD)   |

Twilio signature validation bypasses with a warning when
`TWILIO_AUTH_TOKEN` is unset or still `REPLACE_ME_*` so dev environments
keep working. Production must set a real token.

## Smoke test

```bash
BASE_URL=http://localhost:3001 \
TENANT_API_KEY=usk_xxxxx \
THINKRR_SECRET=<value from packages/api/.env> \
scripts/smoke-test.sh
```

Expected output: **8 passed, 0 failed**. Tests:

1. `GET /health`
2. `GET /public/knowledge/<tenant>/profile.md`
3. `POST /webhooks/thinkrr/<secret>/call-completed`
4. `GET /v1/ai-connect/lookup/by-phone`
5. `GET /v1/ai-connect/eta`
6. `GET /v1/ai-connect/services`
7. `POST /v1/ai-connect/dispatch-request`
8. `POST /v1/ai-connect/smart-action`

## Open questions / deferred

- Real driver-GPS feed → `eta` should compute real arrival times.
- Smart Action handlers per `action_type` — currently recorded only.
- Multi-brand routing — KP carries the brand array but no per-brand
  profiles yet. Session 18 (Multi-Company Switcher) will model brands.
- AAA portal Accept/Decline selectors — see `docs/BLOCKERS.md`.
