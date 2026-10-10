/**
 * Outbound A/B (2026-10-10): slim script + Gemini 3.6 Flash ("slim_gemini")
 * against the legacy script on the live v61 agent ("legacy").
 *
 * WHY: the slim body on Gemini measured ~$0.14/min against ~$0.36 for legacy
 * on Claude 5 Sonnet, with no sales-logic deviation in simulation. Cost is
 * proven; win rate is not, and only real calls can prove it. So a share of
 * calls goes to the new agent, both arms are measured side by side, and the
 * arm shuts itself off if it costs too much or wins too little.
 *
 * HOW:
 *   - Arm is chosen when the script is RENDERED (the slim arm needs the slim
 *     body), from a salted hash of the job id: deterministic, so a retry of
 *     the same job stays in its arm, and independent of the control/reframe
 *     split, which hashes the same id unsalted.
 *   - The arm rides in outbound_calls.script_variables.abArm; at dial time a
 *     slim_gemini call is placed on AB_SLIM_GEMINI_AGENT_ID/VERSION.
 *   - Every call log is stamped with ab_arm and its script version
 *     (`3.16-slim` vs `3.16`).
 *
 * SWITCHES (both must allow it):
 *   AB_SLIM_GEMINI_PCT        0–100, share of new jobs sent to slim_gemini. 0/unset = off.
 *   platform_settings['ab_slim_gemini'].rolled_back = true  — set by the
 *   auto-rollback (env vars cannot be written from code). Clear it to resume.
 * The arm is also off whenever the agent id is not configured.
 */
import {
  SCRIPT_VERSION,
  renderLegacyCallBody,
  type ScenarioKey,
  type ScriptContext,
} from './flip-scripts';
import { SLIM_MAX_TOKENS, estimateTokens, renderSlimCallBody } from './flip-scripts-slim';

export type AbArm = 'slim_gemini' | 'legacy';
export const AB_SETTINGS_KEY = 'ab_slim_gemini';
const SALT = 'ab-slim-gemini-2026-10:';

