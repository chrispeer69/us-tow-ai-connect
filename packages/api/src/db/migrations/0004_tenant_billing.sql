-- Tenant billing (admin dashboard — Billing screen).
-- A single row per tenant tracking plan, status, current billing period, and
-- (optionally) a Stripe customer pointer. The Billing screen aggregates usage
-- from interaction_logs at read time rather than denormalizing it here.

CREATE TABLE IF NOT EXISTS "tenant_billing" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "plan" varchar(20) DEFAULT 'TRIAL' NOT NULL,
  "status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
  "current_period_start" timestamptz DEFAULT now() NOT NULL,
  "current_period_end" timestamptz NOT NULL,
  "stripe_customer_id" varchar(100),
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_billing_tenant_id_uniq"
  ON "tenant_billing" ("tenant_id");
