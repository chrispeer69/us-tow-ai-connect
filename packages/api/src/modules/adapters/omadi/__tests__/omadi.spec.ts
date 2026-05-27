import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the Omadi adapter. Playwright fully mocked — no real browser,
 * no network. Mirrors the TowLogs spec layout.
 */

const h = vi.hoisted(() => {
  return {
    page: null as any,
    launch: null as any,
  };
});

vi.mock('playwright', () => {
  const newContext = vi.fn(async () => ({
    newPage: vi.fn(async () => h.page),
    storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
  }));
  const launch = vi.fn(async () => ({
    newContext,
    close: vi.fn(async () => undefined),
  }));
  h.launch = launch;
  return { chromium: { launch } };
});

import { OmadiAdapter } from '../omadi.adapter';
import { SessionExpiredException } from '../../../../common/exceptions/session-expired.exception';

function makeLocator(opts: {
  count?: number;
  visible?: boolean;
  enabled?: boolean;
  text?: string | null;
}) {
  const loc: any = {
    count: vi.fn(async () => opts.count ?? 0),
    isVisible: vi.fn(async () => opts.visible ?? false),
    isEnabled: vi.fn(async () => opts.enabled ?? false),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    textContent: vi.fn(async () => opts.text ?? null),
  };
  loc.first = () => loc;
  loc.last = () => loc;
  return loc;
}

function makePage(cfg: {
  jobLinkCount?: number;
  actionButton?: string | null;
  landedUrl?: string;
  evaluateResult?: any;
}) {
  const url = cfg.landedUrl ?? 'https://app.omadi.com/dispatch';
  const getByRole = vi.fn((role: string, o?: { name?: string | RegExp }) => {
    if (role === 'link') return makeLocator({ count: cfg.jobLinkCount ?? 1 });
    if (role === 'button') {
      const nameMatch =
        typeof o?.name === 'string'
          ? cfg.actionButton === o.name
          : o?.name instanceof RegExp
            ? true
            : false;
      const match = !!cfg.actionButton && nameMatch;
      return makeLocator({ count: match ? 1 : 0, visible: match, enabled: match });
    }
    return makeLocator({ count: 0 });
  });
  // Default locator(...) resolves to "absent" — keeps the optional reason /
  // dialog flow inert by default. Tests can opt into a present modal by
  // overriding this on the page mock.
  const locator = vi.fn(() => makeLocator({ count: 0 }));
  return {
    goto: vi.fn(async () => undefined),
    url: vi.fn(() => url),
    waitForURL: vi.fn(async () => undefined),
    waitForSelector: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => Buffer.from('')),
    evaluate: vi.fn(async () => cfg.evaluateResult ?? []),
    getByRole,
    locator,
  } as any;
}

function makeRedis(session: string | null) {
  return {
    get: vi.fn(async () => session),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  } as any;
}

const SESSION = JSON.stringify({ cookies: [], origins: [] });

