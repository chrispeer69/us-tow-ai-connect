ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id" varchar(255);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "owner_id" uuid;
ALTER TABLE "tenant_credentials" ADD COLUMN IF NOT EXISTS "username_hash" varchar(255);
ALTER TABLE "tenant_credentials" ADD COLUMN IF NOT EXISTS "password_hash" varchar(255);