ALTER TABLE "tenant_members" ADD COLUMN IF NOT EXISTS "invited_by" varchar(255);
ALTER TABLE "tenant_members" ADD COLUMN IF NOT EXISTS "invited_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "tenant_members" ADD COLUMN IF NOT EXISTS "accepted_at" timestamp with time zone;