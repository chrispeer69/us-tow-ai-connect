import { describe, it, expect } from 'vitest';
import { CLOSE_MARKERS } from '../flip-engine/flip-scripts';
import {
  DEFAULT_INTAKE_COMPLETE_SECONDS,
  extractUserSpeech,
  hasOptOut,
  judgePitchCompletion,
  type PitchCompletionInput,
} from './pitch-completion';

/**
 * The fixtures here are the real calls from the morning of 2026-08-17 — the day
 * Chris asked for the redial. They are the reason each branch exists, so they are
 * the cases the tests are written against rather than invented ones.
 */

const OPTS = { closeMarkers: CLOSE_MARKERS };

function input(over: Partial<PitchCompletionInput> = {}): PitchCompletionInput {
  return {
    status: 'completed',
    disconnectionReason: 'user_hangup',
    durationSeconds: 30,
    transcript: 'Agent: Hi, is that Sam?\nUser: Yes.\n',
    analysis: {},
    jobFlipEligible: true,
    ...over,
  };
}

describe('extractUserSpeech', () => {
  it('returns only the customer turns', () => {
    const t = [
      'Agent: Hi, is that Caitlin? This is Emily from Roadside',
      'User: Yes.',
      'Agent: I have your pickup location as 3-6-5-1 Brinell Street East.',
      'User: Repair shop.',
    ].join('\n');
    expect(extractUserSpeech(t)).toBe('Yes. Repair shop.');
  });

  it('attributes unprefixed continuation lines to the last speaker', () => {
    const t = 'User: Storage\nfacility.\nAgent: Got it.\ntrailing agent words';
    expect(extractUserSpeech(t)).toBe('Storage facility.');
  });

  it('is empty for an empty or missing transcript', () => {
    expect(extractUserSpeech(null)).toBe('');
    expect(extractUserSpeech('   ')).toBe('');
  });
});

describe('hasOptOut', () => {
  it('detects a do-not-call request from the customer', () => {
    expect(hasOptOut('Agent: Can I mention an offer?\nUser: Do not call me again.')).toBe(true);
    expect(hasOptOut('User: stop calling me')).toBe(true);
    expect(hasOptOut('User: take me off your list')).toBe(true);
  });

  it('matches a typographic apostrophe', () => {
    expect(hasOptOut('User: don’t call me back')).toBe(true);
  });

  it('ignores opt-out-shaped language spoken by the AGENT', () => {
    // The whole reason speech is split by speaker: a regex over the raw
    // transcript would eventually match the script and mute redials globally.
    expect(hasOptOut("Agent: We won't call you again if you'd rather we didn't.\nUser: Okay.")).toBe(
      false,
    );
  });

  it('does not fire on an ordinary decline', () => {
    expect(hasOptOut('User: No, thank you. No, thank you.')).toBe(false);
  });
});

