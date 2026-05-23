-- Session 21 (Command Center): unified job board across all adapters.
-- The unified_jobs table is the canonical "single pane of glass" record. Each
-- adapter (towbook, aaa_salesforce, manual) upserts into it using
-- (tenant_id, source, source_job_id) as the natural key. Geocoded lat/lng
-- is cached on the row so the map renderer doesn't re-hit Google Places.

CREATE TABLE IF NOT EXISTS "unified_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "source" varchar(32) NOT NULL,
  "source_job_id" varchar(120) NOT NULL,
  "source_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'new',
  "caller_phone" varchar(20),
  "caller_name" varchar(255),
  "vehicle_year" varchar(10),
  "vehicle_make" varchar(60),
  "vehicle_model" varchar(60),
  "vehicle_color" varchar(40),
  "pickup_address" text,
  "pickup_lat" numeric(10, 6),
  "pickup_lng" numeric(10, 6),
  "dropoff_address" text,
  "dropoff_lat" numeric(10, 6),
  "dropoff_lng" numeric(10, 6),
  "service_type" varchar(60),
  "priority" varchar(10) NOT NULL DEFAULT 'normal',
  "assigned_driver_id" uuid,
  "assigned_truck_id" uuid,
  "eta_minutes" integer,
  "accepted_at" timestamptz,
  "dispatched_at" timestamptz,
  "arrived_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "unified_jobs_source_uniq"
  ON "unified_jobs" ("tenant_id", "source", "source_job_id");

CREATE INDEX IF NOT EXISTS "unified_jobs_tenant_status_idx"
  ON "unified_jobs" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "unified_jobs_tenant_driver_idx"
  ON "unified_jobs" ("tenant_id", "assigned_driver_id");

CREATE INDEX IF NOT EXISTS "unified_jobs_tenant_updated_idx"
  ON "unified_jobs" ("tenant_id", "updated_at" DESC);

-- Drivers + trucks: lightweight tenant-scoped fleet records. Driver location
-- is updated by a future mobile/POS ping; nullable lat/lng so a record exists
-- even before the first ping.
CREATE TABLE IF NOT EXISTS "drivers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "phone" varchar(20),
  "status" varchar(20) NOT NULL DEFAULT 'off_duty',
  "current_lat" numeric(10, 6),
  "current_lng" numeric(10, 6),
  "last_ping_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "drivers_tenant_status_idx" ON "drivers" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "trucks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(60) NOT NULL,
  "type" varchar(20) NOT NULL DEFAULT 'medium',
  "status" varchar(20) NOT NULL DEFAULT 'available',
  "assigned_driver_id" uuid REFERENCES "drivers"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "trucks_tenant_idx" ON "trucks" ("tenant_id");

-- Now that drivers exists, wire up the unified_jobs FKs (created earlier as
-- bare uuids so the unified_jobs DDL doesn't depend on table-order).
ALTER TABLE "unified_jobs"
  ADD CONSTRAINT "unified_jobs_assigned_driver_fk"
  FOREIGN KEY ("assigned_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL;

ALTER TABLE "unified_jobs"
  ADD CONSTRAINT "unified_jobs_assigned_truck_fk"
  FOREIGN KEY ("assigned_truck_id") REFERENCES "trucks"("id") ON DELETE SET NULL;

-- Audit trail. Written on create, status change, assignment, decision events.
CREATE TABLE IF NOT EXISTS "job_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "unified_jobs"("id") ON DELETE CASCADE,
  "event_type" varchar(40) NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actor" varchar(120),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "job_events_job_created_idx"
  ON "job_events" ("job_id", "created_at" DESC);
