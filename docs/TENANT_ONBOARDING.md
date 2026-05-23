# Tenant Onboarding

> Self-serve 4-step signup for new tenants. Ships in Session 27 / Bundle C.

## Flow diagram

```
+--------------------+    POST /v1/onboarding/start     +-----------------------+
| /onboarding (web)  | -------------------------------> | onboarding_drafts row |
|  Step 1 — Company  |    {draftId} returned            |  status='draft'       |
+--------------------+                                  +-----------------------+
          |
          | POST /v1/onboarding/step  (×4, one per step)
          v
+--------------------+
| onboarding_drafts  |  form_data jsonb accumulates step1..step4
+--------------------+
          |
          | POST /v1/onboarding/test-credentials  (optional, step 3)
          | -- AdapterFactory.testConnection(towbook|aaa) --
          v
+----------------------+    POST /v1/onboarding/complete    +-------------------------+
| Final review (step4) | ---------------------------------> | tenants row + admin     |
| Greeting + transfer  |    (captcha or 3/hr IP limit)      | member + api_key +      |
+----------------------+                                    | routing_rule + KP draft |
                                                            +-------------------------+
                                                                  |
                                                                  v
                                                    +-------------------------------+
                                                    | Welcome email (SendGrid or    |
                                                    | stdout fallback) + audit row  |
                                                    +-------------------------------+
```

## Endpoint reference

All endpoints under `/v1/onboarding/*` are **public** (no auth). The
`/complete` endpoint is gated by either:

- **Cloudflare Turnstile / hCaptcha** when `SIGNUP_CAPTCHA_KEY` is set
  on the API (and the request includes a `captchaToken` body field), or
- **Per-IP rate limit**: 3 successful signups per IP per hour. Mirrors
  the existing tenant-scoped `RateLimitGuard` pattern (Redis
  `incr + expire` counter).

### `POST /v1/onboarding/start`

Creates a draft. Pre-populates step 1 with `companyName` if supplied.
`partnerAccountId` is optional but used by Thinkrr (see
`docs/THINKRR_PARTNER_MODE.md`).

```jsonc
// request
{ "email": "owner@acme.com", "companyName": "Acme Towing", "partnerAccountId": "thinkrr-acc-1234" }
// response
{ "draftId": "uuid", "currentStep": 1, "formData": {…}, "captchaRequired": false }
```

### `POST /v1/onboarding/step`

Upserts a step. `step` is `1..4`; `values` must match the step's zod
schema (`OnboardingCompanyStep`, `OnboardingContactStep`,
`OnboardingIntegrationStep`, `OnboardingAgentStep`).

```jsonc
{
  "draftId": "uuid",
  "step": 1,
  "values": {
    "companyName": "Acme Towing",
    "brandNames": ["Acme"],
    "serviceAreaDescription": "Central Ohio",
    "timezone": "America/New_York"
  }
}
```

### `POST /v1/onboarding/test-credentials`

Tests Towbook / AAA portal credentials live without saving them.
Returns `{success, message, latencyMs}` from the adapter.

```jsonc
{ "draftId": "uuid", "softwareType": "TOWBOOK", "username": "u", "password": "p" }
```

### `POST /v1/onboarding/complete`

Finalizes the draft. Atomically creates:

| Table | Row |
|---|---|
| `tenants` | `company_name`, `owner_email`, `timezone`, `target_software_type`, `api_key_hash`, `branding` (defaults from step 1+2), `partner_account_id` (from draft) |
| `tenant_members` | OWNER, ACTIVE |
| `users` | platform_role=`tenant_admin` |
| `routing_rules` | active, `phone_number = step4.transferNumber` |
| `ai_agent_configs` | greeting, voice, transfer_phone, default_eta_mins |
| `tenant_knowledge_pack` | unpublished v2 draft seeded from step 1 |
| `tenant_api_keys` | "Initial bootstrap key" |
| `tenant_credentials` | encrypted Towbook **or** AAA creds (only if step 3 filled) |
| `audit_log` | `onboarding.tenant.created` |

Response includes the **bootstrap API key** (only shown once — store
it), the Knowledge Pack URLs, and the admin URL.

### `GET /v1/onboarding/drafts/:id`

Look up a draft by ID. Used by Thinkrr partner flow when handing a
draft over to an end-customer for completion.

## Draft lifecycle

- `expires_at` defaults to **48 hours**. Drafts past this aren't
  resumable — a fresh `/start` is required.
- `status` transitions: `draft → completed`. (No `abandoned` cleanup
  cron today — a manual `DELETE … WHERE expires_at < NOW() AND status =
  'draft'` is fine.)

## Frontend

`packages/web/src/app/onboarding/page.tsx` renders the 4-step wizard via
`OnboardingClient`. State is local React; persistence is per-step via
the API. The success screen displays the API key in a `<pre>` block
with a copy-friendly format.

## Partner integration

See `docs/THINKRR_PARTNER_MODE.md` for the alternate bulk flow
(`POST /v1/partner/tenants`) and how to hand an end-customer a draft
link.

## Testing

- Vitest: `packages/api/src/modules/tenant-onboarding/tenant-onboarding.service.spec.ts`
- Playwright: `packages/web/tests/e2e/onboarding.spec.ts`
