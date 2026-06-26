import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { eq, sql } from 'drizzle-orm';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { users } from '../../db/schema';

export interface SuperAdminRequest extends Request {
  superAdminEmail: string;
  user?: any;
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Guards /v1/super-admin/*.
 *
 * PRODUCTION: A valid JWT is REQUIRED. The super-admin email is extracted
 * from the verified JWT payload. The `x-super-admin-email` header is
 * ignored entirely in production to prevent authentication bypass.
 *
 * DEVELOPMENT: Falls back to the `x-super-admin-email` header or the
 * SUPER_ADMIN_DEV_EMAIL env var for local dev convenience.
 *
 * After resolving the candidate email, the guard checks:
 *   1. SUPER_ADMIN_EMAILS / SUPER_ADMIN_DEV_EMAIL env whitelist
 *   2. Database `users.platform_role = 'super_admin'`
 */
@Injectable()
export class SuperAdminAuthGuard extends AuthGuard('jwt') {
  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SuperAdminRequest>();

    // ── Step 1: Validate JWT ───────────────────────────────────────────
    let isJwtValid = false;
    try {
      isJwtValid = (await super.canActivate(context)) as boolean;
    } catch (e) {
      // JWT missing or invalid — handled below
    }

    // In production, a valid JWT is mandatory. No header-only fallback.
    if (IS_PRODUCTION && !isJwtValid) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Valid authentication token required for super-admin access',
      });
    }

    // ── Step 2: Resolve candidate email ────────────────────────────────
    let candidate = '';

    if (isJwtValid && req.user && (req.user as any).email) {
      // Authenticated via JWT — trust the token's email
      candidate = (req.user as any).email;
    } else if (!IS_PRODUCTION) {
      // Dev-only: fall back to header or env var
      const header = req.headers['x-super-admin-email'];
      candidate = (Array.isArray(header) ? header[0] : header)
        || process.env.SUPER_ADMIN_DEV_EMAIL
        || '';
    }

    const envEmails = (process.env.SUPER_ADMIN_EMAILS || process.env.SUPER_ADMIN_DEV_EMAIL || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    // Dev convenience: auto-select the first allowed email when nothing provided
    if (!candidate && envEmails.length > 0 && !IS_PRODUCTION) {
      candidate = envEmails[0];
    }

    const email = candidate.trim().toLowerCase();
    if (!email) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'NO_SUPER_ADMIN',
        message: 'Unable to determine super-admin identity',
      });
    }

    // ── Step 3: Verify super-admin role ────────────────────────────────

    // 3a. Check environment variable whitelist (comma-separated)
    if (envEmails.includes(email)) {
      req.superAdminEmail = email;
      return true;
    }

    // 3b. Fallback to Database Role Check
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

