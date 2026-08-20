/**
 * Session 78 — deciding what an outreach call actually did.
 *
 * Chris's spec (2026-08-20 §6) gives five rules:
 *   human answered + full pitch      -> PITCHED
 *   voicemail                        -> VM
 *   no answer / busy                 -> RETRY
 *   opt-out language                 -> DNC   (auto-suppress)
 *   verbal "I'll go claim it"        -> WARM  (flag, do NOT auto-remove)
 *
 * Two things below are not obvious and both were learned the expensive way on
 * the flip dialler:
 *
 * 1. OPT-OUT IS MATCHED AGAINST THE CUSTOMER'S TURNS ONLY. Ray's own script
 *    says, verbatim, "Understood — I'll take you off the list right now."
 *    A regex run over the whole transcript matches that agent line on every
 *    successful opt-out AND on any call where Ray says it defensively — and
 *    then the suppression list quietly swallows the campaign. The same bug is
 *    documented in `outbound-voice/pitch-completion.ts`; parse speakers first.
 *
 * 2. THE PROVIDER'S ENUM IS NOT OUR TAXONOMY. `flip_outcome` on the tow agent
 *    emits FAILED for "customer declined", which fell through the normalizer
 *    unmapped and left DECLINED structurally unreachable for eight days. Every
 *    value the agent can emit is therefore mapped EXPLICITLY here, and anything
 *    unrecognized becomes ERROR rather than being written through raw.
 */

export type CampaignDisposition =
  | 'PITCHED'
  | 'VM'
  | 'RETRY'
  | 'DNC'
  | 'WARM'
  | 'GATEKEEPER'
  | 'NOT_INTERESTED'
  | 'ERROR';

/** Lead statuses the dialler writes back after a call. */
export type LeadStatusAfterCall =
  | 'PITCHED'
  | 'VM'
  | 'RETRY'
  | 'DNC'
  | 'WARM'
  | 'EXHAUSTED'
  | 'INVALID';

export interface DispositionInput {
  /** Our mapped call status: completed | no_answer | busy | failed | error. */
  status: string;
  disconnectionReason?: string | null;
  durationSeconds?: number | null;
  transcript?: string | null;
  /** Structured post-call answers from the agent. */
  analysis?: Record<string, unknown> | null;
}

export interface DispositionResult {
  disposition: CampaignDisposition;
  /** Stable machine-readable explanation, stored for auditing. */
  reason: string;
  /** Set when the customer opted out — the exact words, for the record. */
  optOutQuote: string | null;
  /** Gatekeeper callback time, when one was captured. */
  callbackTime: string | null;
}

/**
 * Opt-out phrases, matched against CUSTOMER turns only. See note 1 above.
 *
 * Kept deliberately broad. A false positive costs one lead out of hundreds; a
 * false negative means calling back somebody who told us to stop, which is the
 * one outcome with real consequences.
 */
const OPT_OUT_PATTERNS: RegExp[] = [
  /\bdo not call\b/i,
  /\bdon'?t call\b/i,
  /\bstop calling\b/i,
  /\bquit calling\b/i,
  /\bnever call\b/i,
  /\bno more calls?\b/i,
  /\btake me off\b/i,
  /\btake us off\b/i,
  /\bremove me\b/i,
  /\bremove us\b/i,
  /\bremove my number\b/i,
  /\bdo not contact\b/i,
  /\bdon'?t contact\b/i,
  /\bunsubscribe\b/i,
  /\bopt me out\b/i,
  /\bdo-?not-?call list\b/i,
  /\blose (?:my|this) number\b/i,
  /\bstop bothering\b/i,
];

/**
 * Warm-intent phrases. These flag for Chris; they never auto-remove the lead,
 * because "yeah I'll check it out" is said far more often than it is done and
 * removing on it would silently shrink the list.
 */
