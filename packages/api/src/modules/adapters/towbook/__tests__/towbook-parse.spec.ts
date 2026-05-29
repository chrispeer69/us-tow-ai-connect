import { describe, it, expect, vi } from 'vitest';

// The adapter imports `chromium` at module load; stub it so importing the pure
// parse helpers doesn't require a browser.
vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));

import {
  parseColumnIdList,
  isPlausibleAddress,
  splitContact,
  assembleActiveJob,
  type TowbookRawRow,
} from '../towbook.adapter';

const NOW = '2026-05-29T00:00:00.000Z';

// Mirrors the verified DS4 columns: 2=vehicle, 4=ETA, 5=driver, 14=status,
// 22=contact. 7/8 stand in for hypothetical "Tow From"/"Tow To" columns once
// their real ids are confirmed from a live scrape.
function row(cells: Record<string, string>, dataId = 'call-1'): TowbookRawRow {
  return { dataId, cells };
}

describe('parseColumnIdList', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseColumnIdList('7, 8 ,,')).toEqual(['7', '8']);
  });
  it('returns [] for undefined/empty', () => {
    expect(parseColumnIdList(undefined)).toEqual([]);
    expect(parseColumnIdList('')).toEqual([]);
  });
});

describe('isPlausibleAddress', () => {
  it('accepts street + business-name destinations', () => {
    expect(isPlausibleAddress('123 Main St, Columbus OH 43004')).toBe(true);
    expect(isPlausibleAddress("Joe's Auto Body")).toBe(true);
  });
  it('rejects obvious non-address noise', () => {
    expect(isPlausibleAddress('')).toBe(false);
    expect(isPlausibleAddress('(614) 555-1212')).toBe(false); // phone
    expect(isPlausibleAddress('01:25')).toBe(false); // clock ETA
    expect(isPlausibleAddress('15 min')).toBe(false); // duration ETA
  });
});

describe('splitContact', () => {
  it('splits "Name (xxx) xxx-xxxx" into name + digits', () => {
    expect(splitContact('Jane Doe (614) 555-1212')).toEqual({
      name: 'Jane Doe',
      phone: '6145551212',
    });
  });
  it('returns name-only when no phone present', () => {
    expect(splitContact('Jane Doe')).toEqual({ name: 'Jane Doe', phone: '' });
  });
});

describe('assembleActiveJob', () => {
  const opts = { pickupColumnIds: ['7'], dropoffColumnIds: ['8'], nowIso: NOW };

  it('maps the verified columns (vehicle/eta/driver/status/contact) unchanged', () => {
    const job = assembleActiveJob(
      row({
        '2': '2021 Toyota Camry Blue',
        '4': '15 min',
        '5': 'Dave D',
        '14': 'Enroute',
        '22': 'Jane Doe (614) 555-1212',
      }),
      opts,
    );
    expect(job).toMatchObject({
      jobId: 'call-1',
      customerName: 'Jane Doe',
      customerPhone: '6145551212',
      vehicle: '2021 Toyota Camry Blue',
      eta: '15 min',
      driverName: 'Dave D',
      status: 'Enroute',
      lastUpdated: NOW,
    });
  });

  it('captures pickup + destination from the configured columns', () => {
    const job = assembleActiveJob(
      row({
        '22': 'Jane Doe (614) 555-1212',
        '7': '123 Tow Ln, Columbus OH',
        '8': "Joe's Auto Body, 9 Repair Rd",
      }),
      opts,
    );
    expect(job.pickup).toBe('123 Tow Ln, Columbus OH');
    expect(job.destination).toBe("Joe's Auto Body, 9 Repair Rd");
  });

  it('leaves destination empty when Towbook has no drop-off yet (tow-to TBD)', () => {
    const job = assembleActiveJob(
      row({ '22': 'Jane Doe (614) 555-1212', '7': '123 Tow Ln, Columbus OH' }),
      opts,
    );
    expect(job.pickup).toBe('123 Tow Ln, Columbus OH');
    expect(job.destination).toBe('');
  });

  it('captures nothing for addresses when no columns are configured', () => {
    const job = assembleActiveJob(
      row({ '7': '123 Tow Ln', '8': '500 Main St' }),
      { pickupColumnIds: [], dropoffColumnIds: [], nowIso: NOW },
    );
    expect(job.pickup).toBe('');
    expect(job.destination).toBe('');
  });

  it('does not let a mis-pointed column inject phone/ETA noise', () => {
    const job = assembleActiveJob(
      row({ '7': '(614) 555-1212', '8': '15 min' }),
      opts,
    );
    expect(job.pickup).toBe('');
    expect(job.destination).toBe('');
  });
});
