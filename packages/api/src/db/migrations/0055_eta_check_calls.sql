-- Every time a customer rings in asking where their truck is.
--
-- Chris, 2026-08-23: "notify the office this person on this job called for an
-- eta - provide an alert so we can monitor that call".
--
-- The value is not the single call, it is the SECOND one. A customer who rings
-- twice about the same job is about to become a complaint, and today that fact
-- exists nowhere — Emily answers, the caller hangs up, and the office never
-- learns it happened. So this is one row per (job, caller) with a counter,
-- rather than one row per call: "called 3 times, last 6 minutes ago" is the
-- sentence somebody needs to read, and it does not survive being spread over
-- three rows.

create table if not exists eta_check_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  -- Identity of the job as the dispatch board knows it. No FK: the job lives in
  -- Towbook, not here, and the scraped cache is the only copy we ever see.
  job_id text not null,
  source text not null default 'TOWBOOK',

  customer_name text,
  customer_phone text not null,
  vehicle text,
  driver_name text,
  pickup text,
  destination text,
  job_status text,

  -- The raw board string, stored exactly as scraped and NEVER read to a caller.
  -- It arrives like "12:55 AM (5 hrs 54 mins late)". It is here so the office
  -- can see the lateness the customer was not told about.
  eta_raw text,

  calls integer not null default 1,
  first_called_at timestamptz not null default now(),
  last_called_at timestamptz not null default now(),

  notified_at timestamptz,
  towbook_note_at timestamptz,

  handled_at timestamptz,
  handled_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open row per caller per job. Partial on handled_at so that once the
-- office clears it, a later call opens a fresh row instead of resurrecting a
-- closed one — a call after a resolution is a new problem, not the old one.
create unique index if not exists eta_check_calls_open_idx
  on eta_check_calls (tenant_id, job_id, customer_phone)
  where handled_at is null;

create index if not exists eta_check_calls_recent_idx
  on eta_check_calls (tenant_id, last_called_at desc);
