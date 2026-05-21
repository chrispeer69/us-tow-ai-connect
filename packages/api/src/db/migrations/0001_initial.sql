-- Initial schema for US Tow AI-Connect.
-- Hand-authored to match packages/api/src/db/schema.ts exactly. The runtime
-- migrator (drizzle-orm/node-postgres/migrator) applies SQL files from this
-- directory in lexical order; the journal is written automatically.

CREATE TABLE IF NOT EXISTS "tenants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_name" varchar(255) NOT NULL,
  "owner_email" varchar(255) NOT NULL,
  "timezone" varchar(50) DEFAULT 'America/New_York' NOT NULL,
  "target_software_type" varchar(50) NOT NULL,
  "api_key_hash" varchar(255) NOT NULL UNIQUE,
  "api_key_prefix" varchar(16) NOT NULL,
  "thinkrr_agent_id" varchar(100),
  "assigned_phone_number" varchar(20),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tenant_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "username_encrypted" text NOT NULL,
  "password_encrypted" text NOT NULL,
  "encryption_iv" text NOT NULL,
  "auth_tag" text NOT NULL,
  "session_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
  "last_login_success" timestamptz,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_credentials_tenant_id_uniq"
  ON "tenant_credentials" ("tenant_id");

CREATE TABLE IF NOT EXISTS "routing_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "rule_name" varchar(100) NOT NULL,
  "phone_number" varchar(20) NOT NULL,
  "is_active_now" boolean DEFAULT false NOT NULL,
  "priority_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "interaction_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "thinkrr_call_id" varchar(100) NOT NULL,
  "caller_phone" varchar(20) NOT NULL,
  "category" varchar(50) NOT NULL,
  "summary" text,
  "outcome" varchar(100) NOT NULL,
  "duration_seconds" integer NOT NULL,
  "latency_ms" integer,
  "interaction_time" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "interaction_logs_tenant_time_idx"
  ON "interaction_logs" ("tenant_id", "interaction_time" DESC);

CREATE TABLE IF NOT EXISTS "ai_agent_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "greeting_message" text DEFAULT 'Thank you for calling.' NOT NULL,
  "service_toggles" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "default_eta_mins" integer DEFAULT 45 NOT NULL,
  "impound_enabled" boolean DEFAULT false NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_configs_tenant_id_uniq"
  ON "ai_agent_configs" ("tenant_id");

CREATE TABLE IF NOT EXISTS "outbound_call_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_name" varchar(255) NOT NULL,
  "customer_phone" varchar(20) NOT NULL,
  "motor_club" varchar(100),
  "vehicle" varchar(255),
  "issue_type" varchar(100),
  "original_destination" text,
  "destination_business_name" varchar(255),
  "destination_type" varchar(50),
  "flip_eligible" boolean DEFAULT false NOT NULL,
  "nearest_our_shop" varchar(255),
  "offer_1_result" varchar(20) DEFAULT 'NOT_ATTEMPTED',
  "offer_2_result" varchar(20) DEFAULT 'NOT_ATTEMPTED',
  "offer_3_result" varchar(20) DEFAULT 'NOT_ATTEMPTED',
  "flip_outcome" varchar(20) DEFAULT 'NOT_ATTEMPTED',
  "new_destination" text,
  "convini_link_sent" boolean DEFAULT false NOT NULL,
  "convini_sell_type" varchar(10),
  "towbook_notes_updated" boolean DEFAULT false NOT NULL,
  "corrections_made" text,
  "call_duration_seconds" integer,
  "call_recording_url" text,
  "transcript" text,
  "management_notified" boolean DEFAULT false NOT NULL,
  "call_time" timestamptz DEFAULT now() NOT NULL
);
