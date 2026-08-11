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
export const SCRIPT_VERSION = '1.0';

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
  return hasSeparateDestination(ctx)
    ? 'Your driver is headed to {{destination}} as planned'
    : 'Your driver is headed to the service location as planned';
}

/** Base variable map shared by every scenario. */
function baseVars(ctx: ScriptContext): Record<string, string> {
  return {
    rep_name: ctx.repName,
    company_name: ctx.companyName,
    motor_club: ctx.motorClub,
    callback_number: ctx.callbackNumber,
    convini_link: ctx.conviniLink,
    diagnostic_value:
      ctx.diagnosticValue != null ? String(ctx.diagnosticValue) : '89',
    customer_first_name: ctx.customerFirstName,
    vehicle: ctx.vehicle,
    pickup_location: ctx.pickupLocation,
    destination: ctx.destination,
    issue: ctx.issue,
    nearest_shop: ctx.nearestShop ?? '',
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
  const defaultOpening = `[STEP 1 — OPENING / IDENTIFICATION]
AI: "Hi, this is {{rep_name}} calling from {{company_name}} about the tow request. I'm the AI assistant helping confirm the details. Am I speaking with {{customer_first_name}}?"
[AGENT: Wait for confirmation. If you reached the wrong person or voicemail, leave a brief polite message with the callback number {{callback_number}} and end the call.]`;

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
    `- Do not pitch repair-shop offers for lockout, fuel delivery, single flat tire, jump-start-only, or winch-out-only calls.`,
    `- Make flip offers as one objection-handling flow, not three unrelated pitches. STOP the moment one is accepted.`,
    `- If the customer gives a hard decline such as "no offers", "just send the tow", "I'm not changing", or "I already know where it is going", stop pitching immediately and keep the original destination.`,
    ...(ctx.pitchConvini ? [
      `- ALWAYS send-frame the free CONVINIcar app near the close, unless the customer hung up, opted out, or asked you to stop.`,
    ] : []),
    `- Never invent prices, times, names, or addresses — use only what's provided here.`,
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
  const shopDistancePhrase = ctx.nearestShopDistanceMiles != null
    ? `, a certified shop just {{nearest_shop_distance}} miles away`
    : `, a certified shop`;
  const destinationIntent = `[STEP 6 — CONFIRM INTENDED DESTINATION WITHOUT LOCKING IT]
AI: "I have the destination as {{destination}}. Is that still correct, and is it a repair shop, body shop, your home, or somewhere else?"
[AGENT: Capture whether the destination is a repair shop, body shop, home, dealership, or something else, but do not verbally lock it yet. Use that answer with the issue type to decide whether the shop offer is appropriate. If the customer gives a hard decline such as "do not switch me", "no offers", or "just send the tow", say "Understood. I'll keep your original destination and focus on getting the driver routed." Then skip all flip offers and continue to the CONVINI close.]`;
  const defaultOffer1 = `Before I confirm the drop-off — just so you know, {{nearest_shop}}${shopDistancePhrase}, they're certified, and I could get you a free diagnostic, normally around \${{diagnostic_value}}, plus 10 percent off today's repair. I'd handle the drop-off with the driver if you choose that option. Would you like me to switch the drop-off to {{nearest_shop}}?`;
  const defaultOffer2 = `Totally fair. Here's the difference though — for today's tow, {{nearest_shop}} can look at your car quickly, give you a written estimate before any work, and you still get the free diagnostic plus 10 percent off today's repair. If you want that, I can update the drop-off with the driver. Would you like me to make that change?`;
  const defaultOffer3 = `I can also add a 50 dollar credit on this repair on top of the discount and hold the priority slot at {{nearest_shop}}. Would you like me to switch the drop-off there?`;
  const defaultConvini = `You're all set, {{customer_first_name}}. ${destinationPlanSentence(ctx)}. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;

  const flipBlock = !!ctx.nearestShop ? [
        ``,
        interpolate(ctx.scriptBlocks?.offer_1 ?? ctx.globalScriptBlocks?.offer_1 ?? defaultOffer1, vars),
        ``,
        `[AGENT: If they say YES -> acknowledge and tell them you'll update the destination. Skip the other offers and jump straight to the CONVINI close.]`,
        `[AGENT: If they give a soft objection like "I already have a shop" -> make Offer 2. If they give a hard decline -> stop pitching, keep the original destination, and jump to the CONVINI close.]`,
      ] : [];

  const offer2Block = !!ctx.nearestShop ? [
        ``,
        interpolate(ctx.scriptBlocks?.offer_2 ?? ctx.globalScriptBlocks?.offer_2 ?? defaultOffer2, vars),
        ``,
        `[AGENT: If they say YES -> acknowledge and tell them you'll update the destination. Skip the other offers and jump straight to the CONVINI close.]`,
        `[AGENT: If they hesitate or remain unsure -> make Offer 3. If they give a hard decline -> stop pitching, keep the original destination, and jump to the CONVINI close.]`,
      ] : [];

  const offer3Block = !!ctx.nearestShop ? [
        ``,
        interpolate(ctx.scriptBlocks?.offer_3 ?? ctx.globalScriptBlocks?.offer_3 ?? defaultOffer3, vars),
        ``,
        `[AGENT: If they say YES -> acknowledge and tell them you'll update the destination. Then jump to the CONVINI close.]`,
        `[AGENT: If they say NO or hard decline -> say "Understood. I'll keep your original destination and focus on getting the driver routed." Then jump to the CONVINI close.]`,
      ] : [];

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
    ...flipBlock,
    ...offer2Block,
    ...offer3Block,
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
  const bodyShopMention = bodyShops.length
    ? `AI: "Understood. Just so you know, {{customer_first_name}} — we also own independent body shops here in the area, like ${bodyShops.join(' and ')}. We're not tied to any insurance network, which means we control our own pricing and quality standards. If you ever need collision work in the future and want to choose your own shop, we'd love to take care of you. No pressure at all — just wanted you to know we're here."`
    : `AI: "Understood. Just so you know, {{customer_first_name}} — we also own independent body shops here in the area. We're not tied to any insurance network, which means we control our own pricing and quality standards. If you ever need collision work in the future and want to choose your own shop, we'd love to take care of you. No pressure at all — just wanted you to know we're here."`;

  const defaultConvini = `You're all set, {{customer_first_name}}. ${destinationPlanSentence(ctx)}. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;
  const conviniBlock = [
    `=== CONVINI SOFT CLOSE ===`,
    interpolate(ctx.scriptBlocks?.convini_pitch ?? ctx.globalScriptBlocks?.convini_pitch ?? defaultConvini, vars),
    `[AGENT: If YES -> confirm you'll text the link, then warm close. If NO -> accept gracefully.]`,
  ];

  return [
    `# SCENARIO B — AUTO BODY SHOP (SOFT MENTION)`,
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
  const defaultConvini = `You're all set, {{customer_first_name}}. ${destinationPlanSentence(ctx)}. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;
  const conviniBlock = ctx.pitchConvini ? [
    `=== CONVINI SOFT CLOSE ===`,
    interpolate(ctx.scriptBlocks?.convini_pitch ?? ctx.globalScriptBlocks?.convini_pitch ?? defaultConvini, vars),
    `[AGENT: If YES -> confirm you'll text the link, then warm close. If NO -> accept gracefully.]`,
  ] : [];

  return [
    `# SCENARIO C — RESIDENCE / UNKNOWN (HARD CONVINI)`,
    `[AGENT: The destination is a residence or unknown. Confirm details and push the CONVINI app hard.]`,
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
  const defaultConvini = `You're all set, {{customer_first_name}}. ${destinationPlanSentence(ctx)}. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;
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
  const defaultConvini = `You're all set, {{customer_first_name}}. ${destinationPlanSentence(ctx)}. I'm texting you the free CONVINIcar app link now so you can track this tow live and request help faster next time.`;

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
