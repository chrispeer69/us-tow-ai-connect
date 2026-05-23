import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export interface PartnerRequest extends Request {
  partnerName: string;
}

/**
 * Single-partner key check. Reads PARTNER_API_KEY from env and
 * constant-time compares against the `x-partner-api-key` header.
 * When a second partner integration arrives, this guard should
 * graduate to looking up a `partners` table; until then, a single
 * env value is sufficient and keeps ops simple.
 */
@Injectable()
export class PartnerApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<PartnerRequest>();
    const provided = (req.headers['x-partner-api-key'] as string | undefined) ?? '';
    const expected = process.env.PARTNER_API_KEY ?? '';
    if (!expected) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'PARTNER_KEY_NOT_CONFIGURED',
        message: 'PARTNER_API_KEY env not set on the API',
      });
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException({
        status: 'error',
        code: 'INVALID_PARTNER_KEY',
        message: 'Invalid partner API key',
      });
    }
    req.partnerName = process.env.PARTNER_NAME ?? 'thinkrr';
    return true;
  }
}
