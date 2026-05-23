-- Session 23: Driver Pings + Live ETA
-- Standalone driver-location reporting table. Intentionally separate from
-- the Session-21 `drivers` table (which is keyed by uuid and owned by the
-- Command Center) so this can run before S21 finishes. A driver here is
-- identified by tenant_id + phone (E.164). When the Command Center wants to
-- correlate, it can join `driver_pings.driver_phone` against `drivers.phone`.

CREATE TABLE IF NOT EXISTS "driver_pings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "driver_phone" varchar(20) NOT NULL,
  "driver_name" varchar(120),
  "lat" numeric(10, 6) NOT NULL,
  "lng" numeric(10, 6) NOT NULL,
  "heading" numeric(5, 2),
  "speed_mph" numeric(5, 2),
  "accuracy_m" numeric(8, 2),
  "battery_pct" integer,
  "source" varchar(20) NOT NULL DEFAULT 'manual',
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Hot path: "latest ping per driver for this tenant" — used by /eta to pick
-- the nearest available driver before calling Distance Matrix.
CREATE INDEX IF NOT EXISTS "driver_pings_tenant_phone_recorded_idx"
  ON "driver_pings" ("tenant_id", "driver_phone", "recorded_at" DESC);

-- Tenant-wide recency scan for the admin live-map view.
CREATE INDEX IF NOT EXISTS "driver_pings_tenant_recorded_idx"
  ON "driver_pings" ("tenant_id", "recorded_at" DESC);
