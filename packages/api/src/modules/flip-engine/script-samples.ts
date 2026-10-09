/**
 * Sample call contexts covering every tenant rule set, scenario, A/B arm and
 * offer-eligibility combination the script generator can produce.
 *
 * Shared by the slim-script tests and scripts/token_report.ts so the token
 * figures we quote and the coverage we test are the same population. Values
 * are shaped like real 10-2026 Roadside jobs (shop names, distances, issue
 * subcategories) — the report adds rows rebuilt from real call logs on top.
 */
import type { ScenarioKey, ScriptContext } from './flip-scripts';

/** Roadside Towing's tenants.flip_engine_config.custom_agent_rules, 2026-10-09. */
export const ROADSIDE_CUSTOM_RULES = `- Be a warm, reassuring dispatcher. One question at a time. Never sound like a telemarketer.
- Disclose that you are Roadside Towing's AI assistant at the start of the call. Do not deny being an AI if asked.
- Confirm details first. If the customer corrects something, acknowledge it and move on.
- Do not ask "is now a good time?" The customer already requested service; keep the call brief and useful.
- Only pitch a repair-shop flip when the call is repairable and the destination is not already our shop or a protected destination.
- Do not pitch repair-shop offers for lockout, fuel delivery, jump-start-only, or winch-out-only calls. Tire jobs DO get an offer — the script carries a tire-specific one (free visual brake inspection, tire condition assessment, fluids topped off, 10% off the next visit).
- Make flip offers as one objection-handling flow, not three unrelated pitches. STOP the moment one is accepted.
- If the customer gives a hard decline such as "no offers", "just send the tow", "I'm not changing", or "I already know where it is going", stop pitching immediately and keep the original destination.
- ALWAYS send-frame the free Roadside Emergency Management App near the close, unless the customer hung up, opted out, or asked you to stop.
- Never invent prices, times, names, or addresses — use only what's provided here.
- The ONLY phone number you may give the customer is {{callback_number}}.
- When you offer the app, say "I'm texting you the link now" — do not ask permission, do not read the link aloud, and do not ask whether it came through.
- Never mention Google reviews, review incentives, or gift cards during the call.
- If the customer is hostile, in danger, or asks you to stop: end the call politely and immediately.
-INSURANCE RULE: If the customer mentions they are going through their insurance, or if their insurance chose the shop, Say something along: "We understand you are under agreement with your insurance. We do have partner shops if you ever need a referral in the future." You do not make insurance decisions.`;

/** platform_settings flip_engine_defaults.custom_agent_rules — every tenant without its own. */
export const GLOBAL_DEFAULT_RULES = `- Be a warm, reassuring dispatcher. One question at a time. Never sound like a telemarketer.
- Confirm details first. If the customer corrects something, acknowledge it and move on.
- Do not ask "is now a good time?" The customer already requested service; keep the call brief and useful.
- Only pitch a repair-shop flip when the call is repairable and the destination is not already our shop or a protected destination.
- Do not pitch repair-shop offers for lockout, fuel delivery, jump-start-only, or winch-out-only calls. Tire jobs DO get an offer — the script carries a tire-specific one (free visual brake inspection, tire condition assessment, fluids topped off, 10% off the next visit).
- Make flip offers as one objection-handling flow, not three unrelated pitches. STOP the moment one is accepted.
- If the customer gives a hard decline such as "no offers", "just send the tow", "I'm not changing", or "I already know where it is going", stop pitching immediately and keep the original destination.
- ALWAYS send-frame the free Roadside Emergency Management App near the close, unless the customer hung up, opted out, or asked you to stop.
- Never invent prices, times, names, or addresses — use only what's provided here.
- The ONLY phone number you may give the customer is {{callback_number}}.
- When you offer the app, say "I'm texting you the link now" — do not ask permission, do not read the link aloud, and do not ask whether it came through.
- Never mention Google reviews, review incentives, or gift cards during the call.
- If the customer is hostile, in danger, or asks you to stop: end the call politely and immediately.`;

export interface ScriptSample {
  name: string;
  tenant: 'roadside' | 'global-default' | 'no-rules';
  scenario: ScenarioKey;
  ctx: ScriptContext;
}

const ALTERNATES = [
  { name: "Wayne's Auto Repair — Westerville", distanceMiles: 5.2 },
  { name: 'Johns Auto Repair', distanceMiles: 7.8 },
];

/** A Roadside job as the orchestrator builds it, competitor-repair shaped. */
export function baseContext(over: Partial<ScriptContext> = {}): ScriptContext {
  return {
    repName: 'Emily',
    companyName: 'Roadside Towing',
    motorClub: 'Agero',
    callbackNumber: '+16146337935',
    conviniLink: 'https://convini.live',
    diagnosticValue: 179,
    customerFirstName: 'Kelli',
    customerFullName: 'Kelli Barnes',
    vehicle: '2016 Honda Accord',
    pickupLocation: '1370 Emig Rd, Columbus, OH',
    destination: 'Firestone Complete Auto Care, 939 Linwood Ave, Columbus, OH',
    issue: 'will not start',
    issueSubcategory: 'no_start',
    nearestShop: "Petty's Auto & Electric Service",
    nearestShopDistanceMiles: 2.4,
    nearestShopAddress: '2088 Mock Rd, Columbus',
    destinationIsDealer: false,
    alternateShops: ALTERNATES,
    scriptVariant: 'control',
    rentalsAvailable: true,
    pitchConvini: true,
    customAgentRules: ROADSIDE_CUSTOM_RULES,
    ...over,
  };
}

