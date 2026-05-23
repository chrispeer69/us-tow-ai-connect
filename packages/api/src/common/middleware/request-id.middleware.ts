import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

const HEADER_IN = 'x-request-id';
const HEADER_OUT = 'X-Request-ID';

interface RequestWithId extends Request {
  requestId?: string;
}

/**
 * Tags every incoming request with a UUIDv4. Honors an inbound
 * `X-Request-ID` header so an upstream proxy / curl call can correlate.
 * The value lands on `req.requestId`, the response header, and (via the
 * audit log interceptor) every audit_log row's `metadata.requestId`.
 *
 * Use the value in log lines:
 *   logger.log(`tenant=${tenantId} job=${jobId} request=${req.requestId} …`)
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction) {
    const incoming = req.headers[HEADER_IN];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const id = isValidId(candidate) ? (candidate as string) : randomUUID();
    req.requestId = id;
    res.setHeader(HEADER_OUT, id);
    next();
  }
}

function isValidId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // Accept any printable ASCII <= 80 chars. We don't lock to UUID so a
  // calling system's own correlation id (Cloudflare ray id, etc.) flows
  // through unchanged.
  return value.length > 0 && value.length <= 80 && /^[\x21-\x7e]+$/.test(value);
}
