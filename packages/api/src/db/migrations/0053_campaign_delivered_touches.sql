-- Separate "how many times we dialled" from "how many times a human heard us".
--
-- Two defects, one cause. The three-stage script picked its stage from
-- `attempts`, which counts dials:
--
--   1. A lead that never answered still advanced. Dial Monday (no answer),
--      dial Thursday -> stage 2, which opens "I called you last week about your
--      free profile" to somebody who has never heard from us. Dial Sunday ->
--      stage 3, "last one, then I'll leave you alone", still to a stranger.
--
--   2. A lead that DID answer was retired on the spot, so the only people who
--      ever heard stage 1 were guaranteed never to hear stages 2 and 3. The
--      whole point of the cadence is name recognition through repetition, and
--      it was firing exclusively at the people who had heard nothing.
--
-- `touches` counts delivered pitches only. `attempts` keeps counting dials and
-- keeps guarding against dialling a dead number forever.

alter table campaign_leads
  add column if not exists touches integer not null default 0;

-- How many stages this campaign runs before a lead is finished. Three today:
-- the profile, the Columbus loop, then what Elite unlocks.
alter table campaigns
  add column if not exists target_touches integer not null default 3;

-- Existing leads: anyone recorded as having heard the pitch has heard exactly
-- one stage, because until now hearing it once retired them.
update campaign_leads
   set touches = 1
 where status in ('PITCHED', 'WARM', 'ACCEPTED')
   and touches = 0;

-- A lead that opted out has heard us and must never hear us again; the touch
-- count is recorded for honesty, not to schedule anything.
update campaign_leads
   set touches = 1
 where status = 'DNC'
   and touches = 0;

create index if not exists campaign_leads_touches_idx
  on campaign_leads (campaign_id, touches);
