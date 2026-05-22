-- Tenant members (admin dashboard — Members screen).
-- A tenant can have multiple member accounts with different roles. Email is
-- unique within a tenant; the same address can exist across tenants.

CREATE TABLE IF NOT EXISTS "tenant_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "email" varchar(255) NOT NULL,
  "name" varchar(255),
  "role" varchar(20) DEFAULT 'MEMBER' NOT NULL,
  "status" varchar(20) DEFAULT 'INVITED' NOT NULL,
  "invited_at" timestamptz DEFAULT now() NOT NULL,
  "last_active_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_members_tenant_email_uniq"
  ON "tenant_members" ("tenant_id", lower("email"));
CREATE INDEX IF NOT EXISTS "tenant_members_tenant_idx"
  ON "tenant_members" ("tenant_id");
