import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { UserRow } from '../../db/schema';

/**
 * Covers the "turn an employee off" contract on the login path.
 *
 * Suspending a member is only meaningful if it survives contact with login.
 * Two ways it used to leak, both regression-tested here:
 *   1. login() issued a 7-day JWT regardless of membership status
 *   2. the auto-link migration branch reset status to ACTIVE unconditionally,
 *      so a suspended member turned themselves back on by signing in
 */

const USER: UserRow = {
  id: 'user-1',
  email: 'driver@example.com',
  passwordHash: 'x',
  name: 'Driver',
  platformRole: null,
} as unknown as UserRow;

/**
 * Fake drizzle.
 *
 * login() runs two different membership lookups and the branch under test
 * depends on which one hits, so they are mocked separately:
 *   byUserId — `.where().orderBy().limit()`, the normal path
 *   byEmail  — `.where().limit()`, the auto-link migration path, reached only
 *              when byUserId comes back empty
 * `updates` records every update().set() payload.
 */
function makeDb(
  byUserId: Array<Record<string, unknown>>,
  byEmail: Array<Record<string, unknown>>,
) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(byUserId) }),
          limit: () => Promise.resolve(byEmail),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  };
  return { db: db as any, updates };
}

function makeService(
  byUserId: Array<Record<string, unknown>>,
  byEmail: Array<Record<string, unknown>> = [],
) {
  const { db, updates } = makeDb(byUserId, byEmail);
  const jwt = { sign: vi.fn().mockReturnValue('signed.jwt.token') };
  const email = { sendPasswordResetOtp: vi.fn() };
  const service = new AuthService(jwt as any, db, email as any);
  return { service, updates, jwt };
}

describe('AuthService.login — turned-off members', () => {
  beforeEach(() => {
    delete process.env.SUPER_ADMIN_EMAILS;
  });

  it('refuses to issue a token when the only membership is SUSPENDED', async () => {
    const { service, jwt } = makeService([
      { tenantId: 't-1', role: 'DRIVER', status: 'SUSPENDED', userId: 'user-1' },
    ]);
    await expect(service.login(USER)).rejects.toThrow(UnauthorizedException);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('reports ACCOUNT_DISABLED so the UI can explain why', async () => {
    const { service } = makeService([
      { tenantId: 't-1', role: 'DRIVER', status: 'SUSPENDED', userId: 'user-1' },
    ]);
    await expect(service.login(USER)).rejects.toMatchObject({
      response: { code: 'ACCOUNT_DISABLED' },
    });
  });

  it('still logs in an ACTIVE member', async () => {
    const { service, jwt } = makeService([
      { tenantId: 't-1', role: 'DRIVER', status: 'ACTIVE', userId: 'user-1' },
    ]);
    await expect(service.login(USER)).resolves.toEqual({
      access_token: 'signed.jwt.token',
    });
    expect(jwt.sign).toHaveBeenCalled();
  });

  it('still logs in an INVITED member — only SUSPENDED is a closed door', async () => {
    const { service } = makeService([
      { tenantId: 't-1', role: 'DRIVER', status: 'INVITED', userId: 'user-1' },
    ]);
    await expect(service.login(USER)).resolves.toEqual({
      access_token: 'signed.jwt.token',
    });
  });

  it('logs in when the user has no membership at all (tenant-less account)', async () => {
    const { service } = makeService([]);
    await expect(service.login(USER)).resolves.toEqual({
      access_token: 'signed.jwt.token',
    });
  });

  it('the auto-link branch must not resurrect a SUSPENDED membership', async () => {
    // userId lookup misses, email lookup hits a suspended row — the migration
    // path. It used to write status ACTIVE here, undoing the owner's decision.
    const { service, updates } = makeService(
      [],
      [{ tenantId: 't-1', role: 'DRIVER', status: 'SUSPENDED', userId: null }],
    );
    await expect(service.login(USER)).rejects.toThrow(UnauthorizedException);
    const statusWrites = updates.filter((u) => 'status' in u);
    expect(statusWrites.length).toBeGreaterThan(0);
    for (const w of statusWrites) expect(w.status).toBe('SUSPENDED');
  });

  it('the auto-link branch still activates a non-suspended membership', async () => {
    const { service, updates } = makeService(
      [],
      [{ tenantId: 't-1', role: 'DRIVER', status: 'INVITED', userId: null }],
    );
    await expect(service.login(USER)).resolves.toBeTruthy();
    expect(updates.some((u) => u.status === 'ACTIVE')).toBe(true);
  });

  it('a configured super admin is exempt so support cannot be locked out', async () => {
    process.env.SUPER_ADMIN_EMAILS = USER.email;
    const { service } = makeService([
      { tenantId: 't-1', role: 'OWNER', status: 'SUSPENDED', userId: 'user-1' },
    ]);
    await expect(service.login(USER)).resolves.toEqual({
      access_token: 'signed.jwt.token',
    });
  });
});
