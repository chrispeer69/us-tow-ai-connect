/**
 * Pure classification of one day's inbound calls, from Retell's call records
 * (the `transcript_with_tool_calls` turns carry what the agent actually did —
 * which tool it called, with what, and what came back).
 *
 * No I/O here so it is unit-testable and so the email and the analyst prompt
 * are built from the same numbers.
 */

export interface RetellTurn {
  role: 'agent' | 'user' | 'tool_call_invocation' | 'tool_call_result' | string;
  content?: string;
  name?: string;
  arguments?: string;
}

export interface RetellInboundCall {
  call_id: string;
  start_timestamp: number;
  end_timestamp?: number;
  from_number?: string;
  to_number?: string;
  agent_version?: number | string;
  disconnection_reason?: string;
  recording_url?: string | null;
  transcript?: string;
  transcript_with_tool_calls?: RetellTurn[];
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    custom_analysis_data?: Record<string, unknown>;
  };
}

export type InboundOutcome =
  | 'answered_from_board'
  | 'message_taken'
  | 'job_created'
  | 'transferred'
  | 'not_found_ended'
  | 'no_conversation'
  | 'ended_other';

export interface ClassifiedInboundCall {
  callId: string;
  startTimestamp: number;
  when: string; // ET, human
  from: string;
  durationSec: number;
  agentVersion: string;
  disconnection: string;
  recordingUrl: string | null;
  branch: string;
  summary: string;
  userTurns: number;
  lookupAttempted: boolean;
  lookupKeys: string[]; // 'phone' | 'po_number' | 'job_number'
  lookupFound: boolean;
  lookupNotFound: boolean;
  matchedBy: string | null;
  /** 2026-09-11 — 'active' | 'completed' | 'canceled' from the lookup result, null if no lookup found anything. */
  jobState: string | null;
  transferred: boolean;
  transferAfter: 'found' | 'not_found' | 'no_lookup' | null;
  transferReason: string;
  messageTaken: boolean;
  jobCreated: boolean;
  outcome: InboundOutcome;
  /** The transcript rendered with tool lines, for the analyst. */
  transcriptText: string;
}

export interface InboundFunnelMetrics {
  calls: number;
  conversations: number; // caller said something and call ran ≥ 15s
  noConversation: number;
  lookups: number;
  found: number;
  notFound: number;
  foundByCallerId: number;
  /** Lookups that matched a job which had already completed or been cancelled (unified_jobs fallback). */
  foundClosed: number;
  transferred: number;
  transferredAfterFound: number;
  transferredAfterNotFound: number;
  transferredNoLookup: number;
  messagesTaken: number;
  jobsCreated: number;
  medianDurationSec: number;
  byBranch: Array<{ branch: string; count: number }>;
  byOutcome: Array<{ outcome: InboundOutcome; count: number }>;
}

export function formatEt(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** UTC bounds of a calendar day in America/New_York, DST-safe. */
export function etDayBounds(date: string): { start: number; end: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const midnightOf = (d: string): number => {
    // Try both possible offsets; keep the one that lands on 00:xx of that ET date.
    for (const offsetHours of [4, 5]) {
      const guess = Date.parse(`${d}T00:00:00Z`) + offsetHours * 3600 * 1000;
      const parts = fmt.formatToParts(new Date(guess));
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const hour = get('hour') === '24' ? '00' : get('hour');
      if (`${get('year')}-${get('month')}-${get('day')}` === d && hour === '00') return guess;
    }
    return Date.parse(`${d}T04:00:00Z`);
  };
  const start = midnightOf(date);
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 24 * 3600 * 1000).toISOString().slice(0, 10);
  return { start, end: midnightOf(next) };
}

function safeJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function renderTranscript(turns: RetellTurn[] | undefined, fallback: string | undefined): string {
  if (!turns || turns.length === 0) return fallback ?? '(no transcript)';
  const lines: string[] = [];
  for (const t of turns) {
    if (t.role === 'agent') lines.push(`Emily: ${t.content ?? ''}`);
    else if (t.role === 'user') lines.push(`Caller: ${t.content ?? ''}`);
    else if (t.role === 'tool_call_invocation') lines.push(`[tool ${t.name ?? '?'} ${(t.arguments ?? '').slice(0, 300)}]`);
    else if (t.role === 'tool_call_result') lines.push(`[result ${(t.content ?? '').slice(0, 400)}]`);
  }
  return lines.join('\n');
}

