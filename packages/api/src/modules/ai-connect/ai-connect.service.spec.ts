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

describe('AiConnectService.lookupByPhone', () => {
  it('returns not_found when phone is missing', async () => {
    const svc = new AiConnectService(
      makeDb() as never,
      makeRedis() as never,
      NOTIFICATIONS as never,
      TWILIO as never,
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

describe('AiConnectService.estimateEta', () => {
  it('returns the configured default ETA', async () => {
    const svc = new AiConnectService(
      makeDb({ agentConfig: { defaultEtaMins: 45 } }) as never,
      makeRedis() as never,
      NOTIFICATIONS as never,
      TWILIO as never,
    );
    const r = await svc.estimateEta(TENANT_ID, 39.96, -82.99);
    expect(r.eta_minutes).toBe(45);
    expect(r.basis).toMatch(/deferred/);
  });

  it('falls back to 45 when no agent config exists', async () => {
    const svc = new AiConnectService(
      makeDb({ agentConfig: null }) as never,
      makeRedis() as never,
      NOTIFICATIONS as never,
      TWILIO as never,
    );
    const r = await svc.estimateEta(TENANT_ID, null, null);
    expect(r.eta_minutes).toBe(45);
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
    );
    const r = await svc.recordSmartAction(TENANT_ID, {
      action_type: 'CREATE_DISPATCH',
      payload: { vehicle: 'Civic' },
    });
    expect(r.status).toBe('PENDING');
    expect(db.inserts[0].values.actionType).toBe('CREATE_DISPATCH');
  });
});
