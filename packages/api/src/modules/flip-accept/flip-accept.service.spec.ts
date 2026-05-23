import { describe, it, expect, vi } from 'vitest';
import { FlipAcceptService } from './flip-accept.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

interface FakeRow {
  id: string;
  tenantId: string;
  sourceAdapter: string;
  sourceJobId: string;
  status: string;
  expiresAt: Date;
  jobSummary: Record<string, unknown>;
  approverPhone: string | null;
  approverResponse: string | null;
  approvalNotes: string | null;
  respondedAt: Date | null;
  requestedAt: Date;
}

function makeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'flip-1',
    tenantId: TENANT_ID,
    sourceAdapter: 'AAA_PORTAL',
    sourceJobId: 'WO-123',
    status: 'pending',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    jobSummary: { service_type: 'tow', pickup_address: '123 Main St' },
    approverPhone: null,
    approverResponse: null,
    approvalNotes: null,
    respondedAt: null,
    requestedAt: new Date(),
    ...overrides,
  };
}

function makeDbForApply(pendingRows: FakeRow[]) {
  const updates: Array<{ patch: Record<string, unknown>; rowId: string }> = [];
  let nextRows = [...pendingRows];

  const db = {
    select() {
      return {
        from() {
          // Thenable: when awaited directly (e.g. tenantIdsForManagerPhone)
          // resolves to []. When chained with .where()...limit() returns rows.
          const thenable = {
            then(resolve: (rows: unknown[]) => void) {
              resolve([]);
            },
            where() {
              return {
                orderBy() {
                  return {
                    limit: async () => nextRows.slice(),
                  };
                },
                limit: async () => nextRows.slice(0, 1),
              };
            },
          };
          return thenable as never;
        },
      };
    },
    update() {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where() {
              return {
                returning: async () => {
                  const target = nextRows[0];
                  const merged = { ...target, ...patch };
                  updates.push({ patch, rowId: target.id });
                  nextRows = [merged];
                  return [merged];
                },
              };
            },
          };
        },
      };
    },
  };

  return { db, updates };
}

describe('FlipAcceptService.applyInboundReply', () => {
  it('approves a pending request when the reply is YES NOTE …', async () => {
    const { db, updates } = makeDbForApply([
      makeRow({ id: 'flip-yes-1' }),
    ]);
    const sms = { sendSms: vi.fn(), recordInbound: vi.fn() };
    const adapters = {
      getAdapter: () => ({
        acceptJob: vi.fn().mockResolvedValue(undefined),
      }),
    };
    const svc = new FlipAcceptService(db as never, sms as never, adapters as never);

    const result = await svc.applyInboundReply({
      fromPhone: '+17408129489',
      rawBody: 'YES NOTE BRING DOLLY',
    });

    expect(result.matched).toBe(true);
    expect(result.reply).toContain('accepted');
    expect(result.request?.status).toBe('auto_dispatched');
    expect(updates[0].patch.status).toBe('auto_dispatched');
    expect(updates[0].patch.approvalNotes).toBe('BRING DOLLY');
  });

  it('declines a pending request when the reply is NO REASON …', async () => {
    const { db, updates } = makeDbForApply([
      makeRow({ id: 'flip-no-1' }),
    ]);
    const sms = { sendSms: vi.fn(), recordInbound: vi.fn() };
    const adapters = {
      getAdapter: () => ({ declineJob: vi.fn().mockResolvedValue(undefined) }),
    };
    const svc = new FlipAcceptService(db as never, sms as never, adapters as never);

    const result = await svc.applyInboundReply({
      fromPhone: '+17408129489',
      rawBody: 'NO REASON too far out',
    });

    expect(result.matched).toBe(true);
    expect(result.reply).toContain('declined');
    expect(updates[0].patch.status).toBe('declined');
    expect(updates[0].patch.approvalNotes).toBe('too far out');
  });

  it('responds with help text for an unparseable reply', async () => {
    const { db } = makeDbForApply([makeRow()]);
    const svc = new FlipAcceptService(
      db as never,
      { sendSms: vi.fn() } as never,
      { getAdapter: () => ({}) } as never,
    );

    const result = await svc.applyInboundReply({
      fromPhone: '+17408129489',
      rawBody: 'huh?',
    });

    expect(result.matched).toBe(false);
    expect(result.reply).toMatch(/YES.*NO/i);
  });

  it('reports no-match when there are no pending rows', async () => {
    const { db } = makeDbForApply([]);
    const svc = new FlipAcceptService(
      db as never,
      { sendSms: vi.fn() } as never,
      { getAdapter: () => ({}) } as never,
    );

    const result = await svc.applyInboundReply({
      fromPhone: '+17408129489',
      rawBody: 'YES',
    });

    expect(result.matched).toBe(false);
    expect(result.reply).toMatch(/no pending/i);
  });
});
