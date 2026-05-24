# Secret Rotation Playbook — US Tow AI-Connect

**Owner:** platform operator (Chris)
**Last reviewed:** 2026-05-24 (Session 41)
**Companion docs:** `SECRET_FINDINGS.md`, `ROTATION_SCHEDULE.md`, `env-vars-inventory.txt`

## How to read this doc

Every production secret lives in **Railway → service → Settings → Variables**
(per-service, never in a committed file). For each secret below:

- **Stored as** — the Railway variable name + which service.
- **Rotate at source** — how to mint a new value at the provider.
- **Update in Railway** — how to install it.
- **Verify** — how to confirm the new value works.
- **Blast radius** — what breaks during the swap.

> **General rule:** Railway redeploys the service when a variable changes. Most
> rotations are a momentary blip. The one exception — `ENCRYPTION_KEY` — requires
> a data migration first (see its section); never swap it blind.

> **Per-tenant adapter credentials** (AAA portal, Towbook logins) are NOT Railway
> variables. They are encrypted at rest in the `tenant_credentials` table and
> entered/updated through the admin onboarding flow. Rotating those is covered in
> §AAA and §Towbook.

---

## §AAA — AAA Salesforce / portal password  ⚠️ ACTION REQUIRED

- **Account:** `chrispeer69@yahoo.com`
- **Status:** **FLAGGED FOR ROTATION.** The current password was disclosed in an
  operator chat transcript (value intentionally NOT reproduced here). It was
  **never committed to the repo** (confirmed: 0 hits across all 112 commits — see
  `SECRET_FINDINGS.md`), but a chat disclosure is still an exposure. Rotate it.
- **Stored as:** encrypted per-tenant in `tenant_credentials`
  (`username_encrypted` / `password_encrypted`, AES-256-GCM). Also read from
  `AAA_USERNAME` / `AAA_PASSWORD` (fallback `AAA_PORTAL_USERNAME` /
  `AAA_PORTAL_PASSWORD`) env vars by the dev-only selector-discovery script
  `packages/api/scripts/discover-aaa-selectors.ts`.
- **Rotate at source:**
  1. Log in to the AAA partner portal (Salesforce) as `chrispeer69@yahoo.com`.
  2. Change the password to a fresh strong value (password manager generated).
  3. If MFA is available on the AAA account, enable it.
- **Update in the app:**
  1. Admin dashboard → tenant onboarding → re-enter the AAA portal credentials.
     The API re-encrypts and overwrites the `tenant_credentials` row. No deploy
     needed.
  2. If anyone runs the discovery script locally, update their local
     `AAA_PASSWORD` env (never commit it).
- **Verify:** trigger an AAA adapter session (Command Center → test login, or
  wait for the next dispatch). Confirm `tenant_credentials.session_status` →
  `ACTIVE` and `last_login_success` updates.
- **Blast radius:** AAA adapter logins fail between password change at source and
  credential update in the app. Do both back-to-back.

---

## §Towbook — Towbook portal password

- **Stored as:** encrypted per-tenant in `tenant_credentials` (same columns as
  AAA). Not an env var.
- **Rotate at source:** log in to Towbook → Account/Profile → change password.
- **Update in the app:** admin onboarding → re-enter Towbook credentials → API
  re-encrypts the `tenant_credentials` row.
- **Verify:** trigger a Towbook adapter action (accept/decline test) and confirm
  `session_status` → `ACTIVE`.
- **Blast radius:** Towbook adapter logins fail in the gap; rotate + re-enter
  back-to-back.

---

## §ENCRYPTION_KEY — credential encryption master key  ⚠️ DATA MIGRATION

- **Stored as:** `ENCRYPTION_KEY` (api service). 32-byte / 64-hex string.
- **What it protects:** AES-256-GCM encryption of every `tenant_credentials`
  row (AAA, Towbook, any adapter login). Implemented in
  `packages/api/src/common/utils/encryption.util.ts`.
- **Why it is special:** all stored ciphertext is bound to the current key. If
  you change `ENCRYPTION_KEY` without re-encrypting, **every adapter login
  breaks** — GCM auth-tag verification fails on decrypt. You MUST re-encrypt the
  data as part of the rotation.

### Full rotation procedure

1. **Generate the new key:**
   ```
   openssl rand -hex 32
   ```