export function classifyInboundCall(call: RetellInboundCall): ClassifiedInboundCall {
  const turns = call.transcript_with_tool_calls ?? [];
  const invocations = turns.filter((t) => t.role === 'tool_call_invocation');
  const results = turns.filter((t) => t.role === 'tool_call_result');
  const custom = call.call_analysis?.custom_analysis_data ?? {};

  const lookupCalls = invocations.filter((t) => t.name === 'lookup_job_by_phone');
  const lookupKeys = new Set<string>();
  for (const inv of lookupCalls) {
    const args = safeJson(inv.arguments) ?? {};
    let any = false;
    for (const k of ['phone', 'po_number', 'job_number']) if (args[k]) { lookupKeys.add(k); any = true; }
    // 2026-09-11 — an argument-less call is the silent caller-ID check.
    if (!any) lookupKeys.add('caller_id');
  }
  let lookupFound = false;
  let lookupNotFound = false;
  let matchedBy: string | null = null;
  let jobState: string | null = null;
  for (const r of results) {
    const body = safeJson(r.content);
    if (!body) continue;
    if (body.status === 'success' && body.source) {
      lookupFound = true;
      if (typeof body.matched_by === 'string') matchedBy = body.matched_by;
      if (typeof body.job_state === 'string') jobState = body.job_state;
    } else if (body.status === 'not_found') {
      lookupNotFound = true;
    }
  }

  const transferred = invocations.some((t) => t.name === 'transfer_to_dispatch');
  const messageTaken = invocations.some((t) => t.name === 'take_dispatch_message');
  const jobCreated = invocations.some((t) => t.name === 'create_tow_job');
  const durationSec = call.end_timestamp ? Math.round((call.end_timestamp - call.start_timestamp) / 1000) : 0;
  const userTurns = turns.filter((t) => t.role === 'user').length;

  let outcome: InboundOutcome = 'ended_other';
  if (transferred) outcome = 'transferred';
  else if (jobCreated) outcome = 'job_created';
  else if (messageTaken) outcome = 'message_taken';
  else if (lookupFound) outcome = 'answered_from_board';
  else if (lookupNotFound) outcome = 'not_found_ended';
  else if (userTurns === 0 || durationSec < 15) outcome = 'no_conversation';

  return {
    callId: call.call_id,
    startTimestamp: call.start_timestamp,
    when: formatEt(call.start_timestamp),
    from: call.from_number ?? '',
    durationSec,
    agentVersion: String(call.agent_version ?? ''),
    disconnection: call.disconnection_reason ?? '',
    recordingUrl: call.recording_url ?? null,
    branch: String(custom.call_branch ?? ''),
    summary: call.call_analysis?.call_summary ?? '',
    userTurns,
    lookupAttempted: lookupCalls.length > 0,
    lookupKeys: [...lookupKeys],
    lookupFound,
    lookupNotFound: lookupNotFound && !lookupFound,
    matchedBy,
    jobState,
    transferred,
    transferAfter: transferred ? (lookupFound ? 'found' : lookupNotFound ? 'not_found' : 'no_lookup') : null,
    transferReason: String(custom.transfer_reason ?? ''),
    messageTaken,
    jobCreated,
    outcome,
    transcriptText: renderTranscript(call.transcript_with_tool_calls, call.transcript),
  };
}

export function computeInboundFunnel(calls: ClassifiedInboundCall[]): InboundFunnelMetrics {
  const count = (f: (c: ClassifiedInboundCall) => boolean) => calls.filter(f).length;
  const durations = calls.map((c) => c.durationSec).filter((d) => d > 0).sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : 0;
  const tally = <K extends string>(key: (c: ClassifiedInboundCall) => K): Array<{ k: K; count: number }> => {
    const m = new Map<K, number>();
    for (const c of calls) m.set(key(c), (m.get(key(c)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, count: n }));
  };
  return {
    calls: calls.length,
    conversations: count((c) => c.outcome !== 'no_conversation'),
    noConversation: count((c) => c.outcome === 'no_conversation'),
    lookups: count((c) => c.lookupAttempted),
    found: count((c) => c.lookupFound),
    notFound: count((c) => c.lookupNotFound),
    foundByCallerId: count((c) => c.matchedBy === 'caller_id'),
    foundClosed: count((c) => c.lookupFound && (c.jobState === 'completed' || c.jobState === 'canceled')),
    transferred: count((c) => c.transferred),
    transferredAfterFound: count((c) => c.transferAfter === 'found'),
    transferredAfterNotFound: count((c) => c.transferAfter === 'not_found'),
    transferredNoLookup: count((c) => c.transferAfter === 'no_lookup'),
    messagesTaken: count((c) => c.messageTaken),
    jobsCreated: count((c) => c.jobCreated),
    medianDurationSec: median,
    byBranch: tally((c) => c.branch || 'unknown').map((x) => ({ branch: x.k, count: x.count })),
    byOutcome: tally((c) => c.outcome).map((x) => ({ outcome: x.k, count: x.count })),
  };
}

/**
 * Which calls the analyst reads: every transfer and every not-found first
 * (that is where the failures are), then found-and-answered, then the rest.
 */
export function sampleForReview(calls: ClassifiedInboundCall[], max: number): ClassifiedInboundCall[] {
  const rank = (c: ClassifiedInboundCall): number =>
    c.transferred ? 0 : c.lookupNotFound ? 1 : c.messageTaken || c.jobCreated ? 2 : c.lookupFound ? 3 : c.outcome === 'no_conversation' ? 5 : 4;
  return [...calls].sort((a, b) => rank(a) - rank(b) || b.durationSec - a.durationSec).slice(0, max);
}
