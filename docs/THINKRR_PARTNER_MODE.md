# Thinkrr Partner Mode

> White-label resale integration between US Tow AI-Connect and Thinkrr.

## Overview

Thinkrr resells US Tow AI-Connect under its own brand. Each end-customer
(a tow company) becomes a **tenant** on our platform; Thinkrr keeps the
billing relationship with the customer and reconciles against us using
`partner_account_id`.

```
+----------------+        +--------------+        +-------------------+
| Thinkrr        |  API   | US Tow       |  KP    | Thinkrr voice     |
| account portal | -----> | AI-Connect   | -----> | agent (per-tenant |
+----------------+        +--------------+        | knowledge pack)   |
                                  |               +-------------------+
                                  v
                        +------------------+
                        | New tenant row   |
                        | + API key        |
                        | + KP draft       |
                        | + audit_log row  |
                        +------------------+
```

## Authentication

All partner endpoints require the header:

```
x-partner-api-key: <PARTNER_API_KEY env value on the US Tow API>
```

The key is rotated by setting `PARTNER_API_KEY` in Railway and restarting
the API container. There is currently a single partner key (Thinkrr); a
future multi-partner refactor would graduate this guard to a `partners`
table lookup.

## Endpoints

### `POST /v1/partner/tenants`

Bulk-create one or more end-customer tenants on behalf of a partner.

**Request body** (validated by `PartnerTenantCreateSchema` in
`@ustow/shared`):

```jsonc
{
  "partnerAccountId": "thinkrr-acc-1234",   // Thinkrr's internal account ID
  "tenants": [
    {
      "companyName": "Acme Towing",
      "ownerEmail": "owner@acme-towing.com",
      "timezone": "America/Chicago",        // default America/New_York
      "transferNumber": "+13125551212",     // optional
      "thinkrrAgentId": "15206",            // optional
      "branding": {                          // optional, partial branding
        "primaryColor": "#0ea5e9",
        "logoUrl": "https://thinkrr-cdn/acme-logo.png",
        "hidePoweredBy": true
      }
    }
  ]
}
```

**Response** (200):

```jsonc
{
  "partnerAccountId": "thinkrr-acc-1234",
  "created": [
    {
      "tenantId": "ab2…",
      "companyName": "Acme Towing",
      "apiKey": "usk_…",                     // shown ONCE — store it
      "knowledgePackUrl":
        "https://api.ustowapi-production.up.railway.app/public/knowledge/ab2…/profile.md",
      "knowledgePackJsonUrl":
        "https://api.ustowapi-production.up.railway.app/public/knowledge/ab2…/profile.json"
    }
  ]
}
```

**Defaults applied:**

- `branding.hidePoweredBy = true` for partner-created tenants (Thinkrr's
  white-label branding wins).
- A `tenant_members` row is created with role=OWNER, status=ACTIVE.
- A platform `users` row is upserted with `platform_role='tenant_admin'`.
- A `tenant_api_keys` row named `partner:<partnerAccountId>` is created
  for the returned API key.
- An empty Knowledge Pack v2 draft is seeded with the company name,
  transfer rule (if `transferNumber` supplied), and 24/7 hours.
- An `audit_log` row records `partner.tenant.created` per tenant.

### Onboarding-flow integration (`/v1/onboarding/start`)

For partner-initiated end-customer signups where Thinkrr wants the
customer to fill in the rest of the wizard, Thinkrr can pre-populate the
draft:

```http
POST /v1/onboarding/start
Content-Type: application/json

{
  "email": "owner@acme-towing.com",
  "companyName": "Acme Towing",
  "partnerAccountId": "thinkrr-acc-1234"
}
```

This returns a `draftId` Thinkrr can hand off to the end-customer in an
email link: `https://dispatch.us-tow-ai-connect.com/onboarding?draftId=…`.
When the customer finalizes the wizard via `POST /v1/onboarding/complete`,
the resulting tenant inherits the `partner_account_id`.

## Knowledge Pack handoff

Thinkrr's voice agent reads the Knowledge Pack URL returned above. Two
shapes are exposed for each tenant:

- `/public/knowledge/:id/profile.md` — markdown for legacy scrapers. If
  the tenant has published a v2 KP, the markdown is rendered from the v2
  blob; otherwise the legacy `ai_agent_configs.knowledge_pack` blob is
  used.
- `/public/knowledge/:id/profile.json` — structured JSON for newer
  integrations that prefer typed access.

Both endpoints set `Cache-Control: public, max-age=60`. When the tenant
publishes a new KP version, the API attempts to POST a `kp_published`
notification to `THINKRR_KP_REFRESH_WEBHOOK_URL` (env, optional) so
Thinkrr can refetch immediately. If the env is unset, Thinkrr will
naturally re-scrape within 60s.

## Billing reconciliation

Thinkrr is the billing system of record for partner-resold tenants. The
US Tow API exposes (via the existing `/v1/admin/billing` surface):

- Call counts per tenant per billing period (`interaction_logs`).
- Call minutes per tenant per billing period.
- Plan tier and `currentPeriodEnd`.

For Thinkrr-resold tenants, the plan tier on our side defaults to
`TRIAL`; Thinkrr is responsible for collecting payment from the
end-customer and remitting to us monthly per partner-contract terms.
Reconciliation is human-driven today; an automated `/v1/partner/usage`
endpoint can ship when contracts solidify.

## Operator runbook

### Rotating the partner API key

```bash
# Railway
railway variables set PARTNER_API_KEY=$(openssl rand -hex 32) -s api
railway redeploy -s api
# Then send the new value to Thinkrr ops out-of-band (1Password share).
```

### Bulk-provisioning a Thinkrr batch

```bash
curl -X POST https://ustowapi-production.up.railway.app/v1/partner/tenants \
  -H "Content-Type: application/json" \
  -H "x-partner-api-key: $PARTNER_API_KEY" \
  -d @batch.json
```

### Auditing a partner's tenants

```sql
SELECT id, company_name, owner_email, created_at
FROM tenants
WHERE partner_account_id = 'thinkrr-acc-1234'
ORDER BY created_at DESC;
```

```sql
SELECT created_at, action, resource_id, metadata
FROM audit_log
WHERE actor_type = 'partner'
ORDER BY created_at DESC
LIMIT 100;
```

## Open items

- `THINKRR_KP_REFRESH_WEBHOOK_URL` — needs documentation from Thinkrr on
  the exact webhook shape they accept. See `docs/BLOCKERS.md`.
- Per-partner contract metadata (plan rates, revenue share) lives in a
  spreadsheet today; will graduate to a `partner_contracts` table when
  contract terms solidify.
