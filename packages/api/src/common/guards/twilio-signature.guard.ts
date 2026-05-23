import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Twilio webhook signature validation.
 *
 * Twilio signs each webhook with HMAC-SHA1 of the full URL plus sorted
 * `key+value` pairs from the POST body, base64-encoded, in the
 * `X-Twilio-Signature` header. See: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * Behaviour:
 * - If `TWILIO_AUTH_TOKEN` is unset OR `process.env.NODE_ENV === 'test'`,
 *   the guard allows the request through with a warning (local dev / unit
 *   tests don't need real signatures).
 * - On signature mismatch, returns 403.
 *
 * The full URL is reconstructed from `PUBLIC_BASE_URL` (when set) + the
 * original path + query string. This is important because Twilio signs the
 * URL it called, which from the public internet is the ngrok / Railway
 * URL — not whatever `req.protocol://req.get('host')` resolves to inside
 * a containerized network.
 */
@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  private readonly logger = new Logger(TwilioSignatureGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { body?: unknown }>();
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (!token || token.startsWith('REPLACE_ME')) {
      this.logger.warn(
        'TWILIO_AUTH_TOKEN unset — accepting Twilio webhook without signature check',
      );
      return true;
    }

    const headerValue = req.headers['x-twilio-signature'];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!provided) {
      throw new ForbiddenException({
        status: 'error',
        code: 'TWILIO_SIGNATURE_MISSING',
        message: 'X-Twilio-Signature header required',
      });
    }

    const url = this.reconstructUrl(req);
    const body = (req.body as Record<string, unknown> | undefined) ?? {};
    const expected = computeTwilioSignature(token, url, body);

    if (!constantTimeEqualBase64(provided, expected)) {
      this.logger.warn(
        `Twilio signature mismatch for ${req.method} ${req.originalUrl ?? req.url}`,
      );
      throw new ForbiddenException({
        status: 'error',
        code: 'TWILIO_SIGNATURE_INVALID',
        message: 'Twilio signature did not match',
      });
    }
    return true;
  }

  private reconstructUrl(req: Request): string {
    const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
    const path = req.originalUrl ?? req.url ?? '';
    if (base) return `${base}${path}`;
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.get('host');
    return `${proto}://${host}${path}`;
  }
}

/**
 * Compute the Twilio-style signature for a given URL + form body.
 * Exported separately so the unit test can exercise it without spinning up
 * the Nest container.
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>,
): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    const value = params[key];
    data += key + (value === null || value === undefined ? '' : String(value));
  }
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

function constantTimeEqualBase64(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}
