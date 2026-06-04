ALTER TABLE "tenant_members" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp with time zone;
ALTER TABLE "tenant_members" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
ALTER TABLE "tenant_members" ADD COLUMN IF NOT EXISTS "invite_token" varchar(255);
ALTER TABLE "tenant_members" ADD COLUMN IF NOT EXISTS "invite_token_expires_at" timestamp with time zone;