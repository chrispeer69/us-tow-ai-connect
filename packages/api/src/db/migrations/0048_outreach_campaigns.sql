-- Session 78 — Outreach campaigns: a second kind of outbound call.
--
-- Chris, 2026-08-20: US Tow Alliance needs a daily outbound campaign to towing
-- companies inviting them to claim a free profile, run as its own vendor inside
-- the Command Center so the conversations can be read and listened to.
--
-- WHY NOT `outbound_call_logs`. That table is a tow job: motor_club, vehicle,
-- issue_type, original_destination, flip_eligible, offer_1_result. An outreach
-- call has none of them. Pouring hundreds of 30-second campaign calls into it
-- would leave every one of those columns null and — worse — would land them in
-- the same population the flip win-rate is measured over. The flip numbers are
-- already hard enough to read (see the 2026-08-20 review: DECLINED had been
-- structurally unreachable for eight days). A campaign call is a different
-- object with a different lifecycle, so it gets its own table.
--
-- WHAT IS SHARED: the tenant, the login, the Retell webhook plumbing, and the
-- transcript/recording viewer. That is the whole reason this lives in Command
-- Center rather than in a standalone tool.

-- ---------------------------------------------------------------------------
-- campaigns — one row per calling programme, per tenant.
-- ---------------------------------------------------------------------------
-- Config lives in the row, not in env vars, because Chris changes concurrency
-- and the daily cap from the UI and a Railway variable change needs a redeploy
-- that currently takes 20-25 minutes to land.
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name text NOT NULL,
  slug text NOT NULL,

  -- OFF is the safe default and it is deliberate: a campaign that exists is not
  -- a campaign that dials. Nothing goes out until this is set to ACTIVE.
  status text NOT NULL DEFAULT 'OFF',          -- OFF | ACTIVE | PAUSED

  -- Retell wiring. Outbound and inbound are DIFFERENT agents on the SAME
  -- number: max_call_duration_ms is an agent-level setting in Retell, and the
  -- spec wants 60s outbound / 90s inbound. One agent cannot hold both caps.
  -- The account already works this way — +18447011345 pairs an inbound Emily
  -- with the outbound one.
  outbound_agent_id text,
  outbound_agent_version text,
  inbound_agent_id text,
  inbound_agent_version text,
  from_number text,                             -- E.164 caller ID

  -- Pacing. All config-driven so the numbers can be raised without a deploy.
  concurrency integer NOT NULL DEFAULT 10,
  daily_cap integer NOT NULL DEFAULT 500,
  max_attempts integer NOT NULL DEFAULT 2,
  max_call_duration_ms integer NOT NULL DEFAULT 60000,

  -- Calling window, LOCAL TO THE NUMBER'S AREA CODE (not to the server, and
  -- not to the tenant). A 9am-5pm window means 9am where the phone rings.
  call_window_start_hour integer NOT NULL DEFAULT 9,
  call_window_end_hour   integer NOT NULL DEFAULT 17,
  call_days jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,   -- ISO: 1=Mon..7=Sun

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_tenant_slug_idx
  ON campaigns (tenant_id, slug);

-- ---------------------------------------------------------------------------
-- campaign_suppressions — permanent do-not-call. Never expires, never deleted.
-- ---------------------------------------------------------------------------
-- SEPARATE FROM THE LEAD ON PURPOSE. If suppression were a lead status, then
-- deleting, re-importing or re-scoring a lead would silently resurrect a number
-- someone asked us to stop calling. The suppression outlives the lead, and the
-- dialler checks this table, not the lead row.
CREATE TABLE IF NOT EXISTS campaign_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone text NOT NULL,                          -- E.164
  reason text,                                  -- verbal_opt_out | manual | complaint
  source_call_id uuid,                          -- the call where they asked
  quote text,                                   -- what they actually said
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tenant-scoped uniqueness: the same number may be suppressed for one vendor
-- without muting it for another.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_suppressions_tenant_phone_idx
  ON campaign_suppressions (tenant_id, phone);

