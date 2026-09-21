import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AiConnectService, describeUstdErrors } from './ai-connect.service';

/**
 * create_tow_job — the proxy that books Emily's new tows into US Tow
 * Dispatch. Exists because Retell wraps tool bodies as { call, name, args }
 * and USTD reads them flat; every booking from 08-23 to 09-12 was a 400.
 *
 * The 400 body below is verbatim from call_45fa3809 (2026-09-11 19:47 ET):
 * USTD's flattened, index-referenced error envelope.
 */
const USTD_400_BODY = [
  { type: '1', title: '2', status: 400, code: '3', errors: '4', requestId: '5' },
  'https://errors.ustowdispatch.cloud/validation_failed',
  'Validation Failed',
  'validation_failed',
  ['6', '7', '8', '9'],
  '01a092e2-3dfd-7c82-90c5-0388add65e0c',
  { path: '10', message: '11' },
  { path: '12', message: '11' },
  { path: '13', message: '11' },
  { path: '14', message: '11' },
  'customer',
  'Required',
  'vehicle',
  'serviceType',
  'pickup',
];

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const CALL_ID = 'call_45fa3809ab8e1d4a10d7981acc8';

// What Emily actually sent on that call, minus nothing — including the
// execution_message Retell appends, which USTD's schema does not accept.
const EMILY_ARGS = {
  intake: { safeLocation: true },
  vehicle: { make: 'Chrysler', model: '300', year: 2008, color: 'dark green/blue', vehicleClass: 'light_duty' },
  serviceType: 'tow',
  pickup: { address: 'Hall Road near the auto mall, next to an apartment complex, on the bridge' },
  dropoff: { address: '1035 Bridgemont Court, Columbus, OH 43228' },
  customer: { name: 'Unknown', phone: '6142025059' },
  notes: 'Vehicle stopped while going uphill.',
  execution_message: 'Getting your tow into the system now.',
};

