import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminAuthGuard, type AdminRequest } from './admin-auth.guard';

const VALID_TENANT = '00000000-0000-0000-0000-000000000001';
const ANOTHER_VALID = '11111111-2222-3333-4444-555555555555';

function ctxFor(
  headers: Record<string, string | string[] | undefined>,
  user?: Record<string, unknown>,
): {
  ctx: ExecutionContext;
  req: AdminRequest;
} {
  const req = {
    headers,
    method: 'GET',
    path: '/v1/admin/company',
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    user,
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
    vi.restoreAllMocks();
  });

  it('accepts a UUID-shaped x-tenant-id header and stamps req.tenantId', async () => {
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({ 'x-tenant-id': VALID_TENANT });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT);
  });

  it('returns 401 (not 500) when x-tenant-id header is missing entirely', async () => {
    const guard = new AdminAuthGuard();
    const { ctx } = ctxFor({});
    try {
      await guard.canActivate(ctx);
      expect.fail('expected UnauthorizedException');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      const body = (err as UnauthorizedException).getResponse() as Record<string, unknown>;
      expect(body.status).toBe('error');
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.message).toBe('Missing tenant context');
    }
  });

  it('returns 401 (not 500) when x-tenant-id is not a UUID — guards Postgres uuid cast', async () => {
    const guard = new AdminAuthGuard();
    const { ctx } = ctxFor({ 'x-tenant-id': 'default-tenant' });
    try {
      await guard.canActivate(ctx);
      expect.fail('expected UnauthorizedException');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      const body = (err as UnauthorizedException).getResponse() as Record<string, unknown>;
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.message).toBe('Invalid tenant identifier');
    }
  });

  it('returns 401 when x-tenant-id is a UUID-ish string with wrong shape', async () => {
    const guard = new AdminAuthGuard();
    const { ctx } = ctxFor({ 'x-tenant-id': '00000000-0000-0000-0000-00000000000' }); // 11-char last segment
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects DEFAULT_ADMIN_TENANT_ID env when it is a non-UUID literal (root cause of prior 500s)', async () => {
    process.env.DEFAULT_ADMIN_TENANT_ID = 'default-tenant';
    const guard = new AdminAuthGuard();
    const { ctx } = ctxFor({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('honours DEFAULT_ADMIN_TENANT_ID env when it is itself UUID-shaped', async () => {
    process.env.DEFAULT_ADMIN_TENANT_ID = VALID_TENANT;
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT);
  });

  it('header wins over env default', async () => {
    process.env.DEFAULT_ADMIN_TENANT_ID = VALID_TENANT;
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({ 'x-tenant-id': ANOTHER_VALID });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenantId).toBe(ANOTHER_VALID);
  });

  it('uses tenantId from a Passport-validated JWT payload', async () => {
    const guard = new AdminAuthGuard();
    vi.spyOn(Object.getPrototypeOf(AdminAuthGuard.prototype), 'canActivate').mockResolvedValue(true);
    const { ctx, req } = ctxFor({ authorization: 'Bearer valid.jwt.token' }, { tenantId: VALID_TENANT });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT);
  });

  it('Passport-validated JWT wins over x-tenant-id header when both present', async () => {
    const guard = new AdminAuthGuard();
    vi.spyOn(Object.getPrototypeOf(AdminAuthGuard.prototype), 'canActivate').mockResolvedValue(true);
    const { ctx, req } = ctxFor({
      authorization: 'Bearer valid.jwt.token',
      'x-tenant-id': ANOTHER_VALID,
    }, { tenantId: VALID_TENANT });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT);
  });

  it('returns 401 when Passport-validated JWT tenantId is itself not a UUID', async () => {
    const guard = new AdminAuthGuard();
    vi.spyOn(Object.getPrototypeOf(AdminAuthGuard.prototype), 'canActivate').mockResolvedValue(true);
    const { ctx } = ctxFor({ authorization: 'Bearer valid.jwt.token' }, { tenantId: 'not-a-uuid' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('uppercase UUIDs are accepted (Postgres accepts both casings)', async () => {
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({ 'x-tenant-id': VALID_TENANT.toUpperCase() });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT.toUpperCase());
  });

  it('whitespace around a valid UUID is tolerated', async () => {
    const guard = new AdminAuthGuard();
    const { ctx, req } = ctxFor({ 'x-tenant-id': `  ${VALID_TENANT}  ` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT);
  });
});

// ─── turned-off members ─────────────────────────────────────────────────────
// Tokens live 7 days and there is no revocation list, so the guard is the only
// thing standing between "owner turns an employee off" and "employee keeps
// working for a week". These lock that down.

/** Minimal stand-in for the drizzle chain the guard uses. */
function dbReturning(rows: Array<{ status: string }>) {
  const calls = { count: 0 };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            calls.count += 1;
            return Promise.resolve(rows);
          },
        }),
      }),
    }),
  };
  return { db: db as any, calls };
}

