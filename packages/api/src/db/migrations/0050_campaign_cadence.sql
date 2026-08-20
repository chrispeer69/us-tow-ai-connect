-- Session 79 — a calling cadence, not a retry loop.
--
-- Chris, 2026-08-20: "truth is we will need to call same numbers several times
-- before the name sticks."
--
-- He is right, and the first batch supports it: 74 calls, ZERO opt-outs. Nobody
-- is annoyed yet, so there is real headroom for repeat contact. Almost nobody
-- claims anything from a first call by a name they have never heard.
--
-- But two things have to be true or repetition builds the wrong memory.
--
-- IT HAS TO BE SPACED. Nothing in the dialler spaced attempts — the only guard
-- was one attempt per number per DAY, so a lead could be dialled six days
-- running. Six calls in six days is not frequency, it is harassment, and it is
-- how a number ends up blocked.
--
-- IT HAS TO CHANGE. A second call that reads the identical script verbatim is
-- the same defect that killed the first three calls of the day, only spread
-- across a week instead of ten seconds. Touch two has to acknowledge touch one.

ALTER TABLE campaigns
  -- Days to wait before the next touch. 0 keeps the old behaviour (next day).
  ADD COLUMN IF NOT EXISTS touch_spacing_days integer NOT NULL DEFAULT 3;

COMMENT ON COLUMN campaigns.touch_spacing_days IS
  'Minimum days between touches on the same lead. Enforced via campaign_leads.next_eligible_at.';

-- `next_eligible_at` already exists on campaign_leads (migration 0048) and has
-- been unused since. It now carries the spacing, and the dialler already
-- filters on it — so the column finally does the job it was created for.

-- Backfill: everything currently mid-cadence becomes eligible tomorrow rather
-- than immediately, so turning this on cannot produce a same-day second touch
-- for a lead that was already called today.
UPDATE campaign_leads
   SET next_eligible_at = COALESCE(last_attempt_at, now()) + interval '3 days'
 WHERE status IN ('RETRY', 'VM')
   AND next_eligible_at IS NULL
   AND last_attempt_at IS NOT NULL;
