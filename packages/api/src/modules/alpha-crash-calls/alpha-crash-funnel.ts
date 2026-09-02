import type { AlphaCallSummary } from './alpha-crash-middleware.client';

/**
 * Same positive-outcome tag set as AlphaFlipsBoard.tsx (frontend), kept here
 * too so the daily email's headline number and the live board never quietly
 * diverge on what counts as "real interest".
 */
export const ALPHA_POSITIVE_OUTCOMES: ReadonlySet<string> = new Set([
  'interested_transfer',
  'interested_callback',
  'interested_not_scheduled',
  'estimate_requested',
  'booked',
  'information_requested',
]);

/** Outcomes that mean the dial never reached anyone worth talking to. */
const NO_CONNECT_OUTCOMES: ReadonlySet<string> = new Set([
  'unavailable',
  'pending_or_unavailable',
]);

export interface AlphaFunnelMetrics {
  calls: number;
  connected: number;
  voicemail: number;
  /** No call_status/outcome at all — the stub-row webhook-drop pattern. */
  noData: number;
  /** Reached a person or left a real signal, i.e. not voicemail/no-connect/stub. */
  substantive: number;
  positiveInterest: number;
  byOutcome: Array<{ outcome: string; count: number }>;
}

export function computeAlphaFunnel(calls: AlphaCallSummary[]): AlphaFunnelMetrics {
  const byOutcomeMap = new Map<string, number>();
  let connected = 0;
  let voicemail = 0;
  let noData = 0;
  let substantive = 0;
  let positiveInterest = 0;

  for (const c of calls) {
    const outcome = c.call_outcome ?? null;
    byOutcomeMap.set(outcome ?? 'no_outcome', (byOutcomeMap.get(outcome ?? 'no_outcome') ?? 0) + 1);

    if (c.call_status) connected += 1;
    if (c.in_voicemail || c.disconnection_reason === 'voicemail_reached') voicemail += 1;
    if (!c.call_status && !outcome) noData += 1;

    if (outcome && !NO_CONNECT_OUTCOMES.has(outcome) && !c.in_voicemail) {
      substantive += 1;
    }
    if (outcome && ALPHA_POSITIVE_OUTCOMES.has(outcome)) positiveInterest += 1;
  }

  return {
    calls: calls.length,
    connected,
    voicemail,
    noData,
    substantive,
    positiveInterest,
    byOutcome: [...byOutcomeMap.entries()]
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count),
  };
}
