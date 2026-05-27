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

  it('marks auto_body destination for body-shop soft mention', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'auto_body',
      issueSubcategory: 'accident_minor',
      issueConfidence: 0.7,
      config: {},
    });
    expect(r.flipEligible).toBe(false);
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

  it('skips flip when issue is single_tire and confidence is high (default 0.85 threshold)', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'single_tire_issue',
      issueConfidence: 0.9,
      config: {},
    });
    expect(r.flipEligible).toBe(false);
    expect(r.reasonCode).toContain('no_flip_category_single_tire_issue');
  });

  it('proceeds with flip when issue is single_tire but confidence is low', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'single_tire_issue',
      issueConfidence: 0.5,
      config: {},
    });
    expect(r.flipEligible).toBe(true);
  });

  it('respects per-tenant confidence threshold override', () => {
    const r = decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory: 'single_tire_issue',
      issueConfidence: 0.7,
      config: { no_flip_confidence_threshold: 0.6 },
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
