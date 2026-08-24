import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { timingSafeEqual } from '../../common/utils/retell-signature';
import { AlphaCrashMiddlewareClient } from './alpha-crash-middleware.client';
import { PushService } from '../push/push.service';

/**
 * Read-only window onto Alpha Automotive's crash-lead outbound caller — a
 * separate system (github.com/chrispeer69/retell-middleware, its own
 * Postgres) that Command Center doesn't own. Everything here proxies to that
 * service's reporting API; nothing is stored in this database.
 *
 * Scoped to the one Alpha Automotive tenant via ALPHA_CRASH_TENANT_ID rather
 * than a generic per-tenant flag — there is exactly one crash-lead deployment
 * and it belongs to exactly one tenant.
 */
@Controller('v1/alpha-crash-calls')
export class AlphaCrashCallsController {
  constructor(
    private readonly middleware: AlphaCrashMiddlewareClient,
    private readonly push: PushService,
  ) {}

  private assertAlphaTenant(req: AdminRequest): void {
    const alphaTenantId = process.env.ALPHA_CRASH_TENANT_ID?.trim();
    if (!alphaTenantId || req.tenantId !== alphaTenantId) {
      throw new ForbiddenException('Not available for this tenant');
    }
  }

  @UseGuards(AdminAuthGuard)
  @Get()
  async list(
    @Req() req: AdminRequest,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('direction') direction?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.assertAlphaTenant(req);
    const result = await this.middleware.listCalls({
      since,
      until,
      direction,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    if (!result) throw new ServiceUnavailableException('Crash-lead call service is unreachable');
    return { data: result };
  }

  @UseGuards(AdminAuthGuard)
  @Get('stats')
  async stats(@Req() req: AdminRequest, @Query('since') since?: string, @Query('until') until?: string) {
    this.assertAlphaTenant(req);
    const result = await this.middleware.getStats({ since, until });
    if (!result) throw new ServiceUnavailableException('Crash-lead call service is unreachable');
    return { data: result };
  }

  @UseGuards(AdminAuthGuard)
  @Get(':callId')
  async detail(@Req() req: AdminRequest, @Param('callId') callId: string) {
    this.assertAlphaTenant(req);
    const result = await this.middleware.getCall(callId);
    if (!result) throw new NotFoundException('Call not found');
    return { data: result };
  }

  /**
   * Inbound from retell-middleware, not from the browser — verified by a
   * shared secret header instead of the admin JWT (the middleware has no
   * Command Center login). Fires the same tenant-wide push used for the
   * towing campaign's "somebody wants to talk" alerts.
   */
  @Post('flip-alert')
  async flipAlert(
    @Req() req: AdminRequest,
    @Body()
    body: {
      call_id?: string;
      customer_name?: string;
      phone?: string;
      call_outcome?: string;
      call_summary?: string;
      preferred_callback_time?: string;
      recording_url?: string;
    },
  ) {
    const expected = process.env.ALPHA_CRASH_ALERT_SECRET?.trim();
    const given = (req.headers['x-alpha-middleware-secret'] as string | undefined)?.trim();
    if (!expected || !given || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Invalid alert secret');
    }
    const alphaTenantId = process.env.ALPHA_CRASH_TENANT_ID?.trim();
    if (!alphaTenantId) throw new ServiceUnavailableException('ALPHA_CRASH_TENANT_ID is not configured');

    await this.push.sendAlphaCrashLeadInterest(alphaTenantId, {
      callId: body.call_id ?? 'unknown',
      customerName: body.customer_name ?? null,
      phone: body.phone ?? null,
      callOutcome: body.call_outcome ?? 'interested',
      callSummary: body.call_summary ?? null,
      preferredCallbackTime: body.preferred_callback_time ?? null,
    });

    return { data: { ok: true } };
  }
}
