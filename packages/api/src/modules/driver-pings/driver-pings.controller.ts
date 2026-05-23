import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  DriverPingCreateSchema,
  DriverPushSubscribeSchema,
  type DriverPingCreate,
  type DriverPushSubscribe,
} from '@ustow/shared';
import {
  TenantApiKeyGuard,
  type TenantAuthenticatedRequest,
} from '../../common/guards/tenant-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { AdminAuthGuard, type AdminRequest } from '../../common/guards/admin-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DriverPingsService } from './driver-pings.service';
import { DriverPushService } from './driver-push.service';

/**
 * Two access paths:
 *   - `POST /v1/driver-pings` — guarded by the tenant API key, so a phone
 *     app / in-cab tablet can post pings with the same credential the
 *     Thinkrr agent uses. Rate-limited (60 req/min per key, default).
 *   - `GET  /v1/admin/driver-pings/...` — admin dashboard read endpoints.
 */
@Controller()
export class DriverPingsController {
  constructor(
    private readonly service: DriverPingsService,
    private readonly push: DriverPushService,
  ) {}

  @Post('v1/driver-pings')
  @HttpCode(201)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  @UsePipes(new ZodValidationPipe(DriverPingCreateSchema))
  async create(@Req() req: TenantAuthenticatedRequest, @Body() body: DriverPingCreate) {
    try {
      const row = await this.service.record(req.tenantId, body);
      return {
        status: 'success',
        data: {
          id: row.id,
          driver_phone: row.driverPhone,
          recorded_at: row.recordedAt,
        },
      };
    } catch (err) {
      throw new BadRequestException({
        status: 'error',
        code: 'INVALID_PING',
        message: (err as Error).message,
      });
    }
  }

  @Get('v1/admin/driver-pings/latest')
  @UseGuards(AdminAuthGuard)
  async listLatest(@Req() req: AdminRequest, @Query('max_age_seconds') maxAge?: string) {
    const opts = maxAge ? { maxAgeSeconds: Math.max(0, Number(maxAge)) || undefined } : {};
    const drivers = await this.service.listLatestPerDriver(req.tenantId, opts);
    return { status: 'success', data: { drivers, count: drivers.length } };
  }

  @Get('v1/admin/driver-pings/:phone/history')
  @UseGuards(AdminAuthGuard)
  async history(
    @Req() req: AdminRequest,
    @Param('phone') phone: string,
    @Query('limit') limit?: string,
  ) {
    const rows = await this.service.listHistoryForDriver(
      req.tenantId,
      phone,
      limit ? Number(limit) : 50,
    );
    return { status: 'success', data: { pings: rows, count: rows.length } };
  }

  /**
   * Register a web-push subscription from the driver PWA. The actual push
   * sending is gated on VAPID keys being configured (see ASSUMPTIONS.md);
   * until then this endpoint just persists the subscription so it's ready
   * when keys land.
   */
  @Post('v1/driver/push/subscribe')
  @HttpCode(201)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  @UsePipes(new ZodValidationPipe(DriverPushSubscribeSchema))
  async subscribePush(
    @Req() req: TenantAuthenticatedRequest,
    @Body() body: DriverPushSubscribe,
  ) {
    try {
      const result = await this.push.subscribe(req.tenantId, body);
      return { status: 'success', data: result };
    } catch (err) {
      throw new BadRequestException({
        status: 'error',
        code: 'INVALID_SUBSCRIPTION',
        message: (err as Error).message,
      });
    }
  }
}
