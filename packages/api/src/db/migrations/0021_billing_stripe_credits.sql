-- Session 28: Stripe credit billing.
--
-- Extends the existing tenant_billing row (migration 0004) with the Stripe
-- subscription pointer + a per-job credit balance, adds a billing_blocked
-- flag to tenants (set when a per-job tenant runs out of credits), and a
-- billing_events ledger for idempotent Stripe webhook processing.
--
-- NOT YET APPLIED TO PROD.

-- tenant_billing: subscription id + credit balance + per-job billing mode.
ALTER TABLE "tenant_billing"
  ADD COLUMN IF NOT EXISTS "stripe_subscription_id" varchar(100);
ALTER TABLE "tenant_billing"
  ADD COLUMN IF NOT EXISTS "credit_balance" integer DEFAULT 0 NOT NULL;
-- per_job_billing = true means each new unified_job deducts one credit and
-- the tenant is gated on credit_balance rather than a monthly call cap.
ALTER TABLE "tenant_billing"
  ADD COLUMN IF NOT EXISTS "per_job_billing" boolean DEFAULT false NOT NULL;

-- tenants: hard gate raised when a per-job tenant's credits hit zero.
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "billing_blocked" boolean DEFAULT false NOT NULL;

-- Idempotent Stripe webhook ledger. stripe_event_id is unique so a redelivered
-- event is a no-op insert (ON CONFLICT DO NOTHING) and is never double-applied.
CREATE TABLE IF NOT EXISTS "billing_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE SET NULL,
  "stripe_event_id" varchar(255) NOT NULL,
  "type" varchar(100) NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "processed_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_events_stripe_event_id_uniq"
  ON "billing_events" ("stripe_event_id");

CREATE INDEX IF NOT EXISTS "billing_events_tenant_idx"
  ON "billing_events" ("tenant_id");
