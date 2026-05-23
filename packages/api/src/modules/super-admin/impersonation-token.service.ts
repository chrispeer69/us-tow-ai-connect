import { Injectable } from '@nestjs/common';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const TTL_SECONDS = 15 * 60;

export interface ImpersonationPayload {
  superAdminEmail: string;
  targetTenantId: string;
  iat: number;
  exp: number;
}

/**
 * HS256-style signed token for super-admin impersonation. We avoid
 * jsonwebtoken to keep the dep list tight — three lines of HMAC are
 * sufficient for a 15-minute, server-issued token.
 *
 * Secret resolution:
 *   1. IMPERSONATION_SECRET env (preferred)
 *   2. sha256(ENCRYPTION_KEY) — derives a stable secret from a value
 *      operators already manage. Dev convenience.
 */
@Injectable()
export class ImpersonationTokenService {
  private secret(): Buffer {
    const direct = process.env.IMPERSONATION_SECRET;
    if (direct && direct.length > 0) return Buffer.from(direct, 'utf8');
    const enc = process.env.ENCRYPTION_KEY ?? 'ustow-dev-impersonation-secret';
    return createHash('sha256').update(enc).digest();
  }

  issue(superAdminEmail: string, targetTenantId: string): string {
    const iat = Math.floor(Date.now() / 1000);
    const payload: ImpersonationPayload = {
      superAdminEmail,
      targetTenantId,
      iat,
      exp: iat + TTL_SECONDS,
    };
    const body = base64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
    const sig = base64Url(
      createHmac('sha256', this.secret()).update(body).digest(),
    );
    return `${body}.${sig}`;
  }

  verify(token: string): ImpersonationPayload | null {
    if (!token || token.indexOf('.') < 0) return null;
    const [body, sig] = token.split('.');
    const expected = base64Url(
      createHmac('sha256', this.secret()).update(body).digest(),
    );
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    try {
      const payload = JSON.parse(
        Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
      ) as ImpersonationPayload;
      if (payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
