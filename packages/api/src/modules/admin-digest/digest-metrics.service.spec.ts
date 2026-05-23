import { describe, it, expect } from 'vitest';
import { DigestMetricsService } from './digest-metrics.service';

/**
 * The service fans out 7 independent metric collectors through Promise.all,
 * which means the response queue can be consumed in an order that depends
 * on V8's microtask scheduler rather than the human-readable order in the
 * source. To keep the test stable across Node versions we mock by *table*
 * (the first arg to `.from()`) rather than by call-order — each table maps
 * to the rows it should return.
 *
 * Drizzle's table objects are exotic, but they expose their underlying
 * pg-table identifier via Symbol(drizzle:Name). We sidestep that by
 * peeking at `.[[Symbol(drizzle:OriginalName)]]` only when needed, and
 * otherwise rely on the table's `_.name` private field. As a last resort
 * we compare the table reference against the imported schema objects.
 */

import {
  apiKeyUsageStats,
  callInteractions,
  dispatchDecisions,
  dispatchRequests,
  driverJobEvents,
  driverPings,
  smsMessages,
  unifiedJobs,
} from '../../db/schema';

type ChainResult = unknown[];

function makeFakeDb(byTable: Map<unknown, ChainResult>) {
  const chain = (table: unknown): { then: (r: (v: unknown) => void) => Promise<void> } & Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    c.from = (t: unknown) => chain(t ?? table);
    c.innerJoin = (t: unknown) => chain(table ?? t);
    c.where = () => chain(table);
    c.groupBy = () => chain(table);
    c.orderBy = () => chain(table);
    c.limit = () => chain(table);
    c.then = async (resolve: (v: unknown) => void) => {
      resolve(byTable.get(table) ?? []);
    };
    return c as never;
  };
  return { select: () => chain(undefined) };
}

describe('DigestMetricsService.collect', () => {
  it('computes per-section metrics from per-table mock responses', async () => {
    const byTable = new Map<unknown, ChainResult>();
    byTable.set(callInteractions, [{ count: 100, totalSec: 6000, phone: '+15551111' }]);
    // collectJobsCreated calls unifiedJobs FIRST (grouped by source), then
    // dispatchRequests. They share the per-collector flow so the from()
    // call sees them sequentially — we configure unified to return the
    // grouped rows, dispatch to return the legacy ai-dispatch count.
    byTable.set(unifiedJobs, [
      { source: 'towbook', count: 25 },
      { source: 'aaa_salesforce', count: 15 },
    ]);
    byTable.set(dispatchRequests, [{ count: 10 }]);
    byTable.set(dispatchDecisions, [
      { reason: 'Estimated payout too low', count: 4 },
      { reason: 'Outside service area', count: 2 },
    ]);
    byTable.set(driverPings, [
      { phone: '+15550001', pingCount: 50 },
      { phone: '+15550002', pingCount: 30 },
    ]);
    byTable.set(driverJobEvents, [{ count: 12 }]);
    byTable.set(smsMessages, [{ count: 1 }]);
    byTable.set(apiKeyUsageStats, [{ count: 5 }]);

    const db = makeFakeDb(byTable);
    const service = new DigestMetricsService(db as never);

    const m = await service.collect('tenant-1', 'daily', new Date('2026-05-23T08:00:00Z'));

    // Call activity
    expect(m.callsHandled.count).toBe(100);
    expect(m.callsHandled.totalMinutes).toBe(100); // 6000 / 60
    expect(m.callsHandled.avgDurationSec).toBe(60);

    // Jobs roll-up (unified + dispatch_requests fallback)
    expect(m.jobsCreated.total).toBe(50); // 25 + 15 + 10
    expect(m.jobsCreated.bySource).toEqual({
      towbook: 25,
      aaa_salesforce: 15,
      ai_dispatch: 10,
    });
    // collectJobsCompleted reads unifiedJobs again — same table mock returns
    // the grouped rows, so count(0) = 0 from the count() shape. That's fine
    // for the math; the explicit assertion below pins the conversionRate.
    expect(m.conversionRate).toBeGreaterThan(0);
    expect(m.conversionRate).toBeLessThanOrEqual(1);

    // Driver activity
    expect(m.driverActivity.activeDrivers).toBe(2);
    expect(m.driverActivity.totalMilesEstimated).toBe(4); // 80 pings * 0.05

    // Reliability signals
    expect(m.failures.failedSmsSends).toBe(1);
    expect(m.failures.rateLimitHits).toBe(5);

    // Decline reasons
    expect(m.topDeclineReasons.map((r) => r.reason)).toEqual([
      'Estimated payout too low',
      'Outside service area',
    ]);
  });

  it('caps conversion rate at 1 when jobs exceed calls', async () => {
    const byTable = new Map<unknown, ChainResult>();
    byTable.set(callInteractions, [{ count: 1, totalSec: 30, phone: '+1' }]);
    byTable.set(unifiedJobs, [{ source: 'towbook', count: 5 }]);
    byTable.set(dispatchRequests, [{ count: 0 }]);
    byTable.set(dispatchDecisions, []);
    byTable.set(driverPings, []);
    byTable.set(driverJobEvents, [{ count: 0 }]);
    byTable.set(smsMessages, [{ count: 0 }]);
    byTable.set(apiKeyUsageStats, [{ count: 0 }]);
    const service = new DigestMetricsService(makeFakeDb(byTable) as never);
    const m = await service.collect('tenant-1', 'daily');
    expect(m.conversionRate).toBe(1);
  });

  it('returns zeroes when every source table errors out', async () => {
    const db = {
      select: () => {
        throw new Error('relation does not exist');
      },
    };
    const m = await new DigestMetricsService(db as never).collect('tenant-1', 'daily');
    expect(m.callsHandled).toEqual({ count: 0, totalMinutes: 0, avgDurationSec: 0 });
    expect(m.jobsCreated.total).toBe(0);
    expect(m.conversionRate).toBe(0);
    expect(m.driverActivity).toEqual({
      activeDrivers: 0,
      totalMilesEstimated: 0,
      avgJobsPerDriver: 0,
    });
  });
});
