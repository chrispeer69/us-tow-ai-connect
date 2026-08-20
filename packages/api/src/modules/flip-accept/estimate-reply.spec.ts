import { describe, expect, it, vi } from 'vitest';
import { FlipAcceptInboundController } from './flip-accept.controller';

/**
 * 3.6 — ESTIMATE is the collision programme's only conversion point.
 *
 * Script 3.6 removed the ask at tow time on purpose, so the entire collision
 * funnel is: one statement, one text, and the customer comes back days later
 * when the estimate lands. If this reply is not routed, that strategy has no
 * receiving end — which is exactly what it had before this change.
 */
describe('inbound ESTIMATE reply', () => {
  const makeController = (matched: unknown) => {
    const service = {
      findRecentCallByPhone: vi.fn().mockResolvedValue(matched),
      applyInboundReply: vi.fn().mockResolvedValue({ matched: false }),
    };
    const sms = { recordInbound: vi.fn().mockResolvedValue(undefined) };
    const notifier = { notifyEstimateReviewRequest: vi.fn().mockResolvedValue({ sent: 2 }) };
    const c = new FlipAcceptInboundController(
      service as never,
      sms as never,
      notifier as never,
    );
    return { c, service, sms, notifier };
  };

  const match = {
    tenantId: 't-1',
    customerName: 'Sara P.',
    vehicle: '2019 Mazda CX-5',
    destination: 'Crash Champions',
  };

  it('alerts managers and never falls through to the YES/NO help text', async () => {
    const { c, notifier, service } = makeController(match);
    const xml = await c.inbound({
      From: '+16145551234',
      To: '+18447011345',
      Body: 'ESTIMATE',
    } as never);

    expect(notifier.notifyEstimateReviewRequest).toHaveBeenCalledWith('t-1', {
      customerName: 'Sara P.',
      customerPhone: '+16145551234',
      vehicle: '2019 Mazda CX-5',
      destination: 'Crash Champions',
    });
    // The flip-accept keyword flow must not swallow it.
    expect(service.applyInboundReply).not.toHaveBeenCalled();
    expect(xml).toContain('free estimate review');
    expect(xml).not.toContain('Reply YES to accept');
  });

  it('is case-insensitive and tolerates trailing text', async () => {
    const { c, notifier } = makeController(match);
    await c.inbound({
      From: '+16145551234',
      To: '+18447011345',
      Body: 'estimate please call me after 5',
    } as never);
    expect(notifier.notifyEstimateReviewRequest).toHaveBeenCalledOnce();
  });

  it('still acknowledges when no recent call matches, rather than leaving them on read', async () => {
    const { c, notifier } = makeController(null);
    const xml = await c.inbound({
      From: '+19995550000',
      To: '+18447011345',
      Body: 'ESTIMATE',
    } as never);
    expect(notifier.notifyEstimateReviewRequest).not.toHaveBeenCalled();
    expect(xml).toContain('free estimate review');
  });

  it('leaves STOP alone — opt-out still wins over every keyword', async () => {
    const { c, notifier } = makeController(match);
    const xml = await c.inbound({
      From: '+16145551234',
      To: '+18447011345',
      Body: 'STOP',
    } as never);
    expect(notifier.notifyEstimateReviewRequest).not.toHaveBeenCalled();
    expect(xml).toContain('opted out');
  });
});
