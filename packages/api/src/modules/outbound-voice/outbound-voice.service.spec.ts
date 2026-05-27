import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OutboundVoiceService } from './outbound-voice.service';
import { ThinkrrOutboundClient } from './thinkrr-outbound.client';
import { MissingVariableError } from './script-templates';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function makeFakeDb(initialCalls: any[] = [], tenantOverrides: Partial<any> = {}) {
  const calls: any[] = [...initialCalls];
  const tenants: any[] = [
    {
      id: TENANT_ID,
      companyName: 'Roadside Towing',
      outboundVoiceEnabled: true,
      outboundVoiceConfig: {},
      ...tenantOverrides,
    },
  ];
  let idCounter = calls.length;

  const db = {
    select(_columns?: any) {
      return {
        from(table: any) {
          const isCalls = table?.[Symbol.for('drizzle:Name')] === 'outbound_calls'
            || table === ('outbound_calls' as never);
          // We can't reliably detect the table object across drizzle internals,
          // so we expose a simple chain that supports both calls & tenants by
          // letting the test bag remember the most recent select.
          // In practice the service reads either tenants or outbound_calls; we
          // disambiguate by which "where" predicate fires.
          let matched: any[] = isCalls ? calls : tenants;
          let activeTable = isCalls ? 'calls' : 'tenants';

          const builder: any = {
            innerJoin() { return builder; },
            where(predicate?: any) {
              // No real predicate evaluation — tests rely on initial seed data.
              if (predicate?.__tableHint === 'tenants') {
                matched = tenants;
                activeTable = 'tenants';
              } else if (predicate?.__tableHint === 'calls') {
                matched = calls;
                activeTable = 'calls';
              }
              return builder;
            },
            orderBy() { return builder; },
            limit(n: number) {
              return Promise.resolve(matched.slice(0, n).map((r) => activeTable === 'calls' ? wrapCallRow(r) : r));
            },
            offset() { return builder; },
            then(resolve: any) {
              return Promise.resolve(matched.map((r) => activeTable === 'calls' ? wrapCallRow(r) : r)).then(resolve);
            },
          };
          return builder;
        },
      };
    },
    insert(_table: any) {
      return {
        values(v: any) {
          const row = {
            id: `voice-${++idCounter}`,
            tenantId: v.tenantId,
            purpose: v.purpose,
            relatedJobId: v.relatedJobId ?? null,
            toPhone: v.toPhone,
            toName: v.toName ?? null,
            scriptTemplate: v.scriptTemplate,
            scriptVariables: v.scriptVariables,
            status: 'queued',
            attempts: 0,
            maxAttempts: v.maxAttempts ?? 3,
            scheduledFor: v.scheduledFor ?? null,
            startedAt: null,
            endedAt: null,
            durationSeconds: null,
            transcript: null,
            recordingUrl: null,
            outcome: null,
            error: null,
            thinkrrCallId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          calls.push(row);
          return { returning: async () => [row] };
        },
      };
    },
    update(_table: any) {
      return {
        set(patch: any) {
          return {
            where(_w: any) {
              const target = calls.find((c) => true && (true)); // last
              const chain = {
                returning: async () => {
                  // Apply patch to all currently tracked rows that haven't been
                  // assigned the patch — for the tests this is acceptable since
                  // tests only operate on a single row.
                  const target = calls[calls.length - 1];
                  if (target) Object.assign(target, patch);
                  return target ? [target] : [];
                },
                then: (resolve: any) => {
                  const target = calls[calls.length - 1];
                  if (target) Object.assign(target, patch);
                  return Promise.resolve(undefined).then(resolve);
                },
              };
              return chain;
            },
          };
        },
      };
    },
  };

  return { db, calls, tenants };
}

function wrapCallRow(row: any) {
  return row;
}

describe('OutboundVoiceService', () => {
  beforeEach(() => {
    delete process.env.THINKRR_OUTBOUND_API_URL;
    delete process.env.THINKRR_API_KEY;
    delete process.env.OUTBOUND_VOICE_DISPATCH_CRON_ENABLED;
    delete process.env.PUBLIC_BASE_URL;
  });

  it('enqueueCall validates variables and inserts a queued row', async () => {
    const { db, calls } = makeFakeDb();
    const client = new ThinkrrOutboundClient();
    const svc = new OutboundVoiceService(db as never, client);

    const row = await svc.enqueueCall({
      tenantId: TENANT_ID,
      purpose: 'customer_status_update',
      toPhone: '+15551234567',
      toName: 'Pat',
      scriptTemplate: 'customer_status_update',
      scriptVariables: {
        customer_name: 'Pat',
        company_name: 'Roadside Towing',
        job_id: 'J-101',
        status: 'driver en-route',
      },
    });

    expect(row.status).toBe('queued');
    expect(row.toPhone).toBe('+15551234567');
    expect(calls).toHaveLength(1);
  });

  it('enqueueCall raises MissingVariableError when required variable is empty', async () => {
    const { db } = makeFakeDb();
    const client = new ThinkrrOutboundClient();
    const svc = new OutboundVoiceService(db as never, client);

    await expect(
      svc.enqueueCall({
        tenantId: TENANT_ID,
        purpose: 'eta_confirmation',
        toPhone: '+15551234567',
        scriptTemplate: 'eta_confirmation',
        scriptVariables: {
          customer_name: 'Pat',
          company_name: 'Roadside Towing',
          // missing driver_first_name, eta_minutes
        },
      }),
    ).rejects.toBeInstanceOf(MissingVariableError);
  });

  it('enqueueCall refuses when outbound_voice_enabled is false', async () => {
    const { db } = makeFakeDb([], { outboundVoiceEnabled: false });
    const client = new ThinkrrOutboundClient();
    const svc = new OutboundVoiceService(db as never, client);

    await expect(
      svc.enqueueCall({
        tenantId: TENANT_ID,
        purpose: 'customer_status_update',
        toPhone: '+15551234567',
        scriptTemplate: 'customer_status_update',
        scriptVariables: {
          customer_name: 'Pat',
          company_name: 'Roadside',
          job_id: 'J-1',
          status: 'queued',
        },
      }),
    ).rejects.toThrow(/disabled/i);
  });

  it('handleWebhookEvent transitions a dialing row to in_progress and completed', async () => {
    const seedRow = {
      id: 'voice-1',
      tenantId: TENANT_ID,
      thinkrrCallId: 'thinkrr-abc',
      status: 'dialing',
      attempts: 1,
      maxAttempts: 3,
      outcome: null,
      startedAt: null,
      endedAt: null,
    };
    const { db, calls } = makeFakeDb([seedRow]);
    const client = new ThinkrrOutboundClient();
    const svc = new OutboundVoiceService(db as never, client);

    const r1 = await svc.handleWebhookEvent({ callId: 'thinkrr-abc', status: 'in_progress' });
    expect(r1.matched).toBe(true);
    expect(r1.newStatus).toBe('in_progress');

    const r2 = await svc.handleWebhookEvent({
      callId: 'thinkrr-abc',
      status: 'completed',
      durationSeconds: 42,
      transcript: 'Hello … goodbye.',
      timestampIso: new Date().toISOString(),
    });
    expect(r2.matched).toBe(true);
    expect(r2.newStatus).toBe('completed');
    const updated = calls[0];
    expect(updated.status).toBe('completed');
    expect(updated.durationSeconds).toBe(42);
    expect(updated.transcript).toBe('Hello … goodbye.');
  });

  it('handleWebhookEvent is idempotent on the terminal status', async () => {
    const seedRow = {
      id: 'voice-1',
      tenantId: TENANT_ID,
      thinkrrCallId: 'thinkrr-abc',
      status: 'completed',
      attempts: 1,
      maxAttempts: 3,
      outcome: null,
      startedAt: new Date(),
      endedAt: new Date(),
    };
    const { db } = makeFakeDb([seedRow]);
    const svc = new OutboundVoiceService(db as never, new ThinkrrOutboundClient());

    const r = await svc.handleWebhookEvent({ callId: 'thinkrr-abc', status: 'completed' });
    expect(r.matched).toBe(true);
    expect(r.previousStatus).toBe('completed');
    expect(r.newStatus).toBe('completed');
  });

  it('handleWebhookEvent returns matched=false on unknown call_id', async () => {
    const { db } = makeFakeDb();
    const svc = new OutboundVoiceService(db as never, new ThinkrrOutboundClient());

    const r = await svc.handleWebhookEvent({ callId: 'nope', status: 'completed' });
    expect(r.matched).toBe(false);
    expect(r.newStatus).toBeNull();
  });
});
