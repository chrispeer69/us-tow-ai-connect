// Session 45 — generic RBAC guard.
//
// Reads the @RequirePermission('resource.action') metadata for the matched
// route and checks it against the acting member's role. Designed to sit AFTER
// AdminAuthGuard in the @UseGuards chain (it relies on `req.tenantId`).
//
// Fail-safe policy (see S45_DECISIONS.md):
//   - No @RequirePermission metadata        → allow (not an RBAC route).
//   - Identity resolvable (email present)   → enforce; OWNER / `*` always pass,
//                                             otherwise 403 if the key is missing.
//   - Identity absent                       → governed by RBAC_ENFORCE:
//                                               unset/false ⇒ allow (preserves
//                                               legacy tenant-id-only flows),
//                                               true        ⇒ 403 (fail closed).

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRequest } from '../../common/guards/admin-auth.guard';
import { resolveUserEmail } from './current-user';
import { MembersService } from './members.service';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly members: MembersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true; // not an RBAC-gated route

    const req = context.switchToHttp().getRequest<AdminRequest>();
    const tenantId = req.tenantId;
    const email = resolveUserEmail(req);

    if (!email) {
      if (process.env.RBAC_ENFORCE === 'true') {
        throw this.deny('No authenticated user for a permission-gated route');
      }
      this.logger.debug(
        `[rbac] no identity; allowing ${req.method} ${req.path} (RBAC_ENFORCE off). Required: ${required}`,
      );
      return true;
    }

    const member = await this.members.findMember(tenantId, email);
    if (!member) {
      throw this.deny(`User ${email} is not a member of this tenant`);
    }
    if (member.status !== 'ACTIVE') {
      throw this.deny(`Member ${email} is not active (status: ${member.status})`);
    }

    const ok = await this.members.roleHasPermission(member.role, required);
    if (!ok) {
      throw this.deny(
        `Role ${member.role} lacks permission '${required}'`,
      );
    }
    return true;
  }

  private deny(message: string): ForbiddenException {
    return new ForbiddenException({
      status: 'error',
      code: 'FORBIDDEN',
      message,
    });
  }
}
