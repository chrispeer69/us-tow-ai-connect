import { describe, expect, it } from 'vitest';
import { isTowCompany } from './tow-company.matcher';
import { readTowCompanyEntries } from './flip-orchestrator.service';

/**
 * This gate SUPPRESSES a call. A false positive means a real motorist never
 * hears from us, which is worse than the problem it solves — so the negative
 * cases below matter more than the positive ones.
 */
const OUR_SHOPS = [
  'Roadside Towing',
  'Wrench Recovery',
  'Johns Auto Repair',
  "Ernie's Automotive Service",
  'Complete Brake Service',
  "Petty's Auto & Electric Service",
  "Wayne's Auto Repair — Westerville",
];

const check = (input: Parameters<typeof isTowCompany>[0]) =>
  isTowCompany({ neverMatch: OUR_SHOPS, ...input });

describe('isTowCompany — real names seen in production', () => {
  // Every one of these was placed as a live call in the 30 days to 2026-08-13.
  it.each([
    'Pro-Tow',
    'Pro Tow Towing & R.',
    "Carter's Towing L.",
    'Mvp Impound And T.',
    "Long's Towing I.",
    'Llc Of Mt Gilead 24/7 Towing & R.',
    "Woody's Towing S.",
    'Eastland Towing',
    'Salvage At Repair Facility Tow Yard',
    'Mahr Towing And Recovery L.',
    'Shamrock Towing I.',
  ])('flags %s', (name) => {
    const r = check({ customerName: name });
    expect(r.matched).toBe(true);
    expect(r.field).toBe('customer_name');
  });
});

describe('isTowCompany — must never fire', () => {
  // Wrench Recovery is the reason "recovery" is not a token on its own.
  it('never flags our own partner shops', () => {
    for (const shop of OUR_SHOPS) {
      expect(check({ customerName: shop }).matched).toBe(false);
      expect(check({ pickupName: shop }).matched).toBe(false);
    }
  });

  it('never flags the tenant itself, despite "Towing" in the name', () => {
    expect(check({ customerName: 'Roadside Towing' }).matched).toBe(false);
  });

  it.each([
    'Chris Peer',
    'Regina Flory',
    'Koku E A.',
    'Toyota Service Center',
    'Caliber Collision',
    'Gerber Collision & Glass',
    "Jay's Diesel Performance",
    'Tire Discounters',
    'Auto Recovery Services', // "recovery" alone must not fire
    'Townsend', // must not trip the "tow" prefix
    'Towne Center Auto',
  ])('does not flag %s', (name) => {
    expect(check({ customerName: name }).matched).toBe(false);
  });

  // A street name must never silence a customer call.
  it('ignores tow words appearing only in an address', () => {
    expect(
      check({ customerName: 'Sarah Miller', pickupAddress: '123 Towing Lane, Columbus OH' })
        .matched,
    ).toBe(false);
  });
});

describe('isTowCompany — operator list', () => {
  const entries = [
    { matchType: 'EXACT_ADDRESS' as const, matchValue: '1450 Joyce Ave, Columbus, OH 43219', active: true },
    { matchType: 'EXACT_NAME' as const, matchValue: 'Buckeye Vehicle Storage', active: true },
    { matchType: 'PHONE' as const, matchValue: '(614) 555-0100', active: true },
    { matchType: 'NAME_PATTERN' as const, matchValue: 'city impound', active: false },
  ];

  it('matches an exact yard address that no token would catch', () => {
    const r = check({ customerName: 'Unknown', pickupAddress: '1450 Joyce Ave, Columbus, OH 43219', entries });
    expect(r).toMatchObject({ matched: true, rule: 'exact_address', field: 'pickup_address' });
  });

  it('matches a listed yard whose name contains no tow word', () => {
    const r = check({ customerName: 'Buckeye Vehicle Storage', entries });
    expect(r).toMatchObject({ matched: true, rule: 'exact_name' });
  });

  it('matches on phone, normalising formatting', () => {
    const r = check({ customerName: 'Unknown', customerPhone: '6145550100', entries });
    expect(r).toMatchObject({ matched: true, rule: 'phone' });
  });

  it('ignores inactive entries', () => {
    expect(check({ customerName: 'City Impound Annex', entries: [entries[3]] }).rule)
      .not.toBe('name_pattern');
  });

  it('will not let a list entry override one of our own shops', () => {
    const r = check({
      customerName: 'Wrench Recovery',
      entries: [{ matchType: 'EXACT_NAME', matchValue: 'Wrench Recovery', active: true }],
    });
    expect(r.matched).toBe(false);
  });
});

describe('readTowCompanyEntries — config parsing', () => {
  it('accepts a pasted list, defaulting active to true', () => {
    const out = readTowCompanyEntries(
      {
        tow_company_list: [
          { matchType: 'EXACT_NAME', matchValue: '  Buckeye Vehicle Storage  ' },
          { matchType: 'PHONE', matchValue: '614-555-0100', active: false },
        ],
      },
      {},
    );
    expect(out).toEqual([
      { matchType: 'EXACT_NAME', matchValue: 'Buckeye Vehicle Storage', active: true },
      { matchType: 'PHONE', matchValue: '614-555-0100', active: false },
    ]);
  });

  // A malformed row must be dropped, not coerced — a bad entry silences calls.
  it('drops malformed rows instead of guessing', () => {
    const out = readTowCompanyEntries(
      {
        tow_company_list: [
          { matchType: 'NOPE', matchValue: 'x' },
          { matchType: 'EXACT_NAME', matchValue: '   ' },
          { matchValue: 'no type' },
          'a string',
          null,
          { matchType: 'EXACT_NAME', matchValue: 'Valid Yard' },
        ],
      },
      {},
    );
    expect(out).toEqual([{ matchType: 'EXACT_NAME', matchValue: 'Valid Yard', active: true }]);
  });

  it('falls back to the global list only when the tenant has none', () => {
    const global = { tow_company_list: [{ matchType: 'EXACT_NAME', matchValue: 'Global Yard' }] };
    expect(readTowCompanyEntries({ tow_company_list: [] }, global)[0].matchValue).toBe('Global Yard');
    expect(
      readTowCompanyEntries({ tow_company_list: [{ matchType: 'EXACT_NAME', matchValue: 'Tenant Yard' }] }, global)[0]
        .matchValue,
    ).toBe('Tenant Yard');
  });

  it('returns an empty list when nothing is configured', () => {
    expect(readTowCompanyEntries(null, undefined)).toEqual([]);
  });
});
