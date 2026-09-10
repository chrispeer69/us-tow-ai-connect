import { describe, expect, it } from 'vitest';
import { renderCallBody } from './flip-scripts';
import { composeAiNotes } from './ai-notes.composer';
import { extractRetellAnalysis } from '../outbound-voice/retell-call-mapping';
import { cleanConfirmedName } from '../outbound-voice/outbound-voice.service';

const base = {
  repName: 'Emily',
  companyName: 'Roadside Towing',
  motorClub: '',
  callbackNumber: '+15551234567',
  conviniLink: 'https://convini.live',
  customerFirstName: 'Pat',
  customerFullName: 'Pat Smith',
  vehicle: '2017 Ford Escape',
  pickupLocation: 'I-70 near exit 101',
  destination: 'Firestone on Main',
  issue: 'a check engine light',
  nearestShop: "Wayne's Westerville",
  nearestShopDistanceMiles: 2,
  rentalsAvailable: true,
};

describe('script 3.13 — confirm the full name', () => {
  it('confirms a full name the ticket already carries', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('[STEP 2b — CONFIRM FULL NAME]');
    expect(body).toContain('I have you down as Pat Smith — is that right?');
    expect(body).toContain('Record the first and last name exactly as the customer gave them');
  });

  it('asks for the last name when the ticket only has a first name', () => {
    const body = renderCallBody('competitor_repair', { ...base, customerFullName: 'Pat' });
    expect(body).toContain('And can I get your last name, so the driver has it right?');
    expect(body).not.toContain('I have you down as');
  });

  it('asks for both names when the ticket name is unusable', () => {
    const body = renderCallBody('competitor_repair', {
      ...base,
      customerFirstName: 'Salvage',
      customerFullName: 'Salvage Account',
    });
    expect(body).toContain('And can I get your first and last name for the driver?');
    expect(body).not.toContain('Salvage');
  });

  it('runs the name step before the pickup confirmation on both arms', () => {
    for (const scriptVariant of ['control', 'reframe'] as const) {
      const body = renderCallBody('competitor_repair', { ...base, scriptVariant });
      const nameAt = body.indexOf('[STEP 2b — CONFIRM FULL NAME]');
      const pickupAt = body.indexOf('[STEP 3 — CONFIRM PICKUP LOCATION]');
      expect(nameAt, scriptVariant).toBeGreaterThan(-1);
      expect(pickupAt, scriptVariant).toBeGreaterThan(nameAt);
    }
  });

  it('lets the name be read back once under the no-repeat rule', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain("a shop name, or the customer's own name. Read those back once");
  });
});

describe('3.13 — post-call name fields', () => {
  it('extracts customer_first_name / customer_last_name from custom_analysis_data', () => {
    const fields = extractRetellAnalysis({
      custom_analysis_data: { customer_first_name: 'Pat', customer_last_name: 'Smith' },
    });
    expect(fields.customer_first_name).toBe('Pat');
    expect(fields.customer_last_name).toBe('Smith');
  });

  it('cleans a spoken name and rejects non-names', () => {
    expect(cleanConfirmedName('smith')).toBe('Smith');
    expect(cleanConfirmedName("  o'brien ")).toBe("O'brien");
    expect(cleanConfirmedName('McDonald')).toBe('McDonald');
    for (const junk of ['unknown', 'N/A', 'none', '', ' ', 'x', '12345', 'declined', null, undefined, 'there']) {
      expect(cleanConfirmedName(junk), String(junk)).toBeNull();
    }
  });
});

describe('3.13 — NAME line on the Towbook AI note', () => {
  it('renders when the confirmed name differs from the ticket', () => {
    const block = composeAiNotes({ confirmedName: 'Pat Smith', ticketName: 'Pat' });
    expect(block).toContain('NAME: Pat Smith (ticket had "Pat").');
  });

  it('stays silent when the ticket already had the same name', () => {
    const block = composeAiNotes({ confirmedName: 'Pat Smith', ticketName: 'pat smith' });
    expect(block ?? '').not.toContain('NAME:');
  });

  it('renders without the ticket clause when the ticket had no name', () => {
    const block = composeAiNotes({ confirmedName: 'Pat Smith', ticketName: null });
    expect(block).toContain('NAME: Pat Smith.');
  });
});
