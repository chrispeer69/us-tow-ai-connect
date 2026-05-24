# Session 28 — Stripe credit billing — Decisions

Additive log. Newest at bottom. Senior-engineer shorthand.

## Context found (not greenfield)
- `tenant_billing` table already existed (migration 0004) with plan/status/period/`stripe_customer_id`.
- `/v1/admin/billing` (GET) and `/v1/admin/billing/plan` (PUT) already served by **AdminController/AdminService** (legacy plan + usage view).
- A billing page already existed at `packages/web/src/app/admin/billing/page.tsx`.
- `webhook-receiver` module exists for Thinkrr — used as the pattern reference for signature-checked webhooks.

## Decisions
- **D1 — Reuse, don't replace, `tenant_billing`.** Migration 0020 *alters* the existing table (adds `stripe_subscription_id`, `credit_balance`, `per_job_billing`) instead of creating a new one. Avoids a parallel source of truth and keeps the legacy admin view working.
- **D2 — New routes are disjoint from the legacy ones.** New `BillingController` owns `GET /v1/admin/billing/status`, `POST /v1/admin/billing/checkout`, `GET /v1/admin/billing/portal`. No collision with admin's bare `GET /v1/admin/billing` / `PUT .../plan`. Did not touch AdminController/AdminService (kept blast radius inside the billing module).
- **D3 — Per-job billing modeled as a boolean, not a new plan enum value.** `tenant_billing.per_job_billing` gates credit deduction. Avoids editing the shared `BillingPlan` enum + `PLAN_DETAILS` map in admin (out of owned scope) and the subscription plan enum stays clean (STARTER/PRO/ENTERPRISE).
- **D4 — `billing_blocked` lives on `tenants`.** Matches the task spec (`tenant.billing_blocked`) and lets the ingest path gate without a join.
- **D5 — Idempotency via unique insert.** `billing_events.stripe_event_id` is unique; `applyWebhookEvent` does `INSERT ... ON CONFLICT DO NOTHING RETURNING` and skips dispatch when no row is returned. The whole event payload is stored as jsonb for audit/replay.
- **D6 — Stripe client is nullable.** No `STRIPE_SECRET_KEY` → provider returns `null`, API still boots; checkout/portal/webhook return 503. Mirrors the existing "boot without DB" stub philosophy in `db.module.ts`. No key is ever hardcoded (tenant-zero included) — see BLOCKER B1.
- **D7 — Signature verification uses `req.rawBody`.** `rawBody: true` is already set in `main.ts` NestFactory, and `/webhooks/*` is already CORS-exempt. No new body-parser plumbing needed.
- **D8 — Credit deduction hook is an optional injection into `CommandCenterService.upsertJob`.** Fires only on `created === true`, best-effort (try/catch) so a billing failure never drops a tow job. `@Optional()` keeps direct-construction unit tests working. CommandCenterModule imports BillingModule (no cycle — billing doesn't import command-center).
- **D9 — `apiVersion` omitted in the Stripe constructor.** Uses the SDK's pinned default (stripe@22) to avoid a brittle literal version string. `current_period_*` read defensively from either the subscription or its items to survive API-version drift.
- **D10 — Credit pack size via env (`STRIPE_CREDIT_PACK_SIZE`, default 100).** Checkout stamps the granted credit count into session metadata so the webhook credits the exact amount even if the env changes later.

## Files
- DB: `0020_billing_stripe_credits.sql` + journal entry idx 19; schema edits (`tenants.billingBlocked`, `tenantBilling` + 3 cols, new `billingEvents`).
- Shared: `SubscriptionPlan`, `CheckoutSessionSchema` in `admin.schema.ts`.
- API: `modules/billing/{stripe.provider,billing.service,billing.controller,stripe-webhook.controller,billing.module}.ts` + 2 specs. Wired into `app.module.ts`. Hook into `command-center.service.ts` + `command-center.module.ts`.
- Web: `app/admin/billing/page.tsx` (credit card, portal/checkout buttons, invoices table).
- Env: 6 Stripe vars in `packages/api/.env.example`.