describe('OmadiAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('login caches storage state in Redis under session:omadi:<tenantId>', async () => {
    h.page = makePage({ landedUrl: 'https://app.omadi.com/dispatch' });
    const redis = makeRedis(null);
    const adapter = new OmadiAdapter(redis);

    await adapter.login('tenant-1', { username: 'u', password: 'p' });

    expect(redis.set).toHaveBeenCalledWith(
      'session:omadi:tenant-1',
      expect.stringContaining('cookies'),
      'EX',
      expect.any(Number),
    );
  });

  it('scrapeAllActiveJobs throws SessionExpiredException when no session exists', async () => {
    h.page = makePage({});
    const adapter = new OmadiAdapter(makeRedis(null));
    await expect(adapter.scrapeAllActiveJobs('tenant-1')).rejects.toBeInstanceOf(
      SessionExpiredException,
    );
  });

  it('scrapeAllActiveJobs returns rows from the evaluated DOM', async () => {
    const fakeJobs = [
      {
        jobId: 'OM-1',
        customerName: 'Jane',
        customerPhone: '5551234567',
        vehicle: 'Civic',
        status: 'Open',
        driverName: '',
        eta: 'Unknown',
        destination: '',
        lastUpdated: '2026-05-27T00:00:00Z',
      },
    ];
    h.page = makePage({ evaluateResult: fakeJobs });
    const adapter = new OmadiAdapter(makeRedis(SESSION));

    const jobs = await adapter.scrapeAllActiveJobs('tenant-1');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobId).toBe('OM-1');
  });

  it('scrapeAllActiveJobs deletes session + throws when page bounces to /login', async () => {
    h.page = makePage({ landedUrl: 'https://app.omadi.com/login' });
    const redis = makeRedis(SESSION);
    const adapter = new OmadiAdapter(redis);

    await expect(adapter.scrapeAllActiveJobs('tenant-1')).rejects.toBeInstanceOf(
      SessionExpiredException,
    );
    expect(redis.del).toHaveBeenCalledWith('session:omadi:tenant-1');
  });

  it('acceptJob clicks the Accept button and returns a success result', async () => {
    h.page = makePage({ actionButton: 'Accept' });
    const adapter = new OmadiAdapter(makeRedis(SESSION));

    const result = await adapter.acceptJob('tenant-1', 'OM-1');
    expect(result.success).toBe(true);
    expect(result.confirmedAt).toBeTruthy();
    expect(result.confirmationEvidence).toBeTruthy();
    expect(h.page.getByRole).toHaveBeenCalledWith(
      'button',
      expect.objectContaining({ name: 'Accept', exact: true }),
    );
  });

  it('declineJob clicks the Decline button and returns a success result', async () => {
    h.page = makePage({ actionButton: 'Decline' });
    const adapter = new OmadiAdapter(makeRedis(SESSION));

    const result = await adapter.declineJob('tenant-1', 'OM-1', 'too far');
    expect(result.success).toBe(true);
    expect(h.page.getByRole).toHaveBeenCalledWith(
      'button',
      expect.objectContaining({ name: 'Decline', exact: true }),
    );
  });

  it('returns credentials-not-configured (no browser launch) when no session', async () => {
    h.page = makePage({ actionButton: 'Accept' });
    h.launch.mockClear();
    const adapter = new OmadiAdapter(makeRedis(null));

    const result = await adapter.acceptJob('tenant-1', 'OM-1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credentials-not-configured/i);
    expect(h.launch).not.toHaveBeenCalled();
  });

  it('returns a failure result + screenshot when the action button is absent', async () => {
    h.page = makePage({ actionButton: null });
    const adapter = new OmadiAdapter(makeRedis(SESSION));

    const result = await adapter.acceptJob('tenant-1', 'OM-1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/accept button not found/i);
    expect(h.page.screenshot).toHaveBeenCalledTimes(1);
  });

  it('returns a failure result + screenshot when the job row is not found', async () => {
    h.page = makePage({ jobLinkCount: 0, actionButton: 'Decline' });
    const adapter = new OmadiAdapter(makeRedis(SESSION));

    const result = await adapter.declineJob('tenant-1', 'NOPE', 'reason');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(h.page.screenshot).toHaveBeenCalledTimes(1);
  });

  it('dispatchJob returns a structured not-applicable result (never throws)', async () => {
    h.page = makePage({});
    const adapter = new OmadiAdapter(makeRedis(SESSION));

    const result = await adapter.dispatchJob('tenant-1', { customer: 'Jane', address: '1 Main' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not-applicable/i);
  });

  it('testConnection returns success + latency on a clean login', async () => {
    h.page = makePage({ landedUrl: 'https://app.omadi.com/dispatch' });
    const adapter = new OmadiAdapter(makeRedis(null));

    const result = await adapter.testConnection({ username: 'u', password: 'p' });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/connected/i);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('testConnection returns failure when login fails', async () => {
    h.page = makePage({ landedUrl: 'https://app.omadi.com/dispatch' });
    h.page.waitForURL = vi.fn(async () => {
      throw new Error('timeout');
    });
    const adapter = new OmadiAdapter(makeRedis(null));

    const result = await adapter.testConnection({ username: 'u', password: 'bad' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/failed/i);
  });
});