const WARM_PATTERNS: RegExp[] = [
  /\bi'?ll (?:go )?(?:check|look|claim|sign|do) (?:it|that|them)? ?(?:out|up)?\b/i,
  /\bi'?ll take a look\b/i,
  /\bgo (?:on(?:to)?|to) (?:the )?(?:site|website)\b/i,
  /\bsend me\b/i,
  /\bsounds good\b/i,
  /\bsounds interesting\b/i,
  /\bwrite (?:that|it) down\b/i,
  /\bgot a pen\b/i,
  /\bwhat'?s the (?:site|website|url|address) again\b/i,
  /\bspell that\b/i,
];

/** Explicit rejection, distinct from opt-out: "not interested" is not "never call". */
const NOT_INTERESTED_PATTERNS: RegExp[] = [
  /\bnot interested\b/i,
  /\bno thanks?\b/i,
  /\bwe'?re (?:all )?(?:set|good)\b/i,
  /\bnot (?:right )?now\b/i,
  /\bpass\b/i,
];

/**
 * Turns spoken by the customer, lowercased.
 *
 * Retell transcripts are line-oriented, "Agent: ..." / "User: ...". Anything
 * unattributed is dropped rather than assumed to be the customer — assuming
 * would re-introduce exactly the bug note 1 warns about.
 */
export function customerTurns(transcript: string | null | undefined): string[] {
  if (!transcript) return [];
  const turns: string[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const match = line.match(/^\s*(user|customer|human|caller)\s*:\s*(.*)$/i);
    if (match && match[2].trim()) turns.push(match[2].trim());
  }
  return turns;
}

/** First customer turn matching any pattern, or null. */
function findMatch(turns: string[], patterns: RegExp[]): string | null {
  for (const turn of turns) {
    for (const pattern of patterns) {
      if (pattern.test(turn)) return turn;
    }
  }
  return null;
}

function readString(analysis: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!analysis) return null;
  const direct = analysis[key];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  // Retell nests custom fields under call_analysis.custom_analysis_data.
  const custom = analysis.custom_analysis_data;
  if (custom && typeof custom === 'object') {
    const nested = (custom as Record<string, unknown>)[key];
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return null;
}

function readBool(analysis: Record<string, unknown> | null | undefined, key: string): boolean | null {
  if (!analysis) return null;
  const pick = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  const direct = pick(analysis[key]);
  if (direct !== null) return direct;
  const custom = analysis.custom_analysis_data;
  if (custom && typeof custom === 'object') {
    return pick((custom as Record<string, unknown>)[key]);
  }
  return null;
}

/**
 * A call this short did not deliver the pitch.
 *
 * Ray's script is ~22 seconds read aloud. Anything under this is a hangup, a
 * wrong number, or an IVR — not a pitch, whatever the agent claims in its
 * post-call answers.
 */
export const MIN_PITCH_SECONDS = 15;

