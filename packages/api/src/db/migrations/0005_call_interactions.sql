-- Session 23 (Thinkrr integration hardening).
-- Stores the full Thinkrr call payload (transcript, summary, structured_data,
-- raw_payload) for each completed call. Separate from interaction_logs which
-- holds the aggregated/categorized record used by the admin dashboard.

CREATE TABLE IF NOT EXISTS "call_interactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "call_id" varchar(120) NOT NULL,
  "caller_phone" varchar(20),
  "called_number" varchar(20),
  "duration_sec" integer,
  "transcript" text,
  "summary" text,
  "structured_data" jsonb,
  "raw_payload" jsonb NOT NULL,
  "matched_job_id" varchar(120),
  "matched_job_source" varchar(20),
  "started_at" timestamptz,
  "ended_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "call_interactions_call_id_uniq"
  ON "call_interactions" ("call_id");

CREATE INDEX IF NOT EXISTS "call_interactions_tenant_created_idx"
  ON "call_interactions" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "call_interactions_caller_phone_idx"
  ON "call_interactions" ("caller_phone");

-- Smart Actions invoked by the Thinkrr agent (dispatch creation, transfer,
-- callback request, etc.). Stored for auditing + replay.
CREATE TABLE IF NOT EXISTS "smart_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "action_type" varchar(60) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" varchar(20) DEFAULT 'PENDING' NOT NULL,
  "result" jsonb,
  "error_message" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "smart_actions_tenant_created_idx"
  ON "smart_actions" ("tenant_id", "created_at" DESC);

-- Dispatch requests created by the AI agent (Session 23 / Section 2).
-- Mirrors the agent's collected fields; SMS notification to dispatch is fired
-- asynchronously from the controller.
CREATE TABLE IF NOT EXISTS "dispatch_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "caller_name" varchar(255) NOT NULL,
  "caller_phone" varchar(20) NOT NULL,
  "vehicle_year" varchar(10),
  "vehicle_make" varchar(60),
  "vehicle_model" varchar(60),
  "vehicle_color" varchar(40),
  "location" text NOT NULL,
  "destination" text,
  "reason" text,
  "agent_notes" text,
  "status" varchar(20) DEFAULT 'NEW' NOT NULL,
  "dispatcher_notified" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "dispatch_requests_tenant_created_idx"
  ON "dispatch_requests" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "dispatch_requests_phone_idx"
  ON "dispatch_requests" ("caller_phone");

-- Add tenant_zero default knowledge pack columns (services, transfer phone,
-- service area, hours, payment methods) into ai_agent_configs as a JSON blob.
-- Existing `service_toggles` and `default_eta_mins` stay as-is.
ALTER TABLE "ai_agent_configs"
  ADD COLUMN IF NOT EXISTS "knowledge_pack" jsonb DEFAULT '{}'::jsonb NOT NULL;
