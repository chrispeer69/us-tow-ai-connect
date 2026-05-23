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
