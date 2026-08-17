/**
 * Session 76 — "did the call actually finish?"
 *
 * Chris, 2026-08-17: "If a call dies with a sales logic pitch I want the agent to
 * immediately call the customer back again — we must complete the call — no less
 * than 3 attempts."
 *
 * WHY THIS IS A SEPARATE MODULE. The existing retry path in
 * OutboundVoiceService only fires on `['failed','no_answer','busy','rejected']`
 * — i.e. calls that never connected. A call that connects, runs 19 seconds and
 * dies mid-intake maps to `completed` (Retell reports `user_hangup`), so it was
 * never retried. On the morning of 2026-08-17, 6 of 12 calls ended under 35
 * seconds and one of ten flip-eligible jobs ever heard an offer. Those are not
 * failed dials; they are abandoned conversations, and they were invisible to the
 * retry logic.
 *
 * THE HARD PART IS NOT RETRYING — IT IS NOT RETRYING TOO MUCH. Three of the
 * calls that morning were tagged `agent_judged_flip_not_appropriate` after a
 * full 200-second intake, and in each case the agent was RIGHT: the club ticket
 * said "Steagalls Mobile Auto Service" and the customer said "her residence";
 * it said "AutoZone Auto Parts" and the customer said "storage facility", after
 * a collision. Redialling those customers three times to pitch a repair shop
 * they have no use for is worse than losing the flip. So the verdict below turns
 * on *whether the conversation reached a resolution*, never on whether we got
 * what we wanted from it.
 *
 * Ordering is deliberate and load-bearing: an opt-out beats everything, then
 * "there was never a pitch to make", then "the pitch reached a decision", and
 * only what survives all three is a genuine abandonment.
 */

/** Verdicts. Only ABANDONED redials. */
export type PitchOutcome =
  /** Customer asked not to be contacted. Never call again, at any attempt count. */
  | 'BLOCKED'
  /** No flip was ever on the table for this job — nothing to complete. */
  | 'NOT_APPLICABLE'
  /** The conversation reached a decision (won, declined, or correctly suppressed). */
  | 'RESOLVED'
  /** Connected, then died before the pitch reached a decision. Redial. */
  | 'ABANDONED';

export interface PitchVerdict {
  outcome: PitchOutcome;
  /** Stable machine-readable reason, logged and stored for auditing. */
  reason: string;
}

export interface PitchCompletionInput {
  /** Our mapped terminal status (`completed`, `no_answer`, …). */
  status: string;
  /** Retell `disconnection_reason`, when present. */
  disconnectionReason?: string | null;
  durationSeconds?: number | null;
  transcript?: string | null;
  /**
   * Post-call analysis from the provider. `flip_eligible` here is the AGENT's
   * judgment after the conversation, which is not the same thing as ours.
   */
  analysis?: {
    flip_eligible?: boolean | null;
    flip_outcome?: string | null;
    offer_1_result?: string | null;
    offer_2_result?: string | null;
    offer_3_result?: string | null;
  } | null;
  /**
   * OUR pre-call gate's decision — whether this job had a flip to pitch at all.
   * Sourced from `outbound_call_logs.flip_eligible`. When false (auto body,
   * destination is our own shop, no partner shop in range) there is no pitch to
   * complete and no reason to redial.
   */
  jobFlipEligible: boolean;
}

/**
 * A conversation this long has, by observation, run the whole intake — pickup,
 * destination, vehicle, issue, parking, tires, keys — which is the point at
 * which the agent has enough to judge the flip honestly. Below it, an
 * `agent_judged_flip_not_appropriate` means "the call died", not "the agent
 * decided". Both 200-second suppressions on 2026-08-17 were correct; every
 * sub-35-second one was a hangup.
 *
 * Tunable via OUTBOUND_RETRY_INTAKE_COMPLETE_SECONDS. Kept well above the
 * 111-second floor below which no win has ever occurred, so we err toward
 * calling back rather than toward assuming a judgment happened.
 */
export const DEFAULT_INTAKE_COMPLETE_SECONDS = 150;

/**
 * Do-not-call phrases, matched against the CUSTOMER's turns only.
 *
 * Scoping to user turns is not a nicety: the agent's own closing script says
 * things like "I've just texted you the link", and an opt-out regex run over the
 * whole transcript would eventually match agent text and silently disable
 * retries for everyone. Parse speakers, then match.
 */
const OPT_OUT_PATTERNS: RegExp[] = [
  /\bdo not call\b/i,
  /\bdon'?t call\b/i,
  /\bstop calling\b/i,
  /\bquit calling\b/i,
  /\bnever call\b/i,
  /\btake me off\b/i,
  /\bremove me from\b/i,
  /\bno more calls\b/i,
  /\bdo not contact\b/i,
  /\bdon'?t contact\b/i,
  /\bunsubscribe\b/i,
];

/** Offer/outcome values that mean the customer actually answered the pitch. */
const DECIDED_OFFER_RESULTS = new Set(['ACCEPTED', 'DECLINED']);

/**
 * Extract just the customer's speech from a Retell transcript.
 *
 * Transcript format is line-oriented `Agent: …` / `User: …`, and a single
 * speaker turn can wrap across lines — continuation lines carry no prefix and
 * belong to whoever spoke last.
 */
