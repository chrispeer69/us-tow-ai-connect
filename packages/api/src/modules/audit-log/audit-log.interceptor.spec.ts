import { describe, it, expect, vi, beforeEach } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AuditLogInterceptor } from './audit-log.interceptor';
import type { AuditLogService } from './audit-log.service';

class FakeReflector {
  private values = new Map<string, unknown>();
  set<T>(key: string, value: T) {
    this.values.set(key, value);
  }
  get<T>(key: string, _handler: unknown): T | undefined {
    return this.values.get(key) as T | undefined;
  }
}

function makeContext(req: Record<string, unknown>) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => {},
  };
}

describe('AuditLogInterceptor', () => {
  let recorder: { calls: unknown[]; service: AuditLogService };
  let reflector: FakeReflector;
  let interceptor: AuditLogInterceptor;

  beforeEach(() => {
    const calls: unknown[] = [];
    recorder = {
      calls,
      service: {
        record: vi.fn(async (p: unknown) => {
          calls.push(p);
          return null;
        }),
      } as unknown as AuditLogService,
    };
    reflector = new FakeReflector();
    interceptor = new AuditLogInterceptor(reflector as never, recorder.service);
  });

  it('records a row for POST /v1/admin/credentials and does not modify the response', async () => {
    const req = {
      method: 'POST',
      path: '/v1/admin/credentials',
      url: '/v1/admin/credentials',
      headers: { 'x-tenant-id': 't1', 'user-agent': 'curl/8' },
      body: { username: 'admin', password: 'pw' },
      params: {},
      tenant: undefined,
      tenantId: 't1',
      requestId: 'req-1',
    };
    const ctx = makeContext(req);
    const next = { handle: () => of({ ok: true }) };
    const observed = await firstValueFrom(interceptor.intercept(ctx as never, next as never));
    expect(observed).toEqual({ ok: true });
    expect(recorder.calls.length).toBe(1);
    const payload = recorder.calls[0] as Record<string, unknown>;
    expect(payload.action).toBe('POST /v1/admin/credentials');
    expect(payload.actorType).toBe('user');
    const after = payload.after as Record<string, unknown>;
    expect(after.username).toBe('admin');
    expect(after.password).toBe('[REDACTED]');
  });

  it('uses @AuditAction metadata when present', async () => {
    reflector.set('audit:action', 'credential.update');
    reflector.set('audit:resource_type', 'tenant_credentials');
    const req = {
      method: 'PUT',
      path: '/v1/admin/credentials',
      headers: { 'x-tenant-id': 't1' },
      body: {},
      params: { id: 'abc' },
    };
    const ctx = makeContext(req);
    await firstValueFrom(
      interceptor.intercept(ctx as never, { handle: () => of(null) } as never),
    );
    const payload = recorder.calls[0] as Record<string, unknown>;
    expect(payload.action).toBe('credential.update');
    expect(payload.resourceType).toBe('tenant_credentials');
    expect(payload.resourceId).toBe('abc');
  });

  it('skips audit when @SkipAudit is set', async () => {
    reflector.set('audit:skip', true);
    const req = {
      method: 'POST',
      path: '/v1/admin/credentials/test',
      headers: {},
      body: {},
    };
    await firstValueFrom(
      interceptor.intercept(makeContext(req) as never, { handle: () => of(null) } as never),
    );
    expect(recorder.calls.length).toBe(0);
  });

  it('skips GET requests entirely', async () => {
    const req = { method: 'GET', path: '/v1/admin/members', headers: {}, body: {} };
    await firstValueFrom(
      interceptor.intercept(makeContext(req) as never, { handle: () => of([]) } as never),
    );
    expect(recorder.calls.length).toBe(0);
  });

  it('writes a *.failed action when the handler throws', async () => {
    const req = {
      method: 'POST',
      path: '/v1/admin/credentials',
      headers: { 'x-tenant-id': 't1' },
      body: { password: 'pw' },
      params: {},
    };
    const next = { handle: () => throwError(() => new Error('boom')) };
    await expect(
      firstValueFrom(interceptor.intercept(makeContext(req) as never, next as never)),
    ).rejects.toThrow('boom');
    const payload = recorder.calls[0] as Record<string, unknown>;
    expect(payload.action).toBe('POST /v1/admin/credentials.failed');
    const meta = payload.metadata as Record<string, unknown>;
    expect(meta.status).toBe('error');
    expect(meta.error).toBe('boom');
  });
});
