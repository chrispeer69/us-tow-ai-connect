import { describe, expect, it } from 'vitest';
import { motorClubCallerFields, motorClubForCallerId } from './motor-club-callers';

describe('motorClubForCallerId', () => {
  it('recognises the Agero block in every common format', () => {
    expect(motorClubForCallerId('+15207334612')).toBe('Agero');
    expect(motorClubForCallerId('15207334699')).toBe('Agero');
    expect(motorClubForCallerId('(520) 733-4001')).toBe('Agero');
  });

  it('does not treat the rest of 520-733 as Agero', () => {
    expect(motorClubForCallerId('+15207331234')).toBeNull();
  });

  it('recognises Allstate, AAA and the likely-Agero 332 block', () => {
    expect(motorClubForCallerId('+17275400000')).toBe('Allstate');
    expect(motorClubForCallerId('+18002221111')).toBe('AAA');
    expect(motorClubForCallerId('+13322305555')).toBe('Agero (likely)');
  });

  it('returns null for customers, blanks and short numbers', () => {
    expect(motorClubForCallerId('+16146337935')).toBeNull();
    expect(motorClubForCallerId(null)).toBeNull();
    expect(motorClubForCallerId('')).toBeNull();
    expect(motorClubForCallerId('5207334')).toBeNull();
  });
});

describe('motorClubCallerFields', () => {
  it('adds nothing for a customer', () => {
    expect(motorClubCallerFields('+16145551234')).toEqual({});
  });

  it('tells Emily the club and to ask for the PO', () => {
    const f = motorClubCallerFields('+15207334612');
    expect(f.motor_club_caller).toBe('Agero');
    expect(f.motor_club_note).toMatch(/PO/);
  });
});