function s(
  name: string,
  scenario: ScenarioKey,
  over: Partial<ScriptContext> = {},
  tenant: ScriptSample['tenant'] = 'roadside',
): ScriptSample {
  const rules =
    tenant === 'roadside' ? ROADSIDE_CUSTOM_RULES : tenant === 'global-default' ? GLOBAL_DEFAULT_RULES : null;
  return { name, tenant, scenario, ctx: baseContext({ customAgentRules: rules, ...over }) };
}

const TIRE = { issue: 'a flat tire', issueSubcategory: 'single_tire_issue' } as const;
const COLLISION = { issue: 'collision damage, rear-ended', issueSubcategory: 'collision' } as const;
const GLASS = { issue: 'cracked windshield', issueSubcategory: null } as const;
const WINCH = { issue: 'stuck in a ditch', issueSubcategory: 'winch_out' } as const;

export const SCRIPT_SAMPLES: ScriptSample[] = [
  // Scenario A — competitor repair, every offer shape, both arms.
  s('A control multi-shop mechanical', 'competitor_repair'),
  s('A reframe multi-shop mechanical', 'competitor_repair', { scriptVariant: 'reframe' }),
  s('A control single-shop mechanical', 'competitor_repair', { alternateShops: [] }),
  s('A reframe single-shop mechanical', 'competitor_repair', { scriptVariant: 'reframe', alternateShops: [] }),
  s('A control multi-shop tire', 'competitor_repair', { ...TIRE }),
  s('A reframe single-shop tire', 'competitor_repair', { ...TIRE, scriptVariant: 'reframe', alternateShops: [] }),
  s('A control dealer destination', 'competitor_repair', {
    destination: 'Byers Toyota, 3800 Morse Rd, Columbus, OH',
    destinationIsDealer: true,
  }),
  s('A reframe dealer tire', 'competitor_repair', { ...TIRE, scriptVariant: 'reframe', destinationIsDealer: true }),
  s('A control no partner shop', 'competitor_repair', { nearestShop: null, alternateShops: [] }),
  s('A reframe collision (offer suppressed)', 'competitor_repair', { ...COLLISION, scriptVariant: 'reframe' }),
  s('A control missing destination', 'competitor_repair', { destination: '' }),
  s('A reframe unusable name, no address', 'competitor_repair', {
    scriptVariant: 'reframe',
    customerFirstName: '39.9612,-82.9988',
    customerFullName: null,
    nearestShopAddress: null,
    nearestShopDistanceMiles: 0.3,
  }),
  s('A control first name only, global rules', 'competitor_repair', { customerFullName: 'Kelli' }, 'global-default'),
  s('A reframe tire, no tenant rules', 'competitor_repair', { ...TIRE, scriptVariant: 'reframe' }, 'no-rules'),
  s('A control winch-out to shop', 'competitor_repair', { ...WINCH }),

  // Scenario B — body, collision, glass.
  s('B control collision to body shop', 'auto_body', {
    ...COLLISION,
    destination: 'Caliber Collision, 5100 Sinclair Rd, Columbus, OH',
    bodyShop1: 'Alpha Collision East',
    bodyShop2: 'Alpha Collision West',
  }),
  s('B reframe glass to storage', 'auto_body', {
    ...GLASS,
    scriptVariant: 'reframe',
    destination: '',
    bodyShop1: 'Alpha Collision East',
  }),
  s('B control ordinary body-shop delivery', 'auto_body', {
    issue: 'will not start',
    destination: 'Caliber Collision, 5100 Sinclair Rd, Columbus, OH',
  }),

  // Scenario C — residence / unknown, conditional offer and none.
  s('C control unknown with conditional shop', 'unknown', {
    destination: 'Google pin near Morse Rd',
    nearestShop: null,
    conditionalShop: "Petty's Auto & Electric Service",
    conditionalShopDistanceMiles: 3.1,
  }),
  s('C reframe residence no offer', 'residence', {
    scriptVariant: 'reframe',
    destination: '44 Oak St, Westerville, OH',
    nearestShop: null,
  }),
  s('C control flat tire, no convini', 'unknown', {
    ...TIRE,
    nearestShop: null,
    pitchConvini: false,
  }),
  s('C control winch-out service only', 'unknown', {
    ...WINCH,
    destination: '1370 Emig Rd, Columbus, OH',
    nearestShop: null,
  }),
  s('C reframe no destination', 'unknown', { scriptVariant: 'reframe', destination: '', nearestShop: null }, 'global-default'),

  // Scenario D and AAA-branded.
  s('D control our shop', 'our_shop', { destination: "Petty's Auto & Electric Service, 2088 Mock Rd" }),
  s('D reframe our shop', 'our_shop', { scriptVariant: 'reframe', destination: "Wayne's Auto Repair — Westerville" }),
  s('AAA control branded destination', 'aaa_branded', { destination: 'AAA Car Care Plus, 1000 Polaris Pkwy' }),
  s('AAA reframe branded, no rules', 'aaa_branded', { scriptVariant: 'reframe' }, 'no-rules'),
];
