import { describe, expect, it } from 'vitest';
import {
  customerTurns,
  decideDisposition,
  nextLeadStatus,
  MIN_PITCH_SECONDS,
} from './campaign-disposition';

/**
 * The first test in this file is the whole reason the file exists.
 *
 * Ray's script says, verbatim: "Understood — I'll take you off the list right
 * now." An opt-out regex run over the WHOLE transcript matches that agent line,
 * which would mean every call where Ray reads his own opt-out response gets
 * suppressed. The same defect is documented in outbound-voice/pitch-completion.ts.
 */
describe('opt-out detection is scoped to the customer', () => {
  it('does NOT suppress when only the AGENT says the opt-out words', () => {
    const transcript = [
      'Agent: Hi — this is Ray with the US Tow Alliance. Quick thirty seconds.',
      'User: Sure, what is this about?',
      "Agent: Understood — I'll take you off the list right now. Sorry to bother you.",
    ].join('\n');

    const result = decideDisposition({ status: 'completed', durationSeconds: 30, transcript });

    expect(result.disposition).not.toBe('DNC');
    expect(result.optOutQuote).toBeNull();
  });

  it('suppresses when the CUSTOMER asks to be removed', () => {
    const transcript = [
      'Agent: Hi — this is Ray with the US Tow Alliance.',
      'User: Take me off your list, do not call here again.',
    ].join('\n');

    const result = decideDisposition({ status: 'completed', durationSeconds: 12, transcript });

    expect(result.disposition).toBe('DNC');
    expect(result.optOutQuote).toContain('Take me off your list');
  });

  it('suppresses even on a very short call — they can hang up mid-sentence', () => {
    const transcript = ['Agent: Hi — this is Ray with', 'User: Stop calling me.'].join('\n');

    const result = decideDisposition({ status: 'completed', durationSeconds: 4, transcript });

    // Beats the "too short to be a pitch -> RETRY" rule. Retrying somebody who
    // just said stop is the one outcome with real consequences.
    expect(result.disposition).toBe('DNC');
  });

  it('suppresses on a no-answer status if the words are there', () => {
    const transcript = ['User: remove my number please'].join('\n');
    const result = decideDisposition({ status: 'no_answer', transcript });
    expect(result.disposition).toBe('DNC');
  });

  it('does NOT suppress when the agent opts a VOICEMAIL out on its own', () => {
    // 2026-08-20, J&J Auto Towing. The call hit an answering machine, the agent
    // read its own opt-out line to it, then self-reported opted_out: true. That
    // permanently suppressed a live prospect on the strength of the agent
    // talking to itself. A person can only opt out if a person was there.
    const transcript = [
      'User: Your',
      'Agent: Hi there — this is Ray with the US Tow Alliance...',
      "User: call has been forwarded to voicemail. The person you're trying to reach is not available.",
      "Agent: Understood — I'll take you off the list right now. Sorry to bother you.",
    ].join('\n');

    const result = decideDisposition({
      status: 'completed',
      disconnectionReason: 'voicemail_reached',
      durationSeconds: 60,
      transcript,
      analysis: { custom_analysis_data: { opted_out: true, reached_voicemail: true } },
    });

    expect(result.disposition).toBe('VM');
    expect(result.optOutQuote).toBeNull();
  });

  it('still honours the agent flag when a live human was on the call', () => {
    // The flag is not worthless — it catches opt-out wording the regex misses.
    // It just needs a human present to be believable.
    const transcript = ['Agent: Hi there —', "User: yeah, we're not doing any of that, lose the number."].join('\n');

    const result = decideDisposition({
      status: 'completed',
      durationSeconds: 20,
      transcript,
      analysis: { custom_analysis_data: { opted_out: true } },
    });

    expect(result.disposition).toBe('DNC');
  });

  it('does not suppress when the agent flags an opt-out but nobody ever spoke', () => {
    const result = decideDisposition({
      status: 'completed',
      durationSeconds: 24,
      transcript: 'Agent: Hi there — this is Ray with the US Tow Alliance...',
      analysis: { custom_analysis_data: { opted_out: true } },
    });

    expect(result.disposition).not.toBe('DNC');
  });

  it('parses only attributed customer turns', () => {
    const transcript = [
      'Agent: hello',
      'User: hi there',
      'some unattributed line about not calling',
      'Customer: second turn',
    ].join('\n');

    expect(customerTurns(transcript)).toEqual(['hi there', 'second turn']);
  });
});

