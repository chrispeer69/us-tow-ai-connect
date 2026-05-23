-- Adds an evidence trail to dispatch_decisions so a row can record that the
-- accept/decline action actually landed in the source portal (toast text /
-- status change) and when. Nullable + additive — safe and idempotent.
ALTER TABLE "dispatch_decisions"
  ADD COLUMN IF NOT EXISTS "confirmation_evidence" text,
  ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;
