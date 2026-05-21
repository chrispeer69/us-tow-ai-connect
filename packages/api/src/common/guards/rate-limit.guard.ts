import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type Redis from 'ioredis';
import type { Response } from 'express';
import { REDIS_CLIENT } from '../redis/redis.module';
import { TooManyRequestsException } from '../exceptions/too-many-requests.exception';
import type { AuthenticatedRequest } from './api-key.guard';

const MAX_REQUESTS = 60;
const WINDOW_SECONDS = 60;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    const identifier =
      req.tenant?.apiKeyPrefix ??
      (req.headers['x-api-key'] as string | undefined) ??
      req.ip ??
      'anonymous';
    const key = `ratelimit:${identifier}`;

    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }
    res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - current)));

    if (current > MAX_REQUESTS) {
      const ttl = await this.redis.ttl(key);
      res.setHeader('Retry-After', String(Math.max(1, ttl)));
      res.status(HttpStatus.TOO_MANY_REQUESTS);
      throw new TooManyRequestsException();
    }
    return true;
  }
}
