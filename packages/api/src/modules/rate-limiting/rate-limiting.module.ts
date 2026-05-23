import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiKeyThrottlerGuard } from './api-key-throttler.guard';
import { RateLimitStatsService } from './rate-limit-stats.service';

/**
 * Session 26 — Bundle B section 1.
 *
 * Wires the custom Redis-backed ApiKeyThrottlerGuard as a global APP_GUARD.
 * The bundled @nestjs/throttler is imported so future per-route overrides
 * (e.g. @Throttle() decorators) keep their NestJS-native ergonomics, but the
 * actual enforcement is our own guard — see api-key-throttler.guard.ts for
 * the rationale.
 */
@Global()
@Module({
  imports: [
    // Forms the DI container for any future @Throttle()/SkipThrottle()
    // decorators we add on individual routes. Default ttl/limit here are
    // never reached because ApiKeyThrottlerGuard short-circuits first; they
    // exist only to satisfy the module config.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 600 },
    ]),
  ],
  providers: [
    ApiKeyThrottlerGuard,
    RateLimitStatsService,
    { provide: APP_GUARD, useClass: ApiKeyThrottlerGuard },
  ],
  exports: [ApiKeyThrottlerGuard, RateLimitStatsService],
})
export class RateLimitingModule {}
