import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Request } from 'express';
import { TenantsService } from '../../modules/tenants/tenants.service';
import type { TenantRow } from '../../db/schema';

export interface TenantAuthenticatedRequest extends Request {
  tenant: TenantRow;
  tenantId: string;
}

const PRIMARY_HEADER = 'x-tenant-api-key';
const FALLBACK_HEADER = 'x-api-key';
const PREFIX_LENGTH = 12; // "usk_" + 8 chars

/**
 * Session-23 guard for AI-Connect agent endpoints. Spec requires
 * `X-Tenant-API-Key`; the existing public endpoints used `x-api-key`, so we
 * accept either to avoid breaking previously-issued credentials.
 */
@Injectable()
export class TenantApiKeyGuard implements CanActivate {
  constructor(private readonly tenants: TenantsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantAuthenticatedRequest>();
    const headerValue = req.headers[PRIMARY_HEADER] ?? req.headers[FALLBACK_HEADER];
    const apiKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < PREFIX_LENGTH) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed tenant API key',
      });
    }

    const prefix = apiKey.slice(0, PREFIX_LENGTH);
    const tenant = await this.tenants.findByApiKeyPrefix(prefix);
    if (!tenant) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Unknown tenant API key',
      });
    }

    const ok = await bcrypt.compare(apiKey, tenant.apiKeyHash);
    if (!ok) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Invalid tenant API key',
      });
    }

    req.tenant = tenant;
    req.tenantId = tenant.id;
    return true;
  }
}
