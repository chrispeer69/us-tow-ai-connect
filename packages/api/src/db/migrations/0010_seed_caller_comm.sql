-- Session 24 (Caller Communication): tenant-zero seed updates.
-- A separate migration to avoid touching the existing tenant-zero seed file
-- owned by the production-seed session. Idempotent: only updates Roadside.
UPDATE "tenants"
SET
  "manager_phones" = '["+17408129489"]'::jsonb,
  "sms_enabled" = true,
  "tracking_url_base" = COALESCE(NULLIF("tracking_url_base", ''), 'https://ustowapi-production.up.railway.app/track')
WHERE "id" = '00000000-0000-0000-0000-000000000001'::uuid;
