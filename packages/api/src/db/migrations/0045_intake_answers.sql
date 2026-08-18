-- Session 77 — keep the dispatch intake answers instead of throwing them away.
--
-- The script has asked all four intake questions on every call since 2026-08-15
-- — where the vehicle sits and which way it faces, whether all four tires are
-- up, whether the customer will be there with the keys, and colour/drivetrain
-- asked open because the club ticket is only ~50% accurate on both.
--
-- Every answer was discarded. Nothing extracted them, nothing stored them, and
-- the AI Notes composer's KEYS / ACCESS / CONDITION / VEHICLE lines have never
-- had anything to render. We were paying the call seconds and getting nothing:
-- on 2026-08-17 that intake is what pushed the median call to 191s and shoved
-- the offer past Retell's 300s cap.
--
-- These columns are the storage half. The other half is a Retell post-call
-- analysis field per line — without those the agent emits nothing to store.
--
-- All nullable and all free text. A driver's note is prose, not an enum: "on the
-- curb in front of the house, nose out, tight turn to get in" is the useful
-- answer and it does not fit a controlled vocabulary. `unknown` is a legitimate
-- value the agent is told to record honestly rather than guess.

ALTER TABLE outbound_call_logs
  -- KEYS — a gate, not a note. Chris's rule: the customer is present with the
  -- keys or we do not tow. "Keys left in my mailbox" has to survive verbatim.
  ADD COLUMN IF NOT EXISTS keys_and_presence text,

  -- ACCESS — how it is sitting and how to reach it. Decides the approach and
  -- sometimes whether the truck fits at all.
  ADD COLUMN IF NOT EXISTS access_notes text,

  -- CONDITION — tires, and whether it rolls, steers, comes out of park. This is
  -- the equipment question: "all four up" and "left rear flat" are different
  -- trucks.
  ADD COLUMN IF NOT EXISTS vehicle_condition text,

  -- VEHICLE — colour and drivetrain as the customer gave them. AWD put on
  -- dollies is damage, not an inconvenience.
  ADD COLUMN IF NOT EXISTS vehicle_details text,

  -- ISSUE — what the customer said is wrong, in their words. `issue_type` is
  -- 'unknown' on 99.6% of calls, so the ticket cannot supply this.
  ADD COLUMN IF NOT EXISTS issue_description text,

  -- Where the vehicle is actually going, as confirmed on the call. Distinct
  -- from new_destination, which only fills on an accepted flip: this one
  -- catches "the ticket says AutoZone, the customer says a storage facility",
  -- which was a real 2026-08-17 call.
  ADD COLUMN IF NOT EXISTS confirmed_destination text;

-- The AI Notes sweep filters on "did this call capture anything worth writing?"
-- Before this migration that was corrections_made / new_destination only, and
-- both are rare. With the intake fields it becomes the common case, so the
-- candidate scan needs to stop being a sequential scan over the day's calls.
CREATE INDEX IF NOT EXISTS outbound_call_logs_notes_pending_idx
  ON outbound_call_logs (tenant_id, call_time DESC)
  WHERE towbook_notes_updated = false;
