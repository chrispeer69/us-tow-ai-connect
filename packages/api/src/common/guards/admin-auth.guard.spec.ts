import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminAuthGuard, type AdminRequest } from './admin-auth.guard';

const VALID_TENANT = '00000000-0000-0000-0000-000000000001';
const ANOTHER_VALID = '11111111-2222-3333-4444-555555555555';

function ctxFor(headers: Record<string, string | string[] | undefined>): {
  ctx: ExecutionContext;
  req: AdminRequest;
} {
  const req = {
    headers,
    method: 'GET',
    path: '/v1/admin/company',
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as AdminRequest;
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('AdminAuthGuard', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.DEFAULT_ADMIN_TENANT_ID;
    delete process.env.DEFAULT_ADMIN_TENANT_ID;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DEFAULT_ADMIN_TENANT_ID;
    else process.env.DEFAULT_ADMIN_TENANT_ID = originalEnv;
  });

  it('accepts a UUID-shaped x-tenant-id header and stamps req.tenantId', () => {
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({ 'x-tenant-id': VALID_TENANT });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT);
  });

  it('returns 401 (not 500) when x-tenant-id header is missing entirely', () => {
    const guard = new AdminAuthGuard();
    const { ctx } = ctxFor({});
    try {
      guard.canActivate(ctx);
      expect.fail('expected UnauthorizedException');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      const body = (err as UnauthorizedException).getResponse() as Record<string, unknown>;
      expect(body.status).toBe('error');
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.message).toBe('Missing tenant context');
    }
  });

  it('returns 401 (not 500) when x-tenant-id is not a UUID — guards Postgres uuid cast', () => {
    const guard = new AdminAuthGuard();
    const { ctx } = ctxFor({ 'x-tenant-id': 'default-tenant' });
    try {
      guard.canActivate(ctx);
      expect.fail('expected UnauthorizedException');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      const body = (err as UnauthorizedException).getResponse() as Record<string, unknown>;
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.message).toBe('Invalid tenant identifier');
    }
  });

  it('returns 401 when x-tenant-id is a UUID-ish string with wrong shape', () => {
    const guard = new AdminAuthGuard();
    const { ctx } = ctxFor({ 'x-tenant-id': '00000000-0000-0000-0000-00000000000' }); // 11-char last segment
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects DEFAULT_ADMIN_TENANT_ID env when it is a non-UUID literal (root cause of prior 500s)', () => {
    process.env.DEFAULT_ADMIN_TENANT_ID = 'default-tenant';
    const guard = new AdminAuthGuard();
    const { ctx } = ctxFor({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('honours DEFAULT_ADMIN_TENANT_ID env when it is itself UUID-shaped', () => {
    process.env.DEFAULT_ADMIN_TENANT_ID = VALID_TENANT;
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({});
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT);
  });

  it('header wins over env default', () => {
    process.env.DEFAULT_ADMIN_TENANT_ID = VALID_TENANT;
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({ 'x-tenant-id': ANOTHER_VALID });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.tenantId).toBe(ANOTHER_VALID);
  });

  it('extracts tenantId from a Bearer JWT payload (trusted in dev)', () => {
    const payload = Buffer.from(JSON.stringify({ tenantId: VALID_TENANT })).toString('base64url');
    const jwt = `header.${payload}.sig`;
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({ authorization: `Bearer ${jwt}` });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT);
  });

  it('JWT wins over x-tenant-id header when both present', () => {
    const payload = Buffer.from(JSON.stringify({ tenantId: VALID_TENANT })).toString('base64url');
    const jwt = `header.${payload}.sig`;
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({
      authorization: `Bearer ${jwt}`,
      'x-tenant-id': ANOTHER_VALID,
    });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT);
  });

  it('returns 401 when JWT tenantId is itself not a UUID', () => {
    const payload = Buffer.from(JSON.stringify({ tenantId: 'not-a-uuid' })).toString('base64url');
    const jwt = `header.${payload}.sig`;
    const guard = new AdminAuthGuard();
    const { ctx } = ctxFor({ authorization: `Bearer ${jwt}` });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('uppercase UUIDs are accepted (Postgres accepts both casings)', () => {
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({ 'x-tenant-id': VALID_TENANT.toUpperCase() });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT.toUpperCase());
  });

  it('whitespace around a valid UUID is tolerated', () => {
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({ 'x-tenant-id': `  ${VALID_TENANT}  ` });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT);
  });
});
