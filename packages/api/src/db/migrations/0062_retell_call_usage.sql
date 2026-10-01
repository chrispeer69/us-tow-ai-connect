-- Retell bills each physical dial attempt, while outbound_calls represents a
-- logical call and is reused by retry logic. Keep immutable per-attempt usage
-- here so daily cost and token reporting remains accurate and idempotent.
CREATE TABLE IF NOT EXISTS retell_call_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outbound_call_id uuid NOT NULL REFERENCES outbound_calls(id) ON DELETE CASCADE,
  retell_call_id text NOT NULL UNIQUE,
  status varchar(30),
  agent_id text,
  agent_version varchar(80),
  duration_seconds integer,
  combined_cost_cents numeric(14,4),
  cost_breakdown jsonb,
  llm_average_tokens numeric(14,2),
  llm_request_count integer,
  llm_token_values jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retell_call_usage_tenant_created_idx
  ON retell_call_usage (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS retell_call_usage_outbound_call_idx
  ON retell_call_usage (outbound_call_id);
