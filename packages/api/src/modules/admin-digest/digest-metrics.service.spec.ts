import { describe, it, expect, beforeEach } from 'vitest';
import { DigestMetricsService } from './digest-metrics.service';

// We're testing the math: count = calls, totalMinutes = sum(duration_sec)/60,
// conversion = jobs/calls. The drizzle layer is mocked so the service just
// receives the rows it expected to query.

interface FakeSelectChain {
  from: (..._args: unknown[]) => FakeSelectChain;
  innerJoin?: (..._args: unknown[]) => FakeSelectChain;
  where: (..._args: unknown[]) => FakeSelectChain;
  groupBy?: (..._args: unknown[]) => FakeSelectChain;
  orderBy?: (..._args: unknown[]) => FakeSelectChain;
  limit?: (..._args: unknown[]) => FakeSelectChain;
}

function makeFakeDb(queryResponses: unknown[][]) {
  let cursor = 0;
  const consume = () => queryResponses[cursor++] ?? [];
  const chain = (): FakeSelectChain => {
    const c: Partial<FakeSelectChain> & { then?: (resolve: (v: unknown) => void) => Promise<void> } = {};
    c.from = () => chain();
    c.innerJoin = () => chain();
    c.where = () => chain();
    c.groupBy = () => chain();
    c.orderBy = () => chain();
    c.limit = () => chain();
    // Make this chain awaitable — returns the next queued response.
    c.then = async (resolve) => resolve(consume());
    return c as FakeSelectChain;
  };
  return {
    select: () => chain(),
  };
}

describe('DigestMetricsService.collect', () => {
  it('computes conversion rate from calls + jobs and folds dispatch_requests as ai_dispatch', async () => {
    // Order of select() calls in collect():
    //   1. collectCalls — count + totalSec
    //   2. collectJobsCreated — bySource grouped (then dispatch_requests count)
    //   3. dispatch_requests fallback count
    //   4. collectJobsCompleted
    //   5. collectDeclineReasons
    //   6. driver_pings group
    //   7. driver_job_events count
    //   8. collectTopCallers
    //   9. sms_messages failed count
    //  10. api_key_usage_stats throttled sum
    const db = makeFakeDb([
      [{ count: 100, totalSec: 6000 }],
      [
        { source: 'towbook', count: 25 },
        { source: 'aaa_salesforce', count: 15 },
      ],
      [{ count: 10 }], // dispatch_requests fallback
      [{ count: 30 }], // jobs completed
      [
        { reason: 'Estimated payout too low', count: 4 },
        { reason: 'Outside service area', count: 2 },
      ],
      [
        { phone: '+15550001', pingCount: 50 },
        { phone: '+15550002', pingCount: 30 },
      ],
      [{ count: 12 }], // distinct driver_job_events jobs
      [{ phone: '+15551111', count: 8 }],
      [{ count: 1 }], // sms failures
      [{ count: 5 }], // throttle hits
    ]);

    const service = new DigestMetricsService(db as never);
    const m = await service.collect('tenant-1', 'daily', new Date('2026-05-23T08:00:00Z'));
    expect(m.callsHandled.count).toBe(100);
    expect(m.callsHandled.totalMinutes).toBe(100); // 6000 / 60
    expect(m.callsHandled.avgDurationSec).toBe(60);
    expect(m.jobsCreated.total).toBe(50); // 25 + 15 + 10
    expect(m.jobsCreated.bySource).toEqual({
      towbook: 25,
      aaa_salesforce: 15,
      ai_dispatch: 10,
    });
    expect(m.jobsCompleted).toBe(30);
    expect(m.conversionRate).toBeCloseTo(0.5, 5); // 50 / 100
    expect(m.topDeclineReasons).toEqual([
      { reason: 'Estimated payout too low', count: 4 },
      { reason: 'Outside service area', count: 2 },
    ]);
    expect(m.driverActivity.activeDrivers).toBe(2);
    expect(m.driverActivity.totalMilesEstimated).toBe(4); // 80 pings * 0.05
    expect(m.driverActivity.avgJobsPerDriver).toBe(6); // 12 / 2
    expect(m.failures.failedSmsSends).toBe(1);
    expect(m.failures.rateLimitHits).toBe(5);
  });

  it('caps conversion at 100% even when more jobs than calls', async () => {
    const db = makeFakeDb([
      [{ count: 1, totalSec: 30 }],
      [{ source: 'towbook', count: 5 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [],
      [],
      [{ count: 0 }],
      [],
      [{ count: 0 }],
      [{ count: 0 }],
    ]);
    const service = new DigestMetricsService(db as never);
    const m = await service.collect('tenant-1', 'daily');
    expect(m.conversionRate).toBe(1);
  });

  it('returns zeroes when every source table errors out', async () => {
    const db = {
      select: () => {
        throw new Error('relation does not exist');
      },
    };
    const service = new DigestMetricsService(db as never);
    const m = await service.collect('tenant-1', 'daily');
    expect(m.callsHandled).toEqual({ count: 0, totalMinutes: 0, avgDurationSec: 0 });
    expect(m.jobsCreated.total).toBe(0);
    expect(m.conversionRate).toBe(0);
  });
});
