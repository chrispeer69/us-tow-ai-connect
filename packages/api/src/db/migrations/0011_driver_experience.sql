-- Session 25: Driver Experience
-- Three independent tables introduced by this session. All are owned by
-- Bundle D and do not touch the Command Center's `unified_jobs` / `drivers`
-- / `trucks` tables (parallel sessions). Driver-job state transitions write
-- here as an audit trail; if `unified_jobs` is reachable the service also
-- updates it, but this table is the system-of-record for driver-side events.

-- ============ DRIVER JOB EVENTS ============
-- Audit log for every driver-side state change against an assigned job.
-- `job_id` is intentionally NOT a FK to `unified_jobs`: the Command Center
-- session may not have finished its migrations on every environment yet,
-- so we want this table to insert successfully even when the referenced
-- job row doesn't exist (the driver-jobs service logs to BLOCKERS.md in
-- that branch). When both sessions are live, a future migration can add
-- the FK with `ON DELETE SET NULL`.
CREATE TABLE IF NOT EXISTS "driver_job_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "driver_phone" varchar(20) NOT NULL,
  "job_id" uuid,
  "event_type" varchar(20) NOT NULL,
  "notes" text,
  "lat" numeric(10, 6),
  "lng" numeric(10, 6),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "driver_job_events_tenant_driver_created_idx"
  ON "driver_job_events" ("tenant_id", "driver_phone", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "driver_job_events_tenant_job_idx"
  ON "driver_job_events" ("tenant_id", "job_id");

-- ============ CONVINI INCOMING JOBS ============
-- Raw landing pad for SMS payloads inbound from Convini. The parsed_payload
-- is what we attempt to lift into unified_jobs; raw_body is kept verbatim
-- so we can re-process when the actual Convini wire format is documented.
-- Status enum is text not pg-enum (same rationale as unified_jobs.source).
CREATE TABLE IF NOT EXISTS "convini_incoming_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "convini_id" varchar(120),
  "raw_body" text NOT NULL,
  "parsed_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'received',
  "error_message" text,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "convini_incoming_jobs_tenant_status_idx"
  ON "convini_incoming_jobs" ("tenant_id", "status", "received_at" DESC);

CREATE INDEX IF NOT EXISTS "convini_incoming_jobs_convini_id_idx"
  ON "convini_incoming_jobs" ("tenant_id", "convini_id");

-- ============ DRIVER PUSH SUBSCRIPTIONS ============
-- Web-push subscription endpoints registered by the driver PWA. Stored as
-- a separate table (not a JSONB column on driver_pings) because a single
-- driver can have multiple subscriptions (phone + tablet) and we want to
-- index by endpoint for de-dup. Actual push sending is deferred until
-- VAPID keys land — see docs/ASSUMPTIONS.md.
CREATE TABLE IF NOT EXISTS "driver_push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "driver_phone" varchar(20) NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh_key" text NOT NULL,
  "auth_key" text NOT NULL,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "driver_push_subs_endpoint_uniq"
  ON "driver_push_subscriptions" ("tenant_id", "endpoint");

CREATE INDEX IF NOT EXISTS "driver_push_subs_tenant_phone_idx"
  ON "driver_push_subscriptions" ("tenant_id", "driver_phone");
