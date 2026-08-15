import {
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { and, eq, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { AuditLogService } from '../../modules/audit-log/audit-log.service';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenantMembers } from '../../db/schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidShaped(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export interface AdminRequest extends Request {
  tenantId: string;
  requestId?: string;
  user?: any;
}

/**
 * How long a membership-status lookup is reused before we re-read the row.
 *
 * Tokens live 7 days and there is no revocation list, so without a per-request
 * check "turn this employee off" would not take effect until their token
 * expired. Re-reading on literally every request is wasteful for a dashboard
 * that polls, so results are cached briefly: turning someone off takes effect
 * within this window, not within a week.
 */
const STATUS_CACHE_TTL_MS = 15_000;

@Injectable()
export class AdminAuthGuard extends AuthGuard('jwt') {
  private static readonly logger = new Logger(AdminAuthGuard.name);
  /** key `${tenantId}:${email}` -> { suspended, checkedAt } */
  private static readonly statusCache = new Map<
    string,
    { suspended: boolean; checkedAt: number }
  >();
  private static warnedNoDb = false;

  constructor(
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() @Inject(DB_CLIENT) private readonly db?: DbClient,
  ) {
    super();
  }

  /** Drop a cached verdict so an owner's on/off toggle is felt immediately. */
  static invalidateStatus(tenantId: string, email: string): void {
    AdminAuthGuard.statusCache.delete(`${tenantId}:${email.trim().toLowerCase()}`);
  }

  /**
   * True when this tenant has explicitly turned the member off.
   *
   * Deliberately narrow: only an explicit SUSPENDED row denies. A missing row
   * is NOT treated as denial, because legacy tokens carry a tenantId with no
   * matching member row and failing those closed would lock out live users for
   * a reason unrelated to this feature. A DB error also does not deny — an
   * unreachable database must not log the whole company out.
   */
  private async isTurnedOff(tenantId: string, email: string): Promise<boolean> {
    if (!this.db) {
      if (!AdminAuthGuard.warnedNoDb) {
        AdminAuthGuard.warnedNoDb = true;
        AdminAuthGuard.logger.warn(
          'No DB client injected — suspended-member enforcement is INACTIVE on this instance',
        );
      }
      return false;
    }

    const normalized = email.trim().toLowerCase();
    const key = `${tenantId}:${normalized}`;
    const hit = AdminAuthGuard.statusCache.get(key);
    const now = Date.now();
    if (hit && now - hit.checkedAt < STATUS_CACHE_TTL_MS) return hit.suspended;

    try {
      const [row] = await this.db
        .select({ status: tenantMembers.status })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            sql`lower(${tenantMembers.email}) = ${normalized}`,
          ),
        )
        .limit(1);
      const suspended = row?.status === 'SUSPENDED';
      AdminAuthGuard.statusCache.set(key, { suspended, checkedAt: now });
      return suspended;
    } catch (e) {
      AdminAuthGuard.logger.error(
        `Membership status check failed for ${normalized}: ${(e as Error).message}`,
      );
      return false;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();

    // SECURITY: A valid JWT is ALWAYS required. No env-var fallbacks, no header overrides.
    let isJwtValid = false;
    try {
      isJwtValid = (await super.canActivate(context)) as boolean;
    } catch (e) {
      void this.recordAuthFailure(req, 'invalid_or_missing_jwt');
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Valid authentication is required. Please sign in.',
      });
    }

    if (!isJwtValid || !req.user) {
      void this.recordAuthFailure(req, 'jwt_validation_failed');
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Valid authentication is required. Please sign in.',
      });
    }

    const candidate = (req.user as any).tenantId;

    if (!candidate) {
      void this.recordAuthFailure(req, 'missing_tenant_context');
      throw new UnauthorizedException({
        status: 'error',
        code: 'NO_TENANT',
        message: 'Your account is not associated with any company. Please ask your admin to invite you.',
      });
    }
    if (!isUuidShaped(candidate)) {
      void this.recordAuthFailure(req, 'invalid_tenant_uuid');
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Invalid tenant identifier',
      });
    }
    req.tenantId = candidate;

    // Turned-off employees are refused here, not just at login. Without this a
    // token minted before the owner flipped the switch would keep working for
    // the rest of its 7-day life. Super admins are exempt so support can always
    // get in.
    const claims = req.user as { email?: string; platformRole?: string };
    if (claims?.email && claims.platformRole !== 'super_admin') {
      if (await this.isTurnedOff(candidate, claims.email)) {
        void this.recordAuthFailure(req, 'member_suspended');
        throw new UnauthorizedException({
          status: 'error',
          code: 'ACCOUNT_DISABLED',
          message:
            'Your access has been turned off. Please contact your account owner.',
        });
      }
    }

    return true;
  }

  private async recordAuthFailure(req: AdminRequest, reason: string): Promise<void> {
    if (!this.auditLog) return;
    try {
      await this.auditLog.record({
        tenantId: null,
        actorType: 'user',
        actorId: 'anonymous',
        action: 'auth.failed',
        resourceType: null,
        resourceId: null,
        metadata: {
          reason,
          method: req.method,
          path: req.path,
          ip: pickIp(req),
          userAgent: req.headers['user-agent'],
          requestId: req.requestId,
        },
      });
    } catch {
      // best-effort
    }
  }
}

function pickIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const fwd = Array.isArray(xff) ? xff[0] : xff;
  return ((fwd ?? req.ip ?? req.socket?.remoteAddress ?? '') as string).split(',')[0].trim();
}
