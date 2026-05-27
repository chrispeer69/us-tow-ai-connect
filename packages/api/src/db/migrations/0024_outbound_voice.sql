-- Session 49 — Outbound voice orchestrator.
--
-- Mirrors the SMS audit pattern (sms_messages from migration 0009 / schema.ts
-- L608) for voice calls placed via the Thinkrr outbound agent. Tenant-scoped,
-- opt-in per call type, full audit trail with transcript + recording.
--
-- All DDL is additive and uses IF NOT EXISTS guards so re-applying the
-- migration on an already-migrated environment is a no-op.

-- 1. Tenant additive flags. The Knowledge Pack v2 column pattern (jsonb config
--    with a top-level boolean enable flag) is reused here so that operators
--    can adjust dispatch cadence, consent-handling, and per-purpose toggles
--    without further schema changes.
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "outbound_voice_enabled"  boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "outbound_voice_config"   jsonb   NOT NULL DEFAULT '{}'::jsonb;

-- 2. Outbound calls audit table.
CREATE TABLE IF NOT EXISTS "outbound_calls" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,

  "purpose"            varchar(40)  NOT NULL,
  "related_job_id"     uuid,

  "to_phone"           varchar(20)  NOT NULL,
  "to_name"            varchar(120),

  "script_template"    varchar(60)  NOT NULL,
  "script_variables"   jsonb        NOT NULL DEFAULT '{}'::jsonb,

  "thinkrr_call_id"    varchar(120) UNIQUE,

  "status"             varchar(20)  NOT NULL DEFAULT 'queued',
  "attempts"           integer      NOT NULL DEFAULT 0,
  "max_attempts"       integer      NOT NULL DEFAULT 3,

  "scheduled_for"      timestamptz,
  "started_at"         timestamptz,
  "ended_at"           timestamptz,
  "duration_seconds"   integer,

  "transcript"         text,
  "recording_url"      text,
  "outcome"            jsonb,
  "error"              text,

  "created_at"         timestamptz  NOT NULL DEFAULT now(),
  "updated_at"         timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT "outbound_calls_purpose_check" CHECK (
    "purpose" IN (
      'customer_status_update',
      'eta_confirmation',
      'post_job_followup',
      'driver_escalation',
      'motor_club_update',
      'custom'
    )
  ),
  CONSTRAINT "outbound_calls_status_check" CHECK (
    "status" IN (
      'queued',
      'dialing',
      'in_progress',
      'completed',
      'failed',
      'no_answer',
      'busy',
      'rejected',
      'cancelled'
    )
  )
);

CREATE INDEX IF NOT EXISTS "outbound_calls_tenant_status_idx"
  ON "outbound_calls" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "outbound_calls_scheduled_for_idx"
  ON "outbound_calls" ("scheduled_for")
  WHERE "scheduled_for" IS NOT NULL;

-- thinkrr_call_id already has UNIQUE; an explicit lookup index helps the
-- webhook handler dedupe quickly.
CREATE INDEX IF NOT EXISTS "outbound_calls_thinkrr_call_id_idx"
  ON "outbound_calls" ("thinkrr_call_id")
  WHERE "thinkrr_call_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "outbound_calls_tenant_created_idx"
  ON "outbound_calls" ("tenant_id", "created_at" DESC);

-- updated_at autotouch trigger pattern — match the convention used by other
-- modules (e.g. tenant_credentials) and let app-level updates set it
-- explicitly. Postgres-level trigger left out intentionally to avoid action
-- at a distance during tests.