2. **Snapshot the database** (Railway Postgres → backup) before touching anything.
3. **Dry-run the re-encryption** against production data (read-only — no writes):
   ```
   OLD_ENCRYPTION_KEY=<current Railway value> \
   NEW_ENCRYPTION_KEY=<new value from step 1> \
   DATABASE_URL=<prod DATABASE_URL> \
     pnpm --filter @ustow/api exec tsx ../../scripts/security/rotate-encryption-key.ts
   ```
   Confirm it reports every row decrypts with the OLD key and re-encrypts +
   verifies with the NEW key. If any row fails, STOP — the OLD key is wrong.
4. **Apply the re-encryption** (single transaction; rolls back on any error):
   ```
   OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... DATABASE_URL=... \
     pnpm --filter @ustow/api exec tsx ../../scripts/security/rotate-encryption-key.ts --apply
   ```
5. **Swap the Railway variable:** set `ENCRYPTION_KEY` (api service) to the NEW
   value. Railway redeploys.
6. **Verify:** after redeploy, trigger an adapter login (AAA or Towbook). Confirm
   `session_status` → `ACTIVE`. Spot-check a tenant's credentials decrypt.
- **Blast radius:** run step 4 and step 5 close together. Between re-encrypt and
  Railway swap, the *running* API still holds the OLD key in memory and can read
  the OLD ciphertext — but the rows are now NEW-key ciphertext, so logins fail
  until the redeploy picks up the NEW key. Schedule during a low-dispatch window.
- **Rollback:** restore the DB snapshot from step 2 and set `ENCRYPTION_KEY` back
  to the OLD value.

---

## §STRIPE_SECRET_KEY — Stripe API secret

- **Status:** **NOT yet wired into the codebase** (no `process.env.STRIPE_*`
  references as of Session 41; billing tables exist but no live Stripe calls).
  Documented here so the runbook is complete once billing goes live.
- **Stored as:** `STRIPE_SECRET_KEY` (api service) — when introduced.
- **Rotate at source:** Stripe Dashboard → Developers → API keys → Roll secret
  key. Stripe supports a grace window where the old key stays valid briefly.
- **Update in Railway:** set `STRIPE_SECRET_KEY` on the api service.
- **Verify:** a test charge / `/v1/billing` health call returns 200; Stripe
  dashboard shows the request authenticated with the new key.
- **Blast radius:** billing calls fail if the old key is revoked before the new
  one is deployed. Use Stripe's roll-with-grace-period.

---

## §STRIPE_WEBHOOK_SECRET — Stripe webhook signing secret

- **Status:** NOT yet wired (see above).
- **Stored as:** `STRIPE_WEBHOOK_SECRET` (api service) — when introduced.
- **Rotate at source:** Stripe Dashboard → Developers → Webhooks → select the
  endpoint → Roll signing secret.
- **Update in Railway:** set `STRIPE_WEBHOOK_SECRET` on the api service.
- **Verify:** send a test event from the Stripe dashboard; confirm the webhook
  receiver returns 200 (signature validates).
- **Blast radius:** inbound Stripe webhooks 4xx until the new secret deploys.

---

## §SENDGRID_API_KEY — SendGrid email API key

- **Stored as:** `SENDGRID_API_KEY` (api service). Optional — blank = alerts log
  to stdout instead of emailing.
- **Rotate at source:** SendGrid → Settings → API Keys → create a new key (Mail
  Send scope), then delete the old one.
- **Update in Railway:** set `SENDGRID_API_KEY` on the api service.
- **Verify:** trigger a CONVINI alert / admin digest email; confirm delivery and
  SendGrid activity feed shows the send under the new key.
- **Blast radius:** outbound alert/digest emails fail in the gap (system degrades
  to stdout logging, not a hard outage).

---

## §VAPID_PRIVATE_KEY — Web Push (VAPID) keypair

- **Status:** delivery deferred until both VAPID keys are set (subscriptions are
  persisted but not yet pushed — see `docs/ASSUMPTIONS.md`).
- **Stored as:** `VAPID_PRIVATE_KEY` + `VAPID_PUBLIC_KEY` + `VAPID_SUBJECT`
  (api service). The **public** key is also baked into the driver PWA client.
- **Rotate at source:** generate a fresh pair:
  ```
  npx web-push generate-vapid-keys
  ```
