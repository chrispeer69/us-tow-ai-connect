-- Session 24 (Caller Communication): tracking links, SMS audit, flip-accept SMS workflow.
-- Three new tables plus tenant-config additions for manager phones, SMS opt-out,
-- and the public tracking-URL base.

-- ============ TRACKING LINKS ============
CREATE TABLE IF NOT EXISTS "tracking_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "token" text NOT NULL UNIQUE,
  "caller_phone" text NOT NULL,
  "caller_name" text,
  "job_id" uuid,
  "pickup_lat" numeric(10, 7),
  "pickup_lng" numeric(10, 7),
  "status" text NOT NULL DEFAULT 'created',
  "assigned_driver_phone" text,
  "assigned_driver_name" text,
  "last_eta_minutes" integer,
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "tracking_links_token_idx" ON "tracking_links" ("token");
CREATE INDEX IF NOT EXISTS "tracking_links_tenant_status_idx" ON "tracking_links" ("tenant_id", "status");

-- ============ SMS MESSAGES ============
CREATE TABLE IF NOT EXISTS "sms_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "direction" text NOT NULL,
  "to_phone" text NOT NULL,
  "from_phone" text NOT NULL,
  "body" text NOT NULL,
  "twilio_sid" text,
  "status" text NOT NULL DEFAULT 'queued',
  "related_tracking_link_id" uuid,
  "related_flip_request_id" uuid,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  "delivered_at" timestamptz,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sms_messages_tenant_created_idx" ON "sms_messages" ("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "sms_messages_twilio_sid_idx" ON "sms_messages" ("twilio_sid");
CREATE INDEX IF NOT EXISTS "sms_messages_related_tracking_idx" ON "sms_messages" ("related_tracking_link_id");
CREATE INDEX IF NOT EXISTS "sms_messages_related_flip_idx" ON "sms_messages" ("related_flip_request_id");

-- ============ FLIP ACCEPT REQUESTS ============
CREATE TABLE IF NOT EXISTS "flip_accept_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "source_adapter" text NOT NULL,
  "source_job_id" text NOT NULL,
  "job_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "status" text NOT NULL DEFAULT 'pending',
  "approver_phone" text,
  "approver_response" text,
  "approval_notes" text,
  "responded_at" timestamptz,
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

CREATE INDEX IF NOT EXISTS "flip_accept_requests_tenant_status_idx"
  ON "flip_accept_requests" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "flip_accept_requests_source_idx"
  ON "flip_accept_requests" ("source_adapter", "source_job_id");

CREATE INDEX IF NOT EXISTS "flip_accept_requests_status_expires_idx"
  ON "flip_accept_requests" ("status", "expires_at");

-- ============ TENANTS: CALLER-COMM CONFIG ============
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "manager_phones" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sms_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tracking_url_base" text NOT NULL DEFAULT 'https://ustowapi-production.up.railway.app/track';
