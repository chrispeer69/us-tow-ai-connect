-- Session 73 — recipients for the daily call-review email.
--
-- Deliberately separate from tenants.digest_emails: the ops digest is daily
-- operations for the whole team, this one is "here is what the AI wants to
-- change about the sales script" and goes to whoever owns the script.

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "call_review_emails" jsonb DEFAULT '[]'::jsonb NOT NULL;