- **Update in Railway / app:** set both `VAPID_PRIVATE_KEY` and
  `VAPID_PUBLIC_KEY`. **Rotating VAPID invalidates every existing driver push
  subscription** — drivers' PWAs must re-subscribe with the new public key.
  Plan to re-prompt subscriptions and/or clear stale `driver_push_subscriptions`
  rows after rotation.
- **Verify:** subscribe a test driver PWA, send a test push, confirm delivery.
- **Blast radius:** all existing push subscriptions stop working until devices
  re-subscribe. Rotate rarely and announce it.

---

## §PARTNER_API_KEY — Thinkrr partner-mode API key

- **Stored as:** `PARTNER_API_KEY` (api service); paired with `PARTNER_NAME`.
- **Rotate at source:** generate a new opaque key
  (`openssl rand -hex 32` or the `generate-api-key` script) and update it on the
  partner's side simultaneously (it is a shared secret between us and the
  partner integration).
- **Update in Railway:** set `PARTNER_API_KEY` on the api service.
- **Verify:** partner-mode request authenticates (200); old key now 401s.
- **Blast radius:** partner integration calls fail until both sides hold the new
  key — coordinate the swap with the partner.

---

## §SENTRY_DSN — Sentry error-reporting DSN

- **Stored as:** `SENTRY_DSN` (api service). Optional — blank disables Sentry,
  errors fall back to Pino/console.
- **Rotate at source:** Sentry → Project Settings → Client Keys (DSN) → generate
  a new key, deactivate the old one. (A DSN is low-sensitivity — it only allows
  *sending* events — but rotate if leaked to stop event spam.)
- **Update in Railway:** set `SENTRY_DSN` on the api service.
- **Verify:** trigger a test error; confirm it lands in Sentry under the project.
- **Blast radius:** error events stop reaching Sentry in the gap; app keeps
  running (console fallback).

---

## §DATABASE_URL — Postgres connection string

- **Stored as:** `DATABASE_URL` (api service). In production this references the
  Railway Postgres plugin via `${{Postgres.DATABASE_URL}}` — rotating the DB
  password is a Railway plugin operation, not a manual string edit.
- **Rotate at source:** Railway → Postgres plugin → rotate credentials (or
  `ALTER ROLE ... WITH PASSWORD` then update the plugin). Because the api service
  references the plugin variable, the new value propagates on redeploy.
- **Update in Railway:** if `DATABASE_URL` is a literal (not a `${{...}}`
  reference), update it on the api service. Prefer the plugin reference so this
  is automatic.
- **Verify:** `/health` readiness probe → DB check passes after redeploy.
- **Blast radius:** API loses DB connectivity until the new credentials deploy.
  Brief, full outage — do during a maintenance window. **Snapshot first.**

---

## Other secrets in the inventory

These are read by the codebase (`env-vars-inventory.txt`) and should be rotated
on the same quarterly cadence if they hold real values:

| Variable | Service | Notes |
|----------|---------|-------|
| `THINKRR_WEBHOOK_SECRET` | api | HMAC secret for inbound Thinkrr webhooks. `openssl rand -hex 32`; update Thinkrr side too. |
| `THINKRR_API_KEY` | api | Thinkrr account API key. Rotate in Thinkrr → API Keys. |
| `TWILIO_AUTH_TOKEN` | api | Twilio console → rotate auth token. Paired with `TWILIO_ACCOUNT_SID`. |
| `GOOGLE_PLACES_API_KEY` | api | Google Cloud → Credentials → regenerate; restrict by API + server IP. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | web | Separate browser key; restrict by HTTP referer. Rotating = rebuild web. |
| `IMPERSONATION_SECRET` | api | Super-admin impersonation token signing secret. `openssl rand -hex 32`. |
| `JWT_SECRET` | api | Reserved (admin auth not yet live). Rotate before enabling. |
| `DRIVER_TENANT_API_KEY` / `NEXT_PUBLIC_DEMO_TENANT_API_KEY` | api/web | Demo/driver tenant API keys; regenerate via `generate-api-key` script. |
| `SIGNUP_CAPTCHA_KEY` | api | CAPTCHA provider secret; rotate at provider. |

---

## Universal post-rotation checklist

- [ ] New value set in Railway (correct service).
- [ ] Service redeployed and healthy (`/health`).
- [ ] Functional verification done (see per-secret Verify step).
- [ ] Old value revoked/deactivated at the source provider.
- [ ] Rotation date recorded in `ROTATION_SCHEDULE.md`.
- [ ] No secret written to any committed file, log, or chat.
