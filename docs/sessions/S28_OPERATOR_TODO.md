# Session 28 — Operator follow-up (Stripe billing)

These steps require a real Stripe account and the production console. Nothing
here is hardcoded in the repo.

## 1. Stripe dashboard — create products & prices
Create 3 recurring (monthly) prices and 1 one-off price:
- Starter (subscription) → copy `price_...` → `STRIPE_PRICE_STARTER`
- Pro (subscription) → `STRIPE_PRICE_PRO`
- Enterprise (subscription) → `STRIPE_PRICE_ENTERPRISE`
- Credit pack (one-off, mode=payment) → `STRIPE_PRICE_CREDIT_PACK`

Use **test mode** keys/prices for tenant-zero + staging; live mode only for prod.

## 2. Webhook endpoint
Stripe dashboard → Developers → Webhooks → Add endpoint:
- URL: `${PUBLIC_BASE_URL}/webhooks/stripe`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`
- Copy the signing secret (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`

## 3. Railway — set env vars on @ustow/api
```
STRIPE_SECRET_KEY=sk_test_...        # or sk_live_... in prod
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ENTERPRISE=price_...
STRIPE_PRICE_CREDIT_PACK=price_...
STRIPE_CREDIT_PACK_SIZE=100          # optional, default 100
```
Until these are set the billing module runs disabled: `/v1/admin/billing/checkout`
and `/portal` return 503, and `/webhooks/stripe` is refused. The rest of the API
is unaffected.

## 4. Apply migration to prod
Migration `0020_billing_stripe_credits` is **NOT yet applied to prod**. It runs
on the next deploy via the container startup migrator (`db:migrate:prod`), or
manually with `pnpm --filter @ustow/api db:migrate:prod`.

## 5. Enable per-job billing for a tenant (when desired)
Per-job credit gating only activates when `tenant_billing.per_job_billing = true`.
A successful credit-pack checkout sets this automatically. To pre-enable a tenant
without a purchase, set the column directly.
