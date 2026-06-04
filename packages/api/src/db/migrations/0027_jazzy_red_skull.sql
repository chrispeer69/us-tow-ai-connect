CREATE TABLE IF NOT EXISTS "aaa_branded_blocklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"match_type" varchar(20) NOT NULL,
	"match_value" varchar(255) NOT NULL,
	"label" varchar(180) NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"added_by" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_agent_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"greeting_message" text DEFAULT 'Thank you for calling.' NOT NULL,
	"service_toggles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_eta_mins" integer DEFAULT 45 NOT NULL,
	"impound_enabled" boolean DEFAULT false NOT NULL,
	"knowledge_pack" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alpha_shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(180) NOT NULL,
	"shop_type" varchar(20) NOT NULL,
	"address_line" varchar(255) NOT NULL,
	"city" varchar(100) NOT NULL,
	"state" varchar(2) NOT NULL,
	"postal_code" varchar(20) NOT NULL,
	"lat" numeric(10, 6),
	"lng" numeric(10, 6),
	"phone" varchar(20),
	"website" text,
	"rental_pickup_available" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_key_usage_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"api_key_id" uuid,
	"identifier" text NOT NULL,
	"endpoint_group" varchar(20) NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"throttled_count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_type" varchar(20) NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"stripe_event_id" varchar(255) NOT NULL,
	"type" varchar(100) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "call_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
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
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_interactions_call_id_unique" UNIQUE("call_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "convini_incoming_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"convini_id" varchar(120),
	"raw_body" text NOT NULL,
	"parsed_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"error_message" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dispatch_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"rule_id" uuid,
	"decision" varchar(20) NOT NULL,
	"reason" text,
	"evaluated_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" varchar(10) DEFAULT 'ai' NOT NULL,
	"confirmation_evidence" text,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dispatch_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dispatch_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"driver_phone" varchar(20) NOT NULL,
	"job_id" uuid,
	"event_type" varchar(20) NOT NULL,
	"notes" text,
	"lat" numeric(10, 6),
	"lng" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_pings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"driver_phone" varchar(20) NOT NULL,
	"driver_name" varchar(120),
	"lat" numeric(10, 6) NOT NULL,
	"lng" numeric(10, 6) NOT NULL,
	"heading" numeric(5, 2),
	"speed_mph" numeric(5, 2),
	"accuracy_m" numeric(8, 2),
	"battery_pct" integer,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"driver_phone" varchar(20) NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh_key" text NOT NULL,
	"auth_key" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(20),
	"status" varchar(20) DEFAULT 'off_duty' NOT NULL,
	"current_lat" numeric(10, 6),
	"current_lng" numeric(10, 6),
	"last_ping_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"to_address" text NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"html_body" text,
	"text_body" text,
	"sendgrid_message_id" text,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"related_kind" varchar(40),
	"related_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flip_accept_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_adapter" text NOT NULL,
	"source_job_id" text NOT NULL,
	"job_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approver_phone" text,
	"approver_response" text,
	"approval_notes" text,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interaction_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thinkrr_call_id" varchar(100) NOT NULL,
	"caller_phone" varchar(20) NOT NULL,
	"category" varchar(50) NOT NULL,
	"summary" text,
	"outcome" varchar(100) NOT NULL,
	"duration_seconds" integer NOT NULL,
	"latency_ms" integer,
	"interaction_time" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255),
	"form_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"client_ip" varchar(64),
	"partner_account_id" varchar(120),
	"expires_at" timestamp with time zone NOT NULL,
	"completed_tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
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
	"call_time" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" varchar(40) NOT NULL,
	"related_job_id" uuid,
	"to_phone" varchar(20) NOT NULL,
	"to_name" varchar(120),
	"script_template" varchar(60) NOT NULL,
	"script_variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thinkrr_call_id" varchar(120),
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"transcript" text,
	"recording_url" text,
	"outcome" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"role" varchar(20) NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_permission_key_pk" PRIMARY KEY("role","permission_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_name" varchar(100) NOT NULL,
	"phone_number" varchar(20) NOT NULL,
	"is_active_now" boolean DEFAULT false NOT NULL,
	"priority_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "smart_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action_type" varchar(60) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"result" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"to_phone" text NOT NULL,
	"from_phone" text NOT NULL,
	"body" text NOT NULL,
	"twilio_sid" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"related_tracking_link_id" uuid,
	"related_flip_request_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "tenant_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_billing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan" varchar(20) DEFAULT 'TRIAL' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"stripe_customer_id" varchar(100),
	"stripe_subscription_id" varchar(100),
	"credit_balance" integer DEFAULT 0 NOT NULL,
	"per_job_billing" boolean DEFAULT false NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"username_encrypted" text NOT NULL,
	"username_hash" varchar(255),
	"password_encrypted" text NOT NULL,
	"encryption_iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"session_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"last_login_success" timestamp with time zone,
	"failure_reason" text,
	"failure_kind" varchar(40),
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"last_failure_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_credentials_username_hash_unique" UNIQUE("username_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_knowledge_pack" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"last_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_knowledge_pack_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"role" varchar(20) DEFAULT 'VIEWER' NOT NULL,
	"status" varchar(20) DEFAULT 'INVITED' NOT NULL,
	"invited_by" varchar(255),
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"invite_token" varchar(255),
	"invite_token_expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"owner_id" uuid,
	"owner_email" varchar(255) NOT NULL,
	"timezone" varchar(50) DEFAULT 'America/New_York' NOT NULL,
	"target_software_type" varchar(50) NOT NULL,
	"api_key_hash" varchar(255) NOT NULL,
	"api_key_prefix" varchar(16) NOT NULL,
	"thinkrr_agent_id" varchar(100),
	"assigned_phone_number" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"manager_phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sms_enabled" boolean DEFAULT true NOT NULL,
	"tracking_url_base" text DEFAULT 'https://ustowapi-production.up.railway.app/track' NOT NULL,
	"digest_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"digest_frequency" varchar(10) DEFAULT 'daily' NOT NULL,
	"allowed_admin_ips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audit_retention_days" integer DEFAULT 365 NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"partner_account_id" varchar(120),
	"billing_blocked" boolean DEFAULT false NOT NULL,
	"outbound_voice_enabled" boolean DEFAULT false NOT NULL,
	"outbound_voice_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flip_engine_enabled" boolean DEFAULT false NOT NULL,
	"flip_engine_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracking_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token" text NOT NULL,
	"caller_phone" text NOT NULL,
	"caller_name" text,
	"job_id" uuid,
	"pickup_lat" numeric(10, 7),
	"pickup_lng" numeric(10, 7),
	"status" text DEFAULT 'created' NOT NULL,
	"assigned_driver_phone" text,
	"assigned_driver_name" text,
	"last_eta_minutes" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"type" varchar(20) DEFAULT 'medium' NOT NULL,
	"status" varchar(20) DEFAULT 'available' NOT NULL,
	"assigned_driver_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unified_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"source_job_id" varchar(120) NOT NULL,
	"source_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"caller_phone" varchar(20),
	"caller_name" varchar(255),
	"vehicle_year" varchar(10),
	"vehicle_make" varchar(60),
	"vehicle_model" varchar(60),
	"vehicle_color" varchar(40),
	"pickup_address" text,
	"pickup_lat" numeric(10, 6),
	"pickup_lng" numeric(10, 6),
	"dropoff_address" text,
	"dropoff_lat" numeric(10, 6),
	"dropoff_lng" numeric(10, 6),
	"service_type" varchar(60),
	"priority" varchar(10) DEFAULT 'normal' NOT NULL,
	"assigned_driver_id" uuid,
	"assigned_truck_id" uuid,
	"eta_minutes" integer,
	"accepted_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"auto_decision" varchar(20),
	"auto_decision_reason" text,
	"auto_decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"google_id" varchar(255),
	"name" varchar(255),
	"platform_role" varchar(20) DEFAULT 'tenant_user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "aaa_branded_blocklist" ADD CONSTRAINT "aaa_branded_blocklist_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_agent_configs" ADD CONSTRAINT "ai_agent_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alpha_shops" ADD CONSTRAINT "alpha_shops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_key_usage_stats" ADD CONSTRAINT "api_key_usage_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_key_usage_stats" ADD CONSTRAINT "api_key_usage_stats_api_key_id_tenant_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."tenant_api_keys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_interactions" ADD CONSTRAINT "call_interactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "convini_incoming_jobs" ADD CONSTRAINT "convini_incoming_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dispatch_decisions" ADD CONSTRAINT "dispatch_decisions_job_id_unified_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."unified_jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dispatch_decisions" ADD CONSTRAINT "dispatch_decisions_rule_id_dispatch_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."dispatch_rules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dispatch_requests" ADD CONSTRAINT "dispatch_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dispatch_rules" ADD CONSTRAINT "dispatch_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_job_events" ADD CONSTRAINT "driver_job_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_pings" ADD CONSTRAINT "driver_pings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_push_subscriptions" ADD CONSTRAINT "driver_push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drivers" ADD CONSTRAINT "drivers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flip_accept_requests" ADD CONSTRAINT "flip_accept_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interaction_logs" ADD CONSTRAINT "interaction_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_unified_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."unified_jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_call_logs" ADD CONSTRAINT "outbound_call_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_calls" ADD CONSTRAINT "outbound_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "smart_actions" ADD CONSTRAINT "smart_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_billing" ADD CONSTRAINT "tenant_billing_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_credentials" ADD CONSTRAINT "tenant_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_knowledge_pack" ADD CONSTRAINT "tenant_knowledge_pack_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trucks" ADD CONSTRAINT "trucks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unified_jobs" ADD CONSTRAINT "unified_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aaa_branded_blocklist_tenant_active_idx" ON "aaa_branded_blocklist" ("tenant_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aaa_branded_blocklist_match_idx" ON "aaa_branded_blocklist" ("match_type","match_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alpha_shops_tenant_active_idx" ON "alpha_shops" ("tenant_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alpha_shops_tenant_type_idx" ON "alpha_shops" ("tenant_id","shop_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_key_usage_stats_window_uniq" ON "api_key_usage_stats" ("identifier","endpoint_group","window_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_key_usage_stats_tenant_window_idx" ON "api_key_usage_stats" ("tenant_id","window_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_key_usage_stats_window_idx" ON "api_key_usage_stats" ("window_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_tenant_created_idx" ON "audit_log" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_actor_idx" ON "audit_log" ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_resource_idx" ON "audit_log" ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON "audit_log" ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_events_stripe_event_id_uniq" ON "billing_events" ("stripe_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_events_tenant_idx" ON "billing_events" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "convini_incoming_jobs_tenant_status_idx" ON "convini_incoming_jobs" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "convini_incoming_jobs_convini_id_idx" ON "convini_incoming_jobs" ("tenant_id","convini_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispatch_decisions_job_idx" ON "dispatch_decisions" ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispatch_rules_tenant_priority_idx" ON "dispatch_rules" ("tenant_id","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_job_events_tenant_driver_created_idx" ON "driver_job_events" ("tenant_id","driver_phone","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_job_events_tenant_job_idx" ON "driver_job_events" ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_pings_tenant_phone_recorded_idx" ON "driver_pings" ("tenant_id","driver_phone","recorded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_pings_tenant_recorded_idx" ON "driver_pings" ("tenant_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "driver_push_subs_endpoint_uniq" ON "driver_push_subscriptions" ("tenant_id","endpoint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_push_subs_tenant_phone_idx" ON "driver_push_subscriptions" ("tenant_id","driver_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_messages_tenant_created_idx" ON "email_messages" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_messages_status_idx" ON "email_messages" ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flip_accept_requests_tenant_status_idx" ON "flip_accept_requests" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flip_accept_requests_source_idx" ON "flip_accept_requests" ("source_adapter","source_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flip_accept_requests_status_expires_idx" ON "flip_accept_requests" ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_events_job_created_idx" ON "job_events" ("job_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_drafts_email_idx" ON "onboarding_drafts" ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_drafts_status_idx" ON "onboarding_drafts" ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_drafts_partner_idx" ON "onboarding_drafts" ("partner_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_calls_tenant_status_idx" ON "outbound_calls" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_calls_scheduled_for_idx" ON "outbound_calls" ("scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_calls_thinkrr_call_id_uniq" ON "outbound_calls" ("thinkrr_call_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_calls_tenant_created_idx" ON "outbound_calls" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_tenant_created_idx" ON "sms_messages" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_twilio_sid_idx" ON "sms_messages" ("twilio_sid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_links_token_idx" ON "tracking_links" ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_links_tenant_status_idx" ON "tracking_links" ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unified_jobs_source_uniq" ON "unified_jobs" ("tenant_id","source","source_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unified_jobs_tenant_status_idx" ON "unified_jobs" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unified_jobs_tenant_driver_idx" ON "unified_jobs" ("tenant_id","assigned_driver_id");