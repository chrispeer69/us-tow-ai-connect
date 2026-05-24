import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { StripeWebhookController } from './stripe-webhook.controller';

function reqWithBody(body: string | undefined): RawBodyRequest<Request> {
  return { rawBody: body === undefined ? undefined : Buffer.from(body) } as never;
}

describe('StripeWebhookController.handle — signature verification', () => {
  const service = { applyWebhookEvent: vi.fn(async () => ({ applied: true, type: 'x' })) };

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    service.applyWebhookEvent.mockClear();
  });
  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('503s when Stripe is not configured', async () => {
    const ctrl = new StripeWebhookController(service as never, null);
    await expect(ctrl.handle(reqWithBody('{}'), 'sig')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('503s when STRIPE_WEBHOOK_SECRET is unset', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const stripe = { webhooks: { constructEvent: vi.fn() } };
    const ctrl = new StripeWebhookController(service as never, stripe as never);
    await expect(ctrl.handle(reqWithBody('{}'), 'sig')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('400s when the signature header is missing', async () => {
    const stripe = { webhooks: { constructEvent: vi.fn() } };
    const ctrl = new StripeWebhookController(service as never, stripe as never);
    await expect(ctrl.handle(reqWithBody('{}'), undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('400s when signature verification throws', async () => {
    const stripe = {
      webhooks: {
        constructEvent: vi.fn(() => {
          throw new Error('no signatures found matching the expected signature');
        }),
      },
    };
    const ctrl = new StripeWebhookController(service as never, stripe as never);
    await expect(ctrl.handle(reqWithBody('{}'), 'bad-sig')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.applyWebhookEvent).not.toHaveBeenCalled();
  });

  it('verifies the signature and dispatches the event on success', async () => {
    const event = { id: 'evt_ok', type: 'invoice.paid' };
    const stripe = { webhooks: { constructEvent: vi.fn(() => event) } };
    const ctrl = new StripeWebhookController(service as never, stripe as never);
    const result = await ctrl.handle(reqWithBody('{"ok":true}'), 'good-sig');
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      Buffer.from('{"ok":true}'),
      'good-sig',
      'whsec_test',
    );
    expect(service.applyWebhookEvent).toHaveBeenCalledWith(event);
    expect(result).toMatchObject({ received: true, applied: true });
  });
});
