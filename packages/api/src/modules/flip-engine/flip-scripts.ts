/**
 * Session 72 — US Tow AI-Connect outbound call scripts.
 *
 * These renderers turn a classified job into the full conversational flow the
 * outbound voice agent executes. The agent prompt is intentionally generic
 * ("deliver and follow {{body}} faithfully, converse naturally, never skip a
 * step"); ALL business logic — which scenario, which offers, what words, what
 * branches — lives HERE, in code. That is what makes the script our IP and the
 * provider swappable: Retell/Thinkrr just speak the body we render.
 *
 * Source of truth: US_Tow_AI_Connect_Call_Scripts.docx +
 * US_Tow_AI_Connect_Outbound_Logic.docx (the 4-scenario flow).
 *
 * SCENARIO ROUTING (by destination tag):
 *   competitor_repair -> Scenario A  (confirm + 3-tier flip + soft CONVINI)
 *   auto_body         -> Scenario B  (confirm + body-shop soft mention + medium CONVINI)
 *   residence/unknown -> Scenario C  (confirm + HARD CONVINI)
 *   our_shop          -> Scenario D  (VIP confirm + CONVINI)
 *   aaa_branded       -> Scenario A shape, NO flip offers (AAA hard rule) + soft CONVINI
 *
 * The body is a SCRIPTED CONVERSATION FLOW, not a monologue. Lines the agent
 * speaks are written verbatim. Branch instructions for the agent are written
 * as bracketed [AGENT: ...] directives — context the agent follows but never
 * reads aloud. Interpolation uses {{name}} straight string replacement.
 */

/**
 * Session 73 — bump this whenever the rendered wording changes in a way that
 * could move the win rate. It is stamped onto every outbound_call_logs row, and
 * it is the only thing that makes "did that change help?" answerable — a script
 * edit shipped without bumping it silently merges two populations.
 *
 * Format: `<major>.<minor>` — major for a structural change (a scenario's flow,
 * the offer ladder), minor for wording inside an existing structure.
 */
export const SCRIPT_VERSION = '2.7';
// 2.7 (2026-08-14) — NOT a wording change. This is the version at which the
//   wording changes from 2.0 onward actually began reaching customers.
//
//   Two layers of `script_blocks` overrides — global `flip_engine_defaults` and
//   the tenant's `flip_engine_config` — were replacing every spoken block with a
//   snapshot of the pre-2.0 text. Everything in this file that renders WORDS was
//   inert for seven versions: the two-leg close (2.3), the reason-finding
//   offer 2 (2.0), the honest distance phrasing (2.0), the shop address and name
//   sanitising (2.6). Only [AGENT:] directives, decision-engine logic and the
//   Retell prompt ever took effect, which is why the 08-12 and 08-13 reviews kept
//   re-reporting wording defects we believed were fixed.
//
//   Consequence for analysis: script_version 2.0–2.6 do NOT identify distinct
//   spoken scripts. Five calls on 08-14 carry a 2.6 stamp with pre-2.0 wording.
//   Do not compare across that range. 2.7 is the first trustworthy boundary.
//
//   Both override sets are backed up before removal. Code is the source of
//   truth again, as this file's own header always claimed.
// 2.6 (2026-08-14) — approved from the 08-13 review. Offer 1 and offer 2 now
//   name the shop's street address, answering the question that killed a flip
//   outright ("where actually is it?"); offer 2 adds the written-estimate
//   reassurance. Unusable customer names no longer reach the caller's ears —
//   "there", "Salvage", "Hexion-Customers" were all spoken aloud on 08-13 — and
//   the vocative now disappears entirely rather than degrading to a placeholder.
//   Shop catchment cut from 100 miles to 12: a 19-mile pitch is not credible.
// 2.5 (2026-08-13) — single flat tires are flip-eligible again, on Chris's
//   call. Low value is not no value: the job still lands at somebody's shop and
//   we were handing those over. `full_tire_set` was always eligible; this only
//   changes genuine single-tire jobs. Paired with agent v33, which removes the
//   matching self-suppression rule from the prompt — the code gate and the
//   prompt rule have to move together or the agent keeps refusing on its own.
// 2.4 (2026-08-13) — the conditional offer. Calls whose destination could not
//   be resolved before dialling now carry an offer the agent may make ONLY
//   after the customer confirms a repair destination. 142 calls in the previous
//   10 days (17% of volume) had an unresolved destination and a 4% eligibility
//   rate; the script was already asking the question and had nothing to do with
//   the answer. Every other non-eligible route keeps its hard no-offer text.
// 2.3 (2026-08-13) — two objections the agent had been answering off-script now
//   have authorized answers, both confirmed as policy by Chris: Roadside absorbs
//   an onward tow if the repair does not go ahead, and the office will check an
//   aftermarket policy with the insurer. Kept out of Offer 2 on purpose — it is
//   a diagnostic question, and stacking reassurances onto it reproduces the
//   density failure the 08-12 review found. Defect fix, not a copy experiment.
// 2.2 (2026-08-12) — body/glass referral reworded by Chris: names the insurance
//   commitment and respects it out loud, so there is nothing to push back on.
// 2.1 (2026-08-12) — body, collision and glass jobs are still called, and now
//   get a present-tense SOFT REFERRAL to our own body shops instead of the
//   generic no-offer script. Explicitly not an offer: no discount, no
//   diagnostic, no ask to switch, and the original destination is reaffirmed.
// 2.0 (2026-08-12) — 2026-08-11 review: front-loaded offer 1; offer 2 becomes a
//   reason-finding question; honest distance phrasing; offers hard-gated on a
//   named shop and on non-collision work; explicit consent required before a
//   destination change; ask for a missing destination instead of improvising.
// 1.0 — baseline at the time attribution was introduced.

export type ScenarioKey =
  | 'competitor_repair'
  | 'auto_body'
  | 'residence'
  | 'unknown'
  | 'our_shop'
  | 'aaa_branded';

/** Everything a scenario render needs. The orchestrator already computes all
 *  of these in handleJob — we just pass them through instead of pre-flattening
 *  into one string. */
export interface ScriptContext {
  // Identity / call framing
  repName: string; // AI rep's spoken name (per-tenant)
  companyName: string; // e.g. "Roadside Towing"
  motorClub: string; // e.g. "AAA"; empty -> omit "on behalf of"
  callbackNumber: string; // the ONLY number the agent may give out
  conviniLink: string; // CONVINI app link (texted, not spoken char-by-char)
  diagnosticValue?: number | null; // spoken dollar anchor for the free diagnostic

  // Customer + job
  customerFirstName: string;
  vehicle: string; // "2019 Blue Honda Civic"
  pickupLocation: string;
  destination: string; // resolved destination address/name
  issue: string; // human issue summary, e.g. "a flat tire"
  issueSubcategory?: string | null; // machine subcat for tailored clarify Qs

