-- Session 81 — a towing owner asked to speak to Chris.
--
-- Chris, 2026-08-22: "upon call back - write in the script the opportunity to
-- speak with me directly - and have the message forward to me to call them
-- ASAP."
--
-- This is the highest-value event the campaign can produce and it is nothing
-- like a disposition. A disposition describes a call that finished; this is a
-- person waiting for a phone to ring. It gets its own row so it can be alerted
-- on, worked, and closed out — a flag buried in a call log would be read
-- tomorrow, and by then the caller has moved on.

CREATE TABLE IF NOT EXISTS campaign_callback_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  call_id uuid REFERENCES campaign_call_logs(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES campaign_leads(id) ON DELETE SET NULL,

  company text,
  contact_name text,
  phone text NOT NULL,

  -- now | today | this_week | no_preference. "now" is the one that matters:
  -- it means somebody is sitting there expecting a call.
  urgency text NOT NULL DEFAULT 'no_preference',
  preferred_time text,

  -- What the agent heard, written for a person to read before dialling.
  note text,
  transcript text,
  recording_url text,

  -- OPEN until Chris marks it. Nothing auto-closes: a request that ages out
  -- silently is the same as never having captured it.
  status text NOT NULL DEFAULT 'OPEN',
  handled_at timestamptz,
  handled_note text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS callback_requests_open_idx
  ON campaign_callback_requests (tenant_id, status, created_at DESC);

-- One request per call. A webhook retry must not page Chris twice.
CREATE UNIQUE INDEX IF NOT EXISTS callback_requests_call_idx
  ON campaign_callback_requests (call_id) WHERE call_id IS NOT NULL;
