import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// web-push is mocked so no real network/VAPID work happens.
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));
import webpush from 'web-push';
import { PushService } from './push.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DRIVER_ID = '00000000-0000-0000-0000-0000000000aa';

interface FakeOpts {
  subs?: Array<{ id: string; endpoint: string; p256dhKey: string; authKey: string }>;
  driverPhone?: string | null;
  insertRow?: { id: string; createdAt: Date };
  deleteRowCount?: number;
}

function makeDb(opts: FakeOpts = {}) {
  const calls = {
    insert: [] as Record<string, unknown>[],
    deletes: 0,
    updates: [] as Record<string, unknown>[],
  };
  const db = {
    insert() {
      return {
        values(v: Record<string, unknown>) {
          calls.insert.push(v);
          return {
            onConflictDoUpdate() {
              return {
                returning: () =>
                  Promise.resolve([
                    opts.insertRow ?? { id: 'sub-1', createdAt: new Date() },
                  ]),
              };
            },
          };
        },
      };
    },
    delete() {
      return {
        where() {
          calls.deletes += 1;
          return Promise.resolve({ rowCount: opts.deleteRowCount ?? 1 });
        },
      };
    },
    select() {
      return { from: () => ({ where: () => Promise.resolve(opts.subs ?? []) }) };
    },
    update() {
      return {
        set(s: Record<string, unknown>) {
          calls.updates.push(s);
          return { where: () => Promise.resolve() };
        },
      };
    },
    query: {
      drivers: {
        findFirst: () =>
          Promise.resolve(
            opts.driverPhone === undefined ? null : { phone: opts.driverPhone },
          ),
      },
    },
  };
  return { db, calls };
}

const sendMock = webpush.sendNotification as unknown as Mock;

beforeEach(() => {
  sendMock.mockReset();
  process.env.VAPID_PUBLIC_KEY = 'test-public';
  process.env.VAPID_PRIVATE_KEY = 'test-private';
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
});

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

describe('PushService.normalizePhone', () => {
  it('coerces a 10-digit number to E.164', () => {
    expect(PushService.normalizePhone('7408129489')).toBe('+17408129489');
  });
  it('returns null for too-short input', () => {
    expect(PushService.normalizePhone('123')).toBeNull();
  });
});

describe('PushService.subscribe', () => {
  it('persists with normalized phone and reports created', async () => {
    const { db, calls } = makeDb({ insertRow: { id: 'sub-9', createdAt: new Date() } });
    const svc = new PushService(db as never);
    const res = await svc.subscribe(TENANT_ID, {
      driver_phone: '(740) 812-9489',
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'p', auth: 'a' },
      user_agent: 'UA',
    });
    expect(calls.insert[0].driverPhone).toBe('+17408129489');
    expect(calls.insert[0].endpoint).toBe('https://push.example/abc');
    expect(res).toEqual({ id: 'sub-9', created: true });
  });

  it('rejects a bogus phone', async () => {
    const { db } = makeDb();
    const svc = new PushService(db as never);
    await expect(
      svc.subscribe(TENANT_ID, {
        driver_phone: '12',
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'p', auth: 'a' },
      }),
    ).rejects.toThrow(/Invalid driver_phone/);
  });
});

describe('PushService.unsubscribe', () => {
  it('returns the number of rows removed', async () => {
    const { db, calls } = makeDb({ deleteRowCount: 1 });
    const svc = new PushService(db as never);
    const n = await svc.unsubscribe(TENANT_ID, 'https://push.example/abc');
    expect(n).toBe(1);
    expect(calls.deletes).toBe(1);
  });
});

describe('PushService.sendToPhone', () => {
  it('skips (no send) when VAPID is unset', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const { db } = makeDb({ subs: [{ id: 's1', endpoint: 'e', p256dhKey: 'p', authKey: 'a' }] });
    const svc = new PushService(db as never);
    const res = await svc.sendToPhone(TENANT_ID, '7408129489', { title: 't', body: 'b' });
    expect(res.skipped).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends to a subscription and stamps last_used_at', async () => {
    sendMock.mockResolvedValue(undefined);
    const { db, calls } = makeDb({
      subs: [{ id: 's1', endpoint: 'https://push/e1', p256dhKey: 'p', authKey: 'a' }],
    });
    const svc = new PushService(db as never);
    const res = await svc.sendToPhone(TENANT_ID, '7408129489', {
      title: 'New job',
      body: 'Tow',
      url: '/driver?job=1',
    });
    expect(res).toEqual({ sent: 1, removed: 0, skipped: false });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(calls.updates[0]).toHaveProperty('lastUsedAt');
  });

  it('prunes a subscription on 410 Gone', async () => {
    sendMock.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    const { db, calls } = makeDb({
      subs: [{ id: 's1', endpoint: 'https://push/dead', p256dhKey: 'p', authKey: 'a' }],
    });
    const svc = new PushService(db as never);
    const res = await svc.sendToPhone(TENANT_ID, '7408129489', { title: 't', body: 'b' });
    expect(res).toEqual({ sent: 0, removed: 1, skipped: false });
    expect(calls.deletes).toBe(1);
  });

  it('keeps the subscription on a transient (500) error', async () => {
    sendMock.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));
    const { db, calls } = makeDb({
      subs: [{ id: 's1', endpoint: 'https://push/e1', p256dhKey: 'p', authKey: 'a' }],
    });
    const svc = new PushService(db as never);
    const res = await svc.sendToPhone(TENANT_ID, '7408129489', { title: 't', body: 'b' });
    expect(res).toEqual({ sent: 0, removed: 0, skipped: false });
    expect(calls.deletes).toBe(0);
  });
});

describe('PushService.sendToDriver', () => {
  it('resolves driver id → phone and fans out to all devices', async () => {
    sendMock.mockResolvedValue(undefined);
    const { db } = makeDb({
      driverPhone: '+17408129489',
      subs: [
        { id: 's1', endpoint: 'https://push/phone', p256dhKey: 'p', authKey: 'a' },
        { id: 's2', endpoint: 'https://push/tablet', p256dhKey: 'p', authKey: 'a' },
      ],
    });
    const svc = new PushService(db as never);
    const res = await svc.sendToDriver(TENANT_ID, DRIVER_ID, {
      title: 'New job assigned',
      body: 'Tow — 1 Main St',
      url: `/driver?job=${DRIVER_ID}`,
    });
    expect(res).toEqual({ sent: 2, removed: 0, skipped: false });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('skips when the driver has no phone on file', async () => {
    const { db } = makeDb({ driverPhone: null });
    const svc = new PushService(db as never);
    const res = await svc.sendToDriver(TENANT_ID, DRIVER_ID, { title: 't', body: 'b' });
    expect(res.skipped).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
