/**
 * Tenant-zero seed: inserts/updates the Roadside Towing tenant row + owner
 * member. Idempotent — safe to run multiple times. Reads DATABASE_URL from env.
 *
 * Brands operating under this tenant (Auto Lyft USA, Excite Towing, Roadside
 * Towing) are not modeled in the current schema; Session 18 (Multi-Company
 * Switcher) will add the structure for that.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { createHash } from 'crypto';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const COMPANY_NAME = 'Roadside Towing';
const OWNER_EMAIL = 'thechrispeer@gmail.com';
const OWNER_NAME = 'Chris Peer';
const TIMEZONE = 'America/New_York';
const SOFTWARE_TYPE = 'TOWBOOK';

// Deterministic placeholder for the bootstrap API key hash so reruns don't
// produce duplicate-unique-constraint errors. The real per-tenant key is
// minted via POST /v1/admin/api-keys; this value is just a non-null filler.
const BOOTSTRAP_API_KEY_HASH = createHash('sha256')
  .update(`bootstrap:${TENANT_ID}`)
  .digest('hex');
const BOOTSTRAP_API_KEY_PREFIX = 'usk_boot';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url, max: 1 });

  try {
    await pool.query(
      `
      INSERT INTO tenants (
        id, company_name, owner_email, timezone, target_software_type,
        api_key_hash, api_key_prefix, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
      ON CONFLICT (id) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        owner_email = EXCLUDED.owner_email,
        timezone = EXCLUDED.timezone,
        target_software_type = EXCLUDED.target_software_type,
        is_active = TRUE,
        updated_at = NOW()
      `,
      [
        TENANT_ID,
        COMPANY_NAME,
        OWNER_EMAIL,
        TIMEZONE,
        SOFTWARE_TYPE,
        BOOTSTRAP_API_KEY_HASH,
        BOOTSTRAP_API_KEY_PREFIX,
      ],
    );

    await pool.query(
      `
      INSERT INTO tenant_members (tenant_id, email, name, role, status)
      VALUES ($1, $2, $3, 'OWNER', 'ACTIVE')
      ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        status = EXCLUDED.status
      `,
      [TENANT_ID, OWNER_EMAIL.toLowerCase(), OWNER_NAME],
    );

    console.log(`Tenant zero ready: ${COMPANY_NAME} (${TENANT_ID})`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
