import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookReceiverService, type ThinkrrCallPayload } from './webhook-receiver.service';

@Controller('webhooks/thinkrr')
export class WebhookReceiverController {
  private readonly logger = new Logger(WebhookReceiverController.name);

  constructor(private readonly service: WebhookReceiverService) {}

  @Post('call-completed')
  @HttpCode(200)
  async handleCallCompleted(
    @Body() payload: ThinkrrCallPayload,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Req() req: Request,
  ) {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Invalid payload');
    }

    this.verifySignatureIfConfigured(signature, req);

    const result = await this.service.processCallWebhook(payload);

    if (!result.accepted) {
      return { received: true, accepted: false, reason: result.reason };
    }

    return { received: true, accepted: true };
  }

  private verifySignatureIfConfigured(signature: string | undefined, req: Request): void {
    const secret = process.env.THINKRR_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.warn(
        'THINKRR_WEBHOOK_SECRET unset — accepting webhook without signature verification',
      );
      return;
    }

    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    const bodyString = raw ? raw.toString('utf8') : JSON.stringify(req.body ?? {});
    const expected = createHmac('sha256', secret).update(bodyString).digest('hex');

    const provided = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
