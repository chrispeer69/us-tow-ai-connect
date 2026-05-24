import { describe, it, expect } from 'vitest';
import { ReportsService, resolveRange, dayKey } from './reports.service';
import { reportToCsv } from './reports.types';
import { drivers, smsMessages, unifiedJobs } from '../../db/schema';

/**
 * Mock Drizzle by *table* (first arg to `.from()`), mirroring the digest
 * metrics spec. Each aggregator runs a single query, so per-table mapping is
 * unambiguous. The chain is thenable so `await db.select()...` resolves to the
 * configured rows.
 */
type Rows = unknown[];
function makeFakeDb(byTable: Map<unknown, Rows>) {
  const chain = (table: unknown): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    c.from = (t: unknown) => chain(t ?? table);
    c.leftJoin = () => chain(table);
    c.innerJoin = () => chain(table);
    c.where = () => chain(table);
    c.groupBy = () => chain(table);
    c.orderBy = () => chain(table);
    c.limit = () => chain(table);
    c.then = (resolve: (v: unknown) => void) => resolve(byTable.get(table) ?? []);
    return c;
  };
  return { select: () => chain(undefined) } as never;
}

// Redis double that always misses + accepts writes — exercises the cache path
// without a live server.
const fakeRedis = {
  get: async () => null,
  set: async () => 'OK',
} as never;

function service(byTable: Map<unknown, Rows>) {
  return new ReportsService(makeFakeDb(byTable), fakeRedis);
}

// Fixed "now" so day keys are deterministic.
const NOW = new Date('2026-05-24T12:00:00.000Z');

describe('resolveRange', () => {
  it('builds a 7-day inclusive UTC window', () => {
    const r = resolveRange({ range: '7d' }, '30d', NOW);
    expect(r.range).toBe('7d');
    expect(r.days).toHaveLength(7);
    expect(r.days[0]).toBe('2026-05-18');
    expect(r.days[6]).toBe('2026-05-24');
    expect(r.fromIso).toBe('2026-05-18T00:00:00.000Z');
  });

  it('defaults unknown ranges to the supplied default', () => {
    const r = resolveRange({ range: 'bogus' }, '30d', NOW);
    expect(r.range).toBe('30d');
    expect(r.days).toHaveLength(30);
  });

  it('honours a valid custom window', () => {
    const r = resolveRange({ range: 'custom', from: '2026-05-01', to: '2026-05-03' }, '30d', NOW);
    expect(r.range).toBe('custom');
    expect(r.days).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
  });

  it('falls back to default when custom bounds are invalid or inverted', () => {
    const inverted = resolveRange({ range: 'custom', from: '2026-05-05', to: '2026-05-01' }, '7d', NOW);
    expect(inverted.range).toBe('7d');
    const missing = resolveRange({ range: 'custom', from: '2026-05-05' }, '7d', NOW);
    expect(missing.range).toBe('7d');
  });
});

describe('ReportsService.jobsPerDay', () => {
  it('gap-fills every day in the window and totals counts', async () => {
    const byTable = new Map<unknown, Rows>();
    byTable.set(unifiedJobs, [
      { day: '2026-05-24', count: 4 },
      { day: '2026-05-22', count: 2 },
    ]);
    const win = resolveRange({ range: '7d' }, '30d', NOW);
    const report = await service(byTable).jobsPerDay('t1', win);

    expect(report.points).toHaveLength(7);
    expect(report.total).toBe(6);
    expect(report.points.find((p) => p.date === '2026-05-24')?.jobs).toBe(4);
    expect(report.points.find((p) => p.date === '2026-05-23')?.jobs).toBe(0);
  });

  it('returns a zero-filled report for an empty tenant', async () => {
    const win = resolveRange({ range: '7d' }, '30d', NOW);
    const report = await service(new Map()).jobsPerDay('fresh', win);
    expect(report.total).toBe(0);
    expect(report.points.every((p) => p.jobs === 0)).toBe(true);
  });
});

describe('ReportsService.winRate', () => {
  it('computes accepted/offered per adapter, sorted by volume', async () => {
    const byTable = new Map<unknown, Rows>();
    byTable.set(unifiedJobs, [
      { source: 'aaa_salesforce', offered: 4, accepted: 1 },
      { source: 'towbook', offered: 10, accepted: 7 },
    ]);
    const win = resolveRange({ range: '30d' }, '30d', NOW);
    const report = await service(byTable).winRate('t1', win);

    expect(report.adapters[0].source).toBe('towbook'); // highest offered first
    expect(report.adapters[0].winRate).toBe(0.7);
    expect(report.adapters[1].winRate).toBe(0.25);
  });

  it('reports a 0 win rate when nothing was offered', async () => {
    const byTable = new Map<unknown, Rows>();
    byTable.set(unifiedJobs, [{ source: 'towbook', offered: 0, accepted: 0 }]);
    const report = await service(byTable).winRate('t1', resolveRange({ range: '30d' }, '30d', NOW));
    expect(report.adapters[0].winRate).toBe(0);
  });
});

