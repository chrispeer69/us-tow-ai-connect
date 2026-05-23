-- Session 22 (Digital Dispatch): rules engine + decision audit trail.
-- Adds auto_decision* columns to unified_jobs so the latest engine outcome
-- is queryable without joining decisions. Decision rows still hold the
-- per-evaluation history.

ALTER TABLE "unified_jobs"
  ADD COLUMN IF NOT EXISTS "auto_decision" varchar(20);

ALTER TABLE "unified_jobs"
  ADD COLUMN IF NOT EXISTS "auto_decision_reason" text;

ALTER TABLE "unified_jobs"
  ADD COLUMN IF NOT EXISTS "auto_decided_at" timestamptz;

CREATE TABLE IF NOT EXISTS "dispatch_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "action" varchar(20) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "dispatch_rules_tenant_priority_idx"
  ON "dispatch_rules" ("tenant_id", "priority");

CREATE TABLE IF NOT EXISTS "dispatch_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "unified_jobs"("id") ON DELETE CASCADE,
  "rule_id" uuid REFERENCES "dispatch_rules"("id") ON DELETE SET NULL,
  "decision" varchar(20) NOT NULL,
  "reason" text,
  "evaluated_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "decided_at" timestamptz DEFAULT now() NOT NULL,
  "decided_by" varchar(10) DEFAULT 'ai' NOT NULL
);

CREATE INDEX IF NOT EXISTS "dispatch_decisions_job_idx"
  ON "dispatch_decisions" ("job_id");

CREATE INDEX IF NOT EXISTS "dispatch_decisions_rule_idx"
  ON "dispatch_decisions" ("rule_id");

CREATE INDEX IF NOT EXISTS "dispatch_decisions_decided_at_idx"
  ON "dispatch_decisions" ("decided_at" DESC);
