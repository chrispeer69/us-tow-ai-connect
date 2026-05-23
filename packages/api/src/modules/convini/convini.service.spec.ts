import { describe, it, expect } from 'vitest';
import { ConviniService } from './convini.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('ConviniService.parseBody', () => {
  it('returns null when there is no CONVINI marker', () => {
    expect(ConviniService.parseBody('STOP')).toBeNull();
    expect(ConviniService.parseBody('hello there')).toBeNull();
  });

  it('parses a colon-delimited key/value payload', () => {
    const body = 'CONVINI: ID=cv-123 NAME="Jane Doe" PHONE=+17408129489 PICKUP_LAT=40.1 PICKUP_LNG=-82.4 SERVICE=tow';
    const parsed = ConviniService.parseBody(body);
    expect(parsed).not.toBeNull();
    expect(parsed!.convini_id).toBe('cv-123');
    expect(parsed!.caller_name).toBe('Jane Doe');
    expect(parsed!.caller_phone).toBe('+17408129489');
    expect(parsed!.pickup_lat).toBe(40.1);
    expect(parsed!.pickup_lng).toBe(-82.4);
    expect(parsed!.service_type).toBe('tow');
  });

  it('accepts the hash form CONVINI#', () => {
    const parsed = ConviniService.parseBody('CONVINI# ID=foo NAME=Bar');
    expect(parsed?.convini_id).toBe('foo');
    expect(parsed?.caller_name).toBe('Bar');
  });

  it('parses an embedded JOB JSON blob and merges into raw_fields', () => {
    const body = 'CONVINI: ID=cv-9 JOB={"caller_name":"Jane","pickup_address":"123 Main","vehicle_make":"Honda"}';
    const parsed = ConviniService.parseBody(body);
    expect(parsed?.convini_id).toBe('cv-9');
    expect(parsed?.caller_name).toBe('Jane');
    expect(parsed?.pickup_address).toBe('123 Main');
    expect(parsed?.vehicle?.make).toBe('Honda');
  });

  it('survives a malformed JSON blob without losing the kv pairs', () => {
    const body = 'CONVINI: ID=cv-1 JOB={not-json} CALLER_PHONE=+15555555555';
    const parsed = ConviniService.parseBody(body);
    expect(parsed?.convini_id).toBe('cv-1');
    expect(parsed?.caller_phone).toBe('+15555555555');
  });

  it('returns null id when no ID/JOB/job_id field is present', () => {
    const body = 'CONVINI: NAME=Foo';
    const parsed = ConviniService.parseBody(body);
    expect(parsed?.convini_id).toBeNull();
  });
});

function makeDb() {
  const inserts: Array<Record<string, unknown>> = [];
  const executes: Array<string> = [];
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    execute(q: unknown) {
      executes.push(String(q));
      return Promise.resolve({ rows: [] });
    },
    insert() {
      return {
        values(v: Record<string, unknown>) {
          inserts.push(v);
          return {
            returning: () => Promise.resolve([{ id: 'incoming-1' }]),
          };
        },
      };
    },
    update() {
      return {
        set(patch: Record<string, unknown>) {
          updates.push(patch);
          return { where: () => Promise.resolve() };
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
  return { db, inserts, executes, updates };
}

describe('ConviniService.ingest', () => {
  it('returns null when body has no CONVINI marker', async () => {
    const { db } = makeDb();
    const svc = new ConviniService(db as never);
    const result = await svc.ingest(TENANT_ID, 'random sms');
    expect(result).toBeNull();
  });

  it('persists a recognised payload and projects to unified_jobs when reachable', async () => {
    const { db, inserts, executes } = makeDb();
    const svc = new ConviniService(db as never);
    const body = 'CONVINI: ID=cv-7 NAME="Foo" PICKUP_ADDRESS="123 Main"';
    const result = await svc.ingest(TENANT_ID, body);
    expect(result?.id).toBe('incoming-1');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ tenantId: TENANT_ID, conviniId: 'cv-7', status: 'received' });
    // At least one execute for probe + projection insert.
    expect(executes.length).toBeGreaterThanOrEqual(1);
  });
});