function makeDb() {
  const inserts: Array<{ values: Record<string, unknown>; conflict?: unknown }> = [];
  return {
    inserts,
    insert() {
      return {
        values(v: Record<string, unknown>) {
          const rec: { values: Record<string, unknown>; conflict?: unknown } = { values: v };
          inserts.push(rec);
          return {
            onConflictDoUpdate(c: unknown) {
              rec.conflict = c;
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
}

function makeService(db = makeDb(), push = { sendToTenantAdmins: vi.fn(async () => undefined) }) {
  const svc = new AiConnectService(
    db as never,
    { get: vi.fn(async () => null) } as never,
    { send: vi.fn() } as never,
    { sendDispatchSms: vi.fn() } as never,
    { listLatestPerDriver: vi.fn(async () => []) } as never,
    { durationToPoint: vi.fn(async () => []), isConfigured: () => false } as never,
    { create: vi.fn() } as never,
    push as never,
  );
  return { svc, db, push };
}

describe('describeUstdErrors', () => {
  it('resolves the flattened envelope into path: message lines', () => {
    expect(describeUstdErrors(USTD_400_BODY)).toEqual([
      'customer: Required',
      'vehicle: Required',
      'serviceType: Required',
      'pickup: Required',
    ]);
  });

  it('reads a plain JSON error body too', () => {
    expect(describeUstdErrors({ message: 'nope' })).toEqual(['nope']);
    expect(describeUstdErrors({ errors: [{ path: 'dropoff', message: 'Dropoff is required for tow service' }] })).toEqual([
      'dropoff: Dropoff is required for tow service',
    ]);
  });

  it('is empty for junk', () => {
    expect(describeUstdErrors(null)).toEqual([]);
    expect(describeUstdErrors('x')).toEqual([]);
    expect(describeUstdErrors([])).toEqual([]);
  });
});

describe('AiConnectService.createTowJob', () => {
  const realFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.USTD_API_KEY = 'tc_test_key';
    delete process.env.USTD_API_BASE_URL;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as never;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.USTD_API_KEY;
  });

  it('forwards the FLAT args to USTD with the server-side key, drops execution_message, fills callReference', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'job-uuid',
          jobNumber: 'RT-1042',
          rateQuote: { totalCents: 18550 },
          vinRequiredAtPickup: true,
        }),
        { status: 201 },
      ),
    );
    const { svc, db, push } = makeService();

    const r = await svc.createTowJob(TENANT_ID, {
      args: { ...EMILY_ARGS },
      providerCallId: CALL_ID,
      fromNumber: '+16142025059',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.ustowdispatch.com/v1/jobs/phone-intake');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tc_test_key');
    expect(headers['content-type']).toBe('application/json');
    expect(headers['idempotency-key']).toBe(CALL_ID);

    const sent = JSON.parse(String(init.body));
    // The whole point: top-level fields, not { call, name, args }.
    expect(sent.customer).toEqual({ name: 'Unknown', phone: '6142025059' });
    expect(sent.vehicle.make).toBe('Chrysler');
    expect(sent.serviceType).toBe('tow');
    expect(sent.pickup.address).toContain('Hall Road');
    expect(sent.execution_message).toBeUndefined();
    expect(sent.callReference).toBe(CALL_ID);

    expect(r.status).toBe('success');
    if (r.status !== 'success') throw new Error('unreachable');
    expect(r.job_number).toBe('RT-1042');
    expect(r.job_id).toBe('job-uuid');
    expect(r.price).toBe('$185.50');
    expect(r.vin_required_at_pickup).toBe(true);
    expect(r.confirmation).toMatch(/You're all set/);

    // Stamped on the call and pushed to the office.
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0].values.providerCallId).toBe(CALL_ID);
    expect(db.inserts[0].values.ustdJobNumber).toBe('RT-1042');
    expect(db.inserts[0].values.branch).toBe('new_tow');
    expect(push.sendToTenantAdmins).toHaveBeenCalledTimes(1);
    const [, note] = push.sendToTenantAdmins.mock.calls[0] as [string, { title: string; body: string }];
    expect(note.title).toBe('New tow booked by Emily — #RT-1042');
    expect(note.body).toContain('2008 Chrysler 300');
    expect(note.body).toContain('6142025059');
  });

  it('keeps a callReference the LLM supplied', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'j', jobNumber: '7' }), { status: 201 }));
    const { svc } = makeService();
    await svc.createTowJob(TENANT_ID, {
      args: { ...EMILY_ARGS, callReference: 'call_from_llm' },
      providerCallId: CALL_ID,
      fromNumber: null,
    });
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(sent.callReference).toBe('call_from_llm');
  });

  it("returns status 'error' with the decoded USTD errors on a 400, and books nothing", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(USTD_400_BODY), { status: 400 }));
    const { svc, db, push } = makeService();
    const r = await svc.createTowJob(TENANT_ID, { args: { ...EMILY_ARGS }, providerCallId: CALL_ID, fromNumber: null });
    expect(r.status).toBe('error');
    if (r.status !== 'error') throw new Error('unreachable');
    expect(r.http_status).toBe(400);
    expect(r.errors).toEqual(['customer: Required', 'vehicle: Required', 'serviceType: Required', 'pickup: Required']);
    expect(db.inserts).toHaveLength(0);
    expect(push.sendToTenantAdmins).not.toHaveBeenCalled();
  });

  it("returns status 'error' when USTD is unreachable, never throws", async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const { svc } = makeService();
    const r = await svc.createTowJob(TENANT_ID, { args: { ...EMILY_ARGS }, providerCallId: null, fromNumber: null });
    expect(r.status).toBe('error');
    expect((r as { message: string }).message).toMatch(/did not answer/);
  });

  it("returns status 'error' and never calls USTD without a key", async () => {
    delete process.env.USTD_API_KEY;
    const { svc } = makeService();
    const r = await svc.createTowJob(TENANT_ID, { args: { ...EMILY_ARGS }, providerCallId: CALL_ID, fromNumber: null });
    expect(r.status).toBe('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed stamp or push does not turn a booked job into an error', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'j', jobNumber: '9' }), { status: 201 }));
    const db = {
      insert() {
        return {
          values() {
            return { onConflictDoUpdate: () => Promise.reject(new Error('db down')) };
          },
        };
      },
    };
    const push = { sendToTenantAdmins: vi.fn(async () => Promise.reject(new Error('push down'))) };
    const { svc } = makeService(db as never, push);
    const r = await svc.createTowJob(TENANT_ID, { args: { ...EMILY_ARGS }, providerCallId: CALL_ID, fromNumber: null });
    expect(r.status).toBe('success');
  });
});
