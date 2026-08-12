import { describe, it, expect } from 'vitest';
import { IssueClassifierService } from './issue-classifier.service';
import { decideFlip } from './flip-decision.engine';

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

  it('still refuses a single flat tire', () => {
    expect(flip('single_tire_issue').flipEligible).toBe(false);
  });
});
