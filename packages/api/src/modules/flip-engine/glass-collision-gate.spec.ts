import { describe, it, expect } from 'vitest';
import { IssueClassifierService } from './issue-classifier.service';
import { decideFlip } from './flip-decision.engine';
import { renderCallBody } from './flip-scripts';

/** Scenario B is what body/glass jobs are routed to. */
const renderCallBodyB = (ctx: unknown) => renderCallBody('auto_body', ctx as never);

/**
 * Session 74 — the glass half of the collision fix was dead on arrival: the
 * orchestrator only ever passes canned issue phrases, so a regex over the free
 * text could never see the word "windshield". Glass now has to exist as a
 * classified subcategory and be refused by the decision engine.
 */
describe('collision + glass never reach a mechanical flip', () => {
  const classifier = new IssueClassifierService();
  const flip = (issueSubcategory: string, issueConfidence = 0.9) =>
    decideFlip({
      source: 'TOWBOOK',
      destinationTag: 'competitor_repair',
      issueSubcategory,
      issueConfidence,
      config: {},
    } as never);

  it('classifies a cracked windshield as glass_damage', () => {
    expect(classifier.classify({ reasonText: 'cracked windshield, needs glass' }).subcategory)
      .toBe('glass_damage');
  });

  it('classifies each glass wording', () => {
    for (const reasonText of [
      'windshield chipped',
      'rear window shattered',
      'rock chip in glass',
      'windscreen crack',
    ]) {
      expect(classifier.classify({ reasonText }).subcategory).toBe('glass_damage');
    }
  });

  it('still calls a crash a collision, not glass, when both words appear', () => {
    expect(classifier.classify({ reasonText: 'collision, windshield broken' }).subcategory)
      .toBe('accident_minor');
  });

  it('refuses the flip for glass damage', () => {
    const d = flip('glass_damage');
    expect(d.flipEligible).toBe(false);
    expect(d.reasonCode).toBeTruthy();
  });

  it('refuses the flip for a minor collision', () => {
    const d = flip('accident_minor', 0.7);
    expect(d.flipEligible).toBe(false);
    expect(d.reasonCode).toBeTruthy();
  });

  it('still allows the flip for ordinary mechanical work', () => {
    expect(flip('mechanical', 0.75).flipEligible).toBe(true);
  });

  it('still allows the flip for a full tire set', () => {
    expect(flip('full_tire_set', 0.92).flipEligible).toBe(true);
  });

  // 2026-08-13 — tires moved out of the no-flip defaults on Chris's call. The
  // point of this file is that COLLISION and GLASS stay refused regardless;
  // a flat tire is ordinary mechanical work and belongs on the ladder.
  it('flips a single flat tire — collision and glass are the guardrail, not tires', () => {
    expect(flip('single_tire_issue').flipEligible).toBe(true);
    expect(flip('accident_minor').flipEligible).toBe(false);
    expect(flip('glass_damage').flipEligible).toBe(false);
  });
});

describe('body + glass jobs get a soft referral, never a flip offer', () => {
  const base: any = {
    repName: 'Emily', companyName: 'Roadside Towing', motorClub: '',
    callbackNumber: '+16145550123', conviniLink: 'https://convini.live',
    customerFirstName: 'Pat', vehicle: '2017 Ford Escape',
    pickupLocation: 'I-70 near exit 101', destination: 'Crash Champions',
    issue: 'an accident', issueSubcategory: 'accident_minor',
    bodyShop1: 'Alpha Collision', bodyShop2: 'Westerville Body',
    nearestShop: "Wayne's Westerville", nearestShopDistanceMiles: 2,
    rentalsAvailable: true, pitchConvini: true,
  };

  it('mentions our body shops in the present tense on a live collision job', () => {
    const body = renderCallBodyB({ ...base });
    expect(body).toContain('that sounds like auto body work');
    expect(body).toContain('commitment with the insurance company to go to the current shop listed');
    expect(body).toContain('If we can ever be of help let us know');
    expect(body).toContain('Alpha Collision');
    expect(body).toContain('Westerville Body');
    expect(body).toContain("we own our own body shops");
  });

  it('says glass work for a glass job', () => {
    const body = renderCallBodyB({
      ...base,
      issue: 'glass or windshield damage',
      issueSubcategory: 'glass_damage',
    });
    expect(body).toContain('that sounds like auto glass work');
    expect(body).not.toContain('auto body work');
  });

  it('is a referral, not an offer — no discount, no diagnostic, no switch ask', () => {
    const body = renderCallBodyB({ ...base });
    // Assert the OFFER is absent, not the words — the guard instruction itself
    // legitimately names the things the agent must not say.
    expect(body).not.toContain('one quick option and then');
    expect(body).not.toContain('10 percent off the repair');
    expect(body).not.toContain("can I ask what's taking you to");
    expect(body).not.toContain('50 dollar credit');
    expect(body).toContain('This is NOT an offer');
  });

  it('reaffirms the original destination so there is nothing to decline', () => {
    const body = renderCallBodyB({ ...base });
    // 2.3 — both legs are named so the customer does not think the truck is
    // heading to the body shop instead of to them.
    expect(body).toContain('come to you at');
    expect(body).toContain('shortly');
    expect(body).toContain('Crash Champions');
  });

  it('keeps the future-tense wording for an ordinary body-shop delivery', () => {
    const body = renderCallBodyB({
      ...base,
      issue: 'a mechanical issue',
      issueSubcategory: 'mechanical',
    });
    expect(body).toContain('If we can ever be of help down the road');
  });
});