describe('judgePitchCompletion', () => {
  it('BLOCKED beats everything, including an unfinished pitch', () => {
    const v = judgePitchCompletion(
      input({ durationSeconds: 12, transcript: 'User: stop calling me' }),
      OPTS,
    );
    expect(v.outcome).toBe('BLOCKED');
    expect(v.reason).toBe('customer_opted_out');
  });

  it('NOT_APPLICABLE when our gate said the job was never flip-eligible', () => {
    // 06:01 CARSTAR and Crash Champions — auto body, 53s and 21s.
    const v = judgePitchCompletion(
      input({ jobFlipEligible: false, durationSeconds: 21 }),
      OPTS,
    );
    expect(v.outcome).toBe('NOT_APPLICABLE');
  });

  it('RESOLVED on an accepted flip', () => {
    const v = judgePitchCompletion(
      input({ analysis: { flip_outcome: 'ACCEPTED' }, durationSeconds: 240 }),
      OPTS,
    );
    expect(v).toEqual({ outcome: 'RESOLVED', reason: 'flip_accepted' });
  });

  it('RESOLVED when the customer answered an offer — a decline is not retried', () => {
    // 06:36 Clintonville: offer 1 DECLINED after the customer talked over it.
    // Re-pitching a decline is harassment, not persistence.
    const v = judgePitchCompletion(
      input({
        durationSeconds: 178,
        analysis: { offer_1_result: 'DECLINED', flip_outcome: 'FAILED' },
      }),
      OPTS,
    );
    expect(v).toEqual({ outcome: 'RESOLVED', reason: 'offer_decided_by_customer' });
  });

  it('RESOLVED when the agent reached its closing block', () => {
    const v = judgePitchCompletion(
      input({
        durationSeconds: 90,
        transcript: "Agent: You're all set, Cire. Your driver is coming to you.",
      }),
      OPTS,
    );
    expect(v).toEqual({ outcome: 'RESOLVED', reason: 'agent_reached_close' });
  });

  it('matches the close through a typographic apostrophe', () => {
    const v = judgePitchCompletion(
      input({ durationSeconds: 90, transcript: 'Agent: You’re all set, Sam.' }),
      OPTS,
    );
    expect(v.outcome).toBe('RESOLVED');
  });

  it('RESOLVED when the agent judged the flip inapplicable after a full intake', () => {
    // 05:48 Steagalls (201s): ticket said a repair shop, customer said "her
    // residence". 07:12 AutoZone (201s): storage facility, after a collision.
    // Both correct. Redialling either would pitch a shop the customer has no
    // use for, three times.
    const v = judgePitchCompletion(
      input({
        durationSeconds: 201,
        transcript: 'Agent: Since the destination is home there is no repair offer.',
        analysis: { flip_eligible: false },
      }),
      OPTS,
    );
    expect(v).toEqual({
      outcome: 'RESOLVED',
      reason: 'agent_judged_not_appropriate_after_full_intake',
    });
  });

  it('ABANDONED when the same judgement comes off a call that plainly died', () => {
    // Same analysis flag, 19 seconds. The tag means "the call died", not "the
    // agent decided" — this is the conflation the duration floor exists to break.
    const v = judgePitchCompletion(
      input({ durationSeconds: 19, analysis: { flip_eligible: false } }),
      OPTS,
    );
    expect(v.outcome).toBe('ABANDONED');
    expect(v.reason).toBe('hangup_before_pitch_19s');
  });

  it('ABANDONED on a hangup before any offer', () => {
    const v = judgePitchCompletion(
      input({
        durationSeconds: 33,
        analysis: { offer_1_result: 'NOT_ATTEMPTED', flip_outcome: 'NOT_ATTEMPTED' },
      }),
      OPTS,
    );
    expect(v.outcome).toBe('ABANDONED');
  });

  it('ABANDONED on a 1-second connect', () => {
    // 06:08 Discount Tire — 1s, empty transcript.
    const v = judgePitchCompletion(
      input({ durationSeconds: 1, transcript: '', analysis: {} }),
      OPTS,
    );
    expect(v.outcome).toBe('ABANDONED');
    expect(v.reason).toBe('hangup_before_pitch_1s');
  });

  it('ABANDONED with a null duration when no webhook ever landed', () => {
    // 06:01 Capital Ford — null duration, null transcript, ninety minutes later.
    const v = judgePitchCompletion(
      input({ durationSeconds: null, transcript: null, disconnectionReason: null, analysis: {} }),
      OPTS,
    );
    expect(v.outcome).toBe('ABANDONED');
    expect(v.reason).toBe('ended_before_pitch_0s');
  });

  it('names voicemail specifically', () => {
    const v = judgePitchCompletion(
      input({ disconnectionReason: 'voicemail', durationSeconds: 14 }),
      OPTS,
    );
    expect(v).toEqual({ outcome: 'ABANDONED', reason: 'voicemail_no_pitch' });
  });

  it('honours a custom intake threshold', () => {
    const over = { durationSeconds: 120, analysis: { flip_eligible: false } };
    expect(judgePitchCompletion(input(over), OPTS).outcome).toBe('ABANDONED');
    expect(
      judgePitchCompletion(input(over), { ...OPTS, intakeCompleteSeconds: 100 }).outcome,
    ).toBe('RESOLVED');
  });

  it('keeps the intake floor above the 111s no-win threshold', () => {
    // Below 111 seconds no win has ever occurred, so treating anything shorter
    // as a completed judgement would write off calls that never got going.
    expect(DEFAULT_INTAKE_COMPLETE_SECONDS).toBeGreaterThan(111);
  });

  it('treats a missing close-marker list as no signal rather than a match', () => {
    const v = judgePitchCompletion(
      input({ durationSeconds: 90, transcript: "Agent: You're all set." }),
      {},
    );
    expect(v.outcome).toBe('ABANDONED');
  });
});

describe('CLOSE_MARKERS', () => {
  it('is non-empty — an empty list silently disables close detection', () => {
    expect(CLOSE_MARKERS.length).toBeGreaterThan(0);
  });

  it('is lowercase so transcript matching is case-stable', () => {
    for (const m of CLOSE_MARKERS) expect(m).toBe(m.toLowerCase());
  });
});