export function decideDisposition(input: DispositionInput): DispositionResult {
  const turns = customerTurns(input.transcript);
  const duration = input.durationSeconds ?? 0;

  // ---- 1. Opt-out beats everything, at any duration, on any status. --------
  // Checked before the dial-status branch on purpose: somebody can say "take me
  // off your list" and hang up, which Retell reports as a short user_hangup.
  const optOutQuote = findMatch(turns, OPT_OUT_PATTERNS);
  const agentSaysOptOut = readBool(input.analysis, 'opted_out');
  if (optOutQuote || agentSaysOptOut === true) {
    return {
      disposition: 'DNC',
      reason: optOutQuote ? 'customer_opt_out_phrase' : 'agent_reported_opt_out',
      optOutQuote: optOutQuote ?? null,
      callbackTime: null,
    };
  }

  // ---- 2. The call never connected. ---------------------------------------
  if (input.status === 'no_answer' || input.status === 'busy') {
    return { disposition: 'RETRY', reason: `dial_${input.status}`, optOutQuote: null, callbackTime: null };
  }
  if (input.status === 'failed' || input.status === 'error') {
    return { disposition: 'ERROR', reason: `dial_${input.status}`, optOutQuote: null, callbackTime: null };
  }

  // ---- 3. Voicemail. ------------------------------------------------------
  // Retell's own detection is authoritative when it fires; the analysis flag is
  // the fallback for calls where detection ran late.
  const reason = (input.disconnectionReason || '').toLowerCase();
  if (reason.includes('voicemail') || readBool(input.analysis, 'reached_voicemail') === true) {
    return { disposition: 'VM', reason: 'voicemail_detected', optOutQuote: null, callbackTime: null };
  }

  // ---- 4. Gatekeeper. -----------------------------------------------------
  // Ray is told not to pitch a receptionist, so a gatekeeper call is a
  // successful call that intentionally contains no pitch. It must not be
  // counted as an abandoned one and must not be retried as if nobody answered.
  const callbackTime = readString(input.analysis, 'callback_time');
  if (readBool(input.analysis, 'reached_gatekeeper') === true) {
    return {
      disposition: 'GATEKEEPER',
      reason: 'gatekeeper_not_decision_maker',
      optOutQuote: null,
      callbackTime,
    };
  }

  // ---- 5. Too short to have been a pitch. ---------------------------------
  if (duration > 0 && duration < MIN_PITCH_SECONDS) {
    return {
      disposition: 'RETRY',
      reason: `abandoned_${Math.round(duration)}s`,
      optOutQuote: null,
      callbackTime,
    };
  }

  // ---- 6. Warm intent. ----------------------------------------------------
  const warmQuote = findMatch(turns, WARM_PATTERNS);
  const agentSaysWarm = readBool(input.analysis, 'will_claim_profile');
  if (agentSaysWarm === true || warmQuote) {
    return {
      disposition: 'WARM',
      reason: agentSaysWarm === true ? 'agent_reported_intent' : 'customer_intent_phrase',
      optOutQuote: null,
      callbackTime,
    };
  }

  // ---- 7. Explicit no. ----------------------------------------------------
  // Distinct from DNC. "Not interested" declines the offer; it does not
  // withdraw consent to ever be called again, and conflating the two would
  // shrink the list far faster than the opt-outs warrant.
  if (findMatch(turns, NOT_INTERESTED_PATTERNS)) {
    return {
      disposition: 'NOT_INTERESTED',
      reason: 'customer_declined',
      optOutQuote: null,
      callbackTime,
    };
  }

  // ---- 8. A human heard it. -----------------------------------------------
  const pitchDelivered = readBool(input.analysis, 'pitch_delivered');
  if (pitchDelivered === true || (turns.length > 0 && duration >= MIN_PITCH_SECONDS)) {
    return { disposition: 'PITCHED', reason: 'pitch_delivered', optOutQuote: null, callbackTime };
  }

  // Connected, ran long enough, but nobody ever spoke. An IVR or hold music.
  return {
    disposition: 'RETRY',
    reason: 'no_human_speech',
    optOutQuote: null,
    callbackTime,
  };
}

/**
 * What the lead's status becomes after this call.
 *
 * NOTE the two that do NOT retire a lead:
 *   WARM  — flagged for Chris, deliberately left in the list (spec §6).
 *   VM    — a voicemail is a delivery, but the spec allows 2 attempts, so a
 *           first VM stays retryable and a second exhausts.
 */
export function nextLeadStatus(
  disposition: CampaignDisposition,
  attempts: number,
  maxAttempts: number,
): LeadStatusAfterCall {
  if (disposition === 'DNC') return 'DNC';
  if (disposition === 'WARM') return 'WARM';
  if (disposition === 'PITCHED' || disposition === 'NOT_INTERESTED') return 'PITCHED';

  const exhausted = attempts >= maxAttempts;
  if (disposition === 'VM') return exhausted ? 'EXHAUSTED' : 'VM';
  if (disposition === 'GATEKEEPER') return exhausted ? 'EXHAUSTED' : 'RETRY';
  if (disposition === 'RETRY' || disposition === 'ERROR') {
    return exhausted ? 'EXHAUSTED' : 'RETRY';
  }
  return 'RETRY';
}

/** Dispositions that mean the lead should never be dialled again. */
export const TERMINAL_DISPOSITIONS: ReadonlySet<CampaignDisposition> = new Set<CampaignDisposition>([
  'DNC',
  'PITCHED',
  'NOT_INTERESTED',
]);
