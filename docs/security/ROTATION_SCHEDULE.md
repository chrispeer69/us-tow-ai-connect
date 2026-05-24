# Secret Rotation Schedule — US Tow AI-Connect

Quarterly rotation calendar. Procedures for each secret live in
`ROTATION_PLAYBOOK.md`. Record every rotation in the log at the bottom.

## Cadence policy

| Tier | Cadence | Secrets |
|------|---------|---------|
| **Critical** | Every 90 days (quarterly) | `ENCRYPTION_KEY`, `DATABASE_URL`, AAA password, Towbook password, `PARTNER_API_KEY` |
| **Standard** | Every 180 days | `SENDGRID_API_KEY`, `TWILIO_AUTH_TOKEN`, `THINKRR_API_KEY`, `THINKRR_WEBHOOK_SECRET`, `IMPERSONATION_SECRET`, `GOOGLE_PLACES_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| **Low / on-event** | Annually or on suspected exposure | `SENTRY_DSN`, `VAPID_PRIVATE_KEY` (disrupts subscriptions — rotate sparingly), `JWT_SECRET`, CAPTCHA keys, demo/driver API keys |
| **Immediate** | On any disclosure | Anything exposed in chat, logs, screenshots, or a leaked `.env` |

## 2026 quarterly calendar (template)

| Quarter | Window (suggested) | Critical-tier due | Standard-tier due | Owner | Status |
|---------|--------------------|-------------------|-------------------|-------|--------|
| Q2 2026 | week of 2026-06-15 | ENCRYPTION_KEY, DATABASE_URL, AAA, Towbook, PARTNER_API_KEY | — | Chris | ☐ |
| Q3 2026 | week of 2026-09-15 | Critical tier | SendGrid, Twilio, Thinkrr×2, Impersonation, Google×2, Stripe×2 | Chris | ☐ |
| Q4 2026 | week of 2026-12-15 | Critical tier | — | Chris | ☐ |
| Q1 2027 | week of 2027-03-15 | Critical tier | Standard tier (180d) + annual (Sentry, VAPID, JWT, CAPTCHA, demo keys) | Chris | ☐ |

> Pick a low-dispatch window (early morning) for `ENCRYPTION_KEY` and
> `DATABASE_URL` rotations — both cause a brief adapter/API blip.

## Pre-rotation checklist (each quarter)

- [ ] Snapshot Railway Postgres before `ENCRYPTION_KEY` / `DATABASE_URL` work.
- [ ] Confirm `scripts/security/bin/gitleaks.exe` present (or reinstall — see
      `docs/sessions/S41_OPERATOR_TODO.md`).
- [ ] Re-run the secret sweep:
      `gitleaks detect --source . --config .gitleaks.toml --no-banner`.
- [ ] Work through `ROTATION_PLAYBOOK.md` per secret; tick the universal
      post-rotation checklist for each.
- [ ] Log results below.

## Rotation log

| Date | Secret(s) rotated | Rotated by | Verified | Notes |
|------|-------------------|-----------|----------|-------|
| 2026-05-24 | AAA password — **flagged** for rotation (chat exposure), not yet rotated by operator | Session 41 | ☐ | See `S41_OPERATOR_TODO.md` item 1 |
| _(add rows as you rotate)_ | | | | |
