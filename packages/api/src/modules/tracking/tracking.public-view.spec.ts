import { afterEach, describe, expect, it } from 'vitest';
import { TrackingService } from './tracking.service';

/** Chainable drizzle stub: each `.select()` resolves to the next queued result. */
function mockDb(queue: unknown[]) {
  let i = 0;
  const builder = (result: unknown) => {
    const p = Promise.resolve(result);
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'offset']) b[m] = () => b;
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => p.then(res, rej);
    return b;
  };
  return { select: () => builder(queue[i++]) } as never;
}

function trackingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    tenantId: '00000000-0000-0000-0000-000000000001',
    token: 'ABCDEFGHJKLM',
    callerName: 'Jane Caller',
    callerPhone: '+16145559999',
    status: 'en_route',
    assignedDriverName: 'Marcus',
    assignedDriverPhone: null,
    lastEtaMinutes: 18,
    pickupLat: '40.1467',
    pickupLng: '-82.9988',
    expiresAt: new Date(Date.now() + 3600_000),
    ...overrides,
  };
}

describe('TrackingService.getPublicView', () => {
  const original = process.env.TWILIO_PROXY_NUMBER;
  afterEach(() => {
    if (original === undefined) delete process.env.TWILIO_PROXY_NUMBER;
    else process.env.TWILIO_PROXY_NUMBER = original;
  });

  it('exposes tenant_id so the public page can resolve branding from the token', async () => {
    delete process.env.TWILIO_PROXY_NUMBER;
    const db = mockDb([[trackingRow()]]); // no driver assigned → only getByToken runs
    const svc = new TrackingService(db, {} as never);
    const view = await svc.getPublicView('ABCDEFGHJKLM');
    expect(view.tenant_id).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('returns driver_call_url=null when no driver is assigned', async () => {
    process.env.TWILIO_PROXY_NUMBER = '+18005551234'; // relay set, but no driver
    const db = mockDb([[trackingRow({ assignedDriverPhone: null })]]);
    const svc = new TrackingService(db, {} as never);
    const view = await svc.getPublicView('ABCDEFGHJKLM');
    expect(view.driver_call_url).toBeNull();
  });

  it('returns driver_call_url=null when a driver is assigned but no relay is configured', async () => {
    delete process.env.TWILIO_PROXY_NUMBER;
    const db = mockDb([[trackingRow({ assignedDriverPhone: '+15551234567' })], []]);
    const svc = new TrackingService(db, {} as never);
    const view = await svc.getPublicView('ABCDEFGHJKLM');
    expect(view.driver_call_url).toBeNull();
  });

  it('returns the masked relay number — never the raw driver phone', async () => {
    process.env.TWILIO_PROXY_NUMBER = '+18005551234';
    const db = mockDb([[trackingRow({ assignedDriverPhone: '+15551234567' })], []]);
    const svc = new TrackingService(db, {} as never);
    const view = await svc.getPublicView('ABCDEFGHJKLM');
    expect(view.driver_call_url).toBe('tel:+18005551234');
    // The raw driver phone must never leak through the masked relay.
    expect(view.driver_call_url?.includes('5551234567')).toBe(false);
  });
});
