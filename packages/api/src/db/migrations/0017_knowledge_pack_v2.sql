-- Session 27 — Multi-Tenant Readiness (Bundle C), Section 3
-- ============================================================
-- Adds `tenant_knowledge_pack` (v2 schema for per-tenant rich profiles).
-- New schema, separate from `ai_agent_configs.knowledge_pack` (v1 blob)
-- so the v2 endpoint can ship without changing v1 readers.
--
-- Each row has a `draft` blob (editor staging) and a `content` blob
-- (published, served by /public/knowledge/:id/profile.{md,json}).
-- `published=false + content={}` is the seeded-but-never-published state.

CREATE TABLE IF NOT EXISTS "tenant_knowledge_pack" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE CASCADE,
  "content" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "draft" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 0,
  "published" boolean NOT NULL DEFAULT FALSE,
  "last_published_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Seed tenant-zero's v2 row from the legacy v1 knowledge_pack blob so the
-- /public/knowledge/:id/profile.md endpoint keeps rendering the same
-- content after the v2 reader is wired up.
INSERT INTO "tenant_knowledge_pack" (
  "tenant_id", "content", "draft", "version", "published", "last_published_at"
)
SELECT
  ac.tenant_id,
  jsonb_build_object(
    'identity', jsonb_build_object(
      'name', t.company_name,
      'brands', COALESCE(ac.knowledge_pack->'brands', '[]'::jsonb),
      'slogan', '',
      'founded_year', NULL,
      'license_numbers', '[]'::jsonb
    ),
    'services', COALESCE(ac.knowledge_pack->'services', '[]'::jsonb),
    'service_areas', COALESCE(
      jsonb_build_array(
        jsonb_build_object(
          'county', ac.knowledge_pack->'service_area'->>'region',
          'cities', '[]'::jsonb,
          'zip_prefixes', '[]'::jsonb
        )
      ),
      '[]'::jsonb
    ),
    'hours', jsonb_build_object(
      'regular', jsonb_build_object(
        'mon_fri', COALESCE(ac.knowledge_pack->>'hours', '24/7'),
        'sat', COALESCE(ac.knowledge_pack->>'hours', '24/7'),
        'sun', COALESCE(ac.knowledge_pack->>'hours', '24/7')
      ),
      'after_hours_premium', false
    ),
    'fleet', '[]'::jsonb,
    'transfer_rules', jsonb_build_array(
      jsonb_build_object(
        'trigger', 'human_request',
        'phone', COALESCE(ac.knowledge_pack->>'transfer_phone', ''),
        'label', COALESCE(ac.knowledge_pack->>'transfer_label', 'Dispatch')
      )
    ),
    'pricing_policy', jsonb_build_object(
      'quote_at_dispatch', true,
      'accepts_motor_clubs', '[]'::jsonb,
      'cash_accepted', true,
      'cards_accepted', true
    ),
    'escalation', jsonb_build_object(
      'manager_phones', '[]'::jsonb,
      'escalate_after_min_on_hold', 5
    )
  ),
  '{}'::jsonb,
  1,
  TRUE,
  NOW()
FROM ai_agent_configs ac
JOIN tenants t ON t.id = ac.tenant_id
WHERE ac.tenant_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (tenant_id) DO NOTHING;
