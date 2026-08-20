-- Session 79 — test mode for outreach campaigns.
--
-- 2026-08-20, the first live batch: three agent defects were found by spending
-- eighteen real Cleveland towing companies to find them. Ray restarted his
-- opening line every time somebody said "Richard's". He read his own system
-- instructions aloud to Bobby's Towing. He recited an opt-out to an answering
-- machine and then reported that the machine had opted out, which permanently
-- suppressed a live prospect.
--
-- Every one of those was obvious within five seconds of hearing it. None of
-- them needed a real prospect to discover. They needed ONE phone that Chris
-- could answer himself.
--
-- The tow dialler has had this since Session 68 (OUTBOUND_TEST_MODE_ENABLED /
-- RETELL_TEST_OVERRIDE_NUMBER, plus a per-tenant override). The campaign
-- dialler shipped without it. This closes that gap.
--
-- Per CAMPAIGN rather than per tenant or per environment: a tenant can run more
-- than one campaign and they are not always at the same stage of readiness. One
-- being rehearsed must not put another into test mode.

ALTER TABLE campaigns
  -- When true, EVERY call this campaign places is redirected to
  -- test_override_number. The lead is still claimed, the attempt still counted
  -- and the row still written, so the whole pipeline is exercised — only the
  -- number dialled changes.
  ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false,

  -- E.164. Required whenever test_mode is on; the dialler REFUSES to place a
  -- call rather than fall through to the real number if this is missing. A
  -- test mode that silently dials the prospect is worse than no test mode,
  -- because you would trust it.
  ADD COLUMN IF NOT EXISTS test_override_number text;

COMMENT ON COLUMN campaigns.test_mode IS
  'Redirect every outbound call to test_override_number. Refuses to dial if that is unset.';
