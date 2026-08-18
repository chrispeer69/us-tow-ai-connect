import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OutboundVoiceService } from './outbound-voice.service';
import { ThinkrrOutboundClient } from './thinkrr-outbound.client';
import { RetellOutboundClient } from './retell-outbound.client';
import { MissingVariableError } from './script-templates';
import { outboundCallLogs, outboundCalls, tenants as tenantsTable } from '../../db/schema';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function makeFakeDb(
  initialCalls: any[] = [],
  tenantOverrides: Partial<any> = {},
  initialLogs: any[] = [],
) {
  const calls: any[] = [...initialCalls];
  const logs: any[] = [...initialLogs];
  const tenants: any[] = [
    {
      id: TENANT_ID,
      companyName: 'Roadside Towing',
      timezone: 'America/New_York',
      managerPhones: [],
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
            || table === outboundCalls;
          const isLogs = table?.[Symbol.for('drizzle:Name')] === 'outbound_call_logs'
            || table === outboundCallLogs;
          const isTenants = table?.[Symbol.for('drizzle:Name')] === 'tenants'
            || table === tenantsTable;
          // We can't reliably detect the table object across drizzle internals,
          // so we expose a simple chain that supports both calls & tenants by
          // letting the test bag remember the most recent select.
          // In practice the service reads either tenants or outbound_calls; we
          // disambiguate by which "where" predicate fires.
          let matched: any[] = isLogs ? logs : isCalls ? calls : tenants;
          let activeTable = isLogs ? 'logs' : isCalls ? 'calls' : isTenants ? 'tenants' : 'tenants';

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
    update(table: any) {
      const isLogs = table?.[Symbol.for('drizzle:Name')] === 'outbound_call_logs'
        || table === outboundCallLogs;
      return {
        set(patch: any) {
          return {
            where(_w: any) {
              const targetRows = isLogs ? logs : calls;
              const chain = {
                returning: async () => {
                  // Apply patch to all currently tracked rows that haven't been
                  // assigned the patch — for the tests this is acceptable since
                  // tests only operate on a single row.
                  const target = targetRows[targetRows.length - 1];
                  if (target) Object.assign(target, patch);
                  return target ? [target] : [];
                },
                then: (resolve: any) => {
                  const target = targetRows[targetRows.length - 1];
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
    execute: vi.fn(async () => undefined),
  };

  return { db, calls, tenants, logs };
}

function wrapCallRow(row: any) {
  return row;
}

function createSvc(db: any) {
  const thinkrr = new ThinkrrOutboundClient();
  const retell = new RetellOutboundClient();
  const provider = {
    providerName: 'retell',
    placeCall: vi.fn(async () => null),
    cancelCall: vi.fn(async () => false),
  } as any;
  const sms = { sendSms: vi.fn(async () => ({ id: 'sms-1', status: 'sent' })) };
  return new OutboundVoiceService(db as never, thinkrr, retell, provider, sms as never, makePush() as never);
}

/** Session 77 — a flip win also buzzes registered manager devices. Stubbed so
 *  the win path is exercised end to end rather than short-circuited. */
function makePush() {
  return { sendFlipWin: vi.fn().mockResolvedValue(undefined) };
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
    const svc = createSvc(db);

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

  it('enqueueCall reuses an existing custom call for the same related job', async () => {
    const existing = {
      id: 'voice-existing',
      tenantId: TENANT_ID,
      purpose: 'custom',
      relatedJobId: '00000000-0000-0000-0000-000000000abc',
      toPhone: '+15551234567',
      toName: 'Pat',
      scriptTemplate: 'custom',
      scriptVariables: { body: 'already queued' },
      status: 'no_answer',
      attempts: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db, calls } = makeFakeDb([existing]);
    const svc = createSvc(db);

    const row = await svc.enqueueCall({
      tenantId: TENANT_ID,
      purpose: 'custom',
      toPhone: '+15551234567',
      toName: 'Pat',
      scriptTemplate: 'custom',
      scriptVariables: { body: 'new duplicate' },
      relatedJobId: '00000000-0000-0000-0000-000000000abc',
    });

    expect(row.id).toBe('voice-existing');
    expect(calls).toHaveLength(1);
  });

  it('enqueueCall can bypass related-job dedupe for deliberate manual follow-up calls', async () => {
    const existing = {
      id: 'voice-existing',
      tenantId: TENANT_ID,
      purpose: 'custom',
      relatedJobId: '00000000-0000-0000-0000-000000000abc',
      toPhone: '+15551234567',
      toName: 'Pat',
      scriptTemplate: 'custom',
      scriptVariables: { body: 'first attempt' },
      status: 'no_answer',
      attempts: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db, calls } = makeFakeDb([existing]);
    const svc = createSvc(db);

    const row = await svc.enqueueCall({
      tenantId: TENANT_ID,
      purpose: 'custom',
      toPhone: '+15551234567',
      toName: 'Pat',
      scriptTemplate: 'custom',
      scriptVariables: { body: 'manual follow-up' },
      relatedJobId: '00000000-0000-0000-0000-000000000abc',
      dedupeRelatedJob: false,
    });

    expect(row.id).not.toBe('voice-existing');
    expect(calls).toHaveLength(2);
  });

  it('enqueueCall raises MissingVariableError when required variable is empty', async () => {
    const { db } = makeFakeDb();
    const svc = createSvc(db);

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
    const svc = createSvc(db);

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

  it('enqueueCall refuses when tenant is in demo mode and demo calls are disabled', async () => {
    const { db } = makeFakeDb([], {
      outboundVoiceConfig: { demo_mode: true, demo_calls_enabled: false },
    });
    const svc = createSvc(db);

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
    ).rejects.toThrow(/demo calls are disabled/i);
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
    const svc = createSvc(db);

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

  it('sends manager attention SMS when a provider webhook reports no answer', async () => {
    const seedRow = {
      id: 'voice-no-answer',
      tenantId: TENANT_ID,
      retellCallId: 'retell-no-answer',
      purpose: 'custom',
      relatedJobId: '00000000-0000-0000-0000-000000000abc',
      toPhone: '+15551234567',
      toName: 'Pat Customer',
      scriptTemplate: 'custom',
      scriptVariables: {},
      status: 'dialing',
      attempts: 1,
      maxAttempts: 3,
      outcome: null,
      startedAt: null,
      endedAt: null,
    };
    const { db } = makeFakeDb([seedRow], { managerPhones: ['+15557654321'] });
    const thinkrr = new ThinkrrOutboundClient();
    const retell = new RetellOutboundClient();
    const provider = {
      providerName: 'retell',
      placeCall: vi.fn(async () => null),
      cancelCall: vi.fn(async () => false),
    } as any;
    const sms = { sendSms: vi.fn(async () => ({ id: 'sms-1', status: 'sent' })) };
    const svc = new OutboundVoiceService(db as never, thinkrr, retell, provider, sms as never, makePush() as never);

    const result = await svc.handleProviderWebhookEvent({
      provider: 'retell',
      callId: 'retell-no-answer',
      status: 'no_answer',
      error: 'voicemail_reached',
    });

    expect(result.matched).toBe(true);
    expect(sms.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+15557654321',
        tenantId: TENANT_ID,
        body: expect.stringContaining('AI CALL NEEDS ATTENTION'),
      }),
    );
    expect(sms.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('no answer / voicemail'),
      }),
    );
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
    const svc = createSvc(db);

    const r = await svc.handleWebhookEvent({ callId: 'thinkrr-abc', status: 'completed' });
    expect(r.matched).toBe(true);
    expect(r.previousStatus).toBe('completed');
    expect(r.newStatus).toBe('completed');
  });

  it('handleWebhookEvent returns matched=false on unknown call_id', async () => {
    const { db } = makeFakeDb();
    const svc = createSvc(db);

    const r = await svc.handleWebhookEvent({ callId: 'nope', status: 'completed' });
    expect(r.matched).toBe(false);
    expect(r.newStatus).toBeNull();
  });

  it('syncs accepted Retell analysis to flip activity and sends manager SMS once', async () => {
    const seedRow = {
      id: 'voice-1',
      tenantId: TENANT_ID,
      retellCallId: 'retell-abc',
      toPhone: '+15551234567',
      status: 'dialing',
      attempts: 1,
      maxAttempts: 3,
      outcome: null,
      startedAt: null,
      endedAt: null,
      durationSeconds: null,
      transcript: null,
      recordingUrl: null,
    };
    const seedLog = {
      id: 'log-1',
      tenantId: TENANT_ID,
      customerName: 'Pat Customer',
      customerPhone: '+15551234567',
      vehicle: '2020 Ford F-150',
      issueType: 'tow',
      originalDestination: 'Competitor Auto',
      nearestOurShop: 'Roadside Towing Shop',
      offer1Result: 'NOT_ATTEMPTED',
      offer2Result: 'NOT_ATTEMPTED',
      offer3Result: 'NOT_ATTEMPTED',
      flipOutcome: 'NOT_ATTEMPTED',
      conviniLinkSent: false,
      managementNotified: false,
      callTime: new Date(),
    };
    const { db, logs } = makeFakeDb(
      [seedRow],
      { managerPhones: ['+15557654321'] },
      [seedLog],
    );
    const thinkrr = new ThinkrrOutboundClient();
    const retell = new RetellOutboundClient();
    const provider = {
      providerName: 'retell',
      placeCall: vi.fn(async () => null),
      cancelCall: vi.fn(async () => false),
    } as any;
    const sms = { sendSms: vi.fn(async () => ({ id: 'sms-1', status: 'sent' })) };
    const svc = new OutboundVoiceService(db as never, thinkrr, retell, provider, sms as never, makePush() as never);

    const result = await svc.handleProviderWebhookEvent({
      provider: 'retell',
      callId: 'retell-abc',
      status: 'completed',
      durationSeconds: 115,
      transcript: 'customer accepted offer one',
      recordingUrl: 'https://recording.example/call',
      analysisData: {
        flip_eligible: true,
        flip_outcome: 'accepted',
        offer_1_result: 'accepted',
        convini_link_sent: true,
        destination_type: 'competitor_repair',
      },
    });

    expect(result.matched).toBe(true);
    expect(logs[0]).toMatchObject({
      flipEligible: true,
      flipOutcome: 'ACCEPTED',
      offer1Result: 'ACCEPTED',
      conviniLinkSent: true,
      managementNotified: true,
      callDurationSeconds: 115,
      transcript: 'customer accepted offer one',
    });
    expect(sms.sendSms).toHaveBeenCalledTimes(1);
    expect(sms.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+15557654321',
        tenantId: TENANT_ID,
      }),
    );
  });

  it('treats destination change language as a flip win', async () => {
    const seedRow = {
      id: 'voice-destination-change',
      tenantId: TENANT_ID,
      provider: 'retell',
      retellCallId: 'retell-change',
      purpose: 'custom',
      relatedJobId: '00000000-0000-0000-0000-000000000abc',
      toPhone: '+15551234567',
      toName: 'Mary',
      scriptTemplate: 'custom',
      scriptVariables: {},
      status: 'dialing',
      attempts: 1,
      maxAttempts: 3,
      outcome: null,
      startedAt: null,
      endedAt: null,
      durationSeconds: null,
      transcript: null,
      recordingUrl: null,
    };
    const seedLog = {
      id: 'log-destination-change',
      tenantId: TENANT_ID,
      customerName: 'Mary Customer',
      customerPhone: '+15551234567',
      vehicle: '2022 Toyota Camry',
      issueType: 'tow',
      originalDestination: 'Competitor Auto',
      nearestOurShop: 'Roadside Towing Shop',
      offer1Result: 'NOT_ATTEMPTED',
      offer2Result: 'NOT_ATTEMPTED',
      offer3Result: 'NOT_ATTEMPTED',
      flipOutcome: 'NOT_ATTEMPTED',
      conviniLinkSent: false,
      managementNotified: false,
      callTime: new Date(),
    };
    const { db, logs } = makeFakeDb(
      [seedRow],
      { managerPhones: ['+15557654321'] },
      [seedLog],
    );
    const thinkrr = new ThinkrrOutboundClient();
    const retell = new RetellOutboundClient();
    const provider = {
      providerName: 'retell',
      placeCall: vi.fn(async () => null),
      cancelCall: vi.fn(async () => false),
    } as any;
    const sms = { sendSms: vi.fn(async () => ({ id: 'sms-1', status: 'sent' })) };
    const svc = new OutboundVoiceService(db as never, thinkrr, retell, provider, sms as never, makePush() as never);

    await svc.handleProviderWebhookEvent({
      provider: 'retell',
      callId: 'retell-change',
      status: 'completed',
      transcript: 'Mary said she wants the destination changed to our shop',
      analysisData: {
        flip_eligible: true,
        flip_outcome: 'destination changed',
        offer_1_result: 'customer wants destination changed',
        destination_type: 'competitor_repair',
      },
    });

    expect(logs[0]).toMatchObject({
      flipOutcome: 'ACCEPTED',
      offer1Result: 'ACCEPTED',
      managementNotified: true,
    });
    expect(sms.sendSms).toHaveBeenCalledTimes(1);
  });

  it('testCall creates an outbound log row even when the provider is unconfigured', async () => {
    const { db, calls } = makeFakeDb();
    const svc = createSvc(db);

    const result = await svc.testCall(TENANT_ID, {
      scenario: 'unknown',
      toPhone: '(555) 123-4567',
      customerName: 'Emily',
    });

    expect(result.success).toBe(false);
    expect(result.outboundCallId).toBe('voice-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: 'voice-1',
      purpose: 'custom',
      toPhone: '+15551234567',
      status: 'failed',
      attempts: 1,
    });
  });
});
