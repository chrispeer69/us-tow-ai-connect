-- Drop existing role check constraint and recreate it to include 'SUPPORT'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_members_role_check'
  ) THEN
    ALTER TABLE "tenant_members" DROP CONSTRAINT "tenant_members_role_check";
  END IF;

  ALTER TABLE "tenant_members"
    ADD CONSTRAINT "tenant_members_role_check"
    CHECK ("role" IN ('OWNER', 'DISPATCHER', 'DRIVER', 'ACCOUNTING', 'VIEWER', 'SUPPORT'));
END $$;

-- Add base permissions for the SUPPORT role
INSERT INTO "role_permissions" ("role", "permission_key") VALUES
  ('SUPPORT', 'settings.read'),
  ('SUPPORT', 'settings.write'),
  ('SUPPORT', 'flip.read'),
  ('SUPPORT', 'flip.write'),
  ('SUPPORT', 'voice.read'),
  ('SUPPORT', 'voice.write'),
  ('SUPPORT', 'support-sandbox.manage')
ON CONFLICT ("role", "permission_key") DO NOTHING;
