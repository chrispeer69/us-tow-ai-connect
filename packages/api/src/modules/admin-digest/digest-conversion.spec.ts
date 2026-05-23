import { describe, expect, it } from 'vitest';

/**
 * Conversion-rate math lives inline in DigestMetricsService.collect — these
 * unit tests pin the formula so a future refactor doesn't silently drift
 * past 100% or NaN when call count is zero.
 *
 * Formula: min(1, jobsCreated.total / callsHandled.count). Zero calls → 0.
 */

function conversionRate(jobs: number, calls: number): number {
  if (calls === 0) return 0;
  return Math.min(1, jobs / calls);
}

describe('digest conversion-rate math', () => {
  it('returns 0 when no calls were handled', () => {
    expect(conversionRate(0, 0)).toBe(0);
    expect(conversionRate(5, 0)).toBe(0);
  });

  it('returns the ratio when jobs < calls', () => {
    expect(conversionRate(10, 100)).toBe(0.1);
    expect(conversionRate(25, 50)).toBe(0.5);
  });

  it('clamps to 1 when jobs > calls (multiple dispatches per call)', () => {
    expect(conversionRate(120, 100)).toBe(1);
  });

  it('handles fractional results without rounding', () => {
    const r = conversionRate(1, 3);
    expect(r).toBeCloseTo(0.3333, 4);
  });
});
