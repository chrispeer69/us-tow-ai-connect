import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DriverJobsService } from './driver-jobs.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function makeDb(opts: {
  executeRows?: Array<Record<string, unknown>>;
  executeThrows?: boolean;
  updateReturns?: Array<{ id: string }>;
  updateThrows?: boolean;
  insertReturns?: Array<{ id: string }>;
}) {
  const calls = {
    executes: [] as Array<{ query: string }>,
    inserts: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
  };
  const db = {
    execute(query: unknown) {
      calls.executes.push({ query: String(query) });
      if (opts.executeThrows) return Promise.reject(new Error('relation "unified_jobs" does not exist'));
      return Promise.resolve({ rows: opts.executeRows ?? [] });
    },
    insert() {
      return {
        values(v: Record<string, unknown>) {
          calls.inserts.push(v);
          return {
            returning: () => Promise.resolve(opts.insertReturns ?? [{ id: 'event-1' }]),
          };
        },
      };
    },
    update() {
      return {
        set(patch: Record<string, unknown>) {
          calls.updates.push(patch);
          return {
            where: () => ({
              returning: () => {
                if (opts.updateThrows) return Promise.reject(new Error('update failed'));
                return Promise.resolve(opts.updateReturns ?? [{ id: 'job-1' }]);
              },
            }),
          };
        },
      };
    },
    select() {
      return {
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      };
    },
  };
  return { db, calls };
}

describe('DriverJobsService.getActive', () => {
  it('returns null for unparseable driver phone', async () => {
    const { db } = makeDb({});
    const svc = new DriverJobsService(db as never);
    const result = await svc.getActive(TENANT_ID, 'nope');
    expect(result).toBeNull();
  });

  it('returns null when unified_jobs is missing (degraded mode)', async () => {
    const { db } = makeDb({ executeThrows: true });
    const svc = new DriverJobsService(db as never);
    const result = await svc.getActive(TENANT_ID, '+17408129489');
    expect(result).toBeNull();
  });

  it('maps a row from unified_jobs into the driver job shape', async () => {
    const { db } = makeDb({
      executeRows: [
        {
          id: 'job-uuid',
          source: 'aaa',
          status: 'en_route',
          caller_name: 'John Doe',
          caller_phone: '+17408129489',
          vehicle_year: '2018',
          vehicle_make: 'Honda',
          vehicle_model: 'Civic',
          vehicle_color: 'red',
          pickup_address: '123 Main St',
          pickup_lat: 40.123,
          pickup_lng: -82.456,
          dropoff_address: 'Bobs Shop',
          dropoff_lat: 40.2,
          dropoff_lng: -82.5,
          service_type: 'tow',
          priority: 'normal',
          eta_minutes: 12,
          payout_estimate: 95.0,
          dispatched_at: '2026-05-23T10:00:00Z',
          completed_at: null,
        },
      ],
    });
    const svc = new DriverJobsService(db as never);
    // Prime cache so the table-exists probe passes.
    const ok = await svc.getActive(TENANT_ID, '+17408129489');
    expect(ok).not.toBeNull();
    expect(ok?.job_id).toBe('job-uuid');
    expect(ok?.vehicle).toEqual({ year: '2018', make: 'Honda', model: 'Civic', color: 'red' });
    expect(ok?.pickup_lat).toBe(40.123);
    expect(ok?.payout_estimate).toBe(95.0);
    expect(ok?.assigned_at).toBeInstanceOf(Date);
  });
});

describe('DriverJobsService.getQueue', () => {
  it('returns [] for unknown phone', async () => {
    const { db } = makeDb({});
    const svc = new DriverJobsService(db as never);
    const rows = await svc.getQueue(TENANT_ID, '');
    expect(rows).toEqual([]);
  });
});

describe('DriverJobsService.updateStatus', () => {
  it('always writes the audit event, even when unified_jobs update fails', async () => {
    const { db, calls } = makeDb({
      // First probe call from updateStatus's hasUnifiedJobs check succeeds (returns empty rows).
      executeRows: [],
      updateThrows: true,
    });
    const svc = new DriverJobsService(db as never);
    const result = await svc.updateStatus(TENANT_ID, '+17408129489', 'job-1', {
      status: 'en_route',
      notes: 'leaving yard',
      lat: 40.1,
      lng: -82.4,
    });
    expect(result.event_id).toBe('event-1');
    expect(result.unified_jobs_updated).toBe(false);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]).toMatchObject({
      tenantId: TENANT_ID,
      driverPhone: '+17408129489',
      jobId: 'job-1',
      eventType: 'en_route',
      notes: 'leaving yard',
      lat: '40.1',
      lng: '-82.4',
    });
  });

  it('marks unified_jobs_updated when the update returns a row', async () => {
    const { db } = makeDb({ executeRows: [], updateReturns: [{ id: 'job-1' }] });
    const svc = new DriverJobsService(db as never);
    const result = await svc.updateStatus(TENANT_ID, '+17408129489', 'job-1', {
      status: 'completed',
    });
    expect(result.unified_jobs_updated).toBe(true);
  });

  it('throws on invalid phone', async () => {
    const { db } = makeDb({});
    const svc = new DriverJobsService(db as never);
    await expect(
      svc.updateStatus(TENANT_ID, 'abc', 'job-1', { status: 'accept' }),
    ).rejects.toThrow(/Invalid driver_phone/);
  });
});
