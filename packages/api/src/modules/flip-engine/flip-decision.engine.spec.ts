import { describe, it, expect } from 'vitest';
import { decideFlip } from './flip-decision.engine';

describe('decideFlip', () => {
  it('hard-blocks AAA-branded destinations regardless of source', () => {
    const r = decideFlip({
      source: 'AAA_PORTAL',
      destinationTag: 'aaa_branded',
      issueSubcategory: 'mechanical',
      issueConfidence: 0.99,
      config: {},
    });
    expect(r.flipEligible).toBe(false);
    expect(r.reasonCode).toBe('aaa_branded_hard_block');
  });

  it('hard-blocks a flip on a motorcycle regardless of destination/issue', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'mechanical',
      issueConfidence: 0.99,
      config: {},
      vehicleMake: 'Harley-Davidson',
    });
    expect(r.flipEligible).toBe(false);
    expect(r.reasonCode).toBe('vehicle_is_motorcycle');
  });

  it('matches motorcycle makes case-insensitively and with surrounding whitespace', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'mechanical',
      issueConfidence: 0.99,
      config: {},
      vehicleMake: '  ducati ',
    });
    expect(r.flipEligible).toBe(false);
    expect(r.reasonCode).toBe('vehicle_is_motorcycle');
  });

  it('does not block cars from an ambiguous make like Honda or BMW', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'mechanical',
      issueConfidence: 0.99,
      config: {},
      vehicleMake: 'Honda',
    });
    expect(r.flipEligible).toBe(true);
  });

  it('skips flip when destination is our own shop', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'our_shop',
      issueSubcategory: 'mechanical',
      issueConfidence: 0.95,
      config: {},
    });
    expect(r.flipEligible).toBe(false);
    expect(r.reasonCode).toBe('destination_is_our_shop');
  });

  // 2026-08-18 — auto_body became eligible when Excite Collision and T&C went
  // live. It still routes to Scenario B via bodyShopSoftMention: eligibility and
  // scenario selection are independent, and that separation is the point.
  // 2026-08-19 — the Chara Booth loss. A bad alternator going to a shop tagged
  // auto_body got the body-shop script and NO offer. The destination tag is a
  // guess about a business; the issue is what the customer just said about their
  // car. When they disagree, the car wins.
  it('does NOT use the body-shop scenario for mechanical work at a body shop', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'auto_body',
      issueSubcategory: 'mechanical',
      issueConfidence: 0.9,
      config: {},
    } as never);
    expect(r.bodyShopSoftMention).toBe(false);
    expect(r.flipEligible).toBe(true);
    expect(r.reasonCode).not.toBe('destination_auto_body');
  });

  it('still uses the body-shop scenario when the work really is body work', () => {
    for (const sub of ['accident_minor', 'accident_with_airbags', 'glass_damage']) {
      const r = decideFlip({
        source: 'TOWBOOK',
        destinationTag: 'auto_body',
        issueSubcategory: sub,
        issueConfidence: 0.7,
        config: {},
      } as never);
      expect(r.bodyShopSoftMention).toBe(true);
      expect(r.reasonCode).toBe('destination_auto_body');
    }
  });

  it('marks auto_body eligible AND routes it to the body-shop scenario', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'auto_body',
      issueSubcategory: 'accident_minor',
      issueConfidence: 0.7,
      config: {},
    });
    expect(r.flipEligible).toBe(true);
    expect(r.bodyShopSoftMention).toBe(true);
    expect(r.conviniIntensity).toBe('medium');
  });

  it('hard CONVINI pitch on residential destination', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'residence',
      issueSubcategory: 'mechanical',
      issueConfidence: 0.7,
      config: {},
    });
    expect(r.flipEligible).toBe(false);
    expect(r.conviniIntensity).toBe('hard');
  });

  // Policy change, 2026-08-13 (Chris): a single flat tire is low value, not no
  // value, and suppressing it handed the job to a competitor's shop for free.
  // `full_tire_set` was always eligible; this only moves genuine single-tire
  // jobs. See DEFAULT_NO_FLIP_CATEGORIES.
  it('flips a single flat tire even at high classifier confidence', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'single_tire_issue',
      issueConfidence: 0.95,
      config: {},
    });
    expect(r.flipEligible).toBe(true);
  });

  // The confidence gate itself must still work — it just has one fewer category
  // in it. Proven with a category that is still on the list.
  it('still skips flip for jump_start at high confidence', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'jump_start',
      issueConfidence: 0.9,
      config: {},
    });
    expect(r.flipEligible).toBe(false);
    expect(r.reasonCode).toContain('no_flip_category_jump_start');
  });

  it('respects per-tenant confidence threshold override', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'jump_start',
      issueConfidence: 0.7,
      config: { no_flip_confidence_threshold: 0.6 },
    });
    expect(r.flipEligible).toBe(false);
  });

  // A tenant that genuinely wants tires suppressed can still say so, without a
  // code change — the default list is only a default.
  it('lets a tenant put single_tire_issue back on its own no-flip list', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'single_tire_issue',
      issueConfidence: 0.9,
      config: { no_flip_categories: ['single_tire_issue'] },
    });
    expect(r.flipEligible).toBe(false);
  });

  it('full_tire_set proceeds with flip (full set is flip-eligible by spec)', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'full_tire_set',
      issueConfidence: 0.95,
      config: {},
    });
    expect(r.flipEligible).toBe(true);
  });

  it('mechanical + competitor repair = flip eligible', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'mechanical',
      issueConfidence: 0.85,
      config: {},
    });
    expect(r.flipEligible).toBe(true);
    expect(r.reasonCode).toContain('flip_eligible');
  });

  it('jump_start at high confidence is suppressed', () => {
    const r = decideFlip({
      source: 'AAA_PORTAL',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'jump_start',
      issueConfidence: 0.93,
      config: {},
    });
    expect(r.flipEligible).toBe(false);
  });

  it('lockout at high confidence is suppressed', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'lockout',
      issueConfidence: 0.94,
      config: {},
    });
    expect(r.flipEligible).toBe(false);
  });
});
