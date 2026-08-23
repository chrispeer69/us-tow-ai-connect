-- Every call that comes IN to the Roadside line.
--
-- There was no record of these anywhere. The 844 agent had no webhook set, so
-- a customer could ring, describe a breakdown, and hang up, and the only trace
-- was in Retell's own dashboard — not queryable, not joinable to a job, and
-- gone from anybody's attention the moment the tab closed.
--
-- That was survivable while the line only handled callbacks. It stops being
-- survivable now that the same line takes a full new-tow intake: Chris wants
-- this "90 percent right most of the time", and you cannot improve the ten per
-- cent you cannot read.

create table if not exists inbound_call_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  provider_call_id text not null,
  agent_id text,
  agent_version text,

  from_number text,
  to_number text,

  /** update | new_tow | motor_club | unknown — which of the three branches ran. */
  branch text not null default 'unknown',

  duration_seconds integer,
  disconnection_reason text,
  transcript text,
  recording_url text,
  summary text,
  /** Raw post-call answers, so a later rule change can re-derive history. */
  analysis jsonb,

  /** Set when the call produced a job in US Tow Dispatch. */
  ustd_job_number text,

  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Retell can redeliver a webhook. One row per call, always.
create unique index if not exists inbound_call_logs_provider_idx
  on inbound_call_logs (provider_call_id);

create index if not exists inbound_call_logs_recent_idx
  on inbound_call_logs (tenant_id, created_at desc);

create index if not exists inbound_call_logs_branch_idx
  on inbound_call_logs (tenant_id, branch, created_at desc);