function jwtCtx(email: string, platformRole?: string) {
  return ctxFor(
    { authorization: 'Bearer valid.jwt.token' },
    { tenantId: VALID_TENANT, email, platformRole },
  );
}

describe('AdminAuthGuard — suspended members', () => {
  beforeEach(() => {
    vi.spyOn(
      Object.getPrototypeOf(AdminAuthGuard.prototype),
      'canActivate',
    ).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a member whose row is SUSPENDED, even with a valid JWT', async () => {
    AdminAuthGuard.invalidateStatus(VALID_TENANT, 'off@example.com');
    const { db } = dbReturning([{ status: 'SUSPENDED' }]);
    const guard = new AdminAuthGuard(undefined, db);
    const { ctx } = jwtCtx('off@example.com');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('allows an ACTIVE member through', async () => {
    AdminAuthGuard.invalidateStatus(VALID_TENANT, 'on@example.com');
    const { db } = dbReturning([{ status: 'ACTIVE' }]);
    const guard = new AdminAuthGuard(undefined, db);
    const { ctx, req } = jwtCtx('on@example.com');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenantId).toBe(VALID_TENANT);
  });

  it('does NOT deny when no member row exists — legacy tokens must not be locked out', async () => {
    AdminAuthGuard.invalidateStatus(VALID_TENANT, 'legacy@example.com');
    const { db } = dbReturning([]);
    const guard = new AdminAuthGuard(undefined, db);
    const { ctx } = jwtCtx('legacy@example.com');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('does NOT deny when the status lookup throws — a DB blip must not log everyone out', async () => {
    AdminAuthGuard.invalidateStatus(VALID_TENANT, 'blip@example.com');
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.reject(new Error('connection reset')),
          }),
        }),
      }),
    } as any;
    const guard = new AdminAuthGuard(undefined, db);
    const { ctx } = jwtCtx('blip@example.com');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('exempts super admins so support can never lock itself out', async () => {
    AdminAuthGuard.invalidateStatus(VALID_TENANT, 'super@example.com');
    const { db, calls } = dbReturning([{ status: 'SUSPENDED' }]);
    const guard = new AdminAuthGuard(undefined, db);
    const { ctx } = jwtCtx('super@example.com', 'super_admin');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(calls.count).toBe(0); // not even queried
  });

  it('caches the verdict, and invalidateStatus forces a re-read', async () => {
    AdminAuthGuard.invalidateStatus(VALID_TENANT, 'cached@example.com');
    const { db, calls } = dbReturning([{ status: 'ACTIVE' }]);
    const guard = new AdminAuthGuard(undefined, db);

    await guard.canActivate(jwtCtx('cached@example.com').ctx);
    await guard.canActivate(jwtCtx('cached@example.com').ctx);
    expect(calls.count).toBe(1);

    AdminAuthGuard.invalidateStatus(VALID_TENANT, 'cached@example.com');
    await guard.canActivate(jwtCtx('cached@example.com').ctx);
    expect(calls.count).toBe(2);
  });

  it('matches the member row case-insensitively on email', async () => {
    AdminAuthGuard.invalidateStatus(VALID_TENANT, 'Mixed@Example.com');
    const { db, calls } = dbReturning([{ status: 'SUSPENDED' }]);
    const guard = new AdminAuthGuard(undefined, db);
    await expect(
      guard.canActivate(jwtCtx('Mixed@Example.com').ctx),
    ).rejects.toThrow(UnauthorizedException);
    // second call with different casing hits the same cache key
    await expect(
      guard.canActivate(jwtCtx('mixed@example.com').ctx),
    ).rejects.toThrow(UnauthorizedException);
    expect(calls.count).toBe(1);
  });

  it('is inactive (allows through) when no DB client was injected', async () => {
    const guard = new AdminAuthGuard();
    const { ctx } = jwtCtx('nodb@example.com');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
