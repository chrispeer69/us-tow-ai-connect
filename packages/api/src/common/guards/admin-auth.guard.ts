import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditLogService } from '../../modules/audit-log/audit-log.service';

const DEFAULT_TENANT_ID = process.env.DEFAULT_ADMIN_TENANT_ID ?? 'default-tenant';

export interface AdminRequest extends Request {
  tenantId: string;
  requestId?: string;
}

/**
 * Placeholder for the real JwtAuthGuard called out by the spec.
 *
 * Resolution path (in priority order):
 *   1. `Authorization: Bearer <jwt>` — decoded only as base64-url; the
 *      `tenantId` claim is trusted in development. A real JWT verification
 *      flow belongs to the admin auth session (not built in this scope).
 *   2. `x-tenant-id: <id>` — explicit dev header.
 *   3. `DEFAULT_ADMIN_TENANT_ID` env (default `default-tenant`).
 *
 * Flagged in ASSUMPTIONS.md for human follow-up before exposing the admin
 * surface to multiple tenants.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Optional() private readonly auditLog?: AuditLogService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequest>();

    const headerTenant = req.headers['x-tenant-id'];
    const tenantFromHeader = Array.isArray(headerTenant) ? headerTenant[0] : headerTenant;
    const tenantFromJwt = this.extractTenantFromAuthHeader(req.headers.authorization);

    const tenantId = (tenantFromJwt || tenantFromHeader || DEFAULT_TENANT_ID || '').trim();
    if (!tenantId) {
      void this.recordAuthFailure(req, 'missing_tenant_context');
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Missing tenant context',
      });
    }
    req.tenantId = tenantId;
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

  private extractTenantFromAuthHeader(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length).trim();
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return typeof payload?.tenantId === 'string' ? payload.tenantId : null;
    } catch {
      return null;
    }
  }
}

function pickIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const fwd = Array.isArray(xff) ? xff[0] : xff;
  return ((fwd ?? req.ip ?? req.socket?.remoteAddress ?? '') as string).split(',')[0].trim();
}
