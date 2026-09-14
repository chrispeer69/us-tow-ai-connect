import { describe, expect, it } from 'vitest';
import { renderCallBody } from './flip-scripts';
import { composeAiNotes } from './ai-notes.composer';
import { extractRetellAnalysis } from '../outbound-voice/retell-call-mapping';
import { cleanConfirmedEmail, cleanConfirmedName } from '../outbound-voice/outbound-voice.service';

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

describe('script 3.14 — ask for the email', () => {
  it('asks for the email right after the name on both arms, before the pickup', () => {
    for (const scriptVariant of ['control', 'reframe'] as const) {
      const body = renderCallBody('competitor_repair', { ...base, scriptVariant });
      const nameAt = body.indexOf('[STEP 2b — CONFIRM FULL NAME]');
      const emailAt = body.indexOf('[STEP 2c — EMAIL]');
      const pickupAt = body.indexOf('[STEP 3 — CONFIRM PICKUP LOCATION]');
      expect(emailAt, scriptVariant).toBeGreaterThan(nameAt);
      expect(pickupAt, scriptVariant).toBeGreaterThan(emailAt);
      expect(body).toContain("And what's the best email for you?");
      expect(body).toContain('Record the address exactly as the customer gave it');
    }
  });

  it('lets the email be read back once under the no-repeat rule', () => {
    const body = renderCallBody('competitor_repair', base);
    expect(body).toContain('a phone number, an email address, a shop name');
  });

  it('extracts customer_email from custom_analysis_data', () => {
    const a = extractRetellAnalysis({ custom_analysis_data: { customer_email: 'Pat.Smith@Gmail.com' } });
    expect(a.customer_email).toBe('Pat.Smith@Gmail.com');
    expect(extractRetellAnalysis({}).customer_email).toBeNull();
  });

  it('cleans a spoken email and rejects non-emails', () => {
    expect(cleanConfirmedEmail('Pat.Smith@Gmail.com')).toBe('pat.smith@gmail.com');
    expect(cleanConfirmedEmail('pat dot smith at gmail dot com')).toBe('pat.smith@gmail.com');
    expect(cleanConfirmedEmail(' d lopez77 @ yahoo.com ')).toBe('dlopez77@yahoo.com');
    for (const junk of ['unknown', 'none', 'no email', 'N/A', 'declined', 'pat smith', 'gmail.com', '', null, undefined]) {
      expect(cleanConfirmedEmail(junk), String(junk)).toBeNull();
    }
  });

  it('renders an EMAIL line on the Towbook AI note', () => {
    const block = composeAiNotes({ confirmedEmail: 'pat.smith@gmail.com', keysAndPresence: 'on scene with keys' });
    expect(block).toContain('EMAIL: pat.smith@gmail.com.');
    expect(composeAiNotes({ confirmedEmail: null, keysAndPresence: 'on scene with keys' })).not.toContain('EMAIL:');
  });
});
