-- A message Emily takes for dispatch instead of transferring the caller.
--
-- Chris, 2026-08-23: "can you make this a message board where emily can pass on
-- the message to dispatch".
--
-- The problem this solves is visible in the first live intake call: the caller
-- gave a complete, correct tow intake and then mentioned a Convini membership.
-- Emily had nowhere to put that one fact, so she cold-transferred — and the
-- whole intake went with her. Everything she had learned was lost because the
-- only two moves she had were "answer it myself" and "hand the call away".
--
-- This is the third move. She finishes what she can, writes down what she
-- cannot answer, and the office reads it on the board without a live call
-- having to be held open. One row per message; unlike eta_check_calls there is
-- no counter, because two separate questions are two separate messages.

create table if not exists dispatch_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  -- The Retell call the message was taken on. Unique per tenant so a tool
  -- retry inside one call updates the message rather than posting it twice.
  provider_call_id text,

  caller_name text,
  caller_phone text not null,

  -- Set only when the message is about a job we already know about. The job
  -- lives in Towbook/USTD, so no FK — this is the number the office types in.
  job_number text,

  -- What the message is ABOUT, so the board can sort by who is bleeding.
  -- Free text rather than an enum: Emily will meet subjects nobody has thought
  -- of yet, and a rejected insert loses a customer's message.
  topic text not null default 'other',

  -- 'urgent' means somebody is stranded, unsafe, or already angry.
  urgency text not null default 'normal',

  -- The message itself, in the caller's terms. This is the whole point of the
  -- row and it is never empty.
  message text not null,

  -- Whether the caller is expecting to be rung back, and when suits them.
  callback_requested boolean not null default true,
  callback_window text,

  handled_at timestamptz,
  handled_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotency for the tool call. Partial, because provider_call_id is null for
-- anything typed in by hand and nulls must not collide with each other.
create unique index if not exists dispatch_messages_call_idx
  on dispatch_messages (tenant_id, provider_call_id)
  where provider_call_id is not null;

-- The board reads open messages, urgent first, newest first.
create index if not exists dispatch_messages_open_idx
  on dispatch_messages (tenant_id, created_at desc)
  where handled_at is null;
