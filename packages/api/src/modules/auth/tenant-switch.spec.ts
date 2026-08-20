import { describe, expect, it, beforeEach, vi } from 'vitest';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Session 79 — tenant switching.
 *
 * This endpoint hands out credentials, so the tests below are mostly about
 * what it must REFUSE. The one that matters most is "role comes from the
 * database": a switch endpoint that trusts a role in the request body is a
 * privilege escalation with extra steps.
 */

const ROADSIDE = '00000000-0000-0000-0000-000000000001';
const ALLIANCE = '34ad702f-83f1-457b-93da-977aa56a9619';
const ALPHA = 'e362b0a1-2e47-4b4f-9f06-47ca4ae62227';

interface FakeRow {
  tenant: { id: string; companyName: string; isActive: boolean } | null;
  membership: { role: string } | null;
}

/**
 * A tiny stand-in for the drizzle query builder.
 *
 * The service issues two shapes of read — "the tenant by id" and "my ACTIVE
 * membership in it" — and both end in `.limit(1)`. Rather than mock drizzle's
 * whole fluent surface, each call pops the next queued result.
 */
function makeDb(queue: unknown[][]) {
  const remaining = [...queue];
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(remaining.shift() ?? []),
    then: (resolve: (v: unknown) => unknown) => resolve(remaining.shift() ?? []),
  };
  return chain;
}

function makeService(rows: FakeRow, opts: { superAdminEmails?: string } = {}) {
  process.env.SUPER_ADMIN_EMAILS = opts.superAdminEmails ?? '';
  const jwt = { sign: vi.fn((payload: unknown) => `signed:${JSON.stringify(payload)}`) };
  const db = makeDb([
    rows.tenant ? [rows.tenant] : [],
    rows.membership ? [rows.membership] : [],
  ]);
  return new AuthService(jwt as any, db as any, {} as any);
}

beforeEach(() => {
  delete process.env.SUPER_ADMIN_EMAILS;
  delete process.env.SUPER_ADMIN_DEV_EMAIL;
});

describe('switchTenant — what it refuses', () => {
  it('refuses a tenant the user has no membership in', async () => {
    const service = makeService({
      tenant: { id: ALPHA, companyName: 'Alpha Automotive LLC', isActive: true },
      membership: null,
    });

    await expect(
      service.switchTenant({ userId: 'u1', email: 'hannah@example.com' }, ALPHA),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an inactive tenant even to a member', async () => {
    const service = makeService({
      tenant: { id: ALLIANCE, companyName: 'US Tow Alliance', isActive: false },
      membership: { role: 'OWNER' },
    });

    await expect(
      service.switchTenant({ userId: 'u1', email: 'hannah@example.com' }, ALLIANCE),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an unknown tenant id', async () => {
    const service = makeService({ tenant: null, membership: null });

    await expect(
      service.switchTenant({ userId: 'u1', email: 'hannah@example.com' }, 'nope'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gives the same message for "not yours" as for "does not exist"', async () => {
    // Otherwise the endpoint becomes a way to enumerate every tenant on the
    // platform by watching which id produces which error.
    const notMine = makeService({
      tenant: { id: ALPHA, companyName: 'Alpha Automotive LLC', isActive: true },
      membership: null,
    });

    await expect(
      notMine.switchTenant({ userId: 'u1', email: 'nobody@example.com' }, ALPHA),
    ).rejects.toThrow('You do not have access to that tenant');
  });
});

describe('switchTenant — the role comes from the database', () => {
  it('uses the stored membership role, not anything the caller sends', async () => {
    const service = makeService({
      tenant: { id: ALLIANCE, companyName: 'US Tow Alliance', isActive: true },
      membership: { role: 'DISPATCHER' },
    });

    const result = await service.switchTenant(
      // A caller currently holding OWNER elsewhere must not carry it across.
      { userId: 'u1', email: 'hannah@example.com', tenantId: ROADSIDE, role: 'OWNER' },
      ALLIANCE,
    );

    expect(result.role).toBe('DISPATCHER');
    expect(result.access_token).toContain('"role":"DISPATCHER"');
    expect(result.access_token).not.toContain('"role":"OWNER"');
  });

  it('stamps the NEW tenant id into the token', async () => {
    const service = makeService({
      tenant: { id: ALLIANCE, companyName: 'US Tow Alliance', isActive: true },
      membership: { role: 'OWNER' },
    });

    const result = await service.switchTenant(
      { userId: 'u1', email: 'hannah@example.com', tenantId: ROADSIDE, role: 'OWNER' },
      ALLIANCE,
    );

    expect(result.access_token).toContain(`"tenantId":"${ALLIANCE}"`);
    expect(result.tenant).toEqual({ id: ALLIANCE, companyName: 'US Tow Alliance' });
  });

  it('preserves platformRole across the switch', async () => {
    const service = makeService({
      tenant: { id: ALLIANCE, companyName: 'US Tow Alliance', isActive: true },
      membership: { role: 'OWNER' },
    });

    const result = await service.switchTenant(
      { userId: 'u1', email: 'chris@example.com', platformRole: 'super_admin' },
      ALLIANCE,
    );

    expect(result.access_token).toContain('"platformRole":"super_admin"');
  });
});

describe('switchTenant — super admin', () => {
  it('may enter a tenant it is not a member of, but only as SUPPORT', async () => {
    // Never OWNER by default. This matches what impersonateTenant has always
    // granted, so super admin does not quietly become a stronger role here.
    const service = makeService({
      tenant: { id: ALPHA, companyName: 'Alpha Automotive LLC', isActive: true },
      membership: null,
    });

    const result = await service.switchTenant(
      { userId: 'u1', email: 'chris@example.com', platformRole: 'super_admin' },
      ALPHA,
    );

    expect(result.role).toBe('SUPPORT');
  });

  it('keeps a real membership role rather than downgrading to SUPPORT', async () => {
    const service = makeService({
      tenant: { id: ALLIANCE, companyName: 'US Tow Alliance', isActive: true },
      membership: { role: 'OWNER' },
    });

    const result = await service.switchTenant(
      { userId: 'u1', email: 'chris@example.com', platformRole: 'super_admin' },
      ALLIANCE,
    );

    expect(result.role).toBe('OWNER');
  });

  it('recognises a super admin configured only by env', async () => {
    const service = makeService(
      {
        tenant: { id: ALPHA, companyName: 'Alpha Automotive LLC', isActive: true },
        membership: null,
      },
      { superAdminEmails: 'chris@example.com,someone@else.com' },
    );

    const result = await service.switchTenant({ userId: 'u1', email: 'chris@example.com' }, ALPHA);
    expect(result.role).toBe('SUPPORT');
  });

  it('is not fooled by a similar email', async () => {
    const service = makeService(
      {
        tenant: { id: ALPHA, companyName: 'Alpha Automotive LLC', isActive: true },
        membership: null,
      },
      { superAdminEmails: 'chris@example.com' },
    );

    await expect(
      service.switchTenant({ userId: 'u1', email: 'chris@example.com.evil.tld' }, ALPHA),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
