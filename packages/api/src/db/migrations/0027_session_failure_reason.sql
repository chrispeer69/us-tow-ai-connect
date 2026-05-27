-- =============================================================================
-- 0027_session_failure_reason
--
-- Adds observability columns to tenant_credentials so we can see WHY a login
-- attempt failed without having to read Railway container logs. The previous
-- catch block discarded the exception message, leaving operators staring at a
-- single "FAILED" status with no path to remediation.
--
-- Columns added:
--   failure_reason       : last exception .message captured by the catch
--   failure_kind         : coarse category (LAUNCH / NAVIGATION / SELECTOR /
--                          AUTH / TIMEOUT / NETWORK / UNKNOWN) for grouping
--   failed_login_count   : monotonic counter, reset to 0 on next success
--   last_failure_at      : timestamp of the most recent failure
--
-- Idempotent: uses IF NOT EXISTS so re-running on every deploy is safe.
-- =============================================================================

ALTER TABLE tenant_credentials
  ADD COLUMN IF NOT EXISTS failure_reason     text,
  ADD COLUMN IF NOT EXISTS failure_kind       varchar(40),
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_at    timestamptz;

CREATE INDEX IF NOT EXISTS tenant_credentials_failure_kind_idx
  ON tenant_credentials (failure_kind)
  WHERE failure_kind IS NOT NULL;
