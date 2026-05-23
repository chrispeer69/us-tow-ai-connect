/**
 * Tenant-zero seed for Sessions 21 + 22: 2 sample drivers, 2 sample trucks,
 * and 3 sample dispatch rules. Idempotent — keyed on (tenant_id, name) for
 * drivers/trucks and (tenant_id, name) for rules, so re-running this script
 * upserts rather than duplicates.
 */
import 'dotenv/config';
import { Pool } from 'pg';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// Central Ohio (Roadside Towing service area).
const DRIVERS = [
  {
    name: 'Marcus Hill',
    phone: '+16145550101',
    status: 'available',
    lat: 39.9612,
    lng: -82.9988,
  },
  {
    name: 'Sara Nguyen',
    phone: '+16145550102',
    status: 'available',
    lat: 40.0992,
    lng: -83.114,
  },
] as const;

const TRUCKS = [
  { name: 'Unit 12 (Flatbed)', type: 'flatbed', status: 'available' },
  { name: 'Unit 7 (Medium)', type: 'medium', status: 'available' },
] as const;

const RULES = [
  {
    name: 'Accept AAA jobs within 25mi between 06:00-22:00 local',
    priority: 10,
    enabled: true,
    action: 'accept',
    conditions: [
      { type: 'distance_max_miles', miles: 25 },
      { type: 'time_of_day', start: '06:00', end: '22:00' },
    ],
  },
  {
    name: 'Decline AAA jobs over 50 miles',
    priority: 20,
    enabled: true,
    action: 'decline',
    conditions: [{ type: 'distance_max_miles', miles: 50.0001 }, /* sentinel — flip via custom_jsonpath when distance > X */],
  },
  {
    name: 'Flag jobs with no estimated payout',
    priority: 30,
    enabled: true,
    action: 'flag',
    conditions: [
      {
        type: 'custom_jsonpath',
        // Truthy iff payout fields are *missing* — flips into "flag" branch.
        expression: '$[?(!@.estimated_payout && !@.payout && !@.amount)]',
      },
    ],
  },
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url, max: 1 });

  try {
    for (const d of DRIVERS) {
      await pool.query(
        `INSERT INTO drivers (tenant_id, name, phone, status, current_lat, current_lng, last_ping_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT DO NOTHING`,
        [TENANT_ID, d.name, d.phone, d.status, d.lat, d.lng],
      );
    }

    for (const t of TRUCKS) {
      await pool.query(
        `INSERT INTO trucks (tenant_id, name, type, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [TENANT_ID, t.name, t.type, t.status],
      );
    }

    for (const r of RULES) {
      // De-dup on (tenant_id, name) for rules so reruns are safe.
      const existing = await pool.query(
        'SELECT id FROM dispatch_rules WHERE tenant_id = $1 AND name = $2',
        [TENANT_ID, r.name],
      );
      if (existing.rowCount === 0) {
        await pool.query(
          `INSERT INTO dispatch_rules (tenant_id, name, enabled, priority, conditions, action)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [TENANT_ID, r.name, r.enabled, r.priority, JSON.stringify(r.conditions), r.action],
        );
      } else {
        await pool.query(
          `UPDATE dispatch_rules
             SET enabled = $3, priority = $4, conditions = $5::jsonb, action = $6, updated_at = NOW()
           WHERE tenant_id = $1 AND name = $2`,
          [TENANT_ID, r.name, r.enabled, r.priority, JSON.stringify(r.conditions), r.action],
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log(`Command-center seed ready for tenant ${TENANT_ID}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
