import { describe, it, expect, beforeEach } from 'vitest';
import { IssueClassifierService } from './issue-classifier.service';

describe('IssueClassifierService.classify', () => {
  let svc: IssueClassifierService;
  beforeEach(() => {
    svc = new IssueClassifierService();
  });

  it('classifies single flat tire as single_tire_issue', () => {
    const r = svc.classify({ reasonText: 'Customer has a flat rear tire' });
    expect(r.subcategory).toBe('single_tire_issue');
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('promotes single tire mention to full_tire_set when "all four" is present', () => {
    const r = svc.classify({ reasonText: 'flat tire and needs all four replaced' });
    expect(r.subcategory).toBe('full_tire_set');
  });

  it('classifies "needs full set of tires" as full_tire_set', () => {
    const r = svc.classify({ reasonText: 'Needs full set of tires installed' });
    expect(r.subcategory).toBe('full_tire_set');
  });

  it('classifies dead battery as jump_start', () => {
    const r = svc.classify({ reasonText: 'Dead battery, needs a jump' });
    expect(r.subcategory).toBe('jump_start');
  });

  it('classifies lockout', () => {
    const r = svc.classify({ reasonText: 'Locked keys in car' });
    expect(r.subcategory).toBe('lockout');
  });

  it('classifies fuel delivery', () => {
    const r = svc.classify({ reasonText: 'Out of gas on highway' });
    expect(r.subcategory).toBe('fuel_delivery');
  });

  it('classifies winch out / recovery', () => {
    const r = svc.classify({ reasonText: 'Vehicle stuck in mud, needs winch out' });
    expect(r.subcategory).toBe('winch_out');
  });

  it('classifies common winch-out descriptions', () => {
    const r = svc.classify({ reasonText: 'Customer slid off road and is stuck on rocks' });
    expect(r.subcategory).toBe('winch_out');
    expect(r.signals).toContain('winch_kw');
  });

  it('classifies airbag deployment', () => {
    const r = svc.classify({ reasonText: 'Accident with airbags deployed' });
    expect(r.subcategory).toBe('accident_with_airbags');
  });

  it('classifies generic accident as accident_minor', () => {
    const r = svc.classify({ reasonText: 'Fender bender, no injuries' });
    expect(r.subcategory).toBe('accident_minor');
  });

  it('classifies generic mechanical as mechanical', () => {
    const r = svc.classify({ reasonText: "Won't start, transmission noise" });
    expect(r.subcategory).toBe('mechanical');
  });

  it('returns unknown with low confidence on empty input', () => {
    const r = svc.classify({});
    expect(r.subcategory).toBe('unknown');
    expect(r.confidence).toBeLessThanOrEqual(0.5);
  });
});
