import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { z } from 'zod';
import { DriverPushSubscribeSchema, type DriverPushSubscribe } from '@ustow/shared';
import {
  TenantApiKeyGuard,
  type TenantAuthenticatedRequest,
} from '../../common/guards/tenant-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PushService } from './push.service';

const DriverPushUnsubscribeSchema = z.object({ endpoint: z.string().url() });
type DriverPushUnsubscribe = z.infer<typeof DriverPushUnsubscribeSchema>;

/**
 * Driver PWA web-push endpoints (Session 29). Guarded by the tenant API key —
 * the same credential the driver app already uses for pings — and rate-limited.
 * `vapid-public-key` is unauthenticated so the service worker can fetch it
 * before the user grants notification permission.
 */
@Controller('v1/driver-push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('vapid-public-key')
  vapidPublicKey() {
    return { status: 'success', data: { publicKey: this.push.getPublicKey() } };
  }

  @Post('subscribe')
  @HttpCode(201)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  @UsePipes(new ZodValidationPipe(DriverPushSubscribeSchema))
  async subscribe(@Req() req: TenantAuthenticatedRequest, @Body() body: DriverPushSubscribe) {
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

  @Post('unsubscribe')
  @HttpCode(200)
  @UseGuards(TenantApiKeyGuard, RateLimitGuard)
  @UsePipes(new ZodValidationPipe(DriverPushUnsubscribeSchema))
  async unsubscribe(@Req() req: TenantAuthenticatedRequest, @Body() body: DriverPushUnsubscribe) {
    const removed = await this.push.unsubscribe(req.tenantId, body.endpoint);
    return { status: 'success', data: { removed } };
  }
}
