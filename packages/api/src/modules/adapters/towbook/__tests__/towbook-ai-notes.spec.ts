import { describe, it, expect } from 'vitest';
import {
  cssEscapeAttr,
  digitsOf,
  looksLikeCardData,
} from '../towbook.adapter';

/**
 * The Update Call modal holds raw cardholder data in its Billing Notes field —
 * full PAN, expiry, security code, billing ZIP (observed 2026-08-15). Storing a
 * security code after authorization is prohibited under PCI DSS. That is
 * Towbook's problem to own, but it constrains us absolutely: we must never read,
 * write, log or persist any of it.
 *
 * `looksLikeCardData` is the tripwire on both sides of the write — on the block
 * we are about to append, and on whatever we just read out of the field. If the
 * Notes selector is ever mis-configured onto a billing field, this is what turns
 * a data-leak into an aborted write. It is deliberately blunt: a false positive
 * costs one skipped note, a false negative writes a card number into a ticket.
 */
describe('looksLikeCardData', () => {
  it('catches a bare PAN', () => {
    expect(looksLikeCardData('4111111111111111')).toBe(true); // Visa test number
    expect(looksLikeCardData('5500005555555559')).toBe(true); // Mastercard test
  });

  it('catches a PAN formatted the way people type it', () => {
    expect(looksLikeCardData('4111 1111 1111 1111')).toBe(true);
    expect(looksLikeCardData('4111-1111-1111-1111')).toBe(true);
    expect(looksLikeCardData('card on file 4111 1111 1111 1111 exp 04/29')).toBe(true);
  });

  it('catches the labels even without a valid number', () => {
    expect(looksLikeCardData('Security Code: 419')).toBe(true);
    expect(looksLikeCardData('CVV 123')).toBe(true);
    expect(looksLikeCardData('Card Number on file')).toBe(true);
    expect(looksLikeCardData('expiration date 03/28')).toBe(true);
  });

  it('does NOT fire on the AI Notes blocks we actually write', () => {
    const realBlock = [
      '--- AI Notes (2026-08-17 06:36 ET) ---',
      'Destination confirmed by customer: 585 Oakland Park Avenue, Columbus.',
      'KEYS: Customer will be on scene with the keys.',
      'ACCESS: Parking lot, nose out.',
      'CONDITION: All four tires up.',
      'VEHICLE: White, drivetrain unknown.',
      'ISSUE: Car will not start, not the battery.',
      'NOTES: Corrected pickup from 766 to 763 South Richardson Avenue; car is in the alley behind.',
    ].join('\n');
    expect(looksLikeCardData(realBlock)).toBe(false);
  });

  it('does not fire on ordinary long digit strings', () => {
    // A 9-digit Towbook job id, a phone number, a ZIP+4 — all shorter than a PAN
    // or failing Luhn, which is exactly what the check is for.
    expect(looksLikeCardData('job 278515215')).toBe(false);
    expect(looksLikeCardData('call them on (614) 471-0505')).toBe(false);
    expect(looksLikeCardData('43219-1234')).toBe(false);
    expect(looksLikeCardData('1234567890123456')).toBe(false); // 16 digits, fails Luhn
  });

  it('is false for empty input', () => {
    expect(looksLikeCardData('')).toBe(false);
    expect(looksLikeCardData(null)).toBe(false);
    expect(looksLikeCardData(undefined)).toBe(false);
  });
});

describe('digitsOf', () => {
  it('strips formatting so two systems can be compared', () => {
    expect(digitsOf('(614) 471-0505')).toBe('6144710505');
    expect(digitsOf('+1 614 471 0505')).toBe('16144710505');
  });

  it('is empty for nullish input', () => {
    expect(digitsOf(null)).toBe('');
    expect(digitsOf(undefined)).toBe('');
  });
});

describe('cssEscapeAttr', () => {
  it('escapes quotes so an external job id cannot break the selector', () => {
    // source_job_id comes from someone else's system and is interpolated into an
    // attribute selector. An unescaped quote would widen or break the match —
    // and a widened match is a write onto the wrong customer's ticket.
    expect(cssEscapeAttr('278515215')).toBe('278515215');
    expect(cssEscapeAttr('12"34')).toBe('12\\"34');
    expect(cssEscapeAttr('12\\34')).toBe('12\\\\34');
  });
});
