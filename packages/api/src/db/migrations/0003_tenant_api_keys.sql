-- Tenant API keys (admin dashboard — API Keys screen).
-- Plaintext keys are returned to the user exactly once at creation; only the
-- hash is persisted. `revoked_at` is a soft-delete: revoked keys remain in
-- the table for audit but must not be accepted by the API key guard.

CREATE TABLE IF NOT EXISTS "tenant_api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL,
  "key_hash" varchar(255) NOT NULL UNIQUE,
  "key_prefix" varchar(16) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "tenant_api_keys_tenant_idx"
  ON "tenant_api_keys" ("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_api_keys_prefix_idx"
  ON "tenant_api_keys" ("key_prefix");