  // Flip data (Scenario A)
  nearestShop?: string | null;
  nearestShopDistanceMiles?: number | null;
  /**
   * Street address of the shop being offered. Twice now a customer has asked
   * where the shop actually is and the agent had only a mileage figure; on
   * 2026-08-13 the customer declined on the very next turn. The addresses were
   * in alpha_shops the whole time — they were simply never passed in.
   */
  nearestShopAddress?: string | null;

  /**
   * Session 74 — the conditional offer, for calls whose destination could not
   * be resolved before dialling.
   *
   * Eligibility is decided pre-call from a map lookup, but the truth is learned
   * mid-call: the script already asks "is it a repair shop, body shop, your
   * home, or somewhere else?". When the lookup returned `unknown` we rendered a
   * script with no offer in it at all, so a customer answering "repair shop"
   * hit an agent that had nothing to offer and was under standing orders not to
   * invent one. Over the 10 days to 2026-08-13 that was 142 calls, 17% of all
   * volume, with a 4% eligibility rate.
   *
   * These fields carry a shop the agent may offer ONLY after the customer
   * confirms a repair destination. The pre-call gate stays honest — the call is
   * still logged ineligible — but the offer is available if the call earns it.
   */
  conditionalShop?: string | null;
  conditionalShopDistanceMiles?: number | null;

  // Body-shop soft mention (Scenario B)
  bodyShop1?: string | null;
  bodyShop2?: string | null;

  // Add-ons
  rentalsAvailable: boolean; // if true, AI can mention rental cars
  pitchConvini: boolean; // if true, AI will pitch CONVINI app

  // Script overrides
  customAgentRules?: string | null;
  scriptBlocks?: {
    opening?: string | null;
    purpose?: string | null;
    confirm_pickup?: string | null;
    confirm_vehicle?: string | null;
    clarify_issue?: string | null;
    confirm_destination?: string | null;
    warm_close?: string | null;
    offer_1?: string | null;
    offer_2?: string | null;
    offer_3?: string | null;
    convini_pitch?: string | null;
  };
  globalScriptBlocks?: {
    opening?: string | null;
    purpose?: string | null;
    confirm_pickup?: string | null;
    confirm_vehicle?: string | null;
    clarify_issue?: string | null;
    confirm_destination?: string | null;
    warm_close?: string | null;
    offer_1?: string | null;
    offer_2?: string | null;
    offer_3?: string | null;
    convini_pitch?: string | null;
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_m, name) => vars[name] ?? '');
}

function normalizeLocationForCompare(value: string | null | undefined): string {
  const suffixes = new Set([
    'street',
    'st',
    'road',
    'rd',
    'avenue',
    'ave',
    'drive',
    'dr',
    'lane',
    'ln',
    'boulevard',
    'blvd',
  ]);
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((part) => part && !suffixes.has(part))
    .join('');
}

function hasSeparateDestination(ctx: ScriptContext): boolean {
  const destination = ctx.destination.trim().toLowerCase();
  if (!destination || destination === 'your destination' || destination === 'your location') {
    return false;
  }
  const pickup = normalizeLocationForCompare(ctx.pickupLocation);
  const dropoff = normalizeLocationForCompare(ctx.destination);
  return pickup.length === 0 || dropoff.length === 0 || pickup !== dropoff;
}

function destinationPlanSentence(ctx: ScriptContext): string {
  // "Your driver is headed to {{destination}}" reads as the truck's next stop,
  // and seven sampled customers on 2026-08-12 heard it as the truck skipping
  // them. Naming both legs in one sentence removes the panic and the 30-90s of
  // rework it caused, including one case that interrupted the CONVINI pitch.
  return hasSeparateDestination(ctx)
    ? 'Your driver is coming to you at {{pickup_location}} first, then taking the vehicle to {{destination}}'
    : 'Your driver is coming to you at {{pickup_location}}';
}

/** Base variable map shared by every scenario. */
/**
 * Session 74 — how far away the partner shop is, phrased honestly.
 *
 * Review of 2026-08-11 found a pitch saying "just zero miles away" for a shop in
 * a different suburb (the value rounds to 0 below half a mile), and shops 7–10
 * miles out described with the word "just". A distance claim the customer can
 * disprove by looking out of the window costs the whole pitch.
 *
 * Under 0.5 mi the rounded number is meaningless, so no distance is claimed at
 * all. "just" is reserved for genuinely near.
 */
function shopDistanceShort(miles: number | null | undefined): string {
  if (miles == null || !Number.isFinite(miles) || miles < 0.5) return '';
  const unit = miles === 1 ? 'mile' : 'miles';
  return miles <= 3
    ? `just ${miles} ${unit} from you`
    : `about ${miles} ${unit} from you`;
}

/** Collision, glass and airbag work — a mechanical diagnostic is the wrong pitch. */
const COLLISION_SUBCATEGORIES = new Set([
  'accident',
  'accident_minor',
  'accident_with_airbags',
  'airbag',
  'airbag_kw',
  'collision',
  'collision_kw',
  'crash',
]);

/** Glass-specific wording. Shared so the pattern is written exactly once. */
const GLASS_RE = /\b(glass|windshield|windscreen|window|rock chip)\b/i;

/** True when the job is specifically glass rather than general body work. */
function isGlassJob(ctx: ScriptContext): boolean {
  return GLASS_RE.test(`${ctx.issue ?? ''} ${ctx.issueSubcategory ?? ''}`);
}

/**
 * True when the job is body/collision/glass work. Four customers on 2026-08-11
 * were pitched a free MECHANICAL diagnostic at a brake shop for collision or
 * glass damage; all declined instantly and two had said "body shop" a turn
 * earlier. Checks the free-text issue too, since glass has no subcategory.
 */
function isCollisionOrGlass(ctx: ScriptContext): boolean {
  if (ctx.issueSubcategory && COLLISION_SUBCATEGORIES.has(ctx.issueSubcategory)) {
    return true;
  }
  return /\b(glass|windshield|windscreen|body work|bodywork|body shop|collision|accident|rear[- ]?end)\b/i.test(
    ctx.issue ?? '',
  );
}

/**
 * A name we should not say out loud. The dial list carries coordinate strings
 * and junk values in the name field; greeting someone as "39.9612" ends the
 * call before it starts.
 */
function isUnusableName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  if (n.length < 2) return true;
  if (/\d/.test(n) && /[.,-]/.test(n)) return true; // coordinate-ish
  if (/^[\d\s.,+-]+$/.test(n)) return true; // all digits/punctuation
  // "there" is our own empty-name placeholder leaking through as if it were a
  // real name — it produced "Am I speaking with there?" on live calls.
  // The rest are business/dispatch words seen in the customer field on
  // 2026-08-13: "Salvage", "Hexion-Customers", "Dipping".
  if (/(customers?|llc|inc\b|corp|dept|department|salvage|towing|tow yard|impound|storage|dispatch|account)/i.test(n)) {
    return true;
  }
  return /^(unknown|n\/?a|null|undefined|customer|caller|test|there|owner|driver|dipping)$/i.test(n);
}

