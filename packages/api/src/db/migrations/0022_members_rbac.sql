-- Session 45 — Members + roles RBAC.
--
-- Evolves the existing `tenant_members` table (migration 0002) into a real
-- RBAC subject, and adds a `role_permissions` matrix. We intentionally do NOT
-- create a separate `members` table: tenant_members is already the source of
-- truth (written by onboarding, read by partner + admin).
--
-- Role/status are kept as varchar + CHECK (the repo has no pgEnum; varchar +
-- app-level zod is the established convention, and ALTER TYPE on an in-use
-- defaulted column is risky). Casing stays UPPERCASE to match existing rows
-- and the onboarding writer, which inserts 'OWNER'/'ACTIVE'.

-- 1. New columns (idempotent).
ALTER TABLE "tenant_members"
  ADD COLUMN IF NOT EXISTS "invited_by"               varchar(255),
  ADD COLUMN IF NOT EXISTS "accepted_at"              timestamptz,
  ADD COLUMN IF NOT EXISTS "last_login_at"            timestamptz,
  ADD COLUMN IF NOT EXISTS "invite_token"             varchar(255),
  ADD COLUMN IF NOT EXISTS "invite_token_expires_at"  timestamptz;

-- 2. Migrate legacy role values to the new set BEFORE adding the CHECK, or the
--    constraint would reject existing rows.
--      ADMIN  -> OWNER   (preserve full access; avoid locking out admins)
--      MEMBER -> VIEWER  (least privilege)
UPDATE "tenant_members" SET "role" = 'OWNER'  WHERE "role" = 'ADMIN';
UPDATE "tenant_members" SET "role" = 'VIEWER' WHERE "role" = 'MEMBER';
-- Defensive: any value not in the new set collapses to least privilege.
UPDATE "tenant_members"
  SET "role" = 'VIEWER'
  WHERE "role" NOT IN ('OWNER', 'DISPATCHER', 'DRIVER', 'ACCOUNTING', 'VIEWER');

-- 3. New default (old default 'MEMBER' would violate the CHECK).
ALTER TABLE "tenant_members" ALTER COLUMN "role" SET DEFAULT 'VIEWER';

-- 4. Backfill accepted_at for already-active members so the column is meaningful.
UPDATE "tenant_members"
  SET "accepted_at" = "invited_at"
  WHERE "status" = 'ACTIVE' AND "accepted_at" IS NULL;

-- 5. CHECK constraints (guarded so a re-run is a no-op).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_members_role_check'
  ) THEN
    ALTER TABLE "tenant_members"
      ADD CONSTRAINT "tenant_members_role_check"
      CHECK ("role" IN ('OWNER', 'DISPATCHER', 'DRIVER', 'ACCOUNTING', 'VIEWER'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_members_status_check'
  ) THEN
    ALTER TABLE "tenant_members"
      ADD CONSTRAINT "tenant_members_status_check"
      CHECK ("status" IN ('INVITED', 'ACTIVE', 'SUSPENDED'));
  END IF;
END $$;

-- 6. Role → permission matrix. Composite PK (role, permission_key).
--    OWNER is represented by the single wildcard row ('OWNER', '*').
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "role"           varchar(20) NOT NULL,
  "permission_key" text        NOT NULL,
  PRIMARY KEY ("role", "permission_key")
);

-- 7. Seed the matrix (idempotent). Keys are '<resource>.<action>'; action is
--    read|write. See docs/sessions/S45_RBAC_MATRIX.md for the authoritative map.
INSERT INTO "role_permissions" ("role", "permission_key") VALUES
  -- owner: everything
  ('OWNER', '*'),
  -- dispatcher: operational surfaces (read + write)
  ('DISPATCHER', 'command-center.read'),
  ('DISPATCHER', 'command-center.write'),
  ('DISPATCHER', 'digital-dispatch.read'),
  ('DISPATCHER', 'digital-dispatch.write'),
  ('DISPATCHER', 'drivers-live.read'),
  ('DISPATCHER', 'drivers-live.write'),
  ('DISPATCHER', 'sms-log.read'),
  ('DISPATCHER', 'sms-log.write'),
  ('DISPATCHER', 'calls.read'),
  ('DISPATCHER', 'calls.write'),
  -- driver: driver portal only (separate from admin)
  ('DRIVER', 'driver-portal.read'),
  ('DRIVER', 'driver-portal.write'),
  -- accounting: billing + reports (read/write), audit-log (read)
  ('ACCOUNTING', 'billing.read'),
  ('ACCOUNTING', 'billing.write'),
  ('ACCOUNTING', 'reports.read'),
  ('ACCOUNTING', 'reports.write'),
  ('ACCOUNTING', 'audit-log.read'),
  -- viewer: read-only on a small surface
  ('VIEWER', 'integrations.read'),
  ('VIEWER', 'command-center.read'),
  ('VIEWER', 'reports.read')
ON CONFLICT ("role", "permission_key") DO NOTHING;