describe('"not interested" is not "never call me"', () => {
  it('records NOT_INTERESTED without suppressing', () => {
    const transcript = ['Agent: ...free profile...', 'User: Not interested, thanks.'].join('\n');
    const result = decideDisposition({ status: 'completed', durationSeconds: 25, transcript });

    expect(result.disposition).toBe('NOT_INTERESTED');
    expect(result.optOutQuote).toBeNull();
  });

  it('a declined lead is retired, not retried', () => {
    expect(nextLeadStatus('NOT_INTERESTED', 1, 2)).toBe('PITCHED');
  });
});

describe('call outcomes', () => {
  it('maps no answer and busy to RETRY', () => {
    expect(decideDisposition({ status: 'no_answer' }).disposition).toBe('RETRY');
    expect(decideDisposition({ status: 'busy' }).disposition).toBe('RETRY');
  });

  it('detects voicemail from the disconnection reason', () => {
    const result = decideDisposition({
      status: 'completed',
      disconnectionReason: 'voicemail_reached',
      durationSeconds: 14,
    });
    expect(result.disposition).toBe('VM');
  });

  it('treats a sub-pitch-length call as abandoned, not as a pitch', () => {
    const transcript = ['Agent: Hi — this is Ray', 'User: uh'].join('\n');
    const result = decideDisposition({
      status: 'completed',
      durationSeconds: MIN_PITCH_SECONDS - 1,
      transcript,
    });
    expect(result.disposition).toBe('RETRY');
    expect(result.reason).toMatch(/abandoned/);
  });

  it('counts a real conversation as PITCHED', () => {
    const transcript = [
      'Agent: Hi — this is Ray with the US Tow Alliance. Quick thirty seconds.',
      'User: Okay, go ahead.',
      'Agent: Your company has a free profile waiting at USTowAlliance.com.',
      'User: Alright.',
    ].join('\n');
    const result = decideDisposition({ status: 'completed', durationSeconds: 31, transcript });
    expect(result.disposition).toBe('PITCHED');
  });

  it('flags warm intent but does NOT retire the lead', () => {
    const transcript = [
      'Agent: ...claim it at USTowAlliance.com',
      "User: Yeah I'll go check it out, what's the website again?",
    ].join('\n');
    const result = decideDisposition({ status: 'completed', durationSeconds: 34, transcript });

    expect(result.disposition).toBe('WARM');
    // Spec §6: flag for Chris, do not auto-remove.
    expect(nextLeadStatus('WARM', 1, 2)).toBe('WARM');
  });

  it('captures the gatekeeper callback time and does not count it as a pitch', () => {
    const result = decideDisposition({
      status: 'completed',
      durationSeconds: 22,
      transcript: 'Agent: When is the best time to catch the owner?\nUser: Try after four.',
      analysis: { custom_analysis_data: { reached_gatekeeper: true, callback_time: 'after 4pm' } },
    });

    expect(result.disposition).toBe('GATEKEEPER');
    expect(result.callbackTime).toBe('after 4pm');
  });

  it('reads agent analysis nested under custom_analysis_data', () => {
    const result = decideDisposition({
      status: 'completed',
      durationSeconds: 28,
      analysis: { custom_analysis_data: { will_claim_profile: true } },
    });
    expect(result.disposition).toBe('WARM');
  });

  it('does not call an IVR a pitch', () => {
    // Connected, ran long, nobody ever spoke.
    const result = decideDisposition({ status: 'completed', durationSeconds: 40, transcript: 'Agent: hello?' });
    expect(result.disposition).toBe('RETRY');
    expect(result.reason).toBe('no_human_speech');
  });
});

describe('attempt exhaustion', () => {
  it('retries a first voicemail and exhausts the second', () => {
    expect(nextLeadStatus('VM', 1, 2)).toBe('VM');
    expect(nextLeadStatus('VM', 2, 2)).toBe('EXHAUSTED');
  });

  it('never resurrects a suppressed lead regardless of attempts', () => {
    expect(nextLeadStatus('DNC', 1, 2)).toBe('DNC');
    expect(nextLeadStatus('DNC', 9, 2)).toBe('DNC');
  });
});
