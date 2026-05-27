-- Session 68 — Retell outbound voice client.
--
-- Adds `retell_call_id` alongside the existing `thinkrr_call_id` column
-- so the outbound_calls table can record calls placed via either provider.
-- The OutboundVoiceService picks a provider at dispatch time via
-- OUTBOUND_VOICE_PROVIDER env var ("retell" | "thinkrr", default "retell"
-- when RETELL_API_KEY is set).
--
-- Both id columns coexist by design — rollback to thinkrr is a single
-- env-flag flip with zero data migration.

ALTER TABLE outbound_calls
  ADD COLUMN IF NOT EXISTS retell_call_id text;

CREATE INDEX IF NOT EXISTS outbound_calls_retell_call_id_idx
  ON outbound_calls (retell_call_id)
  WHERE retell_call_id IS NOT NULL;

-- New `provider` column so future-us can answer "which vendor handled this call"
-- at a glance instead of inferring from which *_call_id column is populated.
-- Existing rows are backfilled to 'thinkrr' since that was the only path before S68.
ALTER TABLE outbound_calls
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'thinkrr';

CREATE INDEX IF NOT EXISTS outbound_calls_provider_idx
  ON outbound_calls (provider);
