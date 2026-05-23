import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TwilioSmsService } from './twilio-sms.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function makeDb(initialRows: Array<Record<string, unknown>> = []) {
  const rows = [...initialRows];
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<{ patch: Record<string, unknown>; where: string }> = [];

  const db = {
    insert() {
      return {
        values(v: Record<string, unknown>) {
          const row = { id: `sms-${rows.length + 1}`, createdAt: new Date(), ...v };
          rows.push(row);
          inserts.push(row);
          return { returning: async () => [row] };
        },
      };
    },
    update() {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(_w: unknown) {
              updates.push({ patch, where: 'unspecified' });
              return Promise.resolve();
            },
          };
        },
      };
    },
    select(): unknown {
      return {
        from() {
          return {
            where() {
              return {
                orderBy() {
                  return {
                    limit() {
                      return Promise.resolve(rows);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return { db, inserts, updates, rows };
}

describe('TwilioSmsService.sendSms (fallback mode)', () => {
  beforeEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
  });

  it('logs without crashing when Twilio is unconfigured', async () => {
    const { db, inserts } = makeDb();
    const svc = new TwilioSmsService(db as never);
    vi.spyOn(svc, 'findDedupeRow').mockResolvedValue(null);

    const result = await svc.sendSms({
      to: '+15551234567',
      body: 'hello',
      tenantId: TENANT_ID,
    });

    expect(result.deduped).toBe(false);
    expect(result.status).toBe('log_only');
    expect(inserts[0].status).toBe('log_only');
    expect(inserts[0].direction).toBe('outbound');
    expect(inserts[0].body).toBe('hello');
  });

  it('returns the existing row when a dedupe hit is found', async () => {
    const { db } = makeDb();
    const svc = new TwilioSmsService(db as never);
    vi.spyOn(svc, 'findDedupeRow').mockResolvedValue({
      id: 'sms-existing',
      twilioSid: 'SM_x',
      status: 'sent',
    } as never);

    const result = await svc.sendSms({
      to: '+15551234567',
      body: 'hello',
      tenantId: TENANT_ID,
    });

    expect(result.deduped).toBe(true);
    expect(result.id).toBe('sms-existing');
    expect(result.twilioSid).toBe('SM_x');
    expect(result.status).toBe('sent');
  });
});
