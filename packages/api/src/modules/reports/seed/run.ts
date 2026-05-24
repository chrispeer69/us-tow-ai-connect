/**
 * CLI for the Session-44 reports validation seed.
 *
 *   (no flag)            dry-run — generates the dataset and prints the plan;
 *                        NEVER connects to the DB.
 *   --apply              wipes existing synthetic rows then inserts a fresh,
 *                        deterministic dataset; flushes the reports cache.
 *   --cleanup            deletes synthetic rows only; flushes the cache.
 *   --tenant-zero-only   required when DATABASE_URL host is not localhost.
 *   --seed=N             override the RNG seed (default 44).
 *
 * Everything is hard-scoped to tenant-zero. Cleanup matches `tenant_id` AND a
 * per-table synthetic marker (see MARKERS) so real rows can never be touched.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import {
  generateDataset,
  MARKERS,
  TENANT_ID,
  DEFAULT_SEED,
  type SeedDataset,
} from './generate';

interface Flags {
  apply: boolean;
  cleanup: boolean;
  tenantZeroOnly: boolean;
  seed: number;
}

function parseFlags(argv: string[]): Flags {
  const seedArg = argv.find((a) => a.startsWith('--seed='));
  return {
    apply: argv.includes('--apply'),
    cleanup: argv.includes('--cleanup'),
    tenantZeroOnly: argv.includes('--tenant-zero-only'),
    seed: seedArg ? Number(seedArg.split('=')[1]) : DEFAULT_SEED,
  };
}

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(...args);
}

function isLocalHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

function printSummary(ds: SeedDataset) {
  const s = ds.summary;
  log('\n── synthetic dataset plan (tenant-zero) ───────────────────────────');
  log(`now=${s.now}  seed=${s.seed}  window=${s.windowDays}d`);
  log(`drivers:   ${s.drivers}`);
  log(
    `jobs:      ${s.jobs.total}  (accepted ${s.jobs.accepted}, declined ${s.jobs.declined}, expired ${s.jobs.expired})`,
  );
  log(`  byStatus: ${JSON.stringify(s.jobsByStatus)}`);
  log(`  bySource: ${JSON.stringify(s.jobsBySource)}`);
  log(`  completed: ${s.completed}   withDispatch (response-time samples): ${s.withDispatch}`);
  log(`sms:       ${s.sms.total}  (inbound ${s.sms.inbound}, outbound ${s.sms.outbound})`);
  log(`pings:     ${s.pings}`);
  log('  top-5 drivers by completed jobs:');
  for (const d of s.perDriverCompleted.slice(0, 5)) log(`    ${d.completed.toString().padStart(4)}  ${d.name}`);
  const tail = s.perDriverCompleted.slice(5);
  if (tail.length) {
    const lo = Math.min(...tail.map((t) => t.completed));
    const hi = Math.max(...tail.map((t) => t.completed));
    log(`    (drivers 6-${s.drivers}: ${lo}-${hi} completed each)`);
  }
  log('───────────────────────────────────────────────────────────────────\n');
}

// ─── cleanup: tenant_id AND marker, every table ─────────────────────────────
async function cleanupSynthetic(pool: Pool): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const r1 = await pool.query(
    `DELETE FROM sms_messages WHERE tenant_id = $1 AND twilio_sid LIKE $2`,
    [TENANT_ID, `${MARKERS.smsSidPrefix}%`],
  );
  out.sms_messages = r1.rowCount ?? 0;
  const r2 = await pool.query(`DELETE FROM driver_pings WHERE tenant_id = $1 AND source = $2`, [
    TENANT_ID,
    MARKERS.pingSource,
  ]);
  out.driver_pings = r2.rowCount ?? 0;
  const r3 = await pool.query(
    `DELETE FROM unified_jobs WHERE tenant_id = $1 AND source_job_id LIKE $2 AND source_payload->>'synthetic' = 'true'`,
    [TENANT_ID, `${MARKERS.jobSourceIdPrefix}%`],
  );
  out.unified_jobs = r3.rowCount ?? 0;
  const r4 = await pool.query(`DELETE FROM drivers WHERE tenant_id = $1 AND phone LIKE $2`, [
    TENANT_ID,
    `${MARKERS.driverPhonePrefix}%`,
  ]);
  out.drivers = r4.rowCount ?? 0;
  return out;
}

/** Generic chunked multi-row insert. `cols` are column names; `rows` are value arrays. */
async function insertRows(
  pool: Pool,
  table: string,
  cols: string[],
  rows: unknown[][],
  jsonbCols: Set<number> = new Set(),
): Promise<number> {
  if (rows.length === 0) return 0;
  const perRow = cols.length;
  const maxParams = 60_000;
  const chunkSize = Math.max(1, Math.floor(maxParams / perRow));
  let inserted = 0;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = row.map((val, ci) => {
        params.push(val);
        return jsonbCols.has(ci) ? `$${params.length}::jsonb` : `$${params.length}`;
      });
      return `(${placeholders.join(',')})`;
    });
    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`;
    const res = await pool.query(sql, params);
    inserted += res.rowCount ?? chunk.length;
  }
  return inserted;
}

async function applyDataset(pool: Pool, ds: SeedDataset): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  // drivers
  counts.drivers = await insertRows(
    pool,
    'drivers',
    ['id', 'tenant_id', 'name', 'phone', 'status', 'current_lat', 'current_lng', 'last_ping_at'],
    ds.drivers.map((d) => [d.id, TENANT_ID, d.name, d.phone, d.status, d.lat, d.lng, ds.summary.now]),
  );

  // unified_jobs
  counts.unified_jobs = await insertRows(
    pool,
    'unified_jobs',
    [
      'tenant_id', 'source', 'source_job_id', 'source_payload', 'status', 'caller_phone',
      'caller_name', 'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_color',
      'pickup_address', 'service_type', 'priority', 'assigned_driver_id', 'eta_minutes',
      'accepted_at', 'dispatched_at', 'arrived_at', 'completed_at', 'auto_decision',
      'auto_decision_reason', 'auto_decided_at', 'created_at', 'updated_at',
    ],
    ds.jobs.map((j) => [
      TENANT_ID, j.source, j.sourceJobId, JSON.stringify(j.sourcePayload), j.status, j.callerPhone,
      j.callerName, j.vehicleYear, j.vehicleMake, j.vehicleModel, j.vehicleColor,
      j.pickupAddress, j.serviceType, j.priority, j.assignedDriverId, j.etaMinutes,
      j.acceptedAt, j.dispatchedAt, j.arrivedAt, j.completedAt, j.autoDecision,
      j.autoDecisionReason, j.autoDecidedAt, j.createdAt, j.createdAt,
    ]),
    new Set([3]), // source_payload is jsonb
  );

  // sms_messages
  counts.sms_messages = await insertRows(
    pool,
    'sms_messages',
    ['tenant_id', 'direction', 'to_phone', 'from_phone', 'body', 'twilio_sid', 'status', 'sent_at', 'delivered_at', 'created_at'],
    ds.sms.map((m) => [
      TENANT_ID, m.direction, m.toPhone, m.fromPhone, m.body, m.twilioSid, m.status, m.sentAt, m.deliveredAt, m.createdAt,
    ]),
  );

  // driver_pings
  counts.driver_pings = await insertRows(
    pool,
    'driver_pings',
    ['tenant_id', 'driver_phone', 'driver_name', 'lat', 'lng', 'heading', 'speed_mph', 'accuracy_m', 'battery_pct', 'source', 'recorded_at'],
    ds.pings.map((p) => [
      TENANT_ID, p.driverPhone, p.driverName, p.lat, p.lng, p.heading, p.speedMph, p.accuracyM, p.batteryPct, p.source, p.recordedAt,
    ]),
  );

  return counts;
}

/** Best-effort flush of the 5-min reports cache for tenant-zero. */
async function flushReportsCache(): Promise<number> {
  const url = process.env.REDIS_URL;
  if (!url) {
    log('[cache] REDIS_URL not set — skipping cache flush (it will expire in ≤5 min).');
    return 0;
  }
  // Lazy import so a missing ioredis dep never breaks dry-run.
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    const keys = await redis.keys(`reports:${TENANT_ID}:*`);
    if (keys.length) await redis.del(...keys);
    log(`[cache] flushed ${keys.length} reports cache key(s).`);
    return keys.length;
  } catch (err) {
    log(`[cache] flush skipped (${(err as Error).message}); cache expires in ≤5 min.`);
    return 0;
  } finally {
    redis.disconnect();
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const flags = parseFlags(argv);
  const ds = generateDataset({ seed: flags.seed });

  // ── dry-run (default) — no DB connection ──
  if (!flags.apply && !flags.cleanup) {
    log('DRY-RUN (default). No database connection made. Pass --apply to write.');
    printSummary(ds);
    log('Markers used for idempotent cleanup:');
    log(`  unified_jobs : source_job_id LIKE '${MARKERS.jobSourceIdPrefix}%' AND source_payload.synthetic = true`);
    log(`  drivers      : phone LIKE '${MARKERS.driverPhonePrefix}%'`);
    log(`  driver_pings : source = '${MARKERS.pingSource}'`);
    log(`  sms_messages : twilio_sid LIKE '${MARKERS.smsSidPrefix}%'`);
    return;
  }

  // ── DB-touching modes: safety gate ──
  const url = process.env.DATABASE_URL;
  if (!url) {
    log('ERROR: DATABASE_URL is required for --apply/--cleanup.');
    process.exitCode = 2;
    return;
  }
  if (!isLocalHost(url) && !flags.tenantZeroOnly) {
    log('REFUSING: DATABASE_URL host is not localhost. Re-run with --tenant-zero-only to');
    log('acknowledge you intend to write ONLY tenant-zero synthetic rows to a remote DB.');
    process.exitCode = 3;
    return;
  }

  const pool = new Pool({ connectionString: url, max: 4 });
  try {
    // Assert tenant-zero exists — clean error instead of FK noise.
    const t = await pool.query('SELECT 1 FROM tenants WHERE id = $1', [TENANT_ID]);
    if (t.rowCount === 0) {
      log(`ERROR: tenant-zero (${TENANT_ID}) does not exist. Run the tenant-zero base seed first.`);
      process.exitCode = 4;
      return;
    }

    if (flags.cleanup && !flags.apply) {
      log('CLEANUP: deleting synthetic rows for tenant-zero…');
      const deleted = await cleanupSynthetic(pool);
      log(`  deleted: ${JSON.stringify(deleted)}`);
      await flushReportsCache();
      return;
    }

    // --apply: idempotent — wipe synthetic, then insert fresh.
    log('APPLY: re-seeding tenant-zero synthetic data (idempotent)…');
    const deleted = await cleanupSynthetic(pool);
    log(`  cleared prior synthetic rows: ${JSON.stringify(deleted)}`);
    printSummary(ds);
    const inserted = await applyDataset(pool, ds);
    log(`  inserted: ${JSON.stringify(inserted)}`);
    await flushReportsCache();
    log('APPLY complete.');
  } finally {
    await pool.end();
  }
}

// Run when invoked directly (tsx / node).
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
