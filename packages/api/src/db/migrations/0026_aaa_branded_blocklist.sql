-- Session 49b — AAA-branded shop blocklist.
--
-- Hard guardrail data backing the "never flip a AAA call going to a
-- AAA-branded repair location" rule. The flip engine matches on the
-- regex /\bAAA\b/i in the destination business name; this table is the
-- operator-managed override layer for edge cases (regional names that
-- don't include the literal "AAA" word but ARE AAA-branded, or
-- specific addresses that should be hard-blocked).
--
-- Tenant-scoped. Tenant zero is seeded with the canonical AAA brand
-- patterns; every other tenant starts empty and the regex check still
-- protects them.
--
-- All DDL is additive with IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS "aaa_branded_blocklist" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,

  "match_type"       varchar(20)  NOT NULL,            -- NAME_PATTERN | EXACT_NAME | EXACT_ADDRESS | PHONE
  "match_value"      varchar(255) NOT NULL,
  "label"            varchar(180) NOT NULL,
  "notes"            text,

  "active"           boolean NOT NULL DEFAULT TRUE,
  "added_by"         varchar(255),

  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "aaa_branded_blocklist_match_type_check" CHECK (
    "match_type" IN ('NAME_PATTERN', 'EXACT_NAME', 'EXACT_ADDRESS', 'PHONE')
  )
);

CREATE INDEX IF NOT EXISTS "aaa_branded_blocklist_tenant_active_idx"
  ON "aaa_branded_blocklist" ("tenant_id", "active");

CREATE INDEX IF NOT EXISTS "aaa_branded_blocklist_match_idx"
  ON "aaa_branded_blocklist" ("match_type", "match_value");

-- Seed: canonical AAA brand patterns scoped to tenant zero.
-- The literal /\bAAA\b/i regex is hard-coded in the flip engine and
-- catches the obvious cases. These rows cover known regional brand
-- variants that the generic regex might miss, plus document the
-- guardrail in plain text inside the operator UI.
