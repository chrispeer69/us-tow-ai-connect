/**
 * SCRIPT_MODE=slim — the token-lean `script_body` (2026-10-09).
 *
 * Retell bills the LLM by context size: $0.064/min × max(1, tokens ÷ 4,000),
 * re-sent every turn. The legacy body is ~7k tokens on a competitor-repair
 * call, 59% of it [AGENT:] notes, and it put the live outbound agent at
 * ~$0.35/min. This renderer produces the same call — the same decisions, the
 * same spoken words, the same offer terms — in a third of the size:
 *
 *   Tier 1  retell/core_prompt.md     universal rules, once, in the Retell prompt
 *   Tier 2  this file                 the per-call steps, branches resolved here
 *   Tier 3  retell/knowledge/*.md     objection and authorized answers, retrieved
 *
 * Every decision is taken by the SAME code legacy uses (scenarioAOffer,
 * scenarioBLines, scenarioCConditionalOffer, openingLines, CONFIRM_LINES …),
 * so the two modes cannot drift apart on what is offered or said. Only the
 * instructions around the words are rewritten. docs/script_slim_coverage.md
 * maps every legacy rule to where it now lives.
 *
 * Runs only with SCRIPT_MODE=slim AND the core prompt published as the agent's
 * general prompt — the slim body leans on those rules and is not safe on top of
 * the legacy (v61) prompt alone.
 */
import {
  AAA_CLARIFY,
  BODY_OPEN_DOOR_LINE,
  CONFIRM_LINES,
  OUR_SHOP_CLARIFY,
  OUR_SHOP_WELCOME,
  REFRAME_OFFER_BRIDGE,
  WARM_CLOSE_LINES,
  baseVars,
  conviniCloseFor,
  hasSeparateDestination,
  interpolate,
  isReframe,
  nameAskLine,
  openingLines,
  scenarioAOffer,
  scenarioBLines,
  scenarioCClarify,
  scenarioCConditionalOffer,
  stripTemplateArtifacts,
  type ScenarioKey,
  type ScriptContext,
} from './flip-scripts';

/** Hard ceiling. Above this the slim body is not cheaper enough to trust. */
export const SLIM_MAX_TOKENS = 2_500;

/** chars ÷ 4 — the estimate the build gate uses (cl100k runs ~4.2 chars/token on this text). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type BlockKey = keyof NonNullable<ScriptContext['scriptBlocks']>;

/** A tenant or global script_blocks override, if one is set. Same precedence as legacy. */
function override(ctx: ScriptContext, key: BlockKey): string | null {
  return ctx.scriptBlocks?.[key] ?? ctx.globalScriptBlocks?.[key] ?? null;
}

/** A bare spoken line (offers, closes) as an AI: line. Already-prefixed lines pass through. */
function say(line: string): string {
  const t = line.trim();
  return t.startsWith('AI:') ? t : `AI: "${t}"`;
}

/** A conditional spoken line. The core prompt defines the IF … → "…" form. */
function sayIf(situation: string, words: string): string {
  const w = words.trim().replace(/^AI:\s*/, '');
  return `IF ${situation} → ${w.startsWith('"') ? w : `"${w}"`}`;
}

const note = (text: string) => `[AGENT: ${text}]`;
const step = (label: string) => `[${label}]`;

// ---------------------------------------------------------------------------
// Tenant custom rules — resolved here, not shipped for the model to sort out.
// ---------------------------------------------------------------------------

/**
 * Tenant rule lines the core prompt (or this script's structure) already
 * carries, normalized. Every one is mapped in docs/script_slim_coverage.md.
 * A line NOT on this list is shipped verbatim — an unknown tenant rule is never
 * dropped, only a known duplicate is.
 */
const COVERED_TENANT_RULES = [
  'be a warm, reassuring dispatcher. one question at a time. never sound like a telemarketer.',
  "disclose that you are {company}'s ai assistant at the start of the call. do not deny being an ai if asked.",
  'confirm details first. if the customer corrects something, acknowledge it and move on.',
  'do not ask "is now a good time?" the customer already requested service; keep the call brief and useful.',
  'only pitch a repair-shop flip when the call is repairable and the destination is not already our shop or a protected destination.',
  'do not pitch repair-shop offers for lockout, fuel delivery, jump-start-only, or winch-out-only calls. tire jobs do get an offer — the script carries a tire-specific one (free visual brake inspection, tire condition assessment, fluids topped off, 10% off the next visit).',
  'make flip offers as one objection-handling flow, not three unrelated pitches. stop the moment one is accepted.',
  'if the customer gives a hard decline such as "no offers", "just send the tow", "i\'m not changing", or "i already know where it is going", stop pitching immediately and keep the original destination.',
  'always send-frame the free roadside emergency management app near the close, unless the customer hung up, opted out, or asked you to stop.',
  "never invent prices, times, names, or addresses — use only what's provided here.",
  'the only phone number you may give the customer is {{callback_number}}.',
  'when you offer the app, say "i\'m texting you the link now" — do not ask permission, do not read the link aloud, and do not ask whether it came through.',
  'never mention google reviews, review incentives, or gift cards during the call.',
  'if the customer is hostile, in danger, or asks you to stop: end the call politely and immediately.',
];

