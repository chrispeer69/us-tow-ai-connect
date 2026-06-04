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

function readEnvDefault(): string | null {
  const raw = process.env.DEFAULT_ADMIN_TENANT_ID;
  if (!raw) return null;
  const trimmed = raw.trim();
  return isUuidShaped(trimmed) ? trimmed : null;
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

    const headerTenant = req.headers['x-tenant-id'];
    const tenantFromHeader = Array.isArray(headerTenant) ? headerTenant[0] : headerTenant;
    const tenantFromEnv = readEnvDefault();
    let devTenantId = (tenantFromHeader || tenantFromEnv || '').trim();

    let isJwtValid = false;
    try {
      isJwtValid = (await super.canActivate(context)) as boolean;
    } catch (e) {
      // Ignore exception if JWT is missing or invalid; we'll fallback to dev if allowed
    }

    let candidate = '';
    if (isJwtValid && req.user && (req.user as any).tenantId) {
       candidate = (req.user as any).tenantId;
    } else if (devTenantId && process.env.NODE_ENV !== 'production') {
       candidate = devTenantId;
    }

    if (!candidate) {
      void this.recordAuthFailure(req, 'missing_tenant_context');
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Missing tenant context',
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
