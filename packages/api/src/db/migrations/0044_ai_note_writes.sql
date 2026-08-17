-- Session 76 — audit trail for AI Notes written back into the dispatch system.
--
-- Every attempt gets a row, successful or not, dry run or real. Two reasons this
-- is a table rather than a log line:
--
--   1. The rollout is "dry run for a day, read what it would have written, then
--      enable". That review is only possible if the composed block is stored.
--   2. This writes into a live customer-facing ticket in someone else's system.
--      When a dispatcher asks why a note appeared on a job, the answer has to be
--      reconstructable — which call, which job, what was appended, and whether it
--      was verified present afterwards.
--
-- `outbound_call_logs.towbook_notes_updated` stays as the fast flag; this table
-- is the evidence behind it.

CREATE TABLE IF NOT EXISTS ai_note_writes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Which call produced the note, and which job it was written to. job_id is the
  -- unified_jobs row; source_job_id is the handle in the external system, kept
  -- verbatim because that is what a dispatcher can actually search for.
  outbound_call_id uuid,
  call_log_id uuid,
  job_id uuid,
  source_adapter varchar(32) NOT NULL,
  source_job_id varchar(120) NOT NULL,

  -- 'written' | 'dry_run' | 'already_present' | 'skipped' | 'failed'
  outcome varchar(24) NOT NULL,
  -- Machine-readable detail: identity_mismatch, deferred_users_editing,
  -- not-configured, refused_card_data_in_notes_block, …
  detail text,

  -- The exact block we composed. Never the rest of the field: the surrounding
  -- text is the customer's dispatcher notes and is not ours to copy.
  notes_block text,
  block_chars integer,

  verified boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The idempotency lookup: "have we already written a note for this call?"
CREATE INDEX IF NOT EXISTS ai_note_writes_call_idx
  ON ai_note_writes (outbound_call_id);
CREATE INDEX IF NOT EXISTS ai_note_writes_tenant_attempted_idx
  ON ai_note_writes (tenant_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS ai_note_writes_job_idx
  ON ai_note_writes (tenant_id, source_adapter, source_job_id);
