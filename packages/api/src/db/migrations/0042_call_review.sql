-- Session 73 — storage for the daily call-review loop. Depends on 0041.

-- One row per daily analyst run. Keeps the funnel snapshot alongside the
-- narrative so a recommendation can always be traced to the numbers that
-- motivated it.
CREATE TABLE IF NOT EXISTS "call_review_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"review_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'RUNNING' NOT NULL,
	"calls_considered" integer DEFAULT 0 NOT NULL,
	"calls_analyzed" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"eligible" integer DEFAULT 0 NOT NULL,
	"never_pitched" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"defects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" varchar(60),
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "call_review_runs" ADD CONSTRAINT "call_review_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "call_review_runs_tenant_date_uniq" ON "call_review_runs" ("tenant_id", "review_date");--> statement-breakpoint

-- Proposed script edits. The agent only ever writes rows here with status
-- PROPOSED — nothing reaches a live call until a human moves it to APPROVED
-- and it is promoted into a variant.
CREATE TABLE IF NOT EXISTS "script_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid,
	"scenario" varchar(40),
	"target" varchar(60) NOT NULL,
	"title" varchar(255) NOT NULL,
	"problem" text NOT NULL,
	"proposed_text" text,
	"current_text" text,
	"rationale" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kind" varchar(20) DEFAULT 'WORDING' NOT NULL,
	"confidence" varchar(10) DEFAULT 'MEDIUM' NOT NULL,
	"expected_lift" varchar(60),
	"status" varchar(20) DEFAULT 'PROPOSED' NOT NULL,
	"reviewed_by" varchar(255),
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "script_recommendations" ADD CONSTRAINT "script_recommendations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "script_recommendations" ADD CONSTRAINT "script_recommendations_run_id_call_review_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."call_review_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "script_recommendations_tenant_status_idx" ON "script_recommendations" ("tenant_id", "status", "created_at");
