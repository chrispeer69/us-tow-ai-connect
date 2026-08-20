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

// 2026-08-18 — Chris opened the body-shop pitch. These tests previously locked
// in "never an offer", which was correct while we had nowhere to send a
// collision job and stopped being correct when Excite Collision and T&C went
// live. What must NOT change is the rest of the guardrail: one ask, no price,
// no discount, no insurance advice, and no ladder.
describe('body + glass jobs get ONE soft offer, and never a price or a ladder', () => {
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
    expect(body).toContain("I'm glad you're okay");
    // 3.6 — the safe lane. The insurer is never named, and the customer is
    // never told what is or is not their call.
    expect(body).not.toContain('insurance company may have already lined');
    expect(body).not.toContain('entirely your call');
    // Passive availability: a statement, not an ask.
    expect(body).toContain('free estimate reviews');
    expect(body).toContain("I'm texting you the info");
    expect(body).not.toContain('Would you like me to send it to one of ours instead');
    // Option 3 deliberately does NOT name our shops on a live collision — the
    // whole point is zero interference at tow time. The names ride the text
    // and the Option 4 (undecided) branch instead.
    expect(body).not.toContain('Alpha Collision');
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

  it('asks once, and never carries mechanical offer terms onto a body job', () => {
    const body = renderCallBodyB({ ...base });
    // The ask exists now...
    // 3.6 — statement, not an ask.
    expect(body).toContain("I'm texting you the info");
    expect(body).not.toContain('Would you like me to send it to one of ours instead');
    // ...but none of the mechanical ladder comes with it. These are the terms of
    // a DIFFERENT offer and quoting them on body work invents a commitment.
    expect(body).not.toContain('one quick option and then');
    expect(body).not.toContain('10 percent off the repair');
    expect(body).not.toContain('50 dollar credit');
    expect(body).not.toContain('free visual mechanical diagnostic');
    expect(body).not.toContain('179');
    // And there is no ladder: offer 2's reframe question must not appear.
    expect(body).not.toContain("can I ask what's taking you to");
    expect(body).toContain('accept on the FIRST no');
    expect(body).toContain('THE LADDER IS DISABLED');
  });

  it('refuses to advise on insurance, and gates the accept', () => {
    const body = renderCallBodyB({ ...base });
    expect(body).toContain('THE SAFE LANE');
    expect(body).toContain('Never say what their policy allows');
    expect(body).toContain('THE LADDER IS DISABLED ON THIS SCENARIO');
    expect(body).toContain('GATE');
    // A hedge is a no. A body job changed on a shrug has to be unwound.
    expect(body).toContain('is a NO');
  });

  it('still reaffirms both legs when the offer is declined', () => {
    const body = renderCallBodyB({ ...base });
    // 2.3 — both legs are named so the customer does not think the truck is
    // heading to the body shop instead of to them. Chris's 2026-08-12 line.
    //
    // It moved on 08-18: it used to sit inside the mention, which was right
    // while there was nothing to decline. With a real question in front of it,
    // stating the plan BEFORE the ask pre-empts the answer, so it now sits on
    // the decline path. The reassurance must survive the move.
    expect(body).toContain('come to you at');
    expect(body).toContain('shortly');
    expect(body).toContain('Crash Champions');
    // ...and it must come AFTER the ask, not before it.
    expect(body.indexOf('Would you like me to send it')).toBeLessThan(
      body.indexOf('come to you at'),
    );
  });

  it('makes the same single ask on an ordinary body-shop delivery', () => {
    const body = renderCallBodyB({
      ...base,
      issue: 'a mechanical issue',
      issueSubcategory: 'mechanical',
    });
    // 3.6 — statement, not an ask.
    expect(body).toContain("I'm texting you the info");
    expect(body).not.toContain('Would you like me to send it to one of ours instead');
    // No live-collision framing on a job that is not one, and no insurance
    // line when there is no insurer in the picture.
    expect(body).not.toContain('that sounds like auto body work');
  });
});
