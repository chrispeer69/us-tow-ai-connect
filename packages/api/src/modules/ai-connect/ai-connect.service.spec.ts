import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiConnectService } from './ai-connect.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function makeDb(initial: { agentConfig?: Record<string, unknown> | null } = {}) {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];

  function buildSelectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => Promise.resolve(rows);
    chain.offset = () => Promise.resolve(rows);
    return chain;
  }

  return {
    inserts,
    updates,
    select(_shape?: unknown) {
      if (_shape && typeof _shape === 'object' && 'defaultEtaMins' in _shape) {
        return buildSelectChain(
          initial.agentConfig ? [{ defaultEtaMins: 45 }] : [],
        );
      }
      if (_shape && typeof _shape === 'object' && 'serviceToggles' in _shape) {
        return buildSelectChain(
          initial.agentConfig
            ? [{ serviceToggles: {}, knowledgePack: { services: [] } }]
            : [],
        );
      }
      return buildSelectChain([]);
    },
    insert(table: { _: { name: string } } | { name?: string }) {
      const name =
        (table as { _?: { name?: string } })._?.name ??
        (table as { name?: string }).name ??
        'unknown';
      return {
        values(v: Record<string, unknown>) {
          inserts.push({ table: name, values: v });
          return {
            returning() {
              return Promise.resolve([{ id: 'fake-id', ...v }]);
            },
          };
        },
      };
    },
    update(table: { _: { name: string } } | { name?: string }) {
      const name =
        (table as { _?: { name?: string } })._?.name ??
        (table as { name?: string }).name ??
        'unknown';
      return {
        set(v: Record<string, unknown>) {
          updates.push({ table: name, values: v });
          return { where: () => Promise.resolve() };
        },
      };
    },
  };
}

function makeRedis(map: Record<string, string> = {}) {
  return {
    get: vi.fn(async (k: string) => map[k] ?? null),
  };
}

const NOTIFICATIONS = { send: vi.fn() };
const TWILIO = { sendDispatchSms: vi.fn(async () => 'SM-stub') };
const DRIVER_PINGS = {
  listLatestPerDriver: vi.fn(async () => []),
};
const DISTANCE_MATRIX = {
  durationToPoint: vi.fn(async () => []),
  isConfigured: () => false,
};

describe('AiConnectService.lookupByPhone', () => {
  it('returns not_found when phone is missing', async () => {
    const svc = new AiConnectService(
      makeDb() as never,
      makeRedis() as never,
      NOTIFICATIONS as never,
      TWILIO as never,
      DRIVER_PINGS as never,
      DISTANCE_MATRIX as never,
    );
    const r = await svc.lookupByPhone(TENANT_ID, '');
    expect(r.found).toBe(false);
  });

  it('returns a matching Towbook job from Redis cache', async () => {
    const jobs = JSON.stringify([
      {
        jobId: 'TB-1',
        customerName: 'A',
        customerPhone: '6141112222',
        vehicle: '',
        status: 'Dispatched',
        driverName: '',
        eta: '30 min',
        destination: '',
        lastUpdated: '2026-05-23T12:00:00Z',
      },
    ]);
    const svc = new AiConnectService(
      makeDb() as never,
      makeRedis({ [`jobs:towbook:${TENANT_ID}`]: jobs }) as never,
      NOTIFICATIONS as never,
      TWILIO as never,
    );
    const r = await svc.lookupByPhone(TENANT_ID, '+16141112222');
    expect(r.found).toBe(true);
    expect(r.source).toBe('TOWBOOK');
    expect(r.job?.jobId).toBe('TB-1');
  });

  it('falls back to AAA when Towbook has no match', async () => {
    const aaa = JSON.stringify([
      {
        jobId: 'AAA-9',
        customerName: 'B',
        customerPhone: '7409991234',
        vehicle: '',
        status: 'In Progress',
        driverName: '',
        eta: 'Unknown',
        destination: '',
        lastUpdated: '2026-05-23T12:00:00Z',
      },
    ]);
    const svc = new AiConnectService(
      makeDb() as never,
      makeRedis({
        [`jobs:towbook:${TENANT_ID}`]: '[]',
        [`jobs:aaa_portal:${TENANT_ID}`]: aaa,
      }) as never,
      NOTIFICATIONS as never,
      TWILIO as never,
    );
    const r = await svc.lookupByPhone(TENANT_ID, '7409991234');
    expect(r.found).toBe(true);
    expect(r.source).toBe('AAA_PORTAL');
  });
});