export function extractUserSpeech(transcript: string | null | undefined): string {
  const text = (transcript ?? '').trim();
  if (!text) return '';
  const out: string[] = [];
  let inUserTurn = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const speaker = line.match(/^(agent|user|assistant|customer|bot)\s*:\s*(.*)$/i);
    if (speaker) {
      const who = speaker[1].toLowerCase();
      inUserTurn = who === 'user' || who === 'customer';
      if (inUserTurn && speaker[2]) out.push(speaker[2]);
      continue;
    }
    // Unprefixed continuation of the previous turn.
    if (inUserTurn) out.push(line);
  }
  return out.join(' ');
}

/**
 * Did the customer ask us to stop calling?
 *
 * Normalized before matching so "don’t call me" (typographic apostrophe, which
 * is what a transcript usually contains) is caught by the same pattern as
 * "don't call me". An opt-out we fail to detect is one we then dial twice more.
 */
export function hasOptOut(transcript: string | null | undefined): boolean {
  const userSpeech = normalizeForMatch(extractUserSpeech(transcript));
  if (!userSpeech) return false;
  return OPT_OUT_PATTERNS.some((p) => p.test(userSpeech));
}

function normalizeResult(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

/**
 * Lowercase, unify the apostrophe, and collapse whitespace.
 *
 * The close marker is "you're all set". The script file writes a straight
 * apostrophe; a transcript can come back with a typographic one, and matching
 * would silently fail on every single call — which fails in the dangerous
 * direction, because a missed close reads as an abandoned pitch and triggers a
 * redial of a customer we already said goodbye to.
 */
function normalizeForMatch(text: string | null | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/\s+/g, ' ');
}

/**
 * Decide whether this call still owes the customer a conversation.
 *
 * `closeMarkers` are the stable opening words of the script's closing block,
 * passed in from flip-scripts so the script text stays the single source of
 * truth. An agent that reached its close finished the call by definition, even
 * if the flip lost.
 */
export function judgePitchCompletion(
  input: PitchCompletionInput,
  opts: { intakeCompleteSeconds?: number; closeMarkers?: readonly string[] } = {},
): PitchVerdict {
  const intakeCompleteSeconds = opts.intakeCompleteSeconds ?? DEFAULT_INTAKE_COMPLETE_SECONDS;
  const closeMarkers = opts.closeMarkers ?? [];
  const analysis = input.analysis ?? {};
  const duration = input.durationSeconds ?? 0;

  // 1. Opt-out outranks everything, including an unfinished pitch. A customer
  //    who said "stop calling" has completed the call in the only sense that
  //    matters.
  if (hasOptOut(input.transcript)) {
    return { outcome: 'BLOCKED', reason: 'customer_opted_out' };
  }

  // 2. Nothing to pitch. Auto body, our own shop, no partner in range. The two
  //    CARSTAR / Crash Champions calls on 2026-08-17 land here.
  if (!input.jobFlipEligible) {
    return { outcome: 'NOT_APPLICABLE', reason: 'job_not_flip_eligible' };
  }

  // 3a. The customer answered the pitch — won or lost, it is settled. We do not
  //     re-pitch a decline; that is harassment dressed as persistence.
  const flipOutcome = normalizeResult(analysis.flip_outcome);
  if (flipOutcome === 'ACCEPTED') {
    return { outcome: 'RESOLVED', reason: 'flip_accepted' };
  }
  const offerResults = [
    normalizeResult(analysis.offer_1_result),
    normalizeResult(analysis.offer_2_result),
    normalizeResult(analysis.offer_3_result),
  ];
  if (offerResults.some((r) => DECIDED_OFFER_RESULTS.has(r))) {
    return { outcome: 'RESOLVED', reason: 'offer_decided_by_customer' };
  }

  // 3b. The agent reached its closing block, so the conversation ran its course
  //     whatever the flip did.
  if (closeMarkers.length > 0) {
    const transcript = normalizeForMatch(input.transcript);
    if (transcript && closeMarkers.some((m) => m && transcript.includes(normalizeForMatch(m)))) {
      return { outcome: 'RESOLVED', reason: 'agent_reached_close' };
    }
  }

  // 3c. A full intake ran and the agent then judged the flip inapplicable.
  //     This is the Steagalls ("her residence") and AutoZone ("storage
  //     facility") case: our ticket-derived gate was wrong, the agent was
  //     right, and redialling would pitch a shop the customer cannot use.
  if (analysis.flip_eligible === false && duration >= intakeCompleteSeconds) {
    return { outcome: 'RESOLVED', reason: 'agent_judged_not_appropriate_after_full_intake' };
  }

  // 4. Everything left is a conversation that stopped early. Voicemail and
  //     dead dials are already handled upstream by the connection-failure retry
  //     path; what reaches here and abandons is the case Chris asked for — the
  //     pitch died on a live call.
  return {
    outcome: 'ABANDONED',
    reason: abandonReason(input.disconnectionReason, duration, analysis.flip_eligible),
  };
}

/** Best available description of *how* it died, for the audit trail. */
function abandonReason(
  disconnectionReason: string | null | undefined,
  duration: number,
  agentFlipEligible: boolean | null | undefined,
): string {
  const reason = (disconnectionReason ?? '').trim().toLowerCase();
  if (reason === 'user_hangup') return `hangup_before_pitch_${duration}s`;
  if (reason === 'agent_hangup') return `agent_ended_before_pitch_${duration}s`;
  if (reason === 'voicemail') return 'voicemail_no_pitch';
  if (reason) return `${reason.slice(0, 40)}_before_pitch_${duration}s`;
  if (agentFlipEligible === false) return `judged_ineligible_on_short_call_${duration}s`;
  return `ended_before_pitch_${duration}s`;
}
