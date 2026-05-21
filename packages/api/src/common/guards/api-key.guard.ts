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

export interface AuthenticatedRequest extends Request {
  tenant: TenantRow;
  tenantId: string;
}

const API_KEY_HEADER = 'x-api-key';
const PREFIX_LENGTH = 12; // "usk_" + 8 chars

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly tenants: TenantsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const headerValue = req.headers[API_KEY_HEADER];
    const apiKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < PREFIX_LENGTH) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed API key',
      });
    }

    const prefix = apiKey.slice(0, PREFIX_LENGTH);
    const tenant = await this.tenants.findByApiKeyPrefix(prefix);
    if (!tenant) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Unknown API key',
      });
    }

    const ok = await bcrypt.compare(apiKey, tenant.apiKeyHash);
    if (!ok) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Invalid API key',
      });
    }

    req.tenant = tenant;
    req.tenantId = tenant.id;
    return true;
  }
}
