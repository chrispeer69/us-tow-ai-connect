-- Session 26 (SaaS Hardening): email audit log + per-tenant digest config.
--
-- `email_messages` is the SendGrid analogue of `sms_messages`. Same
-- responsibilities: pre-write the row, fire the provider, update with
-- provider id / status, fall back to log_only when SENDGRID_API_KEY is
-- absent. `related` columns are intentionally non-FK so deleting a tenant
-- or audit row doesn't blow away the send history.
--
-- The two new `tenants` columns drive Admin Digest delivery:
--   - `digest_emails` — JSONB array of addresses to CC on the daily/weekly summary
--   - `digest_frequency` — 'daily' | 'weekly' | 'off'

CREATE TABLE IF NOT EXISTS "email_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "to_address" text NOT NULL,
  "from_address" text NOT NULL,
  "subject" text NOT NULL,
  "html_body" text,
  "text_body" text,
  "sendgrid_message_id" text,
  "status" varchar(20) NOT NULL DEFAULT 'queued',
  "related_kind" varchar(40),
  "related_id" text,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  "delivered_at" timestamptz,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "email_messages_tenant_created_idx"
  ON "email_messages" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "email_messages_status_idx"
  ON "email_messages" ("status", "created_at" DESC);

-- Tenant configuration: digest preferences + IP allow-list for admin
-- (used by Section 5 security hardening — kept in the same migration so a
-- single rollout flips both features on).
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "digest_emails" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "digest_frequency" varchar(10) NOT NULL DEFAULT 'daily';

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "allowed_admin_ips" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "audit_retention_days" integer NOT NULL DEFAULT 365;

-- Seed tenant-zero with the founder's digest recipient list. Other tenants
-- pick recipients via the /admin/digest UI; tenant-zero is the canonical
-- production tenant so we want the email flow exercised on day one.
UPDATE "tenants"
SET "digest_emails" = '["thechrispeer@gmail.com","chris@bluecollarai.online"]'::jsonb
WHERE "id" = '00000000-0000-0000-0000-000000000001'
  AND jsonb_array_length(COALESCE("digest_emails", '[]'::jsonb)) = 0;
