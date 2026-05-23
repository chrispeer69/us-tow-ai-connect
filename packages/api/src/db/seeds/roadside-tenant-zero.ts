/**
 * Tenant-zero seed: inserts/updates the Roadside Towing tenant row, the
 * owner member, and the AI agent's knowledge pack used by the public
 * profile.md endpoint. Idempotent — safe to run multiple times. Reads
 * DATABASE_URL from env.
 *
 * The brand list (Roadside Towing, Auto Lyft USA, Excite Towing) is stored
 * inside the `knowledge_pack` JSONB blob because the current schema only
 * tracks a single tenant name. Session 18 (Multi-Company Switcher) will
 * model brands properly.
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
const DEFAULT_ETA_MINS = 45;
const TRANSFER_PHONE = '+16148326197';

const BOOTSTRAP_API_KEY_HASH = createHash('sha256')
  .update(`bootstrap:${TENANT_ID}`)
  .digest('hex');
const BOOTSTRAP_API_KEY_PREFIX = 'usk_boot';

// Real-world knowledge pack for the inbound AI agent. Mirrors the live
// dispatcher's intake script and the brands operating under this tenant.
const KNOWLEDGE_PACK = {
  brands: ['Roadside Towing', 'Auto Lyft USA', 'Excite Towing'],
  service_area: {
    region: 'Central Ohio',
    counties: [
      'Franklin',
      'Delaware',
      'Licking',
      'Madison',
      'Pickaway',
      'Union',
    ],
  },
  hours: '24/7',
  services: [
    { key: 'LIGHT_TOW', label: 'Light Duty Towing' },
    { key: 'MEDIUM_TOW', label: 'Medium Duty Towing' },
    { key: 'HEAVY_TOW', label: 'Heavy Duty Towing' },
    { key: 'ROADSIDE', label: 'Roadside Assistance' },
    { key: 'JUMP_START', label: 'Jump Starts' },
    { key: 'LOCKOUT', label: 'Lockouts' },
    { key: 'TIRE_CHANGE', label: 'Tire Changes' },
    { key: 'FUEL_DELIVERY', label: 'Fuel Delivery' },
    { key: 'ACCIDENT_RECOVERY', label: 'Accident Recovery' },
    { key: 'MOTOR_CLUB', label: 'Motor Club Work' },
  ],
  transfer_phone: TRANSFER_PHONE,
  transfer_label: 'Dispatch (Roadside Towing)',
  impound_policy: 'Ask the dispatcher — impound inquiries are handled live',
  default_eta_minutes: DEFAULT_ETA_MINS,
  payment_methods: [
    'Cash',
    'All major credit cards (Visa, MasterCard, Amex, Discover)',
    'Motor club accounts (AAA, Allstate, GEICO, and other partners)',
  ],
  agent_voice: 'Polly.Joanna',
  agent_greeting:
    'Thank you for calling Roadside Towing. How can I help you today?',
} as const;

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

    // Dispatch routing rule — referenced by /v1/ai-connect/transfer-route
    // and the public knowledge pack profile. routing_rules has no unique
    // constraint, so emulate upsert by checking first.
    const existingRule = await pool.query(
      `SELECT id FROM routing_rules WHERE tenant_id = $1 AND phone_number = $2 LIMIT 1`,
      [TENANT_ID, TRANSFER_PHONE],
    );
    if (existingRule.rowCount === 0) {
      await pool.query(
        `INSERT INTO routing_rules (tenant_id, rule_name, phone_number, is_active_now, priority_order)
         VALUES ($1, 'Dispatch (Roadside Towing)', $2, TRUE, 0)`,
        [TENANT_ID, TRANSFER_PHONE],
      );
    }
    // Make sure exactly one rule is active for tenant zero (idempotency).
    await pool.query(
      `UPDATE routing_rules
         SET is_active_now = (phone_number = $2)
       WHERE tenant_id = $1`,
      [TENANT_ID, TRANSFER_PHONE],
    );

    // Build the service_toggles object (one entry per service, enabled=true,
    // single AI_HANDLES vehicle class) so the existing admin UI/Knowledge
    // Pack generator sees them too.
    const serviceToggles = Object.fromEntries(
      KNOWLEDGE_PACK.services.map((s) => [
        s.key,
        { enabled: true, classes: { ALL: 'AI_HANDLES' } },
      ]),
    );

    await pool.query(
      `
      INSERT INTO ai_agent_configs (
        tenant_id, greeting_message, service_toggles, default_eta_mins,
        impound_enabled, knowledge_pack
      )
      VALUES ($1, $2, $3::jsonb, $4, TRUE, $5::jsonb)
      ON CONFLICT (tenant_id) DO UPDATE SET
        greeting_message = EXCLUDED.greeting_message,
        service_toggles = EXCLUDED.service_toggles,
        default_eta_mins = EXCLUDED.default_eta_mins,
        impound_enabled = EXCLUDED.impound_enabled,
        knowledge_pack = EXCLUDED.knowledge_pack,
        updated_at = NOW()
      `,
      [
        TENANT_ID,
        KNOWLEDGE_PACK.agent_greeting,
        JSON.stringify(serviceToggles),
        DEFAULT_ETA_MINS,
        JSON.stringify(KNOWLEDGE_PACK),
      ],
    );

    console.log(`Tenant zero ready: ${COMPANY_NAME} (${TENANT_ID})`);
    console.log(
      `Knowledge pack: ${KNOWLEDGE_PACK.services.length} services, transfer=${TRANSFER_PHONE}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
