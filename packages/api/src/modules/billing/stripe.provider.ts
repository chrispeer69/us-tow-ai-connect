import { Logger, type Provider } from '@nestjs/common';
import Stripe from 'stripe';

/**
 * DI token for the Stripe SDK client.
 *
 * The client is `null` when STRIPE_SECRET_KEY is unset (local dev, CI, or a
 * tenant-zero install before the operator wires Stripe on Railway). Every
 * BillingService method that needs Stripe checks for null and throws a clean
 * 503-style error rather than booting the whole API with a hard dependency on
 * a live Stripe account. See docs/sessions/S28_OPERATOR_TODO.md.
 */
export const STRIPE_CLIENT = 'STRIPE_CLIENT';

// stripe@22's CommonJS type entry exposes the default export as a callable
// constructor whose nested resource namespaces (Stripe.Checkout, Stripe.Event,
// …) are NOT reachable as `Stripe.X` under `moduleResolution: node`. The
// instance type is reachable via the `Stripe.Stripe` alias, so we type the
// client that way and let the SDK's own method signatures type-check the
// call-site params. Webhook events are typed structurally (StripeEvent) to
// stay independent of the account's pinned API version. See S28_DECISIONS D9.
export type StripeInstance = Stripe.Stripe;
export type StripeClient = StripeInstance | null;

export interface StripeEvent {
  id: string;
  type: string;
  // Loosely typed on purpose: the concrete object shape varies by event type
  // and API version; handlers narrow it per-case.
  data: { object: any };
}

export const stripeProvider: Provider = {
  provide: STRIPE_CLIENT,
  useFactory: (): StripeClient => {
    const logger = new Logger('StripeProvider');
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      logger.warn(
        'STRIPE_SECRET_KEY unset — billing runs in disabled mode (checkout/portal return 503). Set it on Railway @ustow/api to enable.',
      );
      return null;
    }
    // apiVersion intentionally omitted: the SDK pins its own default that
    // matches the installed major (stripe@22), which avoids a brittle literal
    // version string that would need bumping on every SDK upgrade.
    return new Stripe(key, { typescript: true });
  },
};
