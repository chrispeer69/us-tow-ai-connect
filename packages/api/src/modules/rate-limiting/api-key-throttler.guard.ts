import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type Redis from 'ioredis';
import type { Request, Response } from 'express';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import {
  type EndpointGroup,
  resolveEndpointGroup,
  THROTTLE_TIERS,
} from './throttle-tiers';

/**
 * Global Redis-backed throttle guard (Session 26, Bundle B section 1).
 *
 * Why custom and not @nestjs/throttler's built-in storage:
 *   - The default in-memory storage doesn't survive restarts and doesn't
 *     work behind more than one API instance (Railway's multi-replica
 *     scaling, ngrok-routed dev, etc.).
 *   - Per-tier limits depend on a URL match, not a decorator — the legacy
 *     /v1/ai-connect/* routes are already shipping and we don't want to
 *     touch parallel-session files to add @Throttle().
 *
 * Algorithm: classic fixed-window counter via INCR + EXPIRE on first hit.
 * Cheaper than a sliding window and good enough for the four tiers we have.
 * The first request in a window pays the EXPIRE cost; everything else is a
 * single round trip.
 *
 * Key form:   throttle:{group}:{identifier}
 * Override:   throttle:override:{group}:{identifier} -> custom limit (int)
 *
 * The override key lets a tenant be bumped without a deploy — written by
 * /v1/admin/system/limits (Section 4).
 */
@Injectable()
export class ApiKeyThrottlerGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyThrottlerGuard.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Don't trip on non-HTTP contexts (websocket upgrade, rpc, etc.).
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const path = req.path ?? req.url ?? '';

    const group = resolveEndpointGroup(path);
    if (!group) return true;

    const identifier = pickIdentifier(req, group);
    const { limit, windowSeconds } = await this.resolveTier(group, identifier);

    const key = `throttle:${group}:${identifier}`;
    let current: number;
    try {
      current = await this.redis.incr(key);
      if (current === 1) {
        await this.redis.expire(key, windowSeconds);
      }
    } catch (err) {
      // Fail-open: if Redis is wedged the API is still usable. The
      // observability layer (Sentry + readiness check) will surface the
      // outage; throttling without Redis is moot anyway.
      this.logger.warn(
        `Redis unreachable for throttle (${(err as Error).message}); allowing request through`,
      );
      return true;
    }

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - current)));
    res.setHeader('X-RateLimit-Group', group);

    if (current > limit) {
      let ttl = await this.redis.ttl(key).catch(() => -1);
      if (ttl < 1) ttl = windowSeconds;
      res.setHeader('Retry-After', String(ttl));
      // Background-count the throttle. The aggregator (RateLimitStatsAggregator)
      // flushes throttled_count to api_key_usage_stats every 5 min.
      void this.redis
        .hincrby(this.windowKey(group, identifier), 'throttled', 1)
        .catch(() => undefined);
      res.status(HttpStatus.TOO_MANY_REQUESTS);
      throw new TooManyRequestsException();
    }

    // Tally for the aggregator (separate from the bucket counter so the
    // bucket can expire at the end of the window without losing stats).
    void this.redis
      .hincrby(this.windowKey(group, identifier), 'requests', 1)
      .catch(() => undefined);
    void this.redis.expire(this.windowKey(group, identifier), 600).catch(() => undefined);

    return true;
  }

  private async resolveTier(group: EndpointGroup, identifier: string) {
    const base = THROTTLE_TIERS[group];
    const overrideKey = `throttle:override:${group}:${identifier}`;
    try {
      const override = await this.redis.get(overrideKey);
      if (override) {
        const parsed = parseInt(override, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          return { ...base, limit: parsed };
        }
      }
    } catch {
      // Fall through to default.
    }
    return base;
  }

  private windowKey(group: EndpointGroup, identifier: string) {
    const window = Math.floor(Date.now() / 1000 / 300) * 300; // 5-min bucket
    return `throttle:stats:${window}:${group}:${identifier}`;
  }
}

interface PossiblyAuthedRequest extends Request {
  tenant?: { id: string; apiKeyPrefix?: string };
  tenantId?: string;
}

function pickIdentifier(req: Request, group: EndpointGroup): string {
  const r = req as PossiblyAuthedRequest;
  if (group === 'tenant_api') {
    const headerKey = (req.headers['x-tenant-api-key'] ?? req.headers['x-api-key']) as
      | string
      | string[]
      | undefined;
    const apiKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;
    if (apiKey && typeof apiKey === 'string' && apiKey.length >= 12) {
      // Use the prefix (first 12 chars) so the identifier is stable even
      // after we move the full key into bcrypt-hashed storage.
      return apiKey.slice(0, 12);
    }
    if (r.tenant?.apiKeyPrefix) return r.tenant.apiKeyPrefix;
    if (r.tenantId) return `tenant:${r.tenantId}`;
  }
  if (group === 'admin') {
    const tenantHeader = req.headers['x-tenant-id'];
    const tenantId = Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader;
    if (tenantId) return `admin:${tenantId}`;
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return `admin:bearer:${auth.slice(7, 27)}`; // first 20 chars of token
    }
  }
  // Public / webhook / un-authenticated tenant fallthrough — bucket by IP.
  const xff = req.headers['x-forwarded-for'];
  const fwd = Array.isArray(xff) ? xff[0] : xff;
  const ip = (fwd ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
  return `ip:${ip}`;
}
