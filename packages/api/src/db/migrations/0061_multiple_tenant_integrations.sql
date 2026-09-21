-- The original schema allowed only one credential row per tenant. The app now
-- supports independent TowBook and AAA connections for the same tenant, so
-- uniqueness belongs to (tenant_id, software_type), not tenant_id alone.
ALTER TABLE "tenant_credentials"
  DROP CONSTRAINT IF EXISTS "tenant_credentials_tenant_id_uniq";

DROP INDEX IF EXISTS "tenant_credentials_tenant_id_uniq";

CREATE UNIQUE INDEX IF NOT EXISTS "unq_tenant_software_idx"
  ON "tenant_credentials" ("tenant_id", "software_type");
