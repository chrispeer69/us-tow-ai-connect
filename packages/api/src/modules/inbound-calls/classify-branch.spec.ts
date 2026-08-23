import { describe, expect, it } from 'vitest';
import { classifyBranch } from './inbound-call.controller';

/**
 * The 844 line now runs three different conversations, and "how often does each
 * one happen, and how often does it go wrong" is the question Chris will ask
 * first. That number is only trustworthy if the classifier is.
 *
 * The agent's own post-call answer wins when it gives one. The transcript
 * fallback exists because post-call analysis is not configured on this agent
 * today, and an unclassified call is a call nobody reviews.
 */

describe('the agent’s own answer wins', () => {
  it('takes call_branch over anything in the transcript', () => {
    // Transcript looks like a new tow; the agent says motor club. Believe the
    // agent — it was on the call and the regex was not.
    expect(
      classifyBranch({ call_branch: 'motor_club' }, 'i need a tow, i broke down'),
    ).toBe('motor_club');
  });

  it('accepts the looser wording a model actually emits', () => {
    expect(classifyBranch({ branch: 'New Tow Request' }, undefined)).toBe('new_tow');
    expect(classifyBranch({ call_branch: 'existing job update' }, undefined)).toBe('update');
  });
});

describe('falling back to the transcript', () => {
  it('reads a purchase order as a motor club', () => {
    expect(classifyBranch(undefined, 'Hi, calling from Agero with a purchase order for you')).toBe(
      'motor_club',
    );
  });

  it('reads a breakdown as a new tow', () => {
    expect(classifyBranch(undefined, "My car won't start and I'm stuck at work")).toBe('new_tow');
    expect(classifyBranch(undefined, 'I locked out my keys')).toBe('new_tow');
  });

  it('reads a status chase as an update', () => {
    expect(classifyBranch(undefined, 'Where is my driver, how much longer')).toBe('update');
    expect(classifyBranch(undefined, 'someone called me from this number')).toBe('update');
  });

  it('prefers the motor club when a caller says both', () => {
    // A club agent frequently describes the breakdown too. The PO number is
    // near-proof of who is calling; "won't start" is only typical of what for.
    expect(
      classifyBranch(undefined, "calling from Agero, PO number 4471, the vehicle won't start"),
    ).toBe('motor_club');
  });

  it('says unknown rather than guessing', () => {
    // Better an honest gap in the numbers than a category filled with calls
    // that were never really in it.
    expect(classifyBranch(undefined, undefined)).toBe('unknown');
    expect(classifyBranch(undefined, '')).toBe('unknown');
    expect(classifyBranch({}, 'hello? hello?')).toBe('unknown');
  });
});
