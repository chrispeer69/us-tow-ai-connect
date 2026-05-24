import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { stripeProvider } from './stripe.provider';

/**
 * Stripe credit billing (Session 28). Exports BillingService so the credit
 * deduction hook can be invoked from the job ingest path (CommandCenter).
 */
@Module({
  controllers: [BillingController, StripeWebhookController],
  providers: [BillingService, stripeProvider],
  exports: [BillingService],
})
export class BillingModule {}
