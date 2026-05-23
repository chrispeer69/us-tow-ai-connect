import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type Redis from 'ioredis';
import type { Request, Response } from 'express';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';

const SIGNUPS_PER_IP_PER_HOUR = 3;
const WINDOW_SECONDS = 60 * 60;

/**
 * Per-IP rate limiter for the public onboarding completion endpoint.
 * 3 successful signups per IP per hour. The /start and /step endpoints
 * are protected by a looser limiter (60/min) inherited from
 * RateLimitGuard via the controller decorator stack. See
 * docs/ASSUMPTIONS.md (Session 27 §1).
 */
@Injectable()
export class OnboardingRateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || req.ip
      || 'unknown';
    const key = `ratelimit:onboarding:${ip}`;
    const current = await this.redis.incr(key);
    if (current === 1) await this.redis.expire(key, WINDOW_SECONDS);
    res.setHeader('X-RateLimit-Limit', String(SIGNUPS_PER_IP_PER_HOUR));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, SIGNUPS_PER_IP_PER_HOUR - current)),
    );
    if (current > SIGNUPS_PER_IP_PER_HOUR) {
      const ttl = await this.redis.ttl(key);
      res.setHeader('Retry-After', String(Math.max(1, ttl)));
      res.status(HttpStatus.TOO_MANY_REQUESTS);
      throw new TooManyRequestsException();
    }
    return true;
  }
}
