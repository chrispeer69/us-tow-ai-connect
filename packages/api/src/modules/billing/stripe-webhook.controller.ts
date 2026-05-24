import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';
import { STRIPE_CLIENT, type StripeClient, type StripeEvent } from './stripe.provider';
import { Inject } from '@nestjs/common';

/**
 * Stripe webhook ingress. Lives under /webhooks/* so it is CORS-exempt (see
 * main.ts) and is authenticated by the Stripe signature, not the admin guard.
 *
 * Requires the raw request body for signature verification — provided by
 * `rawBody: true` in NestFactory.create (main.ts), exposed as req.rawBody.
 */
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly service: BillingService,
    @Inject(STRIPE_CLIENT) private readonly stripe: StripeClient,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Billing is not configured (STRIPE_SECRET_KEY unset)');
    }
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET unset — refusing unverified webhook');
    }
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw request body for signature verification');
    }

    let event: StripeEvent;
    try {
      event = this.stripe.webhooks.constructEvent(req.rawBody, signature, secret);
    } catch (err) {
      this.logger.warn(`Stripe signature verification failed: ${(err as Error).message}`);
      throw new BadRequestException('Invalid Stripe signature');
    }

    const result = await this.service.applyWebhookEvent(event);
    return { received: true, ...result };
  }
}
