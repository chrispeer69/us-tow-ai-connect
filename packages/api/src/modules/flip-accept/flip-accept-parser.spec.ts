import { describe, it, expect } from 'vitest';
import { parseFlipReply } from './flip-accept-parser';

describe('parseFlipReply', () => {
  it('treats a bare YES as approve with no notes', () => {
    expect(parseFlipReply('YES')).toEqual({ kind: 'approve', notes: null });
    expect(parseFlipReply('yes')).toEqual({ kind: 'approve', notes: null });
    expect(parseFlipReply('   Yes   ')).toEqual({ kind: 'approve', notes: null });
  });

  it('captures notes after YES NOTE / YES NOTES', () => {
    expect(parseFlipReply('YES NOTE CALL CUSTOMER BEFORE ARRIVAL')).toEqual({
      kind: 'approve',
      notes: 'CALL CUSTOMER BEFORE ARRIVAL',
    });
    expect(parseFlipReply('YES NOTES: BRING DOLLY')).toEqual({
      kind: 'approve',
      notes: 'BRING DOLLY',
    });
  });

  it('treats free-form text after YES as notes even without the NOTE keyword', () => {
    expect(parseFlipReply('YES bring extra straps')).toEqual({
      kind: 'approve',
      notes: 'bring extra straps',
    });
  });

  it('parses a bare NO as decline with no reason', () => {
    expect(parseFlipReply('NO')).toEqual({ kind: 'decline', reason: null });
  });

  it('captures reason after NO / NO REASON', () => {
    expect(parseFlipReply('NO REASON wrong area')).toEqual({
      kind: 'decline',
      reason: 'wrong area',
    });
    expect(parseFlipReply('NO too far')).toEqual({
      kind: 'decline',
      reason: 'too far',
    });
  });

  it('returns unknown for unrelated text and STOP keywords', () => {
    expect(parseFlipReply('maybe later')).toEqual({ kind: 'unknown' });
    expect(parseFlipReply('STOP')).toEqual({ kind: 'unknown' });
    expect(parseFlipReply('')).toEqual({ kind: 'unknown' });
  });
});
