/**
 * Session 76 — the single place a Retell call object becomes our call state.
 *
 * Extracted from RetellWebhookController so the reconciliation sweep, which
 * PULLS the same object from `GET /v2/get-call`, cannot drift from the webhook
 * that PUSHES it. Two copies of this mapping would eventually disagree about
 * what a call did, and the disagreement would surface as a phantom win or a
 * redial of a customer who already said yes.
 */

/** Retell's post-call analysis, flattened. Fields live at the root or under
 *  `custom_analysis_data` depending on how the agent was configured, so both
 *  are checked for every key. */
export interface RetellAnalysisFields {
  call_summary: string | null;
  call_successful: boolean | null;
  user_sentiment: string | null;
  flip_eligible: boolean | null;
  flip_outcome: string | null;
  offer_1_result: string | null;
  offer_2_result: string | null;
  offer_3_result: string | null;
  convini_link_sent: boolean | null;
  convini_sell_type: string | null;
  corrections_made: string | null;
  nearest_our_shop: string | null;
  destination_type: string | null;
  /**
   * Dispatch intake, added for the AI Notes write-back (Session 76).
   *
   * The script has asked all four on every call since 2026-08-15 — where the
   * vehicle is parked and nose-in/out, whether all four tires are up, whether
   * the customer will be there with the keys, and colour/drivetrain asked open
   * because the club ticket is only ~50% right on both. The answers are spoken
   * on the call and then thrown away: nothing extracts them, so the composer's
   * KEYS / ACCESS / CONDITION / VEHICLE lines have never had anything to render.
   *
   * Reading them here is half the fix. The other half is a Retell post-call
   * analysis field per line — until the agent emits them these stay null and the
   * composer correctly renders nothing rather than inventing it.
   */
  keys_and_presence: string | null;
  access_notes: string | null;
  vehicle_condition: string | null;
  vehicle_details: string | null;
  issue_description: string | null;
  confirmed_destination: string | null;
  new_destination: string | null;
}

export function extractRetellAnalysis(
  callAnalysis: Record<string, unknown> | null | undefined,
): RetellAnalysisFields {
  const analysis = callAnalysis ?? {};
  const custom = (analysis.custom_analysis_data as Record<string, unknown> | undefined) ?? {};
  const pick = (key: string): unknown => analysis[key] ?? custom[key];

  return {
    call_summary: (pick('call_summary') as string) ?? null,
    call_successful: (pick('call_successful') as boolean) ?? null,
    user_sentiment: (pick('user_sentiment') as string) ?? null,
    flip_eligible: (pick('flip_eligible') as boolean) ?? null,
    flip_outcome: (pick('flip_outcome') as string) ?? null,
    offer_1_result: (pick('offer_1_result') as string) ?? null,
    offer_2_result: (pick('offer_2_result') as string) ?? null,
    offer_3_result: (pick('offer_3_result') as string) ?? null,
    convini_link_sent: (pick('convini_link_sent') as boolean) ?? null,
    convini_sell_type: (pick('convini_sell_type') as string) ?? null,
    corrections_made: (pick('corrections_made') as string) ?? null,
    nearest_our_shop: (pick('nearest_our_shop') as string) ?? null,
    destination_type: (pick('destination_type') as string) ?? null,
    keys_and_presence: (pick('keys_and_presence') as string) ?? null,
    access_notes: (pick('access_notes') as string) ?? null,
    vehicle_condition: (pick('vehicle_condition') as string) ?? null,
    vehicle_details: (pick('vehicle_details') as string) ?? null,
    issue_description: (pick('issue_description') as string) ?? null,
    confirmed_destination: (pick('confirmed_destination') as string) ?? null,
    new_destination: (pick('new_destination') as string) ?? null,
  };
}

/**
 * Retell event/status → the status string `mapProviderStatus` understands.
 *
 * `event` is absent when reconciling (a pulled snapshot has no event), so
 * `call_status` and `disconnection_reason` carry the mapping on their own — which
 * they can, because `disconnection_reason` is only ever set on a finished call.
 */
/**
 * A call this short never reached a person, whatever the provider called it.
 *
 * 2026-08-19: four of the morning's ten dials were answering services — the
 * screening kind that says "record your name and reason for calling and I'll
 * see if this person is available". Retell does not flag those as voicemail
 * (they genuinely are a live human voice), the agent correctly gives up, and
 * the hangup arrives as `agent_hangup`. That mapped to COMPLETED regardless of
 * length, so a 4-second call to a machine was filed as a finished conversation
 * and never redialled.
 *
 * 30s is chosen from the data rather than taste: on 2026-08-18 no call under 40s
 * ever produced an offer, and the real conversations that morning ran 126s,
 * 217s and 252s. Nothing legitimate finishes in half a minute — the agent has
 * not even confirmed the pickup address by then.
 */
const NOT_REALLY_CONNECTED_SECONDS = 30;

export function mapRetellStatus(input: {
  event?: 'call_started' | 'call_ended' | 'call_analyzed';
  call_status?: string;
  disconnection_reason?: string;
  /** Optional: when present, an implausibly short "completed" call is treated
   *  as never connected so it re-enters the retry ladder. */
  duration_seconds?: number | null;
}): string {
  const { event, call_status: callStatus } = input;
  if (event === 'call_started') return 'in_progress';

  const reason = input.disconnection_reason?.toLowerCase();
  if (event === 'call_ended' || event === 'call_analyzed' || !event) {
    if (reason === 'user_hangup' || reason === 'agent_hangup' || reason === 'call_transfer') {
      // A hangup this fast is a machine, a wrong number, or a screening service
      // — not a conversation. Send it back round the retry ladder instead of
      // filing it as done. call_transfer is exempt: a transfer IS the outcome,
      // however quickly it happens.
      const secs = input.duration_seconds;
      if (
        reason !== 'call_transfer' &&
        typeof secs === 'number' &&
        secs < NOT_REALLY_CONNECTED_SECONDS
      ) {
        return 'no_answer';
      }
      return 'completed';
    }
    // Retell's actual reason string is `voicemail_reached`, not `voicemail`.
    // This tested only the short form, so every voicemail fell through to the
    // `call_status === 'ended'` branch below and was recorded as COMPLETED — a
    // finished call that nobody answered. It therefore never entered the retry
    // path: on 2026-08-18 that was 17 of 91 dials silently written off.
    if (reason === 'voicemail' || reason === 'voicemail_reached') return 'no_answer';
    if (reason === 'dial_busy') return 'busy';
    if (reason === 'dial_no_answer') return 'no_answer';
    if (reason === 'dial_failed' || reason === 'error') return 'failed';
    if (callStatus === 'ended') return 'completed';
    if (callStatus === 'error') return 'failed';
  }
  if (callStatus === 'ongoing') return 'in_progress';
  if (callStatus === 'registered') return 'dialing';
  return 'failed';
}
