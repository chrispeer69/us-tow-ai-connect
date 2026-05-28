import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';

/**
 * Operator smoke endpoint for Sentry.
 *
 * Set SENTRY_DEBUG_ROUTE=true on the @ustow/api service in Railway,
 * redeploy, then hit:
 *
 *   curl -H "x-tenant-id: <uuid>" \
 *        https://ustowapi-production.up.railway.app/v1/admin/_debug/sentry-test
 *
 * The route throws synchronously, which the Sentry global filter captures
 * and forwards to sentry.io. Unset SENTRY_DEBUG_ROUTE once you've
 * confirmed the event landed — when the env flag is anything other than
 * the literal string "true" the route returns 404 so it can't be hit by
 * accident.
 *
 * Tenant context is enforced by AdminAuthGuard (same x-tenant-id / Bearer
 * flow as every other /v1/admin/* route). See docs/OBSERVABILITY.md.
 */
@Controller('v1/admin/_debug')
@UseGuards(AdminAuthGuard)
export class SentryDebugController {
  @Get('sentry-test')
  fire(): never {
    if (process.env.SENTRY_DEBUG_ROUTE !== 'true') {
      throw new NotFoundException();
    }
    throw new Error('sentry-test');
  }
}
