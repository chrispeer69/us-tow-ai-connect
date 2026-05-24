import { describe, expect, it } from 'vitest';
import { evaluateAll, evaluateCondition, type EvaluationContext } from './conditions';
import type { UnifiedJobRow } from '../../db/schema';

function makeJob(partial: Partial<UnifiedJobRow> = {}): UnifiedJobRow {
  return {
    id: 'job-1',
    tenantId: 'tenant-1',
    source: 'aaa_salesforce',
    sourceJobId: 'WO-1',
    sourcePayload: {},
    status: 'new',
    callerPhone: null,
    callerName: null,
    vehicleYear: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleColor: null,
    pickupAddress: null,
    pickupLat: null,
    pickupLng: null,
    dropoffAddress: null,
    dropoffLat: null,
    dropoffLng: null,
    serviceType: null,
    priority: 'normal',
    assignedDriverId: null,
    assignedTruckId: null,
    etaMinutes: null,
    acceptedAt: null,
    dispatchedAt: null,
    arrivedAt: null,
    completedAt: null,
    autoDecision: null,
    autoDecisionReason: null,
    autoDecidedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as UnifiedJobRow;
}

function makeCtx(over: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    job: makeJob(),
    tenantTimezone: 'America/New_York',
    now: new Date('2026-05-23T14:30:00-04:00'),
    drivers: [],
    ...over,
  };
}

