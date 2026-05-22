import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { WebhookReceiverService, type ThinkrrCallPayload } from './webhook-receiver.service';

/**
 * Thinkrr.ai webhook receiver.
 *
 * Thinkrr does not support per-tenant auth headers on webhooks, so the
 * shared secret is carried in the URL path. The Thinkrr dashboard is
 * configured with: ${PUBLIC_BASE_URL}/webhooks/thinkrr/${THINKRR_WEBHOOK_SECRET}/call-completed
 *
 * If THINKRR_WEBHOOK_SECRET is unset (dev), any value in the :secret slot
 * is accepted and a warning is logged.
 */
@Controller('webhooks/thinkrr')
export class WebhookReceiverController {
  private readonly logger = new Logger(WebhookReceiverController.name);

  constructor(private readonly service: WebhookReceiverService) {}

  @Post(':secret/call-completed')
  @HttpCode(200)
  async handleCallCompletedSecured(
    @Param('secret') secret: string,
    @Body() payload: ThinkrrCallPayload,
  ) {
    this.assertSecret(secret);
    return this.dispatch(payload);
  }

  // Unsecured path retained for environments where THINKRR_WEBHOOK_SECRET is intentionally unset
  // (local dev with ngrok, smoke tests). Returns 401 if the secret IS set, to nudge ops toward
  // the secured URL.
  @Post('call-completed')
  @HttpCode(200)
  async handleCallCompletedLegacy(@Body() payload: ThinkrrCallPayload) {
    if (process.env.THINKRR_WEBHOOK_SECRET) {
      throw new UnauthorizedException(
        'THINKRR_WEBHOOK_SECRET is configured — use /webhooks/thinkrr/{secret}/call-completed',
      );
    }
    this.logger.warn('Accepting webhook on legacy unsecured route — set THINKRR_WEBHOOK_SECRET in prod');
    return this.dispatch(payload);
  }

  private assertSecret(provided: string): void {
    const expected = process.env.THINKRR_WEBHOOK_SECRET;
    if (!expected) {
      this.logger.warn('THINKRR_WEBHOOK_SECRET unset — accepting any secret value in URL');
      return;
    }
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided ?? '', 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
  }

  private async dispatch(payload: ThinkrrCallPayload) {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Invalid payload');
    }
    const result = await this.service.processCallWebhook(payload);
    return result.accepted
      ? { received: true, accepted: true }
      : { received: true, accepted: false, reason: result.reason };
  }
}
