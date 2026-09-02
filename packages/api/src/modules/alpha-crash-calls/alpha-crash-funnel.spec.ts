import { describe, expect, it } from 'vitest';
import type { AlphaCallSummary } from './alpha-crash-middleware.client';
import { computeAlphaFunnel } from './alpha-crash-funnel';

function makeCall(overrides: Partial<AlphaCallSummary> = {}): AlphaCallSummary {
  return {
    id: 'row-id',
    call_id: 'call-id',
    contact_id: null,
    agent_id: null,
    direction: 'outbound',
    created_at: '2026-09-01T12:00:00Z',
    customer_name: null,
    duration_ms: 10000,
    recording_url: null,
    call_status: 'ended',
    disconnection_reason: 'user_hangup',
    call_outcome: 'soft_no',
    call_summary: null,
    callback_requested: false,
    preferred_callback_time: null,
    in_voicemail: false,
    user_sentiment: 'Neutral',
    ...overrides,
  };
}

describe('computeAlphaFunnel', () => {
  it('returns zeroed metrics on an empty set', () => {
    const metrics = computeAlphaFunnel([]);
    expect(metrics).toMatchObject({ calls: 0, connected: 0, voicemail: 0, noData: 0, substantive: 0, positiveInterest: 0 });
  });

  it('counts a stub row (no status, no outcome) as noData, not substantive', () => {
    const metrics = computeAlphaFunnel([
      makeCall({ call_status: null, call_outcome: null, disconnection_reason: null }),
    ]);
    expect(metrics.noData).toBe(1);
    expect(metrics.substantive).toBe(0);
    expect(metrics.connected).toBe(0);
  });

  it('does not count a voicemail pickup as substantive even with an outcome tag', () => {
    const metrics = computeAlphaFunnel([
      makeCall({ call_outcome: 'unavailable', in_voicemail: true, disconnection_reason: 'voicemail_reached' }),
    ]);
    expect(metrics.voicemail).toBe(1);
    expect(metrics.substantive).toBe(0);
  });

  it('counts a real human decline as substantive but not positive interest', () => {
    const metrics = computeAlphaFunnel([makeCall({ call_outcome: 'soft_no' })]);
    expect(metrics.substantive).toBe(1);
    expect(metrics.positiveInterest).toBe(0);
  });

  it('counts information_requested as both substantive and positive interest', () => {
    const metrics = computeAlphaFunnel([makeCall({ call_outcome: 'information_requested' })]);
    expect(metrics.substantive).toBe(1);
    expect(metrics.positiveInterest).toBe(1);
  });

  it('does not count unavailable/pending_or_unavailable as substantive', () => {
    const metrics = computeAlphaFunnel([
      makeCall({ call_outcome: 'unavailable', call_status: null }),
      makeCall({ call_outcome: 'pending_or_unavailable', call_status: null }),
    ]);
    expect(metrics.substantive).toBe(0);
  });

  it('groups byOutcome counts, highest first', () => {
    const metrics = computeAlphaFunnel([
      makeCall({ call_outcome: 'wrong_number' }),
      makeCall({ call_outcome: 'wrong_number' }),
      makeCall({ call_outcome: 'soft_no' }),
    ]);
    expect(metrics.byOutcome[0]).toEqual({ outcome: 'wrong_number', count: 2 });
    expect(metrics.byOutcome[1]).toEqual({ outcome: 'soft_no', count: 1 });
  });
});
