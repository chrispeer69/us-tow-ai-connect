-- Outbound A/B: slim script + Gemini 3.6 Flash vs legacy v61 (2026-10-10).
--
-- ab_arm on the call log says which arm produced the call ('slim_gemini' |
-- 'legacy'; NULL = before the A/B). outbound_call_id links the log row to the
-- logical outbound call, so per-arm cost, tokens and latency join exactly
-- instead of by phone number and time. Latency comes from Retell's
-- call.latency.e2e (milliseconds) on the post-call webhook.
ALTER TABLE outbound_call_logs ADD COLUMN IF NOT EXISTS ab_arm varchar(20);
ALTER TABLE outbound_call_logs ADD COLUMN IF NOT EXISTS outbound_call_id uuid;
CREATE INDEX IF NOT EXISTS outbound_call_logs_ab_arm_idx
  ON outbound_call_logs (tenant_id, ab_arm, call_time DESC)
  WHERE ab_arm IS NOT NULL;

ALTER TABLE retell_call_usage ADD COLUMN IF NOT EXISTS latency_p50_ms integer;
ALTER TABLE retell_call_usage ADD COLUMN IF NOT EXISTS latency_p95_ms integer;