describe('evaluateCondition', () => {
  describe('distance_max_miles', () => {
    it('matches when closest active driver is within radius', () => {
      const job = makeJob({ pickupLat: '40.0' as unknown as string, pickupLng: '-83.0' as unknown as string });
      const now = new Date('2026-05-23T14:30:00-04:00');
      const ctx = makeCtx({
        job,
        now,
        drivers: [
          { id: 'd1', status: 'available', currentLat: '40.05', currentLng: '-83.02', lastPingAt: now },
        ],
      });
      const r = evaluateCondition({ type: 'distance_max_miles', miles: 5 }, ctx);
      expect(r.matched).toBe(true);
    });
    it('rejects when no driver has a recent ping', () => {
      const job = makeJob({ pickupLat: '40.0' as unknown as string, pickupLng: '-83.0' as unknown as string });
      // Anchor the stale ping to ctx.now (not real Date.now()), otherwise a
      // fixed past ctx.now leaves the "1h ago" ping in the future and recent.
      const now = new Date('2026-05-23T14:30:00-04:00');
      const old = new Date(now.getTime() - 60 * 60 * 1000);
      const ctx = makeCtx({
        job,
        now,
        drivers: [
          { id: 'd1', status: 'available', currentLat: '40.05', currentLng: '-83.02', lastPingAt: old },
        ],
      });
      const r = evaluateCondition({ type: 'distance_max_miles', miles: 5 }, ctx);
      expect(r.matched).toBe(false);
      expect(r.reason).toContain('recent location ping');
    });
    it('rejects when job has no geocoded pickup', () => {
      const r = evaluateCondition({ type: 'distance_max_miles', miles: 5 }, makeCtx());
      expect(r.matched).toBe(false);
    });
  });

  describe('time_of_day', () => {
    it('matches inside the window', () => {
      const ctx = makeCtx({ now: new Date('2026-05-23T15:00:00-04:00') });
      const r = evaluateCondition({ type: 'time_of_day', start: '06:00', end: '22:00' }, ctx);
      expect(r.matched).toBe(true);
    });
    it('rejects outside the window', () => {
      const ctx = makeCtx({ now: new Date('2026-05-23T23:00:00-04:00') });
      const r = evaluateCondition({ type: 'time_of_day', start: '06:00', end: '22:00' }, ctx);
      expect(r.matched).toBe(false);
    });
    it('handles windows that cross midnight', () => {
      const ctx = makeCtx({ now: new Date('2026-05-23T01:00:00-04:00') });
      const r = evaluateCondition({ type: 'time_of_day', start: '22:00', end: '06:00' }, ctx);
      expect(r.matched).toBe(true);
    });
  });

  describe('day_of_week', () => {
    it('returns true on a listed day', () => {
      const ctx = makeCtx({ now: new Date('2026-05-23T12:00:00-04:00') }); // Saturday
      const r = evaluateCondition({ type: 'day_of_week', days: [6] }, ctx);
      expect(r.matched).toBe(true);
    });
    it('returns false on an unlisted day', () => {
      const ctx = makeCtx({ now: new Date('2026-05-23T12:00:00-04:00') }); // Saturday
      const r = evaluateCondition({ type: 'day_of_week', days: [1, 2, 3] }, ctx);
      expect(r.matched).toBe(false);
    });
  });

  describe('service_type_in', () => {
    it('case-insensitive match', () => {
      const ctx = makeCtx({ job: makeJob({ serviceType: 'Tow' }) });
      const r = evaluateCondition({ type: 'service_type_in', values: ['tow', 'lockout'] }, ctx);
      expect(r.matched).toBe(true);
    });
    it('no match when service missing', () => {
      const r = evaluateCondition({ type: 'service_type_in', values: ['tow'] }, makeCtx());
      expect(r.matched).toBe(false);
    });
  });

  describe('estimated_payout_min', () => {
    it('reads from payout', () => {
      const ctx = makeCtx({ job: makeJob({ sourcePayload: { payout: 100 } }) });
      const r = evaluateCondition({ type: 'estimated_payout_min', amount: 50 }, ctx);
      expect(r.matched).toBe(true);
    });
    it('returns false when no field is present', () => {
      const r = evaluateCondition({ type: 'estimated_payout_min', amount: 50 }, makeCtx());
      expect(r.matched).toBe(false);
    });
  });

  describe('driver_available_count_min', () => {
    it('counts only available drivers', () => {
      const ctx = makeCtx({
        drivers: [
          { id: 'a', status: 'available', currentLat: null, currentLng: null, lastPingAt: null },
          { id: 'b', status: 'on_job', currentLat: null, currentLng: null, lastPingAt: null },
        ],
      });
      const r = evaluateCondition({ type: 'driver_available_count_min', count: 1 }, ctx);
      expect(r.matched).toBe(true);
      const r2 = evaluateCondition({ type: 'driver_available_count_min', count: 2 }, ctx);
      expect(r2.matched).toBe(false);
    });
  });

  describe('job_age_minutes_max', () => {
    it('matches for fresh jobs', () => {
      const now = new Date('2026-05-23T14:30:00-04:00');
      const job = makeJob({ createdAt: new Date(now.getTime() - 5 * 60_000) });
      const r = evaluateCondition({ type: 'job_age_minutes_max', minutes: 10 }, makeCtx({ job, now }));
      expect(r.matched).toBe(true);
    });
    it('rejects stale jobs', () => {
      const now = new Date('2026-05-23T14:30:00-04:00');
      const job = makeJob({ createdAt: new Date(now.getTime() - 30 * 60_000) });
      const r = evaluateCondition({ type: 'job_age_minutes_max', minutes: 10 }, makeCtx({ job, now }));
      expect(r.matched).toBe(false);
    });
  });

  describe('caller_phone_blacklist', () => {
    it('matches when phone is NOT on blacklist (rule semantically allows)', () => {
      const ctx = makeCtx({ job: makeJob({ callerPhone: '6145559999' }) });
      const r = evaluateCondition(
        { type: 'caller_phone_blacklist', phones: ['(614) 555-0000'] },
        ctx,
      );
      expect(r.matched).toBe(true);
    });
    it('rejects when phone is on blacklist (digits-only compare)', () => {
      const ctx = makeCtx({ job: makeJob({ callerPhone: '6145550000' }) });
      const r = evaluateCondition(
        { type: 'caller_phone_blacklist', phones: ['(614) 555-0000'] },
        ctx,
      );
      expect(r.matched).toBe(false);
    });
  });

  describe('custom_jsonpath', () => {
    it('matches a truthy jsonpath result', () => {
      const ctx = makeCtx({ job: makeJob({ sourcePayload: { special: true } }) });
      const r = evaluateCondition({ type: 'custom_jsonpath', expression: '$.special' }, ctx);
      expect(r.matched).toBe(true);
    });
    it('returns false (with reason) on an invalid expression', () => {
      const ctx = makeCtx();
      const r = evaluateCondition({ type: 'custom_jsonpath', expression: 'not a path' }, ctx);
      expect(r.matched).toBe(false);
    });
  });
});

describe('evaluateAll', () => {
  it('returns matched=true only when every condition matches', () => {
    const job = makeJob({ pickupLat: '40' as unknown as string, pickupLng: '-83' as unknown as string });
    const now = new Date('2026-05-23T12:00:00-04:00');
    const ctx = makeCtx({
      job,
      drivers: [
        { id: 'd', status: 'available', currentLat: '40.01', currentLng: '-83.01', lastPingAt: now },
      ],
      now,
    });
    const r = evaluateAll(
      [
        { type: 'distance_max_miles', miles: 50 },
        { type: 'time_of_day', start: '06:00', end: '22:00' },
      ],
      ctx,
    );
    expect(r.matched).toBe(true);
    expect(r.results.every((x) => x.matched)).toBe(true);
  });

  it('returns matched=false when any single condition fails', () => {
    const ctx = makeCtx({ now: new Date('2026-05-23T23:30:00-04:00') });
    const r = evaluateAll(
      [
        { type: 'time_of_day', start: '06:00', end: '22:00' },
      ],
      ctx,
    );
    expect(r.matched).toBe(false);
  });
});
