import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { eq, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { users } from '../../db/schema';

export interface SuperAdminRequest extends Request {
  superAdminEmail: string;
}

const DEV_FALLBACK_EMAIL = process.env.SUPER_ADMIN_DEV_EMAIL;

/**
 * Guards /v1/super-admin/*. Resolution priority:
 *   1. `x-super-admin-email` header (dev / API client) — must match a
 *      users row whose platform_role = 'super_admin'.
 *   2. SUPER_ADMIN_DEV_EMAIL env when set (single-operator dev mode).
 *
 * When neither resolves, 401. A real OIDC / JWT integration is the
 * follow-up the broader auth refactor will land — flagged in
 * docs/ASSUMPTIONS.md.
 */
@Injectable()
export class SuperAdminAuthGuard implements CanActivate {
  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SuperAdminRequest>();
    const header = req.headers['x-super-admin-email'];
    const candidate = (Array.isArray(header) ? header[0] : header) || DEV_FALLBACK_EMAIL || '';
    const email = candidate.trim().toLowerCase();
    if (!email) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'NO_SUPER_ADMIN',
        message: 'Missing x-super-admin-email header',
      });
    }
    const user = (
      await this.db
        .select({ email: users.email, role: users.platformRole })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1)
    )[0];
    if (!user || user.role !== 'super_admin') {
      throw new UnauthorizedException({
        status: 'error',
        code: 'NOT_SUPER_ADMIN',
        message: 'User is not a super admin',
      });
    }
    req.superAdminEmail = user.email;
    return true;
  }
}
