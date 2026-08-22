-- Session 80 — the columns Chris actually keeps on a lead list.
--
-- His standard export shape, given 2026-08-22:
--
--   company, phone, email, rating, reviews, grade, site_score, ai_score,
--   website, address, city, state, zip
--
-- The importer was taking four of those — company, phone, city, state — and
-- silently dropping the rest. That already cost something: the Cleveland list
-- carried `website`, which is the key the PageSpeed scores join on, and it went
-- in the bin on import. Backfilling it later means re-importing 73 rows.
--
-- Three of these columns do not have values yet. `grade`, `site_score` and
-- `ai_score` are being produced by the Alliance-side work in progress. They go
-- in now, nullable, so that when the scores exist there is somewhere to put
-- them and no second migration is needed mid-campaign.

ALTER TABLE campaign_leads
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS zip text,

  -- Google Places reputation, straight off the export.
  ADD COLUMN IF NOT EXISTS rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS reviews_count integer,

  -- TowGrade's operator grade.
  ADD COLUMN IF NOT EXISTS grade text,

  -- PageSpeed. `site_score` is the headline number a call could be built
  -- around; the raw report lives in the Alliance database, this is the digest.
  ADD COLUMN IF NOT EXISTS site_score integer,

  -- Whatever the AI-readiness scoring settles on.
  ADD COLUMN IF NOT EXISTS ai_score integer;

-- A poor site score is a pitch of its own ("you're losing roadside calls at
-- nine seconds"), so the dialler will want to select on it.
CREATE INDEX IF NOT EXISTS campaign_leads_site_score_idx
  ON campaign_leads (campaign_id, site_score)
  WHERE site_score IS NOT NULL;

COMMENT ON COLUMN campaign_leads.site_score IS
  'PageSpeed headline score. Low scores are a pitch angle, not just a stat.';