function baseVars(ctx: ScriptContext): Record<string, string> {
  return {
    rep_name: ctx.repName,
    company_name: ctx.companyName,
    motor_club: ctx.motorClub,
    callback_number: ctx.callbackNumber,
    convini_link: ctx.conviniLink,
    diagnostic_value:
      ctx.diagnosticValue != null ? String(ctx.diagnosticValue) : '89',
    // Sanitised at the variable, not just at the greeting — an unusable name
    // otherwise still reaches the CONVINI close ("You're all set, 39.9612").
    customer_first_name: isUnusableName(ctx.customerFirstName)
      ? 'there'
      : ctx.customerFirstName,
    // A vocative that disappears entirely when we have no usable name, so the
    // close reads "You're all set." rather than "You're all set, there." or,
    // worse, "You're all set, Salvage." — both heard on 2026-08-13.
    customer_salutation: isUnusableName(ctx.customerFirstName)
      ? ''
      : `, ${ctx.customerFirstName}`,
    vehicle: ctx.vehicle,
    pickup_location: ctx.pickupLocation,
    destination: ctx.destination,
    issue: ctx.issue,
    nearest_shop: ctx.nearestShop ?? '',
    nearest_shop_address: ctx.nearestShopAddress ?? '',
    nearest_shop_distance:
      ctx.nearestShopDistanceMiles != null
        ? String(ctx.nearestShopDistanceMiles)
        : '',
    body_shop_1: ctx.bodyShop1 ?? '',
    body_shop_2: ctx.bodyShop2 ?? '',
  };
}

/** Opening + purpose, shared verbatim by all scenarios.
 *  "on behalf of {{motor_club}}" is dropped when no motor club is present. */
function openingBlock(ctx: ScriptContext, vars: Record<string, string>): string {
  // Two calls on 2026-08-11 greeted the customer with an unusable name field —
  // a coordinate string in one case. Better to ask who we're speaking to than
  // to read junk at them.
  const identify = isUnusableName(ctx.customerFirstName)
    ? `AI: "Hi, this is {{rep_name}} calling from {{company_name}} about the tow request. I'm the AI assistant helping confirm the details. Am I speaking with the owner of the vehicle?"`
    : `AI: "Hi, this is {{rep_name}} calling from {{company_name}} about the tow request. I'm the AI assistant helping confirm the details. Am I speaking with {{customer_first_name}}?"`;

  const defaultOpening = `[STEP 1 — OPENING / IDENTIFICATION]
${identify}
[AGENT: Wait for confirmation. If you reached the wrong person or voicemail, leave a brief polite message with the callback number {{callback_number}} and end the call. If you reach an automated menu, a switchboard, or a business greeting rather than a person, do not work through the menu — leave the brief message if you can and end the call.]`;

  const defaultPurpose = `[STEP 2 — PURPOSE OF CALL]
AI: "Thanks. I'll keep this quick and start with your pickup details."
[AGENT: Do not ask whether now is a good time. Proceed directly into pickup confirmation unless the customer interrupts.]`;

  const opening = ctx.scriptBlocks?.opening ?? ctx.globalScriptBlocks?.opening ?? defaultOpening;
  const purpose = ctx.scriptBlocks?.purpose ?? ctx.globalScriptBlocks?.purpose ?? defaultPurpose;

  return [interpolate(opening, vars), ``, interpolate(purpose, vars)].join('\n');
}

/** Steps 3-6: confirm pickup, vehicle, issue, destination. Shared by A/B/C/D.
 *  `clarifyIssueLine` lets each scenario tailor the issue question. */
function confirmBlock(
  ctx: ScriptContext,
  vars: Record<string, string>,
  clarifyIssueLine: string,
  options: { includeDestination?: boolean } = {},
): string {
  const includeDestination = options.includeDestination ?? true;
  const isWinchOut = ctx.issueSubcategory === 'winch_out';
  const separateDestination = hasSeparateDestination(ctx);
  const defaultPickup = `[STEP 3 — CONFIRM PICKUP LOCATION]
AI: "I have your pickup location as {{pickup_location}}. Is that correct?"
[AGENT: If the customer corrects the location, acknowledge the correction warmly and confirm the corrected version back to them. This correction will be saved to the job notes.]`;

  const defaultVehicle = `[STEP 4 — CONFIRM VEHICLE DETAILS]
AI: "And I have a {{vehicle}}. Is that right?"
[AGENT: If they correct the vehicle, acknowledge and confirm the corrected details.]`;

  const defaultIssue = `[STEP 5 — CLARIFY THE ISSUE]
${clarifyIssueLine}
[AGENT: Listen to their answer and acknowledge it in plain language so they feel heard. This detail will be saved to the job notes for the driver and mechanic.]`;

  const defaultDestination = isWinchOut
    ? `[STEP 6 — CONFIRM WINCH-OUT SERVICE LOCATION]
AI: "For this winch-out, I have the service location as {{pickup_location}}. Is that correct?"
[AGENT: Do not ask for or assume a delivery destination on winch-out calls. If the customer volunteers that they also need the vehicle towed after recovery, then confirm that destination back to them.]`
    : !separateDestination
    ? `[STEP 6 — CONFIRM SERVICE LOCATION]
AI: "I do not have a separate tow destination listed, so I have this as service at {{pickup_location}}. Is that correct?"
[AGENT: Do not ask for a delivery destination unless the customer says the vehicle also needs to be towed somewhere after the service.]`
    : `[STEP 6 — CONFIRM DELIVERY DESTINATION]
AI: "I have the destination as {{destination}}. Is that still correct, and is it a repair shop, body shop, your home, or somewhere else?"
[AGENT: Confirm the destination and capture what kind of place it is. Use that answer with the issue type to decide whether a repair-shop or body-shop offer is appropriate.]`;

  const pickup = ctx.scriptBlocks?.confirm_pickup ?? ctx.globalScriptBlocks?.confirm_pickup ?? defaultPickup;
  const vehicle = ctx.scriptBlocks?.confirm_vehicle ?? ctx.globalScriptBlocks?.confirm_vehicle ?? defaultVehicle;
  const issue = ctx.scriptBlocks?.clarify_issue ?? ctx.globalScriptBlocks?.clarify_issue ?? defaultIssue;
  const destination = ctx.scriptBlocks?.confirm_destination ?? ctx.globalScriptBlocks?.confirm_destination ?? defaultDestination;

  const blocks = [
    interpolate(pickup, vars),
    ``,
    interpolate(vehicle, vars),
    ``,
    interpolate(issue, vars),
  ];
  if (includeDestination) {
    blocks.push(``, interpolate(destination, vars));
  }
  return blocks.join('\n');
}

