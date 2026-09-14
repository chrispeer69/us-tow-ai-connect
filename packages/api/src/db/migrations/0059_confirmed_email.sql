-- 3.14 (2026-09-14) — the customer's email as given on the AI call.
--
-- Chris: "I want her to ask the customer what their email is — and I want her
-- to add that to the AI notes inside Towbook and also inside US Tow Dispatch."
--
-- Script 3.14 asks for it right after the name (STEP 2c), the Retell agent
-- emits it as customer_email (agent v55), and the analysis path stores it here
-- before pushing it to the Towbook AI note (EMAIL line) and the US Tow Dispatch
-- customer record. Null when the customer had none, declined, or the step was
-- never reached.

ALTER TABLE outbound_call_logs
  ADD COLUMN IF NOT EXISTS confirmed_email text;
