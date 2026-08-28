import { describe, expect, it } from 'vitest';
import { usableDestination } from './flip-orchestrator.service';

describe('usableDestination', () => {
  it('rejects a country-level geocode fallback', () => {
    // 08-27 review: "I have the destination as United States. Is that still
    // correct?" — a geocode that only resolved to the country.
    expect(usableDestination('United States')).toBeNull();
    expect(usableDestination('USA')).toBeNull();
  });

  it('rejects a dispatcher free-text non-answer', () => {
    expect(usableDestination('somewhere out of the area')).toBeNull();
    expect(usableDestination('Somewhere Out Of The Area')).toBeNull();
  });

  it('rejects null, empty, and placeholder values', () => {
    expect(usableDestination(null)).toBeNull();
    expect(usableDestination(undefined)).toBeNull();
    expect(usableDestination('  ')).toBeNull();
    expect(usableDestination('unknown')).toBeNull();
    expect(usableDestination('TBD')).toBeNull();
  });

  it('passes through a real address unchanged', () => {
    expect(usableDestination('1515 Alum Creek Drive, Columbus, OH')).toBe(
      '1515 Alum Creek Drive, Columbus, OH',
    );
  });

  it('passes through a short but real destination name', () => {
    // Must not over-reach into blocking legitimate short answers like a shop
    // name or "his house" — only the specific coarse/non-answer values above.
    expect(usableDestination("Wayne's Auto Repair")).toBe("Wayne's Auto Repair");
    expect(usableDestination('his house')).toBe('his house');
  });
});