function normalizeRule(line: string, companyName: string): string {
  let t = line.trim().replace(/^-\s*/, '').replace(/\s+/g, ' ').toLowerCase();
  const company = companyName.trim().toLowerCase();
  if (company) t = t.split(company).join('{company}');
  return t;
}

/** The tenant rule lines that are NOT already covered, verbatim. */
export function uncoveredTenantRules(rules: string | null | undefined, companyName: string): string[] {
  if (!rules?.trim()) return [];
  const covered = new Set(COVERED_TENANT_RULES);
  return rules
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !covered.has(normalizeRule(l, companyName)));
}

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

function openingSteps(ctx: ScriptContext): string[] {
  const o = override(ctx, 'opening');
  const p = override(ctx, 'purpose');
  const { identify, purpose } = openingLines(ctx);
  return [
    ...(o
      ? [o]
      : [
          step('1 OPENING'),
          identify,
          note('Wait for a yes. Wrong person or voicemail: brief message with {{callback_number}}, then end. Menus and switchboards: rule 20.'),
        ]),
    ...(p
      ? [p]
      : [
          step('2 PURPOSE'),
          purpose,
          ...(isReframe(ctx)
            ? [note('Say it in full: it promises the offer. Then straight into the details, no permission asked.')]
            : []),
        ]),
  ];
}

function nameStep(ctx: ScriptContext): string[] {
  return [
    step('2b NAME'),
    nameAskLine(ctx),
    note('Read the name back once to check spelling. One name only: ask once for the other. Refused: "No problem"; never guess or use the ticket.'),
  ];
}

function pickupStep(ctx: ScriptContext): string[] {
  return override(ctx, 'confirm_pickup') ? [override(ctx, 'confirm_pickup')!] : [step('3 PICKUP'), CONFIRM_LINES.pickup];
}

function vehicleStep(ctx: ScriptContext): string[] {
  const o = override(ctx, 'confirm_vehicle');
  if (o) return [o];
  return [
    step('4 VEHICLE'),
    CONFIRM_LINES.vehicle,
    CONFIRM_LINES.colorDrivetrain,
    note('Ask color and drivetrain openly, never from the ticket. "I don\'t know" is fine: note it unknown, never guess.'),
  ];
}

function issueStep(ctx: ScriptContext, clarify: string): string[] {
  const o = override(ctx, 'clarify_issue');
  if (o) return [o];
  return [
    step('5 ISSUE'),
    clarify,
    note('Then let them finish; a pause is not the end, and "hold on" means wait. Acknowledge in a word, or one line of sympathy.'),
  ];
}

/** The re-ask when the destination answer trails off — spoken copy, kept verbatim. */
const DEST_REASK = `"Sorry, I want to get this right — is that a repair shop, a body shop, your home, or somewhere else?"`;

/** Default STEP 6 (scenarios B, C, D, AAA). Same three branches as legacy. */
function destinationStep(ctx: ScriptContext): string[] {
  const o = override(ctx, 'confirm_destination');
  if (o) return [o];
  if (ctx.issueSubcategory === 'winch_out') {
    return [
      step('6 SERVICE LOCATION'),
      CONFIRM_LINES.winchLocation,
      note('No drop-off on a winch-out unless they say it needs towing after; then confirm that destination.'),
    ];
  }
  if (!hasSeparateDestination(ctx)) {
    return [
      step('6 SERVICE LOCATION'),
      CONFIRM_LINES.serviceLocation,
      note('Ask for a drop-off only if they say it must be towed somewhere after the service.'),
    ];
  }
  return [
    step('6 DESTINATION'),
    CONFIRM_LINES.deliveryDestination,
    note('Capture the place type for the notes; their word for it never changes what this script offers. Never guess the type.'),
    sayIf('the answer is unclear or trails off', DEST_REASK),
  ];
}

/** Scenario A's STEP 6: ask without locking it, or ask outright when missing. */
function intendedDestinationStep(ctx: ScriptContext): string[] {
  if (hasSeparateDestination(ctx)) {
    return [
      step('6 DESTINATION (DO NOT LOCK IT)'),
      CONFIRM_LINES.deliveryDestination,
      note('Capture the place type for notes only: "body shop" from them never cancels the offer below. Never guess the type.'),
      sayIf('the answer is unclear or trails off', DEST_REASK),
    ];
  }
  return [
    step('6 DESTINATION MISSING'),
    CONFIRM_LINES.missingDestination,
    note('There is no destination on file: never state or imply one. Use what they give; if nothing, dispatch will confirm the drop-off.'),
  ];
}

