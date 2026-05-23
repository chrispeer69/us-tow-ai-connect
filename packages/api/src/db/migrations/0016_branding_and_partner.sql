-- Session 27 — Multi-Tenant Readiness (Bundle C), Sections 2 & 5
-- ================================================================
-- Adds two new nullable columns to `tenants`:
--   * `branding` (jsonb) — white-label theming (logo url, colors, fonts,
--     custom domain, support phone/email, hide_powered_by). Default {}.
--   * `partner_account_id` (text, nullable) — Thinkrr's account ID for
--     white-label billing reconciliation. Null for tenants that
--     onboarded directly.
--
-- Both are additive — existing rows simply pick up the defaults.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "branding" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "partner_account_id" varchar(120);

CREATE INDEX IF NOT EXISTS "tenants_partner_account_idx"
  ON "tenants" ("partner_account_id");
