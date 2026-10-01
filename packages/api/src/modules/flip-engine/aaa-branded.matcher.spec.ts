import { describe, it, expect } from 'vitest';
import { isAaaBrandedShop, type BlocklistEntry } from './aaa-branded.matcher';

describe('isAaaBrandedShop — hard guardrail', () => {
  it('no longer blocks AAA-branded shops on their name alone (AAA contract ended 2026-10-01)', () => {
    expect(isAaaBrandedShop({ destinationName: 'AAA Car Care Plus - Columbus' }).matched).toBe(false);
  });

  it('no longer blocks "aaa auto repair" with an empty blocklist', () => {
    expect(isAaaBrandedShop({ destinationName: 'aaa auto repair' }).matched).toBe(false);
  });

  it('does NOT block "Maaco Collision" (substring AAA inside another word)', () => {
    // Maaco doesn't actually contain AAA, but this test enforces the
    // standalone-word rule against any name where AAA might happen to
    // appear as a substring of another word.
    const r = isAaaBrandedShop({ destinationName: 'Maaaco Collision Repair' });
    expect(r.matched).toBe(false);
  });

  it('does NOT block "Midas Auto Repair" (no AAA at all)', () => {
    const r = isAaaBrandedShop({ destinationName: 'Midas Auto Repair' });
    expect(r.matched).toBe(false);
  });

  it('does NOT block when only address contains "AAA" but name is empty/safe', () => {
    // The standalone-word check applies to the business name, not the
    // address. AAA is sometimes in street names (e.g., "AAA Way") which
    // is not the signal we want.
    const r = isAaaBrandedShop({
      destinationName: 'Joe\u2019s Garage',
      destinationAddress: '123 AAA Way, Columbus OH',
    });
    expect(r.matched).toBe(false);
  });

  it('blocks via NAME_PATTERN substring match in the blocklist', () => {
    const blocklist: BlocklistEntry[] = [
      { matchType: 'NAME_PATTERN', matchValue: 'Car Care Plus', active: true },
    ];
    const r = isAaaBrandedShop({
      destinationName: 'Joe Car Care Plus',
      blocklist,
    });
    expect(r.matched).toBe(true);
    expect(r.rule).toBe('name_pattern');
    expect(r.matchedValue).toBe('Car Care Plus');
  });

  it('blocks via EXACT_NAME equality (case-insensitive)', () => {
    const blocklist: BlocklistEntry[] = [
      { matchType: 'EXACT_NAME', matchValue: 'Approved Repair Shop', active: true },
    ];
    const r = isAaaBrandedShop({ destinationName: 'approved repair shop', blocklist });
    expect(r.matched).toBe(true);
    expect(r.rule).toBe('exact_name');
  });

  it('blocks via EXACT_ADDRESS equality', () => {
    const blocklist: BlocklistEntry[] = [
      {
        matchType: 'EXACT_ADDRESS',
        matchValue: '100 Main St, Columbus OH',
        active: true,
      },
    ];
    const r = isAaaBrandedShop({
      destinationName: 'Some Repair',
      destinationAddress: '100 Main St, Columbus OH',
      blocklist,
    });
    expect(r.matched).toBe(true);
    expect(r.rule).toBe('exact_address');
  });

  it('blocks via PHONE digits-only equality', () => {
    const blocklist: BlocklistEntry[] = [
      { matchType: 'PHONE', matchValue: '+1 (614) 555-1212', active: true },
    ];
    const r = isAaaBrandedShop({
      destinationName: 'Some Repair',
      destinationPhone: '6145551212',
      blocklist,
    });
    expect(r.matched).toBe(true);
    expect(r.rule).toBe('phone');
  });

  it('ignores inactive blocklist entries', () => {
    const blocklist: BlocklistEntry[] = [
      { matchType: 'NAME_PATTERN', matchValue: 'Car Care', active: false },
    ];
    const r = isAaaBrandedShop({ destinationName: 'Joe Car Care Plus', blocklist });
    expect(r.matched).toBe(false);
  });

  it('returns matched=false when no signals exist at all', () => {
    const r = isAaaBrandedShop({});
    expect(r.matched).toBe(false);
    expect(r.rule).toBeNull();
  });

  it('with an empty blocklist nothing AAA-named is blocked', () => {
    expect(isAaaBrandedShop({ destinationName: 'AAA Tire & Auto' }).matched).toBe(false);
    expect(isAaaBrandedShop({ destinationName: 'Aaa Service Center' }).matched).toBe(false);
  });

  it('regex is anchored to a word boundary so single A or AA do not match', () => {
    expect(isAaaBrandedShop({ destinationName: 'A&A Auto' }).matched).toBe(false);
    expect(isAaaBrandedShop({ destinationName: 'AA Tires' }).matched).toBe(false);
  });
});