-- ---------------------------------------------------------------------------
-- campaign_leads — the queue.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  phone text NOT NULL,                          -- E.164, normalized at ingest
  company text,
  contact_name text,
  state text,
  city text,
  area_code text,

  -- Resolved once at ingest from the area code. Stored rather than computed per
  -- dial so the window query stays a plain indexed filter.
  timezone text,

  -- Carrier type where we can tell. Tow operators very often run the business
  -- off a mobile, and a mobile carries more exposure than a landline — the
  -- ingest flags what it can and the dialler can be told to skip them.
  line_type text,                               -- landline | mobile | voip | unknown

  status text NOT NULL DEFAULT 'QUEUED',
  -- QUEUED     — eligible to dial
  -- CALLING    — a dial is in flight (claimed; prevents double-dialling)
  -- PITCHED    — human answered and heard the pitch
  -- VM         — voicemail left
  -- RETRY      — no answer / busy, attempts remain
  -- WARM       — said they would claim it. Flagged for Chris, NOT auto-removed.
  -- ACCEPTED   — profile claimed. Removed from the dialling pool.
  -- DNC        — opted out. Suppressed permanently.
  -- EXHAUSTED  — max_attempts reached with no contact
  -- INVALID    — unusable number

  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_eligible_at timestamptz,

  source text,                                  -- csv | registry | manual
  external_ref text,                            -- e.g. the Alliance company id
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per number per campaign. Re-importing the same list is a no-op
-- rather than a way to dial someone twice in a morning.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_leads_campaign_phone_idx
  ON campaign_leads (campaign_id, phone);

-- The dialler's hot path: "what is dialable for this campaign right now".
CREATE INDEX IF NOT EXISTS campaign_leads_dialable_idx
  ON campaign_leads (campaign_id, status, next_eligible_at);

CREATE INDEX IF NOT EXISTS campaign_leads_tenant_status_idx
  ON campaign_leads (tenant_id, status);

-- ---------------------------------------------------------------------------
-- campaign_call_logs — one row per ATTEMPT, not per lead.
-- ---------------------------------------------------------------------------
-- This is the table Chris reads and listens to. Transcript and recording_url
-- are the whole point of putting the campaign in Command Center.
CREATE TABLE IF NOT EXISTS campaign_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES campaign_leads(id) ON DELETE SET NULL,

  direction text NOT NULL DEFAULT 'OUTBOUND',   -- OUTBOUND | INBOUND
  phone text NOT NULL,
  company text,

  -- Retell's id. Nullable because the row is written BEFORE the provider call
  -- is placed — otherwise a crash between insert and dial loses the attempt.
  provider_call_id text,
  agent_id text,
  agent_version text,

  status text NOT NULL DEFAULT 'PENDING',       -- PENDING|IN_PROGRESS|COMPLETED|FAILED|NO_ANSWER|BUSY
  disposition text,                             -- PITCHED|VM|RETRY|DNC|WARM|GATEKEEPER|NOT_INTERESTED|ERROR
  disconnection_reason text,

  duration_seconds integer,
  transcript text,
  recording_url text,
  summary text,
  sentiment text,

  -- The agent's structured post-call answers, kept raw. Auto-disposition reads
  -- from this; keeping the whole object means a later rule change can be
  -- re-derived over history instead of needing the calls re-run.
  analysis jsonb,

  -- Gatekeeper path: the owner's best callback time, captured and logged.
  callback_time text,

  error text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_call_logs_provider_call_idx
  ON campaign_call_logs (provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS campaign_call_logs_tenant_time_idx
  ON campaign_call_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS campaign_call_logs_campaign_time_idx
  ON campaign_call_logs (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS campaign_call_logs_lead_idx
  ON campaign_call_logs (lead_id);

-- Counting today's dials against daily_cap, and the status rollup.
CREATE INDEX IF NOT EXISTS campaign_call_logs_disposition_idx
  ON campaign_call_logs (campaign_id, disposition, created_at DESC);
