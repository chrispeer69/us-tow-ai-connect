import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRequest } from '../../common/guards/admin-auth.guard';
import { PermissionGuard } from './permission.guard';
import type { MembersService } from './members.service';

const TENANT = '00000000-0000-0000-0000-000000000001';

function ctxFor(
  required: string | undefined,
  headers: Record<string, string | string[] | undefined>,
): ExecutionContext {
  const req = {
    headers,
    tenantId: TENANT,
    method: 'GET',
    path: '/v1/admin/digital-dispatch/rules',
  } as unknown as AdminRequest;
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

// Reflector stub that returns a fixed required-permission value.
function reflectorReturning(value: string | undefined): Reflector {
  return { getAllAndOverride: () => value } as unknown as Reflector;
}

interface FakeMember {
  role: string;
  status: string;
}

function membersStub(opts: {
  member?: FakeMember | undefined;
  has?: boolean;
}): MembersService {
  return {
    findMember: async () => opts.member,
    roleHasPermission: async () => opts.has ?? false,
  } as unknown as MembersService;
}

describe('PermissionGuard', () => {
  let originalEnforce: string | undefined;

  beforeEach(() => {
    originalEnforce = process.env.RBAC_ENFORCE;
    delete process.env.RBAC_ENFORCE;
  });
  afterEach(() => {
    if (originalEnforce === undefined) delete process.env.RBAC_ENFORCE;
    else process.env.RBAC_ENFORCE = originalEnforce;
  });

  it('allows routes without @RequirePermission metadata', async () => {
    const guard = new PermissionGuard(reflectorReturning(undefined), membersStub({}));
    await expect(guard.canActivate(ctxFor(undefined, {}))).resolves.toBe(true);
  });

  it('allows when no identity is present and RBAC_ENFORCE is off (legacy posture)', async () => {
    const guard = new PermissionGuard(
      reflectorReturning('digital-dispatch.read'),
      membersStub({}),
    );
    await expect(guard.canActivate(ctxFor('digital-dispatch.read', {}))).resolves.toBe(true);
  });

  it('denies when no identity is present and RBAC_ENFORCE is on (fail closed)', async () => {
    process.env.RBAC_ENFORCE = 'true';
    const guard = new PermissionGuard(
      reflectorReturning('digital-dispatch.read'),
      membersStub({}),
    );
    await expect(guard.canActivate(ctxFor('digital-dispatch.read', {}))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('denies an identified user who is not a member of the tenant', async () => {
    const guard = new PermissionGuard(
      reflectorReturning('digital-dispatch.read'),
      membersStub({ member: undefined }),
    );
    await expect(
      guard.canActivate(ctxFor('digital-dispatch.read', { 'x-user-email': 'nobody@x.com' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies an identified member whose status is not ACTIVE', async () => {
    const guard = new PermissionGuard(
      reflectorReturning('digital-dispatch.read'),
      membersStub({ member: { role: 'DISPATCHER', status: 'INVITED' }, has: true }),
    );
    await expect(
      guard.canActivate(ctxFor('digital-dispatch.read', { 'x-user-email': 'd@x.com' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies an active member whose role lacks the permission', async () => {
    const guard = new PermissionGuard(
      reflectorReturning('digital-dispatch.write'),
      membersStub({ member: { role: 'VIEWER', status: 'ACTIVE' }, has: false }),
    );
    await expect(
      guard.canActivate(ctxFor('digital-dispatch.write', { 'x-user-email': 'v@x.com' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an active member whose role grants the permission', async () => {
    const guard = new PermissionGuard(
      reflectorReturning('digital-dispatch.write'),
      membersStub({ member: { role: 'DISPATCHER', status: 'ACTIVE' }, has: true }),
    );
    await expect(
      guard.canActivate(ctxFor('digital-dispatch.write', { 'x-user-email': 'd@x.com' })),
    ).resolves.toBe(true);
  });
});