describe('AiConnectService.lookupByPhone — caller-ID fallback (2026-09-10)', () => {
  const jobs = JSON.stringify([
    {
      jobId: 'TB-7',
      customerName: 'C',
      customerPhone: '(614) 948-9826',
      vehicle: '',
      status: 'Dispatched',
      driverName: '',
      eta: '30 min',
      destination: '',
      lastUpdated: '2026-09-10T12:00:00Z',
    },
  ]);
  const make = () =>
    new AiConnectService(
      makeDb() as never,
      makeRedis({ [`jobs:towbook:${TENANT_ID}`]: jobs }) as never,
      NOTIFICATIONS as never,
      TWILIO as never,
    );

  it('finds the job under the caller ID when the number the caller gave is not on the ticket', async () => {
    const r = await make().lookupByPhone(TENANT_ID, '6149489866', { fallbackPhone: '+16149489826' });
    expect(r.found).toBe(true);
    expect(r.job?.jobId).toBe('TB-7');
    expect(r.matchedBy).toBe('caller_id');
  });

  it('reports a match on the given number as given', async () => {
    const r = await make().lookupByPhone(TENANT_ID, '66149489826', { fallbackPhone: '+16140000000' });
    expect(r.found).toBe(true);
    expect(r.matchedBy).toBe('given');
  });

  it('still returns not_found when neither number is on a live job', async () => {
    const r = await make().lookupByPhone(TENANT_ID, '6140000001', { fallbackPhone: '+16140000002' });
    expect(r.found).toBe(false);
    expect(r.message).toMatch(/No active job/);
  });

  it('uses the caller ID alone when no number was captured', async () => {
    const r = await make().lookupByPhone(TENANT_ID, '', { fallbackPhone: '+16149489826' });
    expect(r.found).toBe(true);
    expect(r.matchedBy).toBe('caller_id');
  });
});

describe('AiConnectService.lookupJob — job number and PO number (2026-09-10)', () => {
  const jobs = JSON.stringify([
    {
      jobId: '283277202',
      callNumber: '127716',
      poNumber: '114071513',
      customerName: 'James H.',
      customerPhone: '6146572450',
      vehicle: '2020 LINC Aviator Red',
      status: 'On scene',
      driverName: 'Alex Kordalis',
      eta: '2:04 PM',
      pickup: '',
      destination: '',
      lastUpdated: '2026-09-10T12:00:00Z',
    },
    {
      jobId: '283304458',
      callNumber: '127729',
      poNumber: '',
      customerName: 'Upreach',
      customerPhone: '6143385480',
      vehicle: '2014 Dodge Grand Caravan',
      status: 'Dispatched',
      driverName: 'Jerod Berry',
      eta: 'Unknown',
      pickup: '',
      destination: '',
      lastUpdated: '2026-09-10T12:00:00Z',
    },
  ]);
  const make = () =>
    new AiConnectService(
      makeDb() as never,
      makeRedis({ [`jobs:towbook:${TENANT_ID}`]: jobs }) as never,
      NOTIFICATIONS as never,
      TWILIO as never,
    );

  it('finds a job by the number printed on the board', async () => {
    const r = await make().lookupJob(TENANT_ID, { jobNumber: '#127729' });
    expect(r.found).toBe(true);
    expect(r.job?.jobId).toBe('283304458');
    expect(r.matchedBy).toBe('job_number');
  });

  it('finds a job by the motor-club PO number', async () => {
    const r = await make().lookupJob(TENANT_ID, { poNumber: '114071513' });
    expect(r.found).toBe(true);
    expect(r.job?.jobId).toBe('283277202');
    expect(r.matchedBy).toBe('po_number');
  });

  it('prefers the job number over a phone that points elsewhere', async () => {
    const r = await make().lookupJob(TENANT_ID, { jobNumber: '127716', phone: '6143385480' });
    expect(r.job?.jobId).toBe('283277202');
    expect(r.matchedBy).toBe('job_number');
  });

  it('falls through PO -> phone -> caller ID', async () => {
    const r = await make().lookupJob(TENANT_ID, { poNumber: '999', phone: '6140000000', fallbackPhone: '+16143385480' });
    expect(r.found).toBe(true);
    expect(r.matchedBy).toBe('caller_id');
  });

  it('reports "phone is required" only when it was given nothing at all', async () => {
    expect((await make().lookupJob(TENANT_ID, {})).message).toBe('phone is required');
    expect((await make().lookupJob(TENANT_ID, { poNumber: '1' })).message).toMatch(/No active job/);
  });
});

