import {
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AuditLogService } from '../../modules/audit-log/audit-log.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidShaped(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export interface AdminRequest extends Request {
  tenantId: string;
  requestId?: string;
  user?: any;
}

@Injectable()
export class AdminAuthGuard extends AuthGuard('jwt') {
  constructor(@Optional() private readonly auditLog?: AuditLogService) {
    super();
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