function intakeSteps(): string[] {
  return [
    step('7a ACCESS'),
    CONFIRM_LINES.intakeAccess,
    note('Never from the ticket. Capture as said: blockers (low garage, gate, tight lane), which tire is flat, won\'t roll/steer/leave park. Half missing: ask that half.'),
    step('7b KEYS — A GATE'),
    CONFIRM_LINES.intakeKeys,
    sayIf(
      'they won\'t be there or are leaving the keys',
      `"Thanks — I'll note that, and our office will call you to confirm the details before the driver heads over."`,
    ),
    note('Capture where the keys will be. Never promise a tow without them; never mention a release, waiver, signature, photos or policy.'),
  ];
}

function winchGuidanceStep(ctx: ScriptContext): string[] {
  if (ctx.issueSubcategory !== 'winch_out') return [];
  return [
    step('6B WINCH-OUT'),
    note('Stuck vehicle to be pulled onto solid ground (ditch, mud, snow, ice, rocks): not a shop tow unless they say it needs one after.'),
    CONFIRM_LINES.winchPhotos,
  ];
}

/**
 * Confirm block, in the legacy order for each arm.
 *   reframe: name, pickup, destination, vehicle, issue, intake
 *   control: name, pickup, vehicle, issue, destination, intake
 * `destination: null` leaves it out (scenario A control places it later).
 */
function confirmSteps(ctx: ScriptContext, clarify: string, destination: string[] | null): string[] {
  const head = [...nameStep(ctx), ...pickupStep(ctx)];
  if (isReframe(ctx)) {
    return [...head, ...(destination ?? []), ...vehicleStep(ctx), ...issueStep(ctx, clarify), ...intakeSteps()];
  }
  return [...head, ...vehicleStep(ctx), ...issueStep(ctx, clarify), ...(destination ?? []), ...intakeSteps()];
}

