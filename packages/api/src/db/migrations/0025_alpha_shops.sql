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
