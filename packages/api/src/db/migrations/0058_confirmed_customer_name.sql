-- 3.13 (2026-09-10) — the customer's name as confirmed on the AI call.
--
-- Chris: "ensure the customer name, first and last, are confirmed and
-- completed on each job when we call and confirm details — and then that needs
-- put in the first name block and the last name block".
--
-- The confirm-details step now asks for or confirms both names (script 3.13),
-- the Retell agent emits them as customer_first_name / customer_last_name
-- (agent v55), and the analysis path stores them here before pushing them to
-- unified_jobs.caller_name, the Roadside GHL contact's first/last blocks, and
-- the Towbook AI note. Free text, exactly as the customer gave them; null when
-- the question was never reached or the customer declined.

ALTER TABLE outbound_call_logs
  ADD COLUMN IF NOT EXISTS confirmed_first_name text,
  ADD COLUMN IF NOT EXISTS confirmed_last_name text;