function closeSteps(ctx: ScriptContext, withApp: boolean, appNote?: string): string[] {
  const vars = baseVars(ctx);
  const app = withApp
    ? [step('CLOSE'), say(interpolate(override(ctx, 'convini_pitch') ?? conviniCloseFor(ctx), vars)), ...(appNote ? [note(appNote)] : [])]
    : [];
  const warm = override(ctx, 'warm_close');
  return [
    ...app,
    ...(warm
      ? [warm]
      : [
          step('WARM CLOSE'),
          WARM_CLOSE_LINES.anythingElse,
          isReframe(ctx) ? WARM_CLOSE_LINES.reframeBye : WARM_CLOSE_LINES.controlBye,
          note('Then end the call.'),
        ]),
  ];
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

function slimScenarioA(ctx: ScriptContext): string[] {
  const o = scenarioAOffer(ctx);
  const { vars } = o;
  const destination = intendedDestinationStep(ctx);
  const confirm = isReframe(ctx)
    ? [...confirmSteps(ctx, o.clarify, destination), ...winchGuidanceStep(ctx)]
    : [...confirmSteps(ctx, o.clarify, null), ...winchGuidanceStep(ctx), ...destination];

  if (!o.offersAllowed) {
    return [
      ...confirm,
      step('8 NO OFFER'),
      note(
        !ctx.nearestShop
          ? 'No partner shop for this job: nothing to offer. Confirm the details, then the close.'
          : 'Collision, body or glass work: no mechanical shop or diagnostic. Confirm the details, then the close.',
      ),
      ...closeSteps(ctx, true),
    ];
  }

  const offer1 = interpolate(override(ctx, 'offer_1') ?? o.defaultOffer1, vars);
  const offer = [
    ...(isReframe(ctx)
      ? [
          step('8a ANNOUNCE'),
          REFRAME_OFFER_BRIDGE,
          note('A statement: no question, no pause. A "no" to this line alone is not a refusal; make the offer once.'),
        ]
      : []),
    step('8 OFFER'),
    say(offer1),
    note(
      o.isTireJob
        ? 'Tire terms only: the 10 percent is on their NEXT tires, brake job or oil change, never today. Never promise how fast it\'s done.'
        : 'Diagnostic is free for NEW VIP customers at that shop. Never mix in tire terms.',
    ),
    ...(o.hasChoice
      ? [
          step('8b SHOP CHOICE'),
          note('A picked shop is the new destination: confirm it by name. "You choose" or "closest" means {{nearest_shop}}, said by name.'),
        ]
      : []),
    ...(o.alternates.length
      ? [
          step(`8c TOO FAR — other partner shops, nearest first: ${o.alternateList}`),
          note('Too far or wants closer: say {{nearest_shop}} is the closest, then name the others one at a time. Never say there are none.'),
        ]
      : [
          step('8c TOO FAR'),
          sayIf(
            'they say it is too far or want somewhere closer',
            `"That's the closest one to you, but let me have our office check what else we can do and call you straight back" — then the close`,
          ),
        ]),
    sayIf(
      'they decline on distance or getting home',
      `"One thing worth knowing — if it goes to {{nearest_shop}} we can sort you a ride home from there, which we can't do from {{destination}}."`,
    ),
  ];

  const followUp = ctx.destinationIsDealer
    ? [step('9 DEALERSHIP — ONE OFFER ONLY'), note('Any decline, with or without a reason, ends the offers: exit line, then the close. No follow-up question.')]
    : [
        step('9 FOLLOW-UP (after a first no)'),
        say(interpolate(override(ctx, 'offer_2') ?? o.defaultOffer2, vars)),
        note('Ask once, never rephrase. Another no, "I\'m good" or silence is the second refusal: exit line.'),
        sayIf('they name a constraint', `"That makes sense, I'll leave it as it is"`),
        step('10 REASSURANCE (a preference only)'),
        say(interpolate(override(ctx, 'offer_2_reassurance') ?? o.defaultOffer2Reassurance, vars)),
      ];

  return [...confirm, ...offer, ...followUp, ...closeSteps(ctx, true)];
}

function slimScenarioB(ctx: ScriptContext): string[] {
  const { clarify, statement } = scenarioBLines(ctx);
  return [
    ...confirmSteps(ctx, clarify, destinationStep(ctx)),
    ...winchGuidanceStep(ctx),
    step('8 ONE STATEMENT — BODY/GLASS, NO OFFER'),
    note('No question, no waiting, no ladder; the first no is final. Shaken or injured: shorten or skip it. Only describe our own shops.'),
    statement,
    sayIf('they clearly ask to use ours', `"Perfect, I'll get the drop-off updated and our office will confirm the details with you."`),
    sayIf('they decline or stay put', BODY_OPEN_DOOR_LINE),
    ...closeSteps(ctx, true),
  ];
}

function slimScenarioC(ctx: ScriptContext): string[] {
  const clarify = scenarioCClarify(ctx);
  const cond = scenarioCConditionalOffer(ctx);
  const offer = cond
    ? [
        step('8 CONDITIONAL OFFER — after the destination answer'),
        note('No shop talk before they answer. Body shop, chosen dealer, unsure or no repair: no offer. One offer only; a no ends it.'),
        sayIf('it is going to a repair shop or garage that is not ours', `"${cond.repairShop}"`),
        sayIf('it is going home with a mechanical fault', `"${cond.home}"`),
      ]
    : [step('8 NO OFFER'), note('No repair-shop offer on this call, not even for "next time".')];
  return [
    ...confirmSteps(ctx, clarify, destinationStep(ctx)),
    ...winchGuidanceStep(ctx),
    ...offer,
    ...closeSteps(ctx, ctx.pitchConvini, 'Residence or unknown destination: give the app close its full weight.'),
  ];
}

function slimScenarioD(ctx: ScriptContext): string[] {
  return [
    ...confirmSteps(ctx, OUR_SHOP_CLARIFY, destinationStep(ctx)),
    ...winchGuidanceStep(ctx),
    step('8 VIP WELCOME — OUR OWN SHOP'),
    OUR_SHOP_WELCOME,
    ...closeSteps(ctx, true),
  ];
}

function slimScenarioAaa(ctx: ScriptContext): string[] {
  return [
    ...confirmSteps(ctx, AAA_CLARIFY, destinationStep(ctx)),
    ...winchGuidanceStep(ctx),
    step('8 AAA-BRANDED DESTINATION'),
    note('AAA policy: never flip this tow. No shop offer of any kind.'),
    ...closeSteps(ctx, true),
  ];
}

const SLIM_RENDERERS: Record<ScenarioKey, (ctx: ScriptContext) => string[]> = {
  competitor_repair: slimScenarioA,
  auto_body: slimScenarioB,
  residence: slimScenarioC,
  unknown: slimScenarioC,
  our_shop: slimScenarioD,
  aaa_branded: slimScenarioAaa,
};

/** The slim body. Same inputs, same decisions and same words as renderCallBody's legacy path. */
export function renderSlimCallBody(scenario: ScenarioKey, ctx: ScriptContext): string {
  const vars = baseVars(ctx);
  const tenantRules = uncoveredTenantRules(ctx.customAgentRules, ctx.companyName);
  const body = [
    ...(tenantRules.length ? ['TENANT RULES:', ...tenantRules, ''] : []),
    ...openingSteps(ctx),
    ...(SLIM_RENDERERS[scenario] ?? slimScenarioC)(ctx),
  ].join('\n');
  return stripTemplateArtifacts(interpolate(body, vars));
}