describe('ReportsService.responseTime', () => {
  it('weights the window average by per-day sample counts', async () => {
    const byTable = new Map<unknown, Rows>();
    byTable.set(unifiedJobs, [
      { day: '2026-05-24', avgSeconds: 120, samples: 3 },
      { day: '2026-05-23', avgSeconds: 300, samples: 1 },
    ]);
    const win = resolveRange({ range: '7d' }, '7d', NOW);
    const report = await service(byTable).responseTime('t1', win);

    expect(report.points).toHaveLength(7);
    // (120*3 + 300*1) / 4 = 165
    expect(report.avgSeconds).toBe(165);
    expect(report.points.find((p) => p.date === '2026-05-24')?.samples).toBe(3);
  });
});

describe('ReportsService.revenue', () => {
  it('is stubbed: completed-job counts with null revenue', async () => {
    const byTable = new Map<unknown, Rows>();
    byTable.set(unifiedJobs, [{ day: '2026-05-24', count: 5 }]);
    const report = await service(byTable).revenue('t1', resolveRange({ range: '7d' }, '7d', NOW));
    expect(report.stubbed).toBe(true);
    expect(report.points.find((p) => p.date === '2026-05-24')?.completedJobs).toBe(5);
    expect(report.points[0].revenueCents).toBeNull();
  });
});

describe('ReportsService.topDrivers', () => {
  it('maps driver names and falls back to a placeholder', async () => {
    const byTable = new Map<unknown, Rows>();
    byTable.set(unifiedJobs, [
      { driverId: 'd1', name: 'Ada', completedJobs: 9 },
      { driverId: 'd2', name: null, completedJobs: 3 },
    ]);
    const report = await service(byTable).topDrivers('t1', resolveRange({ range: '30d' }, '30d', NOW));
    expect(report.drivers[0]).toEqual({ driverId: 'd1', name: 'Ada', completedJobs: 9 });
    expect(report.drivers[1].name).toBe('Unknown driver');
  });
});

describe('ReportsService.smsVolume', () => {
  it('splits inbound vs outbound per day and totals both', async () => {
    const byTable = new Map<unknown, Rows>();
    byTable.set(smsMessages, [
      { day: '2026-05-24', direction: 'inbound', count: 3 },
      { day: '2026-05-24', direction: 'outbound', count: 5 },
      { day: '2026-05-23', direction: 'outbound', count: 2 },
    ]);
    const win = resolveRange({ range: '7d' }, '7d', NOW);
    const report = await service(byTable).smsVolume('t1', win);

    expect(report.totalInbound).toBe(3);
    expect(report.totalOutbound).toBe(7);
    const today = report.points.find((p) => p.date === '2026-05-24');
    expect(today).toEqual({ date: '2026-05-24', inbound: 3, outbound: 5 });
  });
});

describe('reportToCsv', () => {
  const win = resolveRange({ range: 'custom', from: '2026-05-23', to: '2026-05-24' }, '30d', NOW);

  it('serializes jobs-per-day to a stable CSV', async () => {
    const byTable = new Map<unknown, Rows>();
    byTable.set(unifiedJobs, [{ day: '2026-05-24', count: 4 }]);
    const report = await service(byTable).jobsPerDay('t1', win);
    expect(reportToCsv(report)).toMatchInlineSnapshot(`
      "date,jobs
      2026-05-23,0
      2026-05-24,4
      "
    `);
  });

  it('serializes win-rate to a stable CSV', async () => {
    const byTable = new Map<unknown, Rows>();
    byTable.set(unifiedJobs, [{ source: 'towbook', offered: 10, accepted: 7 }]);
    const report = await service(byTable).winRate('t1', win);
    expect(reportToCsv(report)).toMatchInlineSnapshot(`
      "source,offered,accepted,win_rate
      towbook,10,7,0.7
      "
    `);
  });

  it('serializes sms-volume to a stable CSV', async () => {
    const byTable = new Map<unknown, Rows>();
    byTable.set(smsMessages, [
      { day: '2026-05-24', direction: 'inbound', count: 3 },
      { day: '2026-05-24', direction: 'outbound', count: 5 },
    ]);
    const report = await service(byTable).smsVolume('t1', win);
    expect(reportToCsv(report)).toMatchInlineSnapshot(`
      "date,inbound,outbound
      2026-05-23,0,0
      2026-05-24,3,5
      "
    `);
  });

  it('serializes revenue (stubbed) with empty revenue cells', async () => {
    const byTable = new Map<unknown, Rows>();
    byTable.set(unifiedJobs, [{ day: '2026-05-24', count: 2 }]);
    const report = await service(byTable).revenue('t1', win);
    expect(reportToCsv(report)).toMatchInlineSnapshot(`
      "date,completed_jobs,revenue_cents
      2026-05-23,0,
      2026-05-24,2,
      "
    `);
  });
});

describe('dayKey', () => {
  it('formats a UTC day key', () => {
    expect(dayKey(new Date('2026-05-24T23:59:00.000Z'))).toBe('2026-05-24');
  });
});
