import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

const DEFAULT_TENANT_ID = process.env.DEFAULT_ADMIN_TENANT_ID ?? 'default-tenant';

export interface AdminRequest extends Request {
  tenantId: string;
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
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequest>();

    const headerTenant = req.headers['x-tenant-id'];
    const tenantFromHeader = Array.isArray(headerTenant) ? headerTenant[0] : headerTenant;
    const tenantFromJwt = this.extractTenantFromAuthHeader(req.headers.authorization);

    const tenantId = (tenantFromJwt || tenantFromHeader || DEFAULT_TENANT_ID || '').trim();
    if (!tenantId) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Missing tenant context',
      });
    }
    req.tenantId = tenantId;
    return true;
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
