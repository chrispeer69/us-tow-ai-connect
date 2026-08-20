import { describe, expect, it } from 'vitest';
import {
  isWithinCallWindow,
  localTimeAt,
  normalizePhone,
  timezoneForAreaCode,
} from './phone-normalize';

describe('normalizePhone tolerates real paste', () => {
  it.each([
    ['6145550100', '+16145550100'],
    ['614-555-0100', '+16145550100'],
    ['(614) 555-0100', '+16145550100'],
    ['+1 614 555 0100', '+16145550100'],
    ['1-614-555-0100', '+16145550100'],
    ['614.555.0100', '+16145550100'],
    ['  614 555 0100  ', '+16145550100'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input).e164).toBe(expected);
  });

  it('keeps an extension out of the number', () => {
    // Without this, "x204" merges into the digits and the row becomes a
    // plausible-looking wrong number rather than an obvious reject.
    const result = normalizePhone('614-555-0100 x204');
    expect(result.e164).toBe('+16145550100');
    expect(result.extension).toBe('204');
  });

  it('handles ext. and # markers', () => {
    expect(normalizePhone('6145550100 ext. 12').e164).toBe('+16145550100');
    expect(normalizePhone('6145550100 #7').extension).toBe('7');
  });

  it('ignores trailing labels', () => {
    expect(normalizePhone('614.555.0100 (cell)').e164).toBe('+16145550100');
  });
});

describe('normalizePhone rejects what should never be dialled', () => {
  it.each([
    ['', 'empty'],
    ['not a phone', 'no_digits'],
    ['555-0100', 'too_short_7'],
    ['114-555-0100', 'invalid_area_code'],
    ['614-155-0100', 'invalid_exchange'],
    // N11 service codes are caught by their own rule, which is a more useful
    // reason on the ingest report than a generic "invalid area code".
    ['411-555-0100', 'service_code'],
    ['911-555-0100', 'service_code'],
  ])('%s -> %s', (input, reason) => {
    const result = normalizePhone(input);
    expect(result.e164).toBeNull();
    expect(result.reason).toBe(reason);
  });

  it('rejects toll-free — a campaign must not dial an 800 number', () => {
    expect(normalizePhone('800-555-0100').reason).toBe('non_geographic');
    expect(normalizePhone('844-701-1345').reason).toBe('non_geographic');
  });

  it('rejects premium rate', () => {
    expect(normalizePhone('900-555-0100').reason).toBe('non_geographic');
  });

  it('rejects Canadian numbers — CAN Tow Alliance is a separate list', () => {
    expect(normalizePhone('416-555-0100').reason).toBe('canada_out_of_scope');
    expect(normalizePhone('604-555-0100').reason).toBe('canada_out_of_scope');
  });
});

describe('area code timezones', () => {
  it.each([
    ['614', 'America/New_York'],   // Columbus
    ['212', 'America/New_York'],
    ['312', 'America/Chicago'],
    ['303', 'America/Denver'],
    ['602', 'America/Phoenix'],    // no DST
    ['213', 'America/Los_Angeles'],
    ['907', 'America/Anchorage'],
    ['808', 'Pacific/Honolulu'],
  ])('%s -> %s', (code, zone) => {
    expect(timezoneForAreaCode(code)).toBe(zone);
  });

  it('resolves split area codes to the LATER zone', () => {
    // Deliberate safety bias: a late dial is a lost call, an early dial is a
    // 7am cold call to somebody's mobile.
    expect(timezoneForAreaCode('208')).toBe('America/Denver');
    expect(timezoneForAreaCode('509')).toBe('America/Los_Angeles');
    expect(timezoneForAreaCode('850')).toBe('America/Chicago');
  });

  it('attaches the timezone during normalization', () => {
    expect(normalizePhone('614-555-0100').timezone).toBe('America/New_York');
    expect(normalizePhone('213-555-0100').timezone).toBe('America/Los_Angeles');
  });
});

describe('the calling window is local to the called number', () => {
  const window = { startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] };

  // 2026-08-20 is a Thursday. 15:00 UTC = 11:00 ET = 08:00 PT.
  const thursdayMidMorningET = new Date('2026-08-20T15:00:00Z');

  it('allows a call at 11am Eastern', () => {
    const result = isWithinCallWindow('America/New_York', window, thursdayMidMorningET);
    expect(result.allowed).toBe(true);
  });

  it('BLOCKS the same instant for a Pacific number — it is 8am there', () => {
    // This is the whole point of per-number timezones. A server-clock window
    // would have dialled California at 8am.
    const result = isWithinCallWindow('America/Los_Angeles', window, thursdayMidMorningET);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('outside_call_hours');
  });

  it('blocks weekends', () => {
    const saturday = new Date('2026-08-22T15:00:00Z');
    const result = isWithinCallWindow('America/New_York', window, saturday);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('outside_call_days');
  });

  it('refuses to dial an unknown timezone rather than guessing', () => {
    const result = isWithinCallWindow(null, window, thursdayMidMorningET);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('unknown_timezone');
  });

  it('blocks after 5pm local', () => {
    // 22:00 UTC = 18:00 ET
    const evening = new Date('2026-08-20T22:00:00Z');
    expect(isWithinCallWindow('America/New_York', window, evening).allowed).toBe(false);
    // ...but it is 15:00 PT, which is still inside the window.
    expect(isWithinCallWindow('America/Los_Angeles', window, evening).allowed).toBe(true);
  });
});

describe('localTimeAt', () => {
  it('reads the hour and ISO weekday in the target zone', () => {
    const t = localTimeAt('America/New_York', new Date('2026-08-20T15:00:00Z'));
    expect(t.hour).toBe(11);
    expect(t.isoWeekday).toBe(4); // Thursday
  });

  it('renders midnight as hour 0, not 24', () => {
    const t = localTimeAt('America/New_York', new Date('2026-08-20T04:00:00Z'));
    expect(t.hour).toBe(0);
  });
});
