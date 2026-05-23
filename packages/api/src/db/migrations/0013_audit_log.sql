-- Session 26 (SaaS Hardening): unified audit log.
-- Every mutating admin / tenant-api / system action lands here. The interceptor
-- auto-captures POST / PUT / PATCH / DELETE against /v1/admin/* and
-- /v1/ai-connect/*; explicit AuditLogService.record() calls can add domain
-- detail that the interceptor doesn't have (e.g. before/after states for an
-- update). `before_state` / `after_state` / `metadata` are sanitized at write
-- time — sensitive keys (password, token, api_key, secret) are redacted.
--
-- Retention is per-tenant (default 365 days) and enforced by
-- AuditLogRetentionService cron; see docs/AUDIT_LOG.md.

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "actor_type" varchar(20) NOT NULL,
  "actor_id" text NOT NULL,
  "action" text NOT NULL,
  "resource_type" text,
  "resource_id" text,
  "before_state" jsonb,
  "after_state" jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_log_tenant_created_idx"
  ON "audit_log" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "audit_log_actor_idx"
  ON "audit_log" ("actor_type", "actor_id");

CREATE INDEX IF NOT EXISTS "audit_log_resource_idx"
  ON "audit_log" ("resource_type", "resource_id");

CREATE INDEX IF NOT EXISTS "audit_log_action_idx"
  ON "audit_log" ("action", "created_at" DESC);
