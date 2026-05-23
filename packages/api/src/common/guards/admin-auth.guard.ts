import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditLogService } from '../../modules/audit-log/audit-log.service';

// Accept any 8-4-4-4-12 hex UUID (v1..v8, plus the all-zeros seed/dev IDs we
// use throughout the codebase like `00000000-0000-0000-0000-000000000001`).
// Strict v4-only would reject those legitimate dev/seed IDs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidShaped(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

// Optional env default — only honoured if it is itself a valid UUID. The
// previous `?? 'default-tenant'` literal fallback poisoned every admin
// request when the env var was unset: services dereferenced it and the
// `tenants.id::uuid` Postgres cast threw, surfacing as a raw 500. Logged in
// docs/BLOCKERS.md (2026-05-23).
function readEnvDefault(): string | null {
  const raw = process.env.DEFAULT_ADMIN_TENANT_ID;
  if (!raw) return null;
  const trimmed = raw.trim();
  return isUuidShaped(trimmed) ? trimmed : null;
}

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
 *   3. `DEFAULT_ADMIN_TENANT_ID` env — honoured only when itself UUID-shaped.
 *
 * Any resolved tenant id is validated to be UUID-shaped before the request
 * is allowed through, so downstream Drizzle / Postgres queries against
 * `tenants.id::uuid` never receive garbage. Missing or invalid →
 * `UnauthorizedException` (HTTP 401) with a clean JSON body, never a 500.
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
    const tenantFromEnv = readEnvDefault();

    const candidate = (tenantFromJwt || tenantFromHeader || tenantFromEnv || '').trim();

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
