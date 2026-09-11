import { describe, expect, it } from 'vitest';
import {
  classifyInboundCall,
  computeInboundFunnel,
  etDayBounds,
  sampleForReview,
  type RetellInboundCall,
} from './inbound-review-funnel';
import { renderInboundReviewEmailHtml, renderInboundReviewEmailSubject, renderInboundReviewEmailText } from './inbound-review-email';

const T0 = Date.parse('2026-09-10T16:42:00Z');
function call(partial: Partial<RetellInboundCall> & { turns?: RetellInboundCall['transcript_with_tool_calls'] }): RetellInboundCall {
  const { turns, ...rest } = partial;
  return {
    call_id: 'call_' + Math.random().toString(16).slice(2, 12),
    start_timestamp: T0,
    end_timestamp: T0 + 63_000,
    from_number: '+16149311499',
    agent_version: 17,
    disconnection_reason: 'agent_hangup',
    recording_url: 'https://example.test/rec.wav',
    transcript_with_tool_calls: turns,
    ...rest,
  };
}
const found = (matchedBy?: string) => ({
  role: 'tool_call_result',
  content: JSON.stringify({ status: 'success', source: 'TOWBOOK', ...(matchedBy ? { matched_by: matchedBy } : {}), data: { jobId: '1' } }),
});
const notFound = { role: 'tool_call_result', content: JSON.stringify({ status: 'not_found', message: 'No active job found for that phone number' }) };

describe('classifyInboundCall', () => {
  it('reads a clean found-and-answered call', () => {
    const c = classifyInboundCall(
      call({
        turns: [
          { role: 'agent', content: 'Thanks for calling Roadside Towing, this is Emily.' },
          { role: 'user', content: 'Checking on a tow.' },
          { role: 'tool_call_invocation', name: 'lookup_job_by_phone', arguments: '{"phone":"6149311499"}' },
          found('given'),
          { role: 'agent', content: 'Got it — your driver will call you.' },
          { role: 'user', content: 'Thanks.' },
        ],
      }),
    );
    expect(c.outcome).toBe('answered_from_board');
    expect(c.lookupKeys).toEqual(['phone']);
    expect(c.lookupFound).toBe(true);
    expect(c.matchedBy).toBe('given');
    expect(c.transferred).toBe(false);
    expect(c.transcriptText).toContain('Caller: Checking on a tow.');
    expect(c.transcriptText).toContain('[tool lookup_job_by_phone');
  });

  it('flags a transfer after a not-found lookup, and which key was used', () => {
    const c = classifyInboundCall(
      call({
        disconnection_reason: 'call_transfer',
        call_analysis: { custom_analysis_data: { call_branch: 'motor_club', transfer_reason: 'job not found' } },
        turns: [
          { role: 'user', content: 'Allstate, PO 1062043303.' },
          { role: 'tool_call_invocation', name: 'lookup_job_by_phone', arguments: '{"po_number":"1062043303"}' },
          notFound,
          { role: 'tool_call_invocation', name: 'transfer_to_dispatch', arguments: '{}' },
        ],
      }),
    );
    expect(c.outcome).toBe('transferred');
    expect(c.transferAfter).toBe('not_found');
    expect(c.lookupKeys).toEqual(['po_number']);
    expect(c.branch).toBe('motor_club');
    expect(c.transferReason).toBe('job not found');
  });

  it('calls a silent nine-second call no conversation, not a failure', () => {
    const c = classifyInboundCall(call({ end_timestamp: T0 + 9_000, turns: [{ role: 'agent', content: 'Thanks for calling.' }] }));
    expect(c.outcome).toBe('no_conversation');
    expect(c.userTurns).toBe(0);
  });

  it('ranks a message-taken call and a booked job above a plain found call', () => {
    const msg = classifyInboundCall(call({ turns: [{ role: 'user', content: 'x' }, found(), { role: 'tool_call_invocation', name: 'take_dispatch_message', arguments: '{}' }] }));
    const booked = classifyInboundCall(call({ turns: [{ role: 'user', content: 'x' }, { role: 'tool_call_invocation', name: 'create_tow_job', arguments: '{}' }] }));
    expect(msg.outcome).toBe('message_taken');
    expect(booked.outcome).toBe('job_created');
  });
});

