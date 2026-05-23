-- Session 27 — Multi-Tenant Readiness (Bundle C), Section 4
-- ============================================================
-- Adds the platform `users` table for super-admin / tenant_admin /
-- tenant_user identity. Orthogonal to `tenant_members.role` (tenant
-- scoped). Email is the natural key — lowercased + unique.
--
-- Seeds Chris Peer (thechrispeer@gmail.com) as super_admin so the
-- super-admin UI works on day one. Idempotent.

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(255) NOT NULL UNIQUE,
  "name" varchar(255),
  "platform_role" varchar(20) NOT NULL DEFAULT 'tenant_user',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "users_platform_role_idx"
  ON "users" ("platform_role");

INSERT INTO "users" ("email", "name", "platform_role")
VALUES ('thechrispeer@gmail.com', 'Chris Peer', 'super_admin')
ON CONFLICT (email) DO UPDATE
  SET platform_role = 'super_admin',
      name = COALESCE("users".name, EXCLUDED.name),
      updated_at = NOW();
