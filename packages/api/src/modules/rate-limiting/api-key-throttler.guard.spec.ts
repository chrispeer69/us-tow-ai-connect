import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiKeyThrottlerGuard } from './api-key-throttler.guard';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';

class FakeRedis {
  // Fixed-window mock: counter + expire + ttl tracked in memory.
  private counters = new Map<string, number>();
  private hashes = new Map<string, Record<string, string>>();
  private overrides = new Map<string, string>();

  async incr(key: string) {
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    return n;
  }
  async expire(_key: string, _seconds: number) {
    return 1;
  }
  async ttl(_key: string) {
    return 60;
  }
  async get(key: string) {
    return this.overrides.get(key) ?? null;
  }
  async hincrby(key: string, field: string, delta: number) {
    const h = this.hashes.get(key) ?? {};
    h[field] = String((parseInt(h[field] ?? '0', 10) || 0) + delta);
    this.hashes.set(key, h);
    return parseInt(h[field], 10);
  }

  setOverride(key: string, limit: number) {
    this.overrides.set(key, String(limit));
  }
}

interface FakeRes {
  headers: Record<string, string>;
  statusCode: number;
}

function makeContext(path: string, headers: Record<string, string> = {}) {
  const res: FakeRes = { headers: {}, statusCode: 200 };
  const setHeader = (k: string, v: string) => {
    res.headers[k] = v;
  };
  const status = (s: number) => {
    res.statusCode = s;
    return res;
  };
  const req = {
    path,
    url: path,
    method: 'GET',
    headers: { ...headers },
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' },
  };
  return {
    res,
    ctx: {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ setHeader, status }),
      }),
    },
  };
}

describe('ApiKeyThrottlerGuard', () => {
  let redis: FakeRedis;
  let guard: ApiKeyThrottlerGuard;

  beforeEach(() => {
    redis = new FakeRedis();
    guard = new ApiKeyThrottlerGuard(redis as never);
  });

  it('lets requests through under the public-tier limit (60/min)', async () => {
    let allowed = 0;
    for (let i = 0; i < 60; i++) {
      const { ctx } = makeContext('/track/abc');
      const ok = await guard.canActivate(ctx as never);
      if (ok) allowed++;
    }
    expect(allowed).toBe(60);
  });

  it('throws TooManyRequestsException once the public tier is exceeded', async () => {
    for (let i = 0; i < 60; i++) {
      const { ctx } = makeContext('/track/abc');
      await guard.canActivate(ctx as never);
    }
    const { ctx, res } = makeContext('/track/abc');
    await expect(guard.canActivate(ctx as never)).rejects.toBeInstanceOf(
      TooManyRequestsException,
    );
    expect(res.headers['Retry-After']).toBe('60');
    expect(res.headers['X-RateLimit-Group']).toBe('public');
  });

  it('uses 120/min for tenant_api when X-Tenant-API-Key is set', async () => {
    let throttled = 0;
    for (let i = 0; i < 130; i++) {
      const { ctx } = makeContext('/v1/ai-connect/health', {
        'x-tenant-api-key': 'usk_aaaaaaaaaaaa',
      });
      try {
        await guard.canActivate(ctx as never);
      } catch {
        throttled++;
      }
    }
    expect(throttled).toBe(10); // 130 attempts, 120 allowed, 10 throttled
  });

  it('honours a per-identifier Redis override', async () => {
    // Guard buckets tenant_api by the 12-char prefix of the API key, so the
    // override key must use the prefix too — not the full key.
    redis.setOverride('throttle:override:tenant_api:usk_aaaaaaaa', 5);
    let throttled = 0;
    for (let i = 0; i < 10; i++) {
      const { ctx } = makeContext('/v1/ai-connect/health', {
        'x-tenant-api-key': 'usk_aaaaaaaaaaaa',
      });
      try {
        await guard.canActivate(ctx as never);
      } catch {
        throttled++;
      }
    }
    expect(throttled).toBe(5);
  });

  it('passes through unmatched paths without recording a count', async () => {
    const { ctx } = makeContext('/internal/ping');
    const ok = await guard.canActivate(ctx as never);
    expect(ok).toBe(true);
  });

  it('fails open if Redis throws', async () => {
    const explodingRedis = {
      ...redis,
      incr: vi.fn().mockRejectedValue(new Error('redis is down')),
    };
    const explodingGuard = new ApiKeyThrottlerGuard(explodingRedis as never);
    const { ctx } = makeContext('/track/xyz');
    const ok = await explodingGuard.canActivate(ctx as never);
    expect(ok).toBe(true);
  });
});
