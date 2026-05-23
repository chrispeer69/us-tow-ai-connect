-- Session 27 — Multi-Tenant Readiness (Bundle C), Section 1
-- ============================================================
-- Adds the `onboarding_drafts` table — server-side state for the public
-- 4-step wizard. Caller round-trips form data via the `id` so an
-- abandoned tab can be picked back up.
--
-- `audit_log` is intentionally NOT created here — Bundle B (Session 26)
-- ships a richer version (actor_type / actor_id / action / resource_type
-- / resource_id / before_state / after_state / metadata) in
-- 0013_audit_log.sql. Session 27 features write through that schema.

CREATE TABLE IF NOT EXISTS "onboarding_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(255),
  "form_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "current_step" integer NOT NULL DEFAULT 1,
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "client_ip" varchar(64),
  "partner_account_id" varchar(120),
  "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  "completed_tenant_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "onboarding_drafts_email_idx"
  ON "onboarding_drafts" ("email");

CREATE INDEX IF NOT EXISTS "onboarding_drafts_status_idx"
  ON "onboarding_drafts" ("status", "expires_at");

CREATE INDEX IF NOT EXISTS "onboarding_drafts_partner_idx"
  ON "onboarding_drafts" ("partner_account_id");
