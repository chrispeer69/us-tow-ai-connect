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

const NEWLINE = new RegExp("\r?\n");
const AGENT_LINE = new RegExp("^\s*(agent|assistant|ray)\s*:\s*(.*)$", "i");

/** Turns spoken by the AGENT. Mirrors customerTurns. */
export function agentTurns(transcript: string | null | undefined): string[] {
  if (!transcript) return [];
  const turns: string[] = [];
  const lines = transcript.split(NEWLINE);
  for (const line of lines) {
    const m = line.match(AGENT_LINE);
    if (m && m[2].trim()) turns.push(m[2].trim());
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

  // The agent's SELF-REPORT is not sufficient on its own.
  //
  // 2026-08-20, J&J Auto Towing: the call reached voicemail, the agent read its
  // own opt-out line to the answering machine ("Understood — I'll take you off
  // the list right now"), then reported opted_out: true. Nobody had asked for
  // anything. Trusting that flag permanently suppressed a live prospect on the
  // strength of the agent talking to itself.
  //
  // A person can only opt out if a person was there. So the flag is honoured
  // ONLY when a human actually spoke and the call did not reach voicemail;
  // otherwise the customer's own words are the only evidence that counts.
  const agentSaysOptOut = readBool(input.analysis, 'opted_out');
  const reason0 = (input.disconnectionReason || '').toLowerCase();
  const hitVoicemail =
    reason0.includes('voicemail') || readBool(input.analysis, 'reached_voicemail') === true;
  const humanWasPresent = turns.length > 0 && !hitVoicemail;

  if (optOutQuote || (agentSaysOptOut === true && humanWasPresent)) {
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
  //
  // RAY MUST ACTUALLY HAVE SPOKEN. On 2026-08-22 this rule was "15 seconds and
  // any user turn", which scored a phone tree looping its own menu for ninety
  // seconds as a successful pitch. 33 of 91 reported PITCHED calls had NO agent
  // speech in them at all, and the day's pitch rate was reported as 42% when
  // the true figure was 15%. A disposition that can be earned by silence is
  // not measuring anything.
  const agentSpoke = agentTurns(input.transcript).some((t) =>
    /alliance|profile|towing owner|dot com/i.test(t),
  );
  if (!agentSpoke) {
    return {
      disposition: 'RETRY',
      reason: 'agent_never_spoke',
      optOutQuote: null,
      callbackTime,
    };
  }

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
 * Did a human actually hear a script on this call?
 *
 * This is the line the three-stage cadence advances on. A voicemail is a
 * delivery in the sense that the words were spoken, but nobody heard stage one
 * and decided anything, so it does not consume a stage — the next dial replays
 * the same stage to a live person.
 */
export function wasDelivered(disposition: CampaignDisposition): boolean {
  return (
    disposition === 'PITCHED' ||
    disposition === 'NOT_INTERESTED' ||
    disposition === 'WARM' ||
    disposition === 'DNC'
  );
}

/**
 * Which stage of the script to read on the next dial, 1-based.
 *
 * Chris, 2026-08-22: "all calls get stage 1 (day 1) stage 2 (day 3) stage 3
 * (day 5) — then the calls to that number stop". So the stage is the DIAL
 * number: a fixed, finite, three-swing sequence per number with a known end
 * date, not a sequence that stretches until three pitches happen to land.
 *
 * The cost of that choice is that somebody who misses the first two hears
 * stage three first. It stays acceptable because stage three names the
 * Alliance, the free profile and the website on its own — and because the
 * alternative, a lead that never answers looping stage one for eighteen days,
 * buys nothing and ends nowhere. Deliveries are still counted, in `touches`,
 * for the end-of-cycle report.
 */
export function stageForNextCall(dialNumber: number, targetTouches: number): number {
  return Math.min(Math.max(dialNumber, 1), Math.max(targetTouches, 1) + 1);
}

/**
 * What the lead's status becomes after this call.
 *
 * `touches` is the count INCLUDING this call, so a lead that has just heard
 * stage one arrives here with touches = 1.
 *
 * NOTE what does NOT retire a lead:
 *   PITCHED — until every stage has been delivered. Retiring somebody the
 *             moment they hear stage one guarantees that the only people who
 *             ever hear the name are the ones who never pick up. Name
 *             recognition is the whole objective, and it comes from stages
 *             two and three.
 *   WARM    — flagged for Chris, deliberately left in the list (spec section 6).
 *   VM      — the words were spoken but nobody heard them; retryable until the
 *             attempt cap.
 *
 * And what always does:
 *   DNC            — they asked. Never again, at any stage.
 *   NOT_INTERESTED — they heard the offer and said no. Two more calls after a
 *                    no is not repetition, it is pestering, and it is how a
 *                    number gets blocked by a carrier.
 */
export function nextLeadStatus(
  disposition: CampaignDisposition,
  attempts: number,
  maxAttempts: number,
  touches = Number.POSITIVE_INFINITY,
  targetTouches = 1,
): LeadStatusAfterCall {
  // ---- Heard us and answered the question. -------------------------------
  if (disposition === 'DNC') return 'DNC';
  if (disposition === 'NOT_INTERESTED') return 'PITCHED';
  if (disposition === 'WARM') return 'WARM';

  if (disposition === 'PITCHED') {
    // Answering does NOT end the sequence. Retiring a lead the moment it heard
    // stage one meant the only numbers that ever received stages two and three
    // were the ones that never picked up — the cadence was firing exclusively
    // at people who had heard nothing. Every number gets its three swings
    // unless it asks us to stop.
    if (attempts < maxAttempts) return 'RETRY';
    return 'PITCHED';
  }

  // ---- Never reached them. Keep trying, up to the campaign's cap. ---------
  //
  // Chris, 2026-08-20: "if an attempt was not a success - repeat the call until
  // it is a success". Read literally that is dialling somebody forever, which
  // is harassment and is what TCPA complaints are made of. Read as intended it
  // means: do not give up on a number we never actually reached. The 2026-08-20
  // batch is the case for it — 33 of 61 calls ended without a human hearing
  // anything: 9 never answered, 22 hung up inside ten seconds, 2 were dead.
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
