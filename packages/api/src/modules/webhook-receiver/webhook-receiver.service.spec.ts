import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebhookReceiverService, type ThinkrrCallPayload } from './webhook-receiver.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const TENANT_ROW = {
  id: TENANT_ID,
  companyName: 'Roadside Towing',
  assignedPhoneNumber: '+13803336411',
  thinkrrAgentId: 'agent-roadside-1',
};

// processCallWebhook inserts the call_interactions row first, then the
// legacy interaction_logs row. We rely on that ordering to identify rows in
// the mock without needing to extract drizzle's internal table-name symbol.
function makeDb() {
  return {
    inserts: [] as Array<{ values: Record<string, unknown> }>,
    query: {
      tenants: {
        findFirst: vi.fn(async () => TENANT_ROW),
      },
    },
    insert() {
      const self = this;
      return {
        values(v: Record<string, unknown>) {
          self.inserts.push({ values: v });
          const chain = {
            onConflictDoNothing() {
              return Promise.resolve();
            },
            returning() {
              return Promise.resolve([v]);
            },
            then(resolve: (v: undefined) => void) {
              resolve(undefined);
              return Promise.resolve();
            },
          };
          return chain;
        },
      };
    },
  };
}

function makeRedis(map: Record<string, string> = {}) {
  return {
    get: vi.fn(async (key: string) => map[key] ?? null),
    set: vi.fn(),
    del: vi.fn(),
  };
}

describe('WebhookReceiverService.processCallWebhook', () => {
  let originalDbUrl: string | undefined;

  beforeEach(() => {
    originalDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://stub';
  });

  it('rejects when DATABASE_URL is unset', async () => {
    process.env.DATABASE_URL = '';
    const svc = new WebhookReceiverService(
      makeDb() as never,
      makeRedis() as never,
    );
    const result = await svc.processCallWebhook({} as ThinkrrCallPayload);
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/database/);
    process.env.DATABASE_URL = originalDbUrl;
  });

  it('rejects when the tenant cannot be resolved', async () => {
    const db = makeDb();
    db.query.tenants.findFirst = vi.fn(async () => undefined);
    const svc = new WebhookReceiverService(db as never, makeRedis() as never);
    const result = await svc.processCallWebhook({
      call_id: 'CA1',
      tenant_id: 'unknown',
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/tenant/);
  });

  it('inserts a call_interactions row + interaction_log on a happy-path payload', async () => {
    const db = makeDb();
    const svc = new WebhookReceiverService(db as never, makeRedis() as never);
    const result = await svc.processCallWebhook({
      call_id: 'CA-happy',
      tenant_id: TENANT_ID,
      caller_phone: '+16145551234',
      called_number: '+13803336411',
      duration_sec: 120,
      transcript: 'I need a tow my car broke down',
      summary: 'Caller needs a tow',
      structured_data: { intent: 'NEW_TOW_REQUEST' },
      started_at: '2026-05-23T12:00:00Z',
      ended_at: '2026-05-23T12:02:00Z',
    });
    expect(result.accepted).toBe(true);
    expect(db.inserts.length).toBeGreaterThanOrEqual(2);
    const callInteraction = db.inserts[0];
    expect(callInteraction.values.callId).toBe('CA-happy');
    expect(callInteraction.values.callerPhone).toBe('16145551234');
    expect(callInteraction.values.durationSec).toBe(120);
  });

  it('matches caller phone against cached Towbook jobs and links matched_job_id', async () => {
    const towbookJobs = JSON.stringify([
      {
        jobId: 'TB-9001',
        customerName: 'Jane Doe',
        customerPhone: '6145551234',
        vehicle: '2018 Honda Civic Blue',
        status: 'Dispatched',
        driverName: 'Mike',
        eta: '25 min',
        destination: '',
        lastUpdated: '2026-05-23T11:55:00Z',
      },
    ]);
    const db = makeDb();
    const redis = makeRedis({ [`jobs:towbook:${TENANT_ID}`]: towbookJobs });
    const svc = new WebhookReceiverService(db as never, redis as never);
    const result = await svc.processCallWebhook({
      call_id: 'CA-match',
      tenant_id: TENANT_ID,
      caller_phone: '+16145551234',
      duration_sec: 30,
    });
    expect(result.accepted).toBe(true);
    expect(result.matchedJobId).toBe('TB-9001');
    const ci = db.inserts[0];
    expect(ci.values.matchedJobId).toBe('TB-9001');
    expect(ci.values.matchedJobSource).toBe('TOWBOOK');
  });

  it('falls back to AAA cache when Towbook has no match', async () => {
    const aaaJobs = JSON.stringify([
      {
        jobId: 'AAA-44',
        customerName: 'John Smith',
        customerPhone: '7405559090',
        vehicle: '',
        status: 'In Progress',
        driverName: '',
        eta: 'Unknown',
        destination: '',
        lastUpdated: '2026-05-23T11:55:00Z',
      },
    ]);
    const db = makeDb();
    const redis = makeRedis({
      [`jobs:towbook:${TENANT_ID}`]: '[]',
      [`jobs:aaa_portal:${TENANT_ID}`]: aaaJobs,
    });
    const svc = new WebhookReceiverService(db as never, redis as never);
    const result = await svc.processCallWebhook({
      call_id: 'CA-aaa',
      tenant_id: TENANT_ID,
      caller_phone: '740-555-9090',
    });
    expect(result.matchedJobId).toBe('AAA-44');
    expect(db.inserts[0].values.matchedJobSource).toBe('AAA_PORTAL');
  });
});

describe('WebhookReceiverService.categorizeCall', () => {
  const svc = new WebhookReceiverService({} as never, {} as never);

  it('detects ETA lookups', () => {
    expect(svc.categorizeCall('how long until my tow arrives')).toBe('ETA_LOOKUP');
    expect(svc.categorizeCall('what is the eta')).toBe('ETA_LOOKUP');
  });

  it('detects new tow requests', () => {
    expect(svc.categorizeCall('I broke down on the highway')).toBe('NEW_TOW_REQUEST');
  });

  it('detects transfer requests', () => {
    expect(svc.categorizeCall('I want to speak to a human')).toBe('TRANSFER_TO_HUMAN');
  });

  it('detects impound inquiries', () => {
    expect(svc.categorizeCall('how do I pick up my car from impound')).toBe(
      'IMPOUND_INQUIRY',
    );
  });

  it('falls back to GENERAL_INQUIRY', () => {
    expect(svc.categorizeCall('hello there')).toBe('GENERAL_INQUIRY');
  });
});
