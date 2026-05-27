-- Session 49b — Alpha Automotive shop registry.
--
-- Per-tenant list of partner repair / body shops the flip engine can
-- redirect calls to. Tenant-zero is seeded with all 9 Alpha Automotive
-- shops; every other tenant starts empty and uses the admin UI to add
-- their own shops.
--
-- Also adds two flip-engine config columns to the tenants table.
--
-- All DDL is additive with IF NOT EXISTS guards.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "flip_engine_enabled" boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "flip_engine_config"  jsonb   NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "alpha_shops" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,

  "name"                     varchar(180) NOT NULL,
  "shop_type"                varchar(20)  NOT NULL,           -- REPAIR | BODY
  "address_line"             varchar(255) NOT NULL,
  "city"                     varchar(100) NOT NULL,
  "state"                    varchar(2)   NOT NULL,
  "postal_code"              varchar(20)  NOT NULL,

  "lat"                      double precision,
  "lng"                      double precision,

  "phone"                    varchar(20),
  "website"                  text,

  "rental_pickup_available"  boolean NOT NULL DEFAULT TRUE,
  "active"                   boolean NOT NULL DEFAULT TRUE,
  "specialties"              jsonb   NOT NULL DEFAULT '[]'::jsonb,
  "notes"                    text,

  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "alpha_shops_shop_type_check" CHECK (
    "shop_type" IN ('REPAIR', 'BODY')
  )
);

CREATE INDEX IF NOT EXISTS "alpha_shops_tenant_active_idx"
  ON "alpha_shops" ("tenant_id", "active");

CREATE INDEX IF NOT EXISTS "alpha_shops_tenant_type_idx"
  ON "alpha_shops" ("tenant_id", "shop_type");

CREATE INDEX IF NOT EXISTS "alpha_shops_geo_idx"
  ON "alpha_shops" ("lat", "lng")
  WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL;

-- Seed: 9 Alpha Automotive shops scoped to tenant zero only. The seed
-- inserts via ON CONFLICT DO NOTHING so re-running the migration is a
-- no-op. Other tenants start empty and use POST /v1/admin/alpha-shops
-- to add their own.
INSERT INTO "alpha_shops" (
  "tenant_id", "name", "shop_type", "address_line", "city", "state",
  "postal_code", "lat", "lng", "phone", "website", "rental_pickup_available",
  "active", "notes"
) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Ernie''s Automotive Service', 'REPAIR',
   '3906 E Main Street', 'Columbus', 'OH', '43213',
   39.961370, -82.864639,
   '+16142358037', 'https://erniesautomotiveservice.com', TRUE, TRUE,
   'Founded 1978. Foreign + domestic vehicles.'),
  ('00000000-0000-0000-0000-000000000001',
   'Complete Brake Service', 'REPAIR',
   '580 W Town St', 'Columbus', 'OH', '43215',
   39.962030, -83.012840,
   '+16142214888', 'https://completebrake.net', TRUE, TRUE,
   'Founded 1986. Brake specialist + commercial vehicles.'),
  ('00000000-0000-0000-0000-000000000001',
   'Hilliard Auto Repair', 'REPAIR',
   '4462 Cemetery Rd', 'Hilliard', 'OH', '43026',
   40.036970, -83.150650,
   '+16144296030', 'https://hilliardautorepair.net', TRUE, TRUE,
   'Founded 2024. Cars, trucks, fleet vehicles.'),
  ('00000000-0000-0000-0000-000000000001',
   'Petty''s Auto & Electric Service', 'REPAIR',
   '330 S Washington Ave', 'Columbus', 'OH', '43215',
   39.954670, -82.997410,
   '+16142245566', 'https://pettysauto.com', TRUE, TRUE,
   'Founded 1982. Acquired June 2025. ASE-certified, factory diagnostic equipment.'),
  ('00000000-0000-0000-0000-000000000001',
   'Wayne''s Auto Repair — Columbus', 'REPAIR',
   '2375 Schrock Rd', 'Columbus', 'OH', '43229',
   40.099110, -82.991270,
   '+16148900449', 'https://waynesautorepair.com', TRUE, TRUE,
   'Locally owned since 1999.'),
  ('00000000-0000-0000-0000-000000000001',
   'Wayne''s Auto Repair — Westerville', 'REPAIR',
   '5995 Westerville Rd', 'Westerville', 'OH', '43081',
   40.116170, -82.928470,
   '+16148900449', 'https://waynesautorepair.com', TRUE, TRUE,
   'Locally owned since 1999.'),
  ('00000000-0000-0000-0000-000000000001',
   'Wayne''s Auto Repair — Powell', 'REPAIR',
   '361 Village Park Dr', 'Powell', 'OH', '43065',
   40.158010, -83.075870,
   '+16148486100', 'https://waynesautorepair.com', TRUE, TRUE,
   'Locally owned since 1999.'),
  ('00000000-0000-0000-0000-000000000001',
   'Excite Collision Repair', 'BODY',
   '5511 Westerville Rd', 'Westerville', 'OH', '43081',
   40.110610, -82.929940,
   '+16149306103', 'https://excitecollision.com', TRUE, TRUE,
   'Founded 2018. NAPA 24-month / 24,000-mile warranty.'),
  ('00000000-0000-0000-0000-000000000001',
   'T&C Body Shop', 'BODY',
   '2856 Johnstown Rd', 'Columbus', 'OH', '43219',
   40.030360, -82.911270,
   '+16144710505', 'https://tncbody.com', TRUE, TRUE,
   'Founded 1997. Near John Glenn International Airport.')
ON CONFLICT DO NOTHING;
