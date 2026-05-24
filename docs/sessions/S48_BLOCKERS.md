# S48 — Blockers / follow-ups

## #1 — decisions 500 root cause still unconfirmed (mitigated, not fixed)
- **What:** `GET /v1/admin/digital-dispatch/decisions` 500'd in prod (caught by
  S42 smoke, PR #7). S48 wraps the query in try/catch so it now degrades to an
  empty 200 and logs the real error — but the underlying cause is not yet known.
- **Why unconfirmed:** Railway CLI is not auth'd in this checkout (`railway
  status` → `invalid_grant` / no linked project). Couldn't pull the stack trace.
- **Hypothesis:** column / JSONB / migration drift — `.select({ decision:
  dispatchDecisions, … })` pulls the whole decisions row including JSONB columns
  (e.g. `evaluated_conditions`, `confirmation_evidence`); if one is missing in
  the prod schema, the query throws.
- **Action for owner:**
  1. `railway login && railway logs` on the API service, hit the endpoint, read
     the now-logged `listDecisions failed …` error.
  2. If it's column drift, run the pending migration; confirm prod schema matches
     `packages/api/src/db/schema.ts`.
- **⚠️ Detection moved:** once mitigated, S5 in `scripts/smoke/post-deploy-smoke.sh`
  flips FAIL→PASS even if a new variant recurs. The signal now lives in logs, not
  the smoke gate. Consider a log-based alert on `listDecisions failed`.

## #2 — no per-tenant driver relay number storage
- **What:** `driver_call_url` resolves from the deployment-level
  `TWILIO_PROXY_NUMBER` env. There is no per-tenant masked-relay configuration.
- **Why:** the `branding` jsonb is strictly zod-parsed (`BrandingSchema` strips
  unknown keys), so a per-tenant relay number can't live there without a
  shared-schema change; no `tenants` column exists either.
- **Action for owner (white-label):** add a `driverRelayNumber` field to
  `BrandingSchema` (packages/shared) **or** a `driver_relay_number` column on
  `tenants` (+ migration), then have `resolveDriverCallUrl` prefer it over the
  env. True Twilio Proxy *session* provisioning (ephemeral per caller↔driver
  number) is a larger, separate piece of work — the API field is the contract;
  provisioning is downstream.
