import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DB_CLIENT, type DbClient } from '../../db/db.module';
import { tenants } from '../../db/schema';

interface RequestWithTenant extends Request {
  tenantId?: string;
  requestId?: string;
}

const ALLOW_HEADERS = ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for'];

/**
 * Per-tenant IP allow-list. When `tenants.allowed_admin_ips` is non-empty
 * (jsonb array of CIDR-less IP strings or ranges, exact match today), a
 * request to /v1/admin/* is rejected if the client IP isn't on the list.
 *
 * Default empty array means "allow all" — preserves the existing behaviour
 * for tenants who haven't opted in.
 *
 * The guard expects AdminAuthGuard to run first so `req.tenantId` is set.
 * Used as a controller-level guard (after AdminAuthGuard) and as a global
 * APP_GUARD-style check is intentionally NOT applied — every other route
 * in the API has its own IP gating (or none).
 */
@Injectable()
export class AdminIpAllowListGuard implements CanActivate {
  private readonly logger = new Logger(AdminIpAllowListGuard.name);
  // Avoid hot-loop DB hits for the same tenant. 10s TTL is fine — the
  // operator's "I added an IP" experience is still under 30s end-to-end.
  private cache = new Map<string, { fetchedAt: number; allowed: string[] }>();
  private CACHE_TTL_MS = 10_000;

  constructor(@Inject(DB_CLIENT) private readonly db: DbClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<RequestWithTenant>();
    const tenantId = req.tenantId;
    if (!tenantId) return true; // AdminAuthGuard will have rejected if truly missing
    const path = req.path ?? '';
    if (!path.startsWith('/v1/admin/')) return true;

    const allowed = await this.loadAllowed(tenantId);
    if (allowed.length === 0) return true;

    const clientIp = pickIp(req);
    if (!isAllowed(clientIp, allowed)) {
      this.logger.warn(
        `tenant=${tenantId} request=${req.requestId ?? '-'} blocked ip=${clientIp} not in allow-list (${allowed.length} entries)`,
      );
      throw new ForbiddenException({
        status: 'error',
        code: 'IP_NOT_ALLOWED',
        message: 'Client IP is not in the tenant admin allow-list',
      });
    }
    return true;
  }

  private async loadAllowed(tenantId: string): Promise<string[]> {
    const cached = this.cache.get(tenantId);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < this.CACHE_TTL_MS) return cached.allowed;
    try {
      const rows = await this.db
        .select({ allowed: tenants.allowedAdminIps })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      const raw = rows[0]?.allowed;
      const list = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
      this.cache.set(tenantId, { fetchedAt: now, allowed: list });
      return list;
    } catch (err) {
      // Fail-open. A wedged DB shouldn't lock admins out of fixing it.
      this.logger.warn(
        `tenant=${tenantId} allow-list load failed (${(err as Error).message}); allowing through`,
      );
      return [];
    }
  }
}

function pickIp(req: Request): string {
  for (const h of ALLOW_HEADERS) {
    const raw = req.headers[h];
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (typeof first === 'string' && first.length > 0) {
      return first.split(',')[0].trim();
    }
  }
  return (req.ip ?? req.socket?.remoteAddress ?? '').trim();
}

function isAllowed(clientIp: string, allowed: string[]): boolean {
  if (allowed.includes(clientIp)) return true;
  // Lightweight CIDR / wildcard support: a list entry of "203.0.113.*"
  // matches "203.0.113.10". CIDR ranges left to a future iteration —
  // most operators want a small literal list.
  for (const entry of allowed) {
    if (entry.endsWith('.*')) {
      const prefix = entry.slice(0, -1); // "203.0.113."
      if (clientIp.startsWith(prefix)) return true;
    }
  }
  return false;
}
