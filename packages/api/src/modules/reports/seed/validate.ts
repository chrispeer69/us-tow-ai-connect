/**
 * Session-44 validation harness. Drives the REAL ReportsService (read-only —
 * we never modify reports.service.ts) against the seeded tenant-zero data and
 * checks each of the 6 charts' math, units, ranges, empty state, cache, and CSV
 * export. Prints a PASS/FAIL line per check; exits non-zero if anything fails.
 *
 *   DATABASE_URL=… REDIS_URL=… tsx src/modules/reports/seed/validate.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import * as schema from '../../../db/schema';
import { ReportsService, resolveRange } from '../reports.service';
import { reportToCsv, csvFilename, type AnyReport } from '../reports.types';
import { generateDataset, TENANT_ID } from './generate';

const EMPTY_TENANT = '00000000-0000-0000-0000-0000000000ff'; // no data → empty-state

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  // eslint-disable-next-line no-console
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
function log(...a: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(...a);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: 1,
  });
  const svc = new ReportsService(db as never, redis as never);

  // Independent expectation from the same deterministic generator.
  const exp = generateDataset().summary;
  log(`\n=== S44 validation — expected from generator (seed ${exp.seed}) ===`);
  log(`jobs=${exp.jobs.total} accepted=${exp.jobs.accepted} completed=${exp.completed} ` +
    `sms(in/out)=${exp.sms.inbound}/${exp.sms.outbound}\n`);

  // ── 1. jobs-per-day (90d) ──
  log('1. jobs-per-day (90d)');
  const jpd = await svc.jobsPerDay(TENANT_ID, resolveRange({ range: '90d' }));
  const jpdSum = jpd.points.reduce((s, p) => s + p.jobs, 0);
  check('90 day points', jpd.points.length === 90, `${jpd.points.length}`);
  check('total == sum(points)', jpd.total === jpdSum, `total=${jpd.total} sum=${jpdSum}`);
  check('total == seeded jobs', jpd.total === exp.jobs.total, `got=${jpd.total} exp=${exp.jobs.total}`);
  check('all days present (gap-filled)', jpd.points.every((p) => typeof p.jobs === 'number'));

  // ── 2. win-rate ──
  log('2. win-rate (90d)');
  const wr = await svc.winRate(TENANT_ID, resolveRange({ range: '90d' }));
  const offered = wr.adapters.reduce((s, a) => s + a.offered, 0);
  const accepted = wr.adapters.reduce((s, a) => s + a.accepted, 0);
  check('sum offered == jobs', offered === exp.jobs.total, `${offered}/${exp.jobs.total}`);
  check('sum accepted == seeded accepted', accepted === exp.jobs.accepted, `${accepted}/${exp.jobs.accepted}`);
  check('3 adapters (aaa/towbook/direct)', wr.adapters.length === 3, wr.adapters.map((a) => a.source).join(','));
  check(
    'each winRate in [0,1] and ≈0.6',
    wr.adapters.every((a) => a.winRate >= 0 && a.winRate <= 1 && Math.abs(a.winRate - 0.6) < 0.1),
    wr.adapters.map((a) => `${a.source}=${(a.winRate * 100).toFixed(1)}%`).join(' '),
  );

  // ── 3. response-time (7d default + 90d) ──
  log('3. response-time');
  const rt7 = await svc.responseTime(TENANT_ID, resolveRange({}, '7d'));
  const rt90 = await svc.responseTime(TENANT_ID, resolveRange({ range: '90d' }));
  check('7d default → 7 points', rt7.points.length === 7, `${rt7.points.length}`);
  check('7d has dense samples', rt7.points.filter((p) => p.samples > 0).length >= 6, `${rt7.points.filter((p) => p.samples > 0).length}/7 days w/ samples`);
  check('avgSeconds within 90..480', rt7.avgSeconds >= 90 && rt7.avgSeconds <= 480, `${rt7.avgSeconds}s (${(rt7.avgSeconds / 60).toFixed(1)}m)`);
  check('90d samples == accepted (all dispatched)', rt90.points.reduce((s, p) => s + p.samples, 0) === exp.jobs.accepted, `${rt90.points.reduce((s, p) => s + p.samples, 0)}/${exp.jobs.accepted}`);

  // ── 4. revenue (stub) ──
  log('4. revenue (90d) — documented stub');
  const rev = await svc.revenue(TENANT_ID, resolveRange({ range: '90d' }));
  const compSum = rev.points.reduce((s, p) => s + p.completedJobs, 0);
  check('stubbed flag true', rev.stubbed === true);
  check('revenueCents null on every point', rev.points.every((p) => p.revenueCents === null));
  check('sum completedJobs == seeded completed', compSum === exp.completed, `${compSum}/${exp.completed}`);

  // ── 5. top-drivers ──
  log('5. top-drivers (90d)');
  const td = await svc.topDrivers(TENANT_ID, resolveRange({ range: '90d' }));
  const desc = td.drivers.every((d, i) => i === 0 || td.drivers[i - 1].completedJobs >= d.completedJobs);
  check('exactly 5 rows', td.drivers.length === 5, `${td.drivers.length}`);
  check('descending order', desc);
  check('top within 50..200 band', td.drivers.every((d) => d.completedJobs >= 50 && d.completedJobs <= 200), td.drivers.map((d) => d.completedJobs).join(','));
  check('names resolved (not "Unknown driver")', td.drivers.every((d) => d.name && d.name !== 'Unknown driver'), td.drivers.map((d) => d.name).join(' | '));
  check('top matches generator', td.drivers[0].completedJobs === exp.perDriverCompleted[0].completed, `svc=${td.drivers[0].completedJobs} gen=${exp.perDriverCompleted[0].completed}`);

  // ── 6. sms-volume ──
  log('6. sms-volume (90d)');
  const sms = await svc.smsVolume(TENANT_ID, resolveRange({ range: '90d' }));
  check('totalInbound == seeded', sms.totalInbound === exp.sms.inbound, `${sms.totalInbound}/${exp.sms.inbound}`);
  check('totalOutbound == seeded', sms.totalOutbound === exp.sms.outbound, `${sms.totalOutbound}/${exp.sms.outbound}`);
  check('inbound+outbound == total sms', sms.totalInbound + sms.totalOutbound === exp.sms.total, `${sms.totalInbound + sms.totalOutbound}/${exp.sms.total}`);

  // ── empty state (fresh tenant, no rows) ──
  log('empty state (tenant with zero data)');
  const eJpd = await svc.jobsPerDay(EMPTY_TENANT, resolveRange({ range: '30d' }));
  const eWr = await svc.winRate(EMPTY_TENANT, resolveRange({ range: '30d' }));
  const eTd = await svc.topDrivers(EMPTY_TENANT, resolveRange({ range: '30d' }));
  const eRt = await svc.responseTime(EMPTY_TENANT, resolveRange({}, '7d'));
  check('jobs-per-day zero-filled (30 pts, total 0)', eJpd.points.length === 30 && eJpd.total === 0);
  check('win-rate empty adapters', eWr.adapters.length === 0);
  check('top-drivers empty', eTd.drivers.length === 0);
  check('response-time all-zero, avg 0', eRt.avgSeconds === 0 && eRt.points.every((p) => p.samples === 0 && p.avgSeconds === 0));

  // ── date-range presets ──
  log('date-range presets');
  const j7 = await svc.jobsPerDay(TENANT_ID, resolveRange({ range: '7d' }));
  const j30 = await svc.jobsPerDay(TENANT_ID, resolveRange({ range: '30d' }));
  check('7d → 7 points', j7.points.length === 7);
  check('30d → 30 points', j30.points.length === 30);
  check('7d total ≤ 30d total ≤ 90d total', j7.total <= j30.total && j30.total <= jpd.total, `${j7.total} ≤ ${j30.total} ≤ ${jpd.total}`);
  const custom = await svc.jobsPerDay(TENANT_ID, resolveRange({ range: 'custom', from: '2026-04-01', to: '2026-04-30' }));
  check('custom 2026-04 → 30 points', custom.points.length === 30, `${custom.points.length}`);

  // ── cache (5-min TTL) ──
  log('redis cache (5-min TTL)');
  // fromIso/toIso embed `now`, so rather than reconstruct the exact key, confirm
  // a jobs-per-day key exists after the read above and carries the 300s TTL.
  const keys = await redis.keys(`reports:${TENANT_ID}:jobs-per-day:90d:*`);
  check('jobs-per-day cached after read', keys.length >= 1, `${keys.length} key(s)`);
  if (keys.length) {
    const ttl = await redis.ttl(keys[0]);
    check('TTL ≈ 300s (≤300, >0)', ttl > 0 && ttl <= 300, `ttl=${ttl}s`);
  }

  // ── CSV exports ──
  log('CSV exports (headers + RFC-4180 CRLF)');
  const csvChecks: Array<[AnyReport, string, string]> = [
    [jpd, 'date,jobs', 'jobs-per-day'],
    [wr, 'source,offered,accepted,win_rate', 'win-rate'],
    [rt90, 'date,avg_seconds,samples', 'response-time'],
    [rev, 'date,completed_jobs,revenue_cents', 'revenue'],
    [td, 'driver_id,name,completed_jobs', 'top-drivers'],
    [sms, 'date,inbound,outbound', 'sms-volume'],
  ];
  for (const [rep, header, metric] of csvChecks) {
    const csv = reportToCsv(rep);
    const firstLine = csv.split('\r\n')[0];
    check(`${metric} CSV header + CRLF + filename`, firstLine === header && csv.includes('\r\n') && csvFilename(rep.metric, rep.range) === `${metric}_${rep.range}.csv`, `"${firstLine}"`);
  }

  log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===`);
  await pool.end();
  redis.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