describe('computeInboundFunnel + sampleForReview', () => {
  const calls = [
    classifyInboundCall(call({ turns: [{ role: 'user', content: 'a' }, { role: 'tool_call_invocation', name: 'lookup_job_by_phone', arguments: '{"phone":"1"}' }, found('caller_id')] })),
    classifyInboundCall(call({ turns: [{ role: 'user', content: 'b' }, { role: 'tool_call_invocation', name: 'lookup_job_by_phone', arguments: '{"phone":"2"}' }, notFound, { role: 'tool_call_invocation', name: 'transfer_to_dispatch', arguments: '{}' }] })),
    classifyInboundCall(call({ turns: [{ role: 'user', content: 'c' }, { role: 'tool_call_invocation', name: 'transfer_to_dispatch', arguments: '{}' }] })),
    classifyInboundCall(call({ end_timestamp: T0 + 5_000, turns: [] })),
  ];
  it('counts what the email and the analyst both use', () => {
    const m = computeInboundFunnel(calls);
    expect(m.calls).toBe(4);
    expect(m.conversations).toBe(3);
    expect(m.lookups).toBe(2);
    expect(m.found).toBe(1);
    expect(m.foundByCallerId).toBe(1);
    expect(m.notFound).toBe(1);
    expect(m.transferred).toBe(2);
    expect(m.transferredAfterNotFound).toBe(1);
    expect(m.transferredNoLookup).toBe(1);
    expect(m.byOutcome.find((o) => o.outcome === 'transferred')?.count).toBe(2);
  });
  it('puts transfers and not-founds first in the sample', () => {
    const s = sampleForReview(calls, 3);
    expect(s.map((c) => c.outcome)).toEqual(['transferred', 'transferred', 'answered_from_board']);
  });
});

describe('etDayBounds', () => {
  it('spans midnight to midnight New York time in September (EDT, UTC-4)', () => {
    const { start, end } = etDayBounds('2026-09-10');
    expect(new Date(start).toISOString()).toBe('2026-09-10T04:00:00.000Z');
    expect(new Date(end).toISOString()).toBe('2026-09-11T04:00:00.000Z');
  });
  it('uses UTC-5 in January', () => {
    const { start } = etDayBounds('2026-01-15');
    expect(new Date(start).toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });
});

describe('inbound review email', () => {
  const calls = [
    classifyInboundCall(call({ turns: [{ role: 'user', content: 'a' }, { role: 'tool_call_invocation', name: 'lookup_job_by_phone', arguments: '{"phone":"1"}' }, found('caller_id')] })),
  ];
  const metrics = computeInboundFunnel(calls);
  const analysis = {
    summary: 'One call, found on caller ID, answered cleanly.',
    successes: [{ label: 'found the job on the caller ID', count: 1, quotes: [{ callId: calls[0].callId, quote: 'Got it' }] }],
    failures: [],
    recommendations: [{ target: 'pacing', title: 'Slow the greeting', problem: 'Too fast', proposedText: null, currentText: null, rationale: 'r', evidence: [], kind: 'PROMPT' as const, confidence: 'LOW' as const }],
  };
  it('renders subject, text and html with the numbers and the recording link', () => {
    const input = { reviewDate: '2026-09-10', metrics, analysis, calls, agentVersions: ['17'] };
    expect(renderInboundReviewEmailSubject(input)).toBe('Inbound Emily 2026-09-10 — 1 calls, 1 found, 0 transferred');
    const text = renderInboundReviewEmailText(input);
    expect(text).toContain('SUCCESSES');
    expect(text).toContain('RECOMMENDATIONS');
    expect(text).toContain('https://example.test/rec.wav');
    const html = renderInboundReviewEmailHtml(input);
    expect(html).toContain('found the job on the caller ID');
    expect(html).toContain('Slow the greeting');
    expect(html).toContain('listen');
    expect(html).toContain('(caller ID)');
  });
  it('says so plainly on a day with no calls', () => {
    const input = { reviewDate: '2026-09-10', metrics: computeInboundFunnel([]), analysis: null, calls: [], agentVersions: [] };
    expect(renderInboundReviewEmailSubject(input)).toBe('Inbound Emily 2026-09-10: no calls');
    expect(renderInboundReviewEmailHtml(input)).toContain('No inbound calls');
  });
});