/** FNV-1a over a salted seed → 0..99. */
export function abBucket(seed: string): number {
  const s = SALT + seed;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** Deterministic arm for a job. pct ≤ 0 (or no seed) is always legacy. */
export function pickAbArm(seed: string | null | undefined, pct: number): AbArm {
  const s = (seed ?? '').trim();
  if (!s || !Number.isFinite(pct) || pct <= 0) return 'legacy';
  return abBucket(s) < Math.min(pct, 100) ? 'slim_gemini' : 'legacy';
}

/** AB_SLIM_GEMINI_PCT, clamped to 0–100. Anything unparseable is 0 (off). */
export function abPctFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number((env.AB_SLIM_GEMINI_PCT ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

/** The slim_gemini agent. Null when not configured — the arm is then off. */
export function abAgentFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { agentId: string; agentVersion: string | null } | null {
  const agentId = env.AB_SLIM_GEMINI_AGENT_ID?.trim();
  if (!agentId) return null;
  return { agentId, agentVersion: env.AB_SLIM_GEMINI_AGENT_VERSION?.trim() || null };
}

/** The share actually applied: env, unless rolled back or no agent configured. */
export function effectiveAbPct(rolledBack: boolean, env: NodeJS.ProcessEnv = process.env): number {
  if (rolledBack || !abAgentFromEnv(env)) return 0;
  return abPctFromEnv(env);
}

export function scriptVersionForArm(arm: AbArm): string {
  return arm === 'slim_gemini' ? `${SCRIPT_VERSION}-slim` : SCRIPT_VERSION;
}

/**
 * Render the body for an arm. The legacy arm is ALWAYS the legacy renderer —
 * never SCRIPT_MODE — so a global flag cannot contaminate the control. A slim
 * body over the size ceiling falls back to the legacy arm entirely (body AND
 * agent), so a slim prompt never runs a legacy script or the reverse.
 */
export function renderForArm(
  arm: AbArm,
  scenario: ScenarioKey,
  ctx: ScriptContext,
): { body: string; arm: AbArm; scriptVersion: string } {
  if (arm === 'slim_gemini') {
    const body = renderSlimCallBody(scenario, ctx);
    if (estimateTokens(body) <= SLIM_MAX_TOKENS) {
      return { body, arm, scriptVersion: scriptVersionForArm(arm) };
    }
  }
  return { body: renderLegacyCallBody(scenario, ctx), arm: 'legacy', scriptVersion: scriptVersionForArm('legacy') };
}

// ---------------------------------------------------------------------------
// ETA-stated violations
// ---------------------------------------------------------------------------

/**
 * True when an AGENT turn states or confirms an arrival time — a clock time,
 * "in N minutes", "within the hour", "N minutes away". The scripted refusal
 * ("I don't have the exact ETA in front of me…") never matches.
 */
export function agentStatedEta(transcript: string | null | undefined): boolean {
  if (!transcript) return false;
  const agentTurns = transcript
    .split(/\r?\n/)
    .filter((l) => /^\s*(agent|ai|emily)\s*:/i.test(l))
    .map((l) => l.replace(/^\s*\w+\s*:\s*/, ''));
  const ETA = [
    /\b(?:at|by|around|about|before|until)\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)/i,
    /\b(?:be there|arrive|get there|get to you|be with you|show up)\b[^.?!]{0,40}\b(?:\d+|an?|one|two|three|half an?)\s*(?:minutes?|mins?|hours?|hrs?)\b/i,
    /\b(?:in|within)\s+(?:about\s+|around\s+|the next\s+)?(?:\d+|an?|one|two|half an?)\s*(?:minutes?|mins?|hours?|hrs?)\b/i,
    /\b\d+\s*(?:minutes?|mins?)\s+(?:away|out)\b/i,
    /\bwithin the hour\b/i,
  ];
  return agentTurns.some((t) => ETA.some((re) => re.test(t)));
}

// ---------------------------------------------------------------------------
// Auto-rollback rule
// ---------------------------------------------------------------------------

export interface ArmTotals {
  connected: number;
  eligibleConnected: number;
  accepted: number;
  costDollars: number;
  billedMinutes: number;
}

export const ROLLBACK_MIN_CONNECTED = 50;
export const ROLLBACK_MAX_DOLLARS_PER_MIN = 0.2;
export const ROLLBACK_MIN_ACCEPT_RATIO = 0.7;

/**
 * Chris, 2026-10-10: after 50 connected slim calls, roll back if the slim arm
 * costs more than $0.20/min, or its offer-accepted rate is below 70% of
 * legacy's. Rates are per connected flip-eligible call. With no legacy wins to
 * compare against, the acceptance test cannot fail.
 */
export function shouldRollback(slim: ArmTotals, legacy: ArmTotals): { rollback: boolean; reason: string | null } {
  if (slim.connected < ROLLBACK_MIN_CONNECTED) return { rollback: false, reason: null };
  const perMin = slim.billedMinutes > 0 ? slim.costDollars / slim.billedMinutes : 0;
  if (perMin > ROLLBACK_MAX_DOLLARS_PER_MIN) {
    return { rollback: true, reason: `slim_gemini costs $${perMin.toFixed(3)}/min (limit $${ROLLBACK_MAX_DOLLARS_PER_MIN.toFixed(2)})` };
  }
  const rate = (t: ArmTotals) => (t.eligibleConnected > 0 ? t.accepted / t.eligibleConnected : 0);
  const legacyRate = rate(legacy);
  if (legacyRate > 0 && rate(slim) < ROLLBACK_MIN_ACCEPT_RATIO * legacyRate) {
    return {
      rollback: true,
      reason:
        `slim_gemini offer-accepted rate ${(rate(slim) * 100).toFixed(1)}% is below 70% of legacy ` +
        `${(legacyRate * 100).toFixed(1)}% (${slim.accepted}/${slim.eligibleConnected} vs ${legacy.accepted}/${legacy.eligibleConnected})`,
    };
  }
  return { rollback: false, reason: null };
}

// ---------------------------------------------------------------------------
// Per-arm daily report rows
// ---------------------------------------------------------------------------

/** One call, as the report query returns it. */
export interface AbCallRow {
  day: string; // YYYY-MM-DD, America/New_York
  arm: AbArm;
  durationSeconds: number | null;
  flipEligible: boolean | null;
  offer1Result: string | null;
  flipOutcome: string | null;
  disconnectionReason: string | null;
  transcript: string | null;
  costCents: number | null;
  billedSeconds: number | null;
  llmAvgTokens: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}

export interface AbDayRow {
  day: string;
  arm: AbArm;
  calls: number;
  connected: number;
  eligible_connected: number;
  offer_made: number;
  offer_made_rate: number | null;
  offer_accepted: number;
  offer_accepted_rate: number | null;
  hard_refusals: number;
  hangup_before_offer: number;
  eta_violations: number;
  avg_cost_per_min: number | null;
  avg_llm_tokens: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
}

/** A call counts as connected when a conversation happened (>30s), not a voicemail beep. */
export const CONNECTED_MIN_SECONDS = 30;
const OFFERED = new Set(['DECLINED', 'ACCEPTED']);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Aggregate calls into one row per (day, arm). Definitions:
 *   connected            duration > 30s
 *   offer made           offer_1_result DECLINED or ACCEPTED, among connected eligible
 *   offer accepted       flip_outcome ACCEPTED (destination changed), among connected eligible
 *   hard refusal         flip_outcome FAILED (every offer made was declined)
 *   hangup before offer  connected eligible, no offer, customer hung up
 *   ETA violation        an agent turn states or confirms an arrival time
 *   $/min                Retell combined cost ÷ billed minutes, all attempts
 *   latency              median of each call's e2e p50 / p95
 */
export function summarizeAb(rows: AbCallRow[]): AbDayRow[] {
  const groups = new Map<string, AbCallRow[]>();
  for (const r of rows) {
    const k = `${r.day}|${r.arm}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const out: AbDayRow[] = [];
  for (const [k, rs] of groups) {
    const [day, arm] = k.split('|') as [string, AbArm];
    const connected = rs.filter((r) => (r.durationSeconds ?? 0) > CONNECTED_MIN_SECONDS);
    const elig = connected.filter((r) => r.flipEligible);
    const offered = elig.filter((r) => OFFERED.has((r.offer1Result ?? '').toUpperCase()));
    const accepted = elig.filter((r) => (r.flipOutcome ?? '').toUpperCase() === 'ACCEPTED');
    const costed = rs.filter((r) => r.costCents != null && (r.billedSeconds ?? 0) > 0);
    const cents = costed.reduce((a, r) => a + Number(r.costCents), 0);
    const secs = costed.reduce((a, r) => a + Number(r.billedSeconds), 0);
    const tokens = rs.map((r) => r.llmAvgTokens).filter((x): x is number => x != null);
    out.push({
      day,
      arm,
      calls: rs.length,
      connected: connected.length,
      eligible_connected: elig.length,
      offer_made: offered.length,
      offer_made_rate: elig.length ? offered.length / elig.length : null,
      offer_accepted: accepted.length,
      offer_accepted_rate: elig.length ? accepted.length / elig.length : null,
      hard_refusals: elig.filter((r) => (r.flipOutcome ?? '').toUpperCase() === 'FAILED').length,
      hangup_before_offer: elig.filter(
        (r) => !OFFERED.has((r.offer1Result ?? '').toUpperCase()) && /user_hangup/i.test(r.disconnectionReason ?? ''),
      ).length,
      eta_violations: connected.filter((r) => agentStatedEta(r.transcript)).length,
      avg_cost_per_min: secs > 0 ? cents / 100 / (secs / 60) : null,
      avg_llm_tokens: tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : null,
      latency_p50_ms: median(rs.map((r) => r.latencyP50Ms).filter((x): x is number => x != null)),
      latency_p95_ms: median(rs.map((r) => r.latencyP95Ms).filter((x): x is number => x != null)),
    });
  }
  return out.sort((a, b) => (a.day === b.day ? a.arm.localeCompare(b.arm) : b.day.localeCompare(a.day)));
}

/** Totals over every row, for the rollback check. */
export function totalsFor(rows: AbCallRow[], arm: AbArm): ArmTotals {
  const rs = rows.filter((r) => r.arm === arm);
  const connected = rs.filter((r) => (r.durationSeconds ?? 0) > CONNECTED_MIN_SECONDS);
  const elig = connected.filter((r) => r.flipEligible);
  const costed = rs.filter((r) => r.costCents != null && (r.billedSeconds ?? 0) > 0);
  return {
    connected: connected.length,
    eligibleConnected: elig.length,
    accepted: elig.filter((r) => (r.flipOutcome ?? '').toUpperCase() === 'ACCEPTED').length,
    costDollars: costed.reduce((a, r) => a + Number(r.costCents), 0) / 100,
    billedMinutes: costed.reduce((a, r) => a + Number(r.billedSeconds), 0) / 60,
  };
}

export const AB_CSV_COLUMNS: (keyof AbDayRow)[] = [
  'day', 'arm', 'calls', 'connected', 'eligible_connected', 'offer_made', 'offer_made_rate',
  'offer_accepted', 'offer_accepted_rate', 'hard_refusals', 'hangup_before_offer', 'eta_violations',
  'avg_cost_per_min', 'avg_llm_tokens', 'latency_p50_ms', 'latency_p95_ms',
];

export function abCsv(rows: AbDayRow[]): string {
  const fmt = (v: unknown) =>
    v == null ? '' : typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(4) : String(v);
  return [AB_CSV_COLUMNS.join(','), ...rows.map((r) => AB_CSV_COLUMNS.map((c) => fmt(r[c])).join(','))].join('\n') + '\n';
}