describe('AiConnectService.estimateEta', () => {
  it('falls back to default ETA when no driver pings exist', async () => {
    const svc = new AiConnectService(
      makeDb({ agentConfig: { defaultEtaMins: 45 } }) as never,
      makeRedis() as never,
      NOTIFICATIONS as never,
      TWILIO as never,
      DRIVER_PINGS as never,
      DISTANCE_MATRIX as never,
    );
    const r = await svc.estimateEta(TENANT_ID, 39.96, -82.99);
    expect(r.eta_minutes).toBe(45);
    expect(r.basis).toMatch(/no fresh driver pings/);
  });

  it('falls back to 45 when no caller coordinates are supplied', async () => {
    const svc = new AiConnectService(
      makeDb({ agentConfig: null }) as never,
      makeRedis() as never,
      NOTIFICATIONS as never,
      TWILIO as never,
      DRIVER_PINGS as never,
      DISTANCE_MATRIX as never,
    );
    const r = await svc.estimateEta(TENANT_ID, null, null);
    expect(r.eta_minutes).toBe(45);
    expect(r.basis).toMatch(/no caller coordinates/);
  });

  it('uses Distance Matrix when fresh driver pings are within range', async () => {
    const driverPings = {
      listLatestPerDriver: vi.fn(async () => [
        {
          driverPhone: '+17408129489',
          driverName: 'Sam',
          lat: 39.97,
          lng: -82.99,
          heading: null,
          speedMph: null,
          accuracyM: null,
          batteryPct: null,
          recordedAt: new Date(),
          ageSeconds: 30,
        },
      ]),
    };
    const distanceMatrix = {
      isConfigured: () => true,
      durationToPoint: vi.fn(async () => [
        {
          durationSeconds: 12 * 60,
          distanceMeters: 5 * 1609,
          origin: { lat: 39.97, lng: -82.99 },
        },
      ]),
    };
    const svc = new AiConnectService(
      makeDb({ agentConfig: { defaultEtaMins: 45 } }) as never,
      makeRedis() as never,
      NOTIFICATIONS as never,
      TWILIO as never,
      driverPings as never,
      distanceMatrix as never,
    );
    const r = await svc.estimateEta(TENANT_ID, 39.96, -82.99);
    expect(r.eta_minutes).toBe(12);
    expect(r.basis).toMatch(/distance_matrix/);
    expect(distanceMatrix.durationToPoint).toHaveBeenCalled();
  });

  it('haversine fallback when Distance Matrix is unavailable', async () => {
    const driverPings = {
      listLatestPerDriver: vi.fn(async () => [
        {
          driverPhone: '+17408129489',
          driverName: 'Sam',
          lat: 39.97,
          lng: -82.99,
          heading: null,
          speedMph: null,
          accuracyM: null,
          batteryPct: null,
          recordedAt: new Date(),
          ageSeconds: 30,
        },
      ]),
    };
    const distanceMatrix = {
      isConfigured: () => false,
      durationToPoint: vi.fn(async () => []),
    };
    const svc = new AiConnectService(
      makeDb({ agentConfig: { defaultEtaMins: 45 } }) as never,
      makeRedis() as never,
      NOTIFICATIONS as never,
      TWILIO as never,
      driverPings as never,
      distanceMatrix as never,
    );
    const r = await svc.estimateEta(TENANT_ID, 39.96, -82.99);
    expect(r.basis).toMatch(/haversine/);
    expect(r.eta_minutes).toBeGreaterThanOrEqual(5);
  });
});

describe('AiConnectService.recordSmartAction', () => {
  it('inserts a smart_actions row with PENDING status', async () => {
    const db = makeDb();
    const svc = new AiConnectService(
      db as never,
      makeRedis() as never,
      NOTIFICATIONS as never,
      TWILIO as never,
      DRIVER_PINGS as never,
      DISTANCE_MATRIX as never,
    );
    const r = await svc.recordSmartAction(TENANT_ID, {
      action_type: 'CREATE_DISPATCH',
      payload: { vehicle: 'Civic' },
    });
    expect(r.status).toBe('PENDING');
    expect(db.inserts[0].values.actionType).toBe('CREATE_DISPATCH');
  });
});