function issueGuidanceBlock(ctx: ScriptContext): string {
  if (ctx.issueSubcategory !== 'winch_out') return '';
  return [
    `[STEP 6B — WINCH-OUT PHOTO GUIDANCE]`,
    `[AGENT: A winch-out usually means the vehicle is stuck and needs to be pulled back onto solid ground, such as after sliding off the road, getting stuck in mud, snow, ice, rocks, or a ditch. Do not treat this as a normal repair-shop tow unless the customer says they also need a tow afterward.]`,
    `AI: "For the winch-out, please have a few photos of the situation ready. When the driver calls, they may ask you to text those photos so they can see the depth of the problem before they arrive."`,
  ].join('\n');
}

/** Warm close, shared by all scenarios. */
function warmCloseBlock(ctx: ScriptContext, vars: Record<string, string>): string {
  const defaultClose = `=== WARM CLOSE (all scenarios) ===
[AGENT: Do not ask whether the CONVINI text came through.]
AI: "Anything else before you go?"
AI: "Drive safe."
[AGENT: End the call.]`;

  const close = ctx.scriptBlocks?.warm_close ?? ctx.globalScriptBlocks?.warm_close ?? defaultClose;
  return interpolate(close, vars);
}

/** Global rules prepended to every body. */
function globalRules(ctx: ScriptContext): string {
  const lines = [
    `=== GLOBAL RULES (follow on every call; [AGENT:...] and [STEP...] lines are context, NEVER read aloud) ===`,
    `- Be a warm, reassuring dispatcher. One question at a time. Never sound like a telemarketer.`,
    `- Disclose that you are CONVINIcar's AI towing assistant at the start of the call. Do not deny being an AI if asked.`,
    `- Confirm details first. If the customer corrects something, acknowledge it and move on.`,
    `- Do not ask "is now a good time?" The customer already requested service; keep the call brief and useful.`,
    `- Only pitch a repair-shop flip when the call is repairable and the destination is not already our shop or a protected destination.`,
    // Tire jobs came off this list on 2026-08-13 — see flip-decision.engine.ts.
    // They are low-value, not no-value, and they were being given away.
    `- Do not pitch repair-shop offers for lockout, fuel delivery, jump-start-only, or winch-out-only calls.`,
    `- A flat tire IS a repair job. If the vehicle is being towed somewhere and this script contains an offer, make it — a tire arriving at a competitor's shop is still a customer we handed over.`,
    `- Make flip offers as one objection-handling flow, not three unrelated pitches. STOP the moment one is accepted.`,
    `- If the customer gives a hard decline such as "no offers", "just send the tow", "I'm not changing", or "I already know where it is going", stop pitching immediately and keep the original destination.`,
    ...(ctx.pitchConvini ? [
      `- ALWAYS send-frame the free CONVINIcar app near the close, unless the customer hung up, opted out, or asked you to stop.`,
    ] : []),
    `- Never invent prices, times, names, or addresses — use only what's provided here.`,
    // Session 74 — from the 2026-08-11 review. Each of these is a behaviour that
    // actually happened on a live call, not a hypothetical.
    `- THE SCRIPT DECIDES WHETHER TO PITCH, NOT YOU. If this script contains a repair-shop offer, make it. If it does not, there is no offer to make — do not construct one because the job "sounds like" a flip, and do not skip a written offer because you judge the customer unlikely to accept.`,
    `- If no partner shop is named anywhere in this script, we have no shop for this job. Never refer to "a partner shop", "a shop nearby", or "a shop that specializes in that" without a name from this script.`,
    `- Never promise anything about the tow itself that is not written here — in particular never tell a customer they can ride in the tow truck.`,
    // Applies everywhere, not just Scenario A: money and coverage are the two
    // subjects where an invented answer becomes a commitment we have to honour.
    `- Never tell a customer whether their insurance or warranty covers something, what it will cost them, or who will pay. If they ask and this script has no written answer, say you'll have the office confirm and move on.`,
    `- Speak only the words inside the quotation marks after "AI:". Never say "AI", never read the quotation marks, and never read a step label, a bracketed instruction, or any placeholder in double braces.`,
    `- Ask one question at a time. After a question, stop and wait for the answer — never run a question and a sign-off together.`,
    `- Never read a raw latitude/longitude pair aloud. If a location is only coordinates, say "the location we have on file" and ask the customer to describe it.`,
    `- The ONLY phone number you may give the customer is {{callback_number}}. Never read out the caller ID or any other number.`,
    ...(ctx.pitchConvini ? [
      `- When you offer the app, say "I'm texting you the link now" — do not ask permission, do not read the link aloud, and do not ask whether it came through.`,
    ] : []),
    `- Never mention Google reviews, review incentives, or gift cards during the call.`,
    `- If the customer is hostile, in danger, or asks you to stop: end the call politely and immediately.`,
  ];
  if (ctx.motorClub.toUpperCase() === 'AAA') {
    lines.push(
      `- AAA HARD RULE: never flip a AAA call whose destination is a AAA-branded facility — confirm details and go straight to the CONVINI close.`,
    );
  }
  if (ctx.customAgentRules) {
    lines.push(``, `=== TENANT CUSTOM RULES ===`, ctx.customAgentRules);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// SCENARIO A — Competitor Auto Repair Shop (confirm + 3-tier flip + soft CONVINI)
// ---------------------------------------------------------------------------

function scenarioA(ctx: ScriptContext): string {
  const clarify = `AI: "I see the issue is listed as {{issue}}. Can you tell me a little more about what happened? For example, is the engine light on, is it overheating, or did it just not start?"`;
  const vars = baseVars(ctx);
  const distanceShort = shopDistanceShort(ctx.nearestShopDistanceMiles);

  // A blank destination used to render as "I have the destination as ." — six
  // calls on 2026-08-11 spoke the raw placeholder or covered the gap with an
  // improvised phrase, and one agent could not answer when the customer asked
  // where the car was going. Ask for it outright instead of bluffing.
  const destinationIntent = hasSeparateDestination(ctx)
    ? `[STEP 6 — CONFIRM INTENDED DESTINATION WITHOUT LOCKING IT]
AI: "I have the destination as {{destination}}. Is that still correct, and is it a repair shop, body shop, your home, or somewhere else?"
[AGENT: Capture whether the destination is a repair shop, body shop, home, dealership, or something else, but do not verbally lock it yet. Use that answer with the issue type to decide whether the shop offer is appropriate. If the customer gives a hard decline such as "do not switch me", "no offers", or "just send the tow", say "Understood. I'll keep your original destination and focus on getting the driver routed." Then skip all flip offers and continue to the CONVINI close.]`
    : `[STEP 6 — DESTINATION IS MISSING: ASK, DO NOT GUESS]
AI: "I want to make sure I have the right drop-off for you — can you tell me the name or address of the shop this is going to?"
[AGENT: You do NOT have a destination on file for this job. Never state or imply one, never say a placeholder, and never improvise a vague phrase like "the shop you mentioned". Capture what the customer says and use it for the rest of the call. If they cannot give one, say you'll have dispatch confirm the drop-off and continue.]`;

  // Front-loaded: four customers cut the previous pitch off mid-sentence, so the
  // decline was to the length of the monologue rather than to the offer. Ask
  // first, justify second, and name the alternative so "no" is a real choice.
  // Naming the street address answers the question that killed the flip on
  // 2026-08-13 ("where actually is it?") before it has to be asked. Omitted
  // entirely when we have no address, rather than left as an empty phrase.
  const shopAddressPhrase = ctx.nearestShopAddress?.trim() ? ` at {{nearest_shop_address}}` : ``;

  const defaultOffer1 =
    `Before I confirm the drop-off — one quick option and then I'll let you go. We work with a certified shop, {{nearest_shop}}${shopAddressPhrase}` +
    (distanceShort ? `, ${distanceShort}` : ``) +
    `: they include the diagnostic at no charge, normally around \${{diagnostic_value}}, and take 10 percent off the repair. ` +
    (hasSeparateDestination(ctx)
      ? `Want me to send the driver there instead, or keep {{destination}}?`
      : `Want me to send the driver there instead?`);

  // Offer 2 previously restated the same benefits the customer had just turned
  // down; it went 0 for 11. Ask why instead — if the reason is a regular shop or
  // an insurer, there is no offer to make and pushing only costs goodwill.
  // Keeps the diagnostic question (it is what makes tier 2 different from tier
  // 1) and adds the two things a hesitant customer actually asked for on
  // 2026-08-13: where the shop is, and what happens before any work starts.
  const offer2Reassurance =
    `{{nearest_shop}}${shopAddressPhrase} is certified, they give you a written estimate before any work starts, ` +
    `and the free diagnostic plus 10 percent off still stands. I'd sort the change out with the driver.`;
  const defaultOffer2 = hasSeparateDestination(ctx)
    ? `Totally fair — can I ask what's taking you to {{destination}}? If that's your regular shop or your insurer picked it, I'll leave it exactly as it is. If it's just what was on the ticket, ${offer2Reassurance}`
    : `Totally fair — can I ask what's taking you to that shop? If it's your regular shop or your insurer picked it, I'll leave it exactly as it is. If it's just what was on the ticket, ${offer2Reassurance}`;

  const defaultOffer3 = `I can also add a 50 dollar credit on this repair on top of the discount and hold the priority slot at {{nearest_shop}}. Would you like me to switch the drop-off there?`;

  // One of two wins on 2026-08-11 rested on a reply given amid unrelated, partly
  // unintelligible speech. A destination change is not something to infer.
  const consentGate = `[AGENT: Before you treat any reply as a YES, you must have an unambiguous one. If the answer is unclear, partial, or arrives amid other speech, ask: "Just so I have it clearly — is that a yes to sending the driver to {{nearest_shop}} instead?" Only log a destination change on an explicit yes.]`;
  const defaultConvini = `You're all set{{customer_salutation}}. ${destinationPlanSentence(ctx)}. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;

  // Two gates, both hard. No partner shop on file means there is nothing
  // truthful to offer — on 2026-08-11 an agent with no shop invented "a partner
  // shop that specializes in that kind of work" and promised a ride in the tow
  // truck. Collision and glass work should never be met with an offer of a
  // mechanical diagnostic at a brake shop.
  const offersAllowed = !!ctx.nearestShop && !isCollisionOrGlass(ctx);

  const flipBlock = offersAllowed ? [
        ``,
        interpolate(ctx.scriptBlocks?.offer_1 ?? ctx.globalScriptBlocks?.offer_1 ?? defaultOffer1, vars),
        ``,
        interpolate(consentGate, vars),
        `[AGENT: If they say YES -> acknowledge and tell them you'll update the destination. Skip the other offers and jump straight to the CONVINI close.]`,
        `[AGENT: A BARE "no" IS NOT A HARD DECLINE — it is the most common answer and it still gets Offer 2. On 2026-08-13, 10 of 12 declines went straight to the close and the ladder was never run. Go to Offer 2 unless they gave a REASON (their regular shop, their insurer, a warranty, a dealership they chose) or an explicit stop such as "no offers", "just send the tow", "I am not changing", or "I already know where it is going". Only those end the ladder.]`,
      ] : [];

  const offer2Block = offersAllowed ? [
        ``,
        interpolate(ctx.scriptBlocks?.offer_2 ?? ctx.globalScriptBlocks?.offer_2 ?? defaultOffer2, vars),
        ``,
        `[AGENT: This is a question, not a second pitch. LISTEN to the reason. If they name a regular shop, a dealership, an insurer, or a warranty -> accept it, say "That makes sense, I'll leave it as it is", and go to the CONVINI close. Do NOT continue to Offer 3.]`,
        interpolate(consentGate, vars),
        `[AGENT: If they say YES -> acknowledge and tell them you'll update the destination. Skip the other offers and jump straight to the CONVINI close.]`,
        `[AGENT: Only if the reason is genuinely "it's just what was on the ticket" AND they are still undecided -> make Offer 3. Otherwise stop pitching and jump to the CONVINI close.]`,
      ] : [];

  const offer3Block = offersAllowed ? [
        ``,
        interpolate(ctx.scriptBlocks?.offer_3 ?? ctx.globalScriptBlocks?.offer_3 ?? defaultOffer3, vars),
        ``,
        interpolate(consentGate, vars),
        `[AGENT: If they say YES -> acknowledge and tell them you'll update the destination. Then jump to the CONVINI close.]`,
        `[AGENT: If they say NO or hard decline -> say "Understood. I'll keep your original destination and focus on getting the driver routed." Then jump to the CONVINI close.]`,
      ] : [];

  // Two objections now have authorized answers, both confirmed as real policy by
  // the operator on 2026-08-13. They exist because the agent reached for both on
  // a live call and had to invent the wording — the content was broadly right,
  // the authorization was not.
  //
  // Deliberately NOT folded into Offer 2. Offer 2 is a diagnostic question
  // ("what's taking you there?") and stacking reassurances onto it recreates the
  // density failure the 2026-08-12 review found, where a customer could not
  // parse the offer until the agent restated it more plainly. These are
  // responses to a stated objection, usable at whichever rung it comes up.
  const authorizedAnswers = offersAllowed
    ? [
        ``,
        `=== AUTHORIZED ANSWERS (use ONLY when the customer raises these; never volunteer them) ===`,
        // Roadside Towing absorbs the second tow. Any recovery from the vendor
        // afterwards is internal and must never reach the call.
        `[AGENT: If the customer worries about being stuck at our shop, or asks what happens if the repair does not go ahead -> "You're not stuck there. If the repair isn't something you want to go ahead with, we'll tow it on to {{destination}} at no cost to you." Do not put a time or a day on that onward tow, and never discuss who pays us or why a repair was not approved.]`,
        `[AGENT: If the customer asks whether their insurance or warranty covers it -> "Our partner shops take most aftermarket repair policies. I can note down who you're insured with and have our office team check your coverage with them directly. The diagnostic itself is free either way, so you'd know what you're dealing with before spending anything." Take the provider NAME only — never ask for a policy number, member id, or date of birth. Do not say the office will call "right now" or give any timeframe, and never state that a specific policy is or is not covered.]`,
      ]
    : [];

  // When offers are suppressed, say so explicitly. An empty PHASE 2 previously
  // left the agent to fill the silence, which is how the invented shop happened.
  const noOfferNote = offersAllowed
    ? []
    : [
        ``,
        !ctx.nearestShop
          ? `[AGENT: There is NO partner shop on file for this job. You have nothing to offer. Do not mention a partner shop, a nearby shop, a discount, a free diagnostic, or a ride in the tow truck. Confirm the details and go straight to the CONVINI close.]`
          : `[AGENT: This is collision, body or glass work. Do NOT offer a mechanical repair shop or a free mechanical diagnostic — it does not apply to this damage. Confirm the details and go straight to the CONVINI close.]`,
      ];

  const conviniBlock = [
    `=== CONVINI SOFT CLOSE ===`,
    interpolate(ctx.scriptBlocks?.convini_pitch ?? ctx.globalScriptBlocks?.convini_pitch ?? defaultConvini, vars),
    `[AGENT: If YES -> confirm you'll text the link, then warm close. If NO -> accept gracefully.]`,
  ];

  return [
    `# SCENARIO A — COMPETITOR REPAIR (3-TIER FLIP)`,
    `[AGENT: The destination appears to be a competitor repair shop. Confirm details, ask intended destination without locking it, then attempt one repair-shop flip flow unless the customer hard-declines.]`,
    ``,
    `=== PHASE 1: DATA CONFIRMATION ===`,
    openingBlock(ctx, vars),
    ``,
    confirmBlock(ctx, vars, clarify, { includeDestination: false }),
    ``,
    issueGuidanceBlock(ctx),
    ``,
    destinationIntent,
    ``,
    `=== PHASE 2: THE 3-TIER FLIP ===`,
    ...noOfferNote,
    ...flipBlock,
    ...offer2Block,
    ...offer3Block,
    ...authorizedAnswers,
    ``,
    ...conviniBlock,
    ``,
    warmCloseBlock(ctx, vars),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// SCENARIO B — Auto Body / Collision (confirm + soft mention, NO flip + medium CONVINI)
// ---------------------------------------------------------------------------

function scenarioB(ctx: ScriptContext): string {
  const clarify = `AI: "I see the issue is listed as {{issue}}. Can you tell me a little more about what happened?"`;
  const vars = baseVars(ctx);
  const bodyShops = [ctx.bodyShop1, ctx.bodyShop2].filter(Boolean);
  const shopList = bodyShops.length ? `, like ${bodyShops.join(' and ')}` : '';

  // Session 74 — a SOFT REFERRAL, not a flip. Body and glass work is refused a
  // repair-shop offer (wrong shop, wrong diagnostic), but these jobs are still
  // worth calling and the customer should know we own body shops. The whole
  // difference from an offer: no discount, no free diagnostic, no "want me to
  // switch", and the original destination is reaffirmed in the same breath so
  // there is nothing to decline.
  const isActiveDamageJob = isCollisionOrGlass(ctx);
  const glass = isGlassJob(ctx);

  // Wording is Chris's, 2026-08-12. The move that makes it work: it names the
  // insurance commitment and respects it out loud, so there is no pressure to
  // push back against and nothing to decline. Do not turn this into an offer.
  const damageKind = glass ? 'auto glass work' : 'auto body work';
  // Written out rather than string-replacing destinationPlanSentence: now that
  // the plan names both legs, patching "Your driver is" into "I'll have your
  // driver" produced "…coming to you at X first, then taking … shortly".
  const closingLine = hasSeparateDestination(ctx)
    ? `I'll have your driver come to you at {{pickup_location}} first, then take the vehicle to {{destination}} shortly`
    : `I'll have your driver come to you at {{pickup_location}} shortly`;
  // Only claim they have a shop commitment when a real destination is on file.
  const insuranceLine = hasSeparateDestination(ctx)
    ? ` We know you have a commitment with the insurance company to go to the current shop listed and we respect that.`
    : ``;

  const bodyShopMention = isActiveDamageJob
    ? `AI: "Understood, that sounds like ${damageKind}. Just to let you know{{customer_salutation}}, we own our own body shops here in the area${shopList}.${insuranceLine} If we can ever be of help let us know. No pressure either way — ${closingLine}."`
    : `AI: "Understood. Just to let you know{{customer_salutation}}, we own our own body shops here in the area${shopList}. If we can ever be of help down the road, let us know — no pressure at all. ${closingLine.charAt(0).toUpperCase()}${closingLine.slice(1)}."`;

  const defaultConvini = `You're all set{{customer_salutation}}. ${destinationPlanSentence(ctx)}. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;
  const conviniBlock = [
    `=== CONVINI SOFT CLOSE ===`,
    interpolate(ctx.scriptBlocks?.convini_pitch ?? ctx.globalScriptBlocks?.convini_pitch ?? defaultConvini, vars),
    `[AGENT: If YES -> confirm you'll text the link, then warm close. If NO -> accept gracefully.]`,
  ];

  return [
    `# SCENARIO B — AUTO BODY / GLASS (SOFT REFERRAL, NEVER A FLIP OFFER)`,
    `[AGENT: This is body, collision or glass work. Mention our body shops ONCE, as information. This is NOT an offer: do not quote a discount, do not mention a free diagnostic, do not ask to switch the drop-off, and do not repeat the mention if they do not take it up. If the customer asks to use our shop, say you'll pass it to dispatch to arrange — do not promise a price or a timescale.]`,
    `[AGENT: The destination is an auto body shop. Confirm details, then gently mention our body shops before moving to the Convini pitch.]`,
    ``,
    `=== PHASE 1: DATA CONFIRMATION ===`,
    openingBlock(ctx, vars),
    ``,
    confirmBlock(ctx, vars, clarify),
    ``,
    issueGuidanceBlock(ctx),
    ``,
    `=== PHASE 2: BODY SHOP SOFT MENTION ===`,
    `[STEP 7 — BRAND AWARENESS]`,
    bodyShopMention,
    ``,
    ...conviniBlock,
    ``,
    warmCloseBlock(ctx, vars),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// SCENARIO C — Residential / Unknown (confirm + HARD CONVINI sell)
// ---------------------------------------------------------------------------

function scenarioC(ctx: ScriptContext): string {
  const sub = (ctx.issueSubcategory ?? '').toLowerCase();
  const isWinchOut = sub === 'winch_out';
  const isFlat =
    sub.includes('tire') ||
    ctx.issue.toLowerCase().includes('tire') ||
    ctx.issue.toLowerCase().includes('flat');
  const clarify = isWinchOut
    ? `AI: "I see this is listed as a winch-out. That usually means the vehicle is stuck and needs to be pulled back onto solid ground. Can you tell me what it is stuck on or stuck in?"`
    : isFlat
    ? `AI: "I see you have a flat tire. Which tire is it — front left, front right, rear left, or rear right? And do you have a spare?"`
    : `AI: "I see the issue is listed as {{issue}}. Can you tell me a little more about what's going on so we send the right help?"`;
  
  const vars = baseVars(ctx);
  const defaultConvini = `You're all set{{customer_salutation}}. ${destinationPlanSentence(ctx)}. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;
  const conviniBlock = ctx.pitchConvini ? [
    `=== CONVINI SOFT CLOSE ===`,
    interpolate(ctx.scriptBlocks?.convini_pitch ?? ctx.globalScriptBlocks?.convini_pitch ?? defaultConvini, vars),
    `[AGENT: If YES -> confirm you'll text the link, then warm close. If NO -> accept gracefully.]`,
  ] : [];

  // Session 74 — the conditional offer. Only ever set when the destination
  // could not be resolved before dialling AND a partner shop is in range; every
  // other route into Scenario C (collision, glass, no shop, residence) leaves it
  // null and keeps the hard no-offer rule below, unchanged.
  //
  // This exists because the gate ran before the call and the answer arrives
  // during it. The script already asks whether the destination is a repair shop;
  // until now a customer who said yes met an agent with nothing to offer.
  const conditional = ctx.conditionalShop?.trim() ? ctx.conditionalShop.trim() : null;
  const conditionalDistance = shopDistanceShort(ctx.conditionalShopDistanceMiles);
  const conditionalBlock = conditional
    ? [
        `[AGENT: THE DESTINATION ON FILE IS UNCONFIRMED, so there is no offer yet. Ask the destination question as written and LISTEN. Do not mention any shop, discount or diagnostic before the customer has answered it.]`,
        `[AGENT: ONLY IF the customer confirms the vehicle is going to a repair shop or garage that is not one of ours -> you may then make this offer, once: "Before I confirm the drop-off — just so you know, ${conditional} is a certified shop${conditionalDistance}, and I could get you a free diagnostic plus 10 percent off today's repair. I'd handle the drop-off with the driver if you choose that option. Would you like me to switch the drop-off to ${conditional}?"]`,
        `[AGENT: If they say anything else — home, a body shop, a dealership they chose, a residence, or they are unsure — there is NO offer on this call. Do not mention ${conditional} at all. Go to the CONVINI close.]`,
        `[AGENT: Take a YES only if it is unambiguous. If the answer is unclear or arrives amid other speech, ask "Just so I have it clearly — is that a yes to sending the driver to ${conditional} instead?" Never infer a destination change.]`,
        `[AGENT: If they decline, accept it and move to the CONVINI close. Do not make a second or third offer on this call.]`,
      ]
    : [
        // Unchanged behaviour for every other non-eligible route.
        `[AGENT: THERE IS NO REPAIR-SHOP OFFER ON THIS CALL. Do not mention a partner shop, a nearby shop, a certified shop, a discount, a free diagnostic, or switching the drop-off — not even in passing, and not as a suggestion for "next time". Do not tell the customer they can ride in the tow truck. Confirm the details, pitch CONVINI, and close.]`,
      ];

  return [
    `# SCENARIO C — RESIDENCE / UNKNOWN (HARD CONVINI)`,
    `[AGENT: The destination is a residence or unknown. Confirm details and push the CONVINI app hard.]`,
    // Session 74 — this scenario is where the orchestrator lands every job that
    // is NOT flip-eligible, including jobs with no partner shop and collision /
    // glass work. It is therefore where an agent with nothing to offer actually
    // stands, and on 2026-08-11 one filled that silence by inventing "a partner
    // shop that specializes in that kind of work" and promising a ride in the
    // tow truck. Say the quiet part explicitly.
    ...conditionalBlock,
    ``,
    `=== PHASE 1: DATA CONFIRMATION ===`,
    openingBlock(ctx, vars),
    ``,
    confirmBlock(ctx, vars, clarify),
    ``,
    issueGuidanceBlock(ctx),
    ``,
    ...conviniBlock,
    ``,
    warmCloseBlock(ctx, vars),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// SCENARIO D — Already One of Our Shops (VIP confirm + CONVINI)
// ---------------------------------------------------------------------------

function scenarioD(ctx: ScriptContext): string {
  const clarify = `AI: "I see the issue is listed as {{issue}}. Can you tell me a little more so our team is ready when you arrive?"`;
  const vars = baseVars(ctx);
  const defaultConvini = `You're all set{{customer_salutation}}. ${destinationPlanSentence(ctx)}. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;
  const conviniBlock = [
    `=== CONVINI SOFT CLOSE ===`,
    interpolate(ctx.scriptBlocks?.convini_pitch ?? ctx.globalScriptBlocks?.convini_pitch ?? defaultConvini, vars),
    `[AGENT: If YES -> confirm you'll text the link, then warm close. If NO -> accept gracefully.]`,
  ];

  return [
    `# SCENARIO D — OUR SHOP (VIP TREATMENT)`,
    `[AGENT: The destination is OUR OWN shop. Roll out the red carpet, confirm details, and offer Convini.]`,
    ``,
    `=== PHASE 1: DATA CONFIRMATION ===`,
    openingBlock(ctx, vars),
    ``,
    confirmBlock(ctx, vars, clarify),
    ``,
    issueGuidanceBlock(ctx),
    ``,
    `=== PHASE 2: VIP WELCOME ===`,
    `AI: "Great news — your vehicle is coming to our shop at {{destination}}. When you arrive, let the front desk know you're a tow customer and they'll take priority care of you. You'll have a written estimate within one hour."`,
    ``,
    ...conviniBlock,
    ``,
    warmCloseBlock(ctx, vars),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// SCENARIO AAA-BRANDED — confirm + CONVINI, NEVER flip (AAA hard rule)
// ---------------------------------------------------------------------------

function scenarioAaaBranded(ctx: ScriptContext): string {
  const clarify = `AI: "I see the issue is listed as {{issue}}. Can you tell me a little more about what happened?"`;
  const vars = baseVars(ctx);
  const defaultConvini = `You're all set{{customer_salutation}}. ${destinationPlanSentence(ctx)}. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;

  return [
    `# SCENARIO — AAA-BRANDED DESTINATION (NO FLIP — AAA HARD RULE)`,
    `[AGENT: This tow is going to a AAA-branded facility. Per policy you must NOT attempt to flip it. Confirm the details and close with a soft CONVINI offer only.]`,
    ``,
    `=== PHASE 1: DATA CONFIRMATION ===`,
    openingBlock(ctx, vars),
    ``,
    confirmBlock(ctx, vars, clarify),
    ``,
    issueGuidanceBlock(ctx),
    ``,
    `=== CONVINI SOFT CLOSE ===`,
    interpolate(ctx.scriptBlocks?.convini_pitch ?? ctx.globalScriptBlocks?.convini_pitch ?? defaultConvini, vars),
    `[AGENT: If YES -> confirm you'll text the link, then warm close. If NO -> accept gracefully.]`,
    ``,
    warmCloseBlock(ctx, vars),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const SCENARIO_RENDERERS: Record<ScenarioKey, (ctx: ScriptContext) => string> = {
  competitor_repair: scenarioA,
  auto_body: scenarioB,
  residence: scenarioC,
  unknown: scenarioC,
  our_shop: scenarioD,
  aaa_branded: scenarioAaaBranded,
};

/**
 * Render the complete call body for a job. Returns the fully-interpolated
 * script flow the voice agent will execute. The orchestrator passes this as
 * the `body` dynamic variable; the agent prompt stays generic.
 */
export function renderCallBody(scenario: ScenarioKey, ctx: ScriptContext): string {
  const vars = baseVars(ctx);
  const renderer = SCENARIO_RENDERERS[scenario] ?? scenarioC;

  // Each scenario block interpolates its own text, but globalRules() did not —
  // so `{{callback_number}}` shipped verbatim inside script_body, and customers
  // heard the literal token. Retell substitutes its prompt template exactly
  // once and does NOT recurse into the value it injects for {{script_body}},
  // so anything template-shaped that survives to here reaches the caller's ear.
  //
  // Interpolating the assembled body is idempotent for the blocks that already
  // did it (no {{…}} left to match), and closes the gap for everything else.
  const assembled = interpolate(
    [globalRules(ctx), ``, renderer(ctx)].join('\n'),
    vars,
  );

  return stripTemplateArtifacts(assembled);
}

/**
 * Last line of defence before text reaches a live phone call.
 *
 * `ctx.customAgentRules` is free text a tenant pastes into config, and one
 * production call leaked a raw `<parameter name="…">` fragment that way. No
 * placeholder or markup fragment should ever be speakable, so anything still
 * template-shaped is removed rather than trusted.
 *
 * `[AGENT: …]` and `[STEP …]` are deliberate — the Retell prompt teaches the
 * agent to treat them as instructions and never read them aloud — so they stay.
 */
function stripTemplateArtifacts(text: string): string {
  return text
    // Unresolved {{tokens}} — a variable we never supplied a value for.
    .replace(/\{\{[^}]*\}\}/g, '')
    // Tool-call / XML fragments pasted into free-text config.
    .replace(/<\/?parameter\b[^>]*>/gi, '')
    .replace(/<\/?(?:invoke|function_calls|antml:[a-z_]+)\b[^>]*>/gi, '')
    // Collapse whitespace the removals leave behind.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when a rendered body still contains something unspeakable. Test seam. */
export function hasTemplateArtifacts(text: string): boolean {
  return /\{\{[^}]*\}\}|<\/?parameter\b|<\/?invoke\b/i.test(text);
}

/** Map a destination tag to the scenario key. Centralized so routing is
 *  testable and the orchestrator doesn't hand-roll the switch. */
export function scenarioForDestinationTag(tag: string): ScenarioKey {
  switch (tag) {
    case 'competitor_repair':
      return 'competitor_repair';
    case 'auto_body':
      return 'auto_body';
    case 'our_shop':
      return 'our_shop';
    case 'aaa_branded':
      return 'aaa_branded';
    case 'residence':
      return 'residence';
    case 'unknown':
    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Back-compat: legacy per-section renderers (kept so existing imports/tests in
// flip-orchestrator + flip-scripts.spec compile until the orchestrator is
// migrated to renderCallBody). These now use the verbatim script wording.
// ---------------------------------------------------------------------------

export interface ConfirmDetailsInput {
  customerName: string;
  companyName: string;
  vehicle: string;
  pickupLocation: string;
  destination: string;
}

export function renderConfirmDetails(i: ConfirmDetailsInput): string {
  return [
    `Hi ${i.customerName}, this is ${i.companyName} calling about your tow.`,
    `I'd like to confirm a few details. I have your pickup as ${i.pickupLocation}, your vehicle as a ${i.vehicle}, and your destination as ${i.destination}.`,
    `Is all of that correct?`,
  ].join(' ');
}

export interface FlipOfferInput {
  ourShopName: string;
  distanceMilesSaved: number | null;
  rentalsAvailable: boolean;
}

export function renderOffer1(i: FlipOfferInput): string {
  const dist = i.distanceMilesSaved != null ? ` just ${i.distanceMilesSaved} miles away` : '';
  return `Before I confirm the drop-off — just so you know, ${i.ourShopName} is a certified shop${dist}, and I could get you a free diagnostic plus 10 percent off today's repair. I'd handle the drop-off with the driver if you choose that option. Would you like me to switch the drop-off to ${i.ourShopName}?`;
}

export function renderOffer2(i: FlipOfferInput): string {
  return `Totally fair. Here's the difference though — for today's tow, ${i.ourShopName} can look at your car quickly, give you a written estimate before any work, and you still get the free diagnostic plus 10 percent off today's repair. If you want that, I can update the drop-off with the driver. Would you like me to make that change?`;
}

export function renderOffer3(i: FlipOfferInput): string {
  return `I can also add a 50 dollar credit on this repair on top of the discount and hold the priority slot at ${i.ourShopName}. Would you like me to switch the drop-off there?`;
}

export interface ConviniPitchInput {
  intensity: 'soft' | 'medium' | 'hard';
  rentalsAvailable: boolean;
  ourBodyShopMention?: { shop1: string; shop2: string };
}

export function renderConviniPitch(i: ConviniPitchInput): string {
  if (i.intensity === 'soft') {
    return `I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;
  }
  if (i.intensity === 'medium') {
    const body = i.ourBodyShopMention
      ? ` By the way, we also own two body shops — ${i.ourBodyShopMention.shop1} and ${i.ourBodyShopMention.shop2} — if you ever need collision work down the road.`
      : '';
    return `I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.${body}`;
  }
  return `I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;
}

export function renderClosing(_i: { customerName: string }): string {
  return `Thank you for choosing us. Have a safe rest of your day.`;
}
