import { describe, expect, it } from 'vitest';
import {
  customerTurns,
  decideDisposition,
  nextLeadStatus,
  stageForNextCall,
  wasDelivered,
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
    // Connected, ran long, nobody ever spoke. Ray said only "hello?" — no
    // script content — so the agent-never-spoke guard catches it first, which
    // is the more accurate reason of the two.
    const result = decideDisposition({ status: 'completed', durationSeconds: 40, transcript: 'Agent: hello?' });
    expect(result.disposition).toBe('RETRY');
    expect(result.reason).toBe('agent_never_spoke');
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

describe('PITCHED requires that Ray actually spoke', () => {
  it('does NOT score a phone-tree loop as a pitch', () => {
    // 2026-08-22, Mid-Iowa Towing: 90 seconds of the company's own IVR looping
    // its menu twice, no agent speech at all, logged as PITCHED.
    const transcript = [
      'User: Thank you for calling Mid-Iowa Towing. Press 1 if you are law enforcement.',
      'User: Press 2 for heavy-duty towing and recovery. Press 3 for light-duty towing.',
    ].join('\n');
    const r = decideDisposition({ status: 'completed', durationSeconds: 90, transcript });
    expect(r.disposition).not.toBe('PITCHED');
    expect(r.reason).toBe('agent_never_spoke');
  });

  it('does NOT score a bare "hello" as a pitch', () => {
    const r = decideDisposition({
      status: 'completed',
      durationSeconds: 15,
      transcript: "User: John's Towing.\nUser: Hello?",
    });
    expect(r.disposition).toBe('RETRY');
  });

  it('DOES score a real delivered pitch', () => {
    const transcript = [
      'User: Hello?',
      'Agent: Hey — Ray here, with the Yoo-Ess Toe Alliance. We built your company a free profile.',
      'User: Okay.',
    ].join('\n');
    const r = decideDisposition({ status: 'completed', durationSeconds: 30, transcript });
    expect(r.disposition).toBe('PITCHED');
  });
});


describe('the three-stage cadence: three dials, days 1 / 3 / 5, then stop', () => {
  it('reads the stage off the dial number', () => {
    expect(stageForNextCall(1, 3)).toBe(1);
    expect(stageForNextCall(2, 3)).toBe(2);
    expect(stageForNextCall(3, 3)).toBe(3);
  });

  it('never asks for a stage past the closer', () => {
    expect(stageForNextCall(4, 3)).toBe(4);
    expect(stageForNextCall(9, 3)).toBe(4);
  });

  it('answering does not end the sequence', () => {
    // The defect this replaced: PITCHED was terminal, so the only numbers that
    // ever received stages two and three were the ones that never picked up.
    expect(nextLeadStatus('PITCHED', 1, 3, 1, 3)).toBe('RETRY');
    expect(nextLeadStatus('PITCHED', 2, 3, 2, 3)).toBe('RETRY');
  });

  it('stops after the third dial', () => {
    expect(nextLeadStatus('PITCHED', 3, 3, 3, 3)).toBe('PITCHED');
    expect(nextLeadStatus('RETRY', 3, 3, 0, 3)).toBe('EXHAUSTED');
    expect(nextLeadStatus('VM', 3, 3, 0, 3)).toBe('EXHAUSTED');
  });

  it('a no is a no — it does not get the remaining stages', () => {
    expect(nextLeadStatus('NOT_INTERESTED', 1, 3, 1, 3)).toBe('PITCHED');
  });

  it('an opt-out is never re-dialled, at any stage', () => {
    expect(nextLeadStatus('DNC', 1, 3, 1, 3)).toBe('DNC');
  });

  it('counts deliveries separately from dials, for the end-of-cycle report', () => {
    // Not used for scheduling any more — used to answer "did anyone actually
    // hear us" per number when the cycle closes.
    expect(wasDelivered('PITCHED')).toBe(true);
    expect(wasDelivered('NOT_INTERESTED')).toBe(true);
    expect(wasDelivered('DNC')).toBe(true);
    expect(wasDelivered('WARM')).toBe(true);
    expect(wasDelivered('VM')).toBe(false);
    expect(wasDelivered('RETRY')).toBe(false);
    expect(wasDelivered('GATEKEEPER')).toBe(false);
  });

  it('callers with no cadence configured behave exactly as before', () => {
    expect(nextLeadStatus('PITCHED', 1, 1)).toBe('PITCHED');
    expect(nextLeadStatus('NOT_INTERESTED', 1, 2)).toBe('PITCHED');
    expect(nextLeadStatus('VM', 2, 2)).toBe('EXHAUSTED');
  });
});
