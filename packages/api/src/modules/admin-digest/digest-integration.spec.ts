import { describe, it, expect } from 'vitest';
import { DigestMetricsService, type DigestMetrics } from './digest-metrics.service';
import { renderDigestHtml } from './digest-renderer';

/**
 * Integration-ish test (Bundle B section 6 requirement): "simulated day of
 * activity → digest preview returns expected metrics". We stand up an
 * in-memory fake that mimics a real production day, run the metrics
 * collector AND the renderer end-to-end, and assert the resulting HTML
 * contains the same numbers a human would expect after that day.
 *
 * The fake DB is intentionally minimal — every row the service needs lives
 * in a Map<table, rows[]>, and the chain mock returns each table's payload
 * verbatim. No drizzle SQL is exercised; the contract under test is the
 * full pipeline shape, not the SQL.
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

const SIMULATED_DAY = {
  calls: { count: 84, totalSec: 5400 }, // 90 min, ~64s avg
  unifiedJobsBySource: [
    { source: 'towbook', count: 31 },
    { source: 'aaa_salesforce', count: 8 },
  ],
  legacyDispatchRequests: { count: 3 }, // 3 ai_dispatch
  jobsCompleted: { count: 27 },
  declines: [
    { reason: 'No driver within range', count: 5 },
    { reason: 'Payout too low', count: 2 },
  ],
  driverPings: [
    { phone: '+16140001', pingCount: 240 },
    { phone: '+16140002', pingCount: 198 },
    { phone: '+16140003', pingCount: 110 },
  ],
  driverJobEvents: { count: 28 },
  topCallers: [
    { phone: '+16145551234', count: 6 },
    { phone: '+16147654321', count: 4 },
  ],
  failedSms: { count: 4 },
  rateLimitHits: { count: 11 },
};

function fakeDbFromDay() {
  const byTable = new Map<unknown, unknown[]>();
  byTable.set(callInteractions, [{ count: SIMULATED_DAY.calls.count, totalSec: SIMULATED_DAY.calls.totalSec }]);
  byTable.set(unifiedJobs, SIMULATED_DAY.unifiedJobsBySource);
  byTable.set(dispatchRequests, [{ count: SIMULATED_DAY.legacyDispatchRequests.count }]);
  byTable.set(dispatchDecisions, SIMULATED_DAY.declines);
  byTable.set(driverPings, SIMULATED_DAY.driverPings);
  byTable.set(driverJobEvents, [{ count: SIMULATED_DAY.driverJobEvents.count }]);
  byTable.set(smsMessages, [{ count: SIMULATED_DAY.failedSms.count }]);
  byTable.set(apiKeyUsageStats, [{ count: SIMULATED_DAY.rateLimitHits.count }]);

  const chain = (table: unknown): { then: (r: (v: unknown) => void) => Promise<void> } & Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    c.from = (t: unknown) => chain(t ?? table);
    c.innerJoin = (t: unknown) => chain(table ?? t);
    c.where = () => chain(table);
    c.groupBy = () => chain(table);
    c.orderBy = () => chain(table);
    c.limit = () => chain(table);
    c.then = async (resolve: (v: unknown) => void) => resolve(byTable.get(table) ?? []);
    return c as never;
  };
  return { select: () => chain(undefined) };
}

describe('digest end-to-end — simulated day of activity', () => {
  it('produces metrics consistent with the simulated day', async () => {
    const service = new DigestMetricsService(fakeDbFromDay() as never);
    const m = await service.collect('tenant-1', 'daily', new Date('2026-05-23T08:00:00Z'));

    // 84 calls, 5400 sec = 90 min, 64s avg
    expect(m.callsHandled.count).toBe(84);
    expect(m.callsHandled.totalMinutes).toBe(90);
    expect(m.callsHandled.avgDurationSec).toBe(64);

    // 31 + 8 + 3 (legacy dispatch_requests folded as ai_dispatch) = 42
    expect(m.jobsCreated.total).toBe(42);
    expect(m.jobsCreated.bySource.towbook).toBe(31);
    expect(m.jobsCreated.bySource.aaa_salesforce).toBe(8);
    expect(m.jobsCreated.bySource.ai_dispatch).toBe(3);

    // 42 / 84 = 0.5
    expect(m.conversionRate).toBeCloseTo(0.5, 5);

    expect(m.topDeclineReasons[0].reason).toBe('No driver within range');
    expect(m.topDeclineReasons[0].count).toBe(5);

    expect(m.driverActivity.activeDrivers).toBe(3);
    // 240+198+110 = 548 pings * 0.05 mi/ping = 27.4 → round to 27
    expect(m.driverActivity.totalMilesEstimated).toBe(27);

    expect(m.failures.failedSmsSends).toBe(4);
    expect(m.failures.rateLimitHits).toBe(11);
  });

  it('renders the simulated-day HTML with the same numbers a human would expect', async () => {
    const service = new DigestMetricsService(fakeDbFromDay() as never);
    const metrics = await service.collect('tenant-1', 'daily');

    const html = renderDigestHtml({
      tenantName: 'Roadside Towing',
      metrics,
      webBaseUrl: 'https://app.example.com',
    });

    expect(html).toContain('84'); // calls
    expect(html).toContain('90'); // total minutes
    expect(html).toContain('50.0%'); // conversion rate
    expect(html).toContain('towbook');
    expect(html).toContain('aaa_salesforce');
    expect(html).toContain('No driver within range');
    expect(html).toContain('Roadside Towing');
  });
});

// Reference shape — keeps the DigestMetrics type imported so a future shape
// change forces a corresponding test update.
type _Shape = DigestMetrics;
