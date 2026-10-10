import { afterEach, describe, expect, it } from 'vitest';
import {
  abCsv,
  abPctFromEnv,
  agentStatedEta,
  effectiveAbPct,
  pickAbArm,
  renderForArm,
  scriptVersionForArm,
  shouldRollback,
  summarizeAb,
  totalsFor,
  type AbCallRow,
  type ArmTotals,
} from './ab-slim-gemini';
import { SCRIPT_VERSION, pickScriptVariant, renderLegacyCallBody } from './flip-scripts';
import { renderSlimCallBody } from './flip-scripts-slim';
import { SCRIPT_SAMPLES } from './script-samples';

const ids = Array.from({ length: 10_000 }, (_, i) => `job-${i}-${(i * 7919) % 104729}`);

describe('arm assignment', () => {
  it('is deterministic per job — a retry stays in its arm', () => {
    for (const id of ids.slice(0, 200)) expect(pickAbArm(id, 20)).toBe(pickAbArm(id, 20));
  });

  it('sends about the configured share to slim_gemini', () => {
    const share = ids.filter((id) => pickAbArm(id, 20) === 'slim_gemini').length / ids.length;
    expect(share).toBeGreaterThan(0.18);
    expect(share).toBeLessThan(0.22);
  });

  it('0, negative, unparseable or no seed is always legacy; 100 is always slim', () => {
    for (const id of ids.slice(0, 100)) {
      expect(pickAbArm(id, 0)).toBe('legacy');
      expect(pickAbArm(id, -5)).toBe('legacy');
      expect(pickAbArm(id, NaN)).toBe('legacy');
      expect(pickAbArm(id, 100)).toBe('slim_gemini');
    }
    expect(pickAbArm('', 100)).toBe('legacy');
    expect(pickAbArm(null, 100)).toBe('legacy');
  });

  it('is independent of the control/reframe split on the same job id', () => {
    const slim = ids.filter((id) => pickAbArm(id, 20) === 'slim_gemini');
    const reframe = slim.filter((id) => pickScriptVariant(id) === 'reframe').length / slim.length;
    expect(reframe).toBeGreaterThan(0.45);
    expect(reframe).toBeLessThan(0.55);
  });
});

describe('switches', () => {
  it('reads AB_SLIM_GEMINI_PCT, clamped; unset or junk is off', () => {
    expect(abPctFromEnv({} as NodeJS.ProcessEnv)).toBe(0);
    expect(abPctFromEnv({ AB_SLIM_GEMINI_PCT: '20' } as NodeJS.ProcessEnv)).toBe(20);
    expect(abPctFromEnv({ AB_SLIM_GEMINI_PCT: '250' } as NodeJS.ProcessEnv)).toBe(100);
    expect(abPctFromEnv({ AB_SLIM_GEMINI_PCT: 'twenty' } as NodeJS.ProcessEnv)).toBe(0);
    expect(abPctFromEnv({ AB_SLIM_GEMINI_PCT: '0' } as NodeJS.ProcessEnv)).toBe(0);
  });

  it('is off when rolled back or when the slim agent is not configured', () => {
    const on = { AB_SLIM_GEMINI_PCT: '20', AB_SLIM_GEMINI_AGENT_ID: 'agent_x' } as NodeJS.ProcessEnv;
    expect(effectiveAbPct(false, on)).toBe(20);
    expect(effectiveAbPct(true, on)).toBe(0);
    expect(effectiveAbPct(false, { AB_SLIM_GEMINI_PCT: '20' } as NodeJS.ProcessEnv)).toBe(0);
  });
});

describe('rendering per arm', () => {
  const saved = process.env.SCRIPT_MODE;
  afterEach(() => {
    if (saved === undefined) delete process.env.SCRIPT_MODE;
    else process.env.SCRIPT_MODE = saved;
  });

  it('slim arm renders the slim body and stamps 3.16-slim', () => {
    for (const x of SCRIPT_SAMPLES) {
      const r = renderForArm('slim_gemini', x.scenario, x.ctx);
      expect(r.arm).toBe('slim_gemini');
      expect(r.body).toBe(renderSlimCallBody(x.scenario, x.ctx));
      expect(r.scriptVersion).toBe(`${SCRIPT_VERSION}-slim`);
    }
  });

  it('legacy arm is always the legacy renderer, even if SCRIPT_MODE=slim is set globally', () => {
    process.env.SCRIPT_MODE = 'slim';
    for (const x of SCRIPT_SAMPLES) {
      const r = renderForArm('legacy', x.scenario, x.ctx);
      expect(r.arm).toBe('legacy');
      expect(r.body).toBe(renderLegacyCallBody(x.scenario, x.ctx));
      expect(r.scriptVersion).toBe(SCRIPT_VERSION);
    }
  });

  it('script versions per arm', () => {
    expect(scriptVersionForArm('slim_gemini')).toBe(`${SCRIPT_VERSION}-slim`);
    expect(scriptVersionForArm('legacy')).toBe(SCRIPT_VERSION);
  });
});

describe('ETA-stated violations', () => {
  it('flags an agent stating or confirming a time', () => {
    for (const t of [
      'Agent: The driver will be there around 3:30 PM.',
      'Agent: He should arrive in about 20 minutes.',
      'Agent: They are 15 minutes away.',
      'Agent: Expect them within the hour.',
      'Agent: The driver will get to you in an hour or so.',
    ]) expect(agentStatedEta(t), t).toBe(true);
  });

  it('never flags the scripted refusal, the customer, or ordinary numbers', () => {
    for (const t of [
      "Agent: I don't have the exact ETA in front of me, but the driver will call you directly once they're dispatched.",
      'User: They told me 3:30 PM, is that right?\nAgent: I don\'t have the exact ETA in front of me.',
      'Agent: a visual inspection of up to an hour, normally a $179 value — plus up to 10 percent off parts and labor.',
      'Agent: I have your pickup location as 1370 Emig Rd. Is that correct?',
      'Agent: about 2 miles away; Johns Auto Repair, about 8 miles away.',
    ]) expect(agentStatedEta(t), t).toBe(false);
  });
});

describe('auto-rollback rule', () => {
  const t = (o: Partial<ArmTotals>): ArmTotals => ({
    connected: 60,
    eligibleConnected: 40,
    accepted: 4,
    costDollars: 30,
    billedMinutes: 200,
    ...o,
  });

  it('never fires before 50 connected slim calls', () => {
    expect(shouldRollback(t({ connected: 49, costDollars: 999 }), t({})).rollback).toBe(false);
  });

  it('fires when slim costs more than $0.20/min', () => {
    const v = shouldRollback(t({ costDollars: 42, billedMinutes: 200 }), t({}));
    expect(v.rollback).toBe(true);
    expect(v.reason).toMatch(/\$0\.210\/min/);
  });

  it('fires when slim acceptance is under 70% of legacy, not at or above it', () => {
    expect(shouldRollback(t({ accepted: 1, eligibleConnected: 40 }), t({ accepted: 4, eligibleConnected: 40 })).rollback).toBe(true);
    expect(shouldRollback(t({ accepted: 3, eligibleConnected: 40 }), t({ accepted: 4, eligibleConnected: 40 })).rollback).toBe(false);
  });

  it('cannot fail acceptance when legacy has no wins to compare against', () => {
    expect(shouldRollback(t({ accepted: 0 }), t({ accepted: 0 })).rollback).toBe(false);
  });
});

describe('per-arm daily report', () => {
  const row = (o: Partial<AbCallRow>): AbCallRow => ({
    day: '2026-10-12',
    arm: 'slim_gemini',
    durationSeconds: 120,
    flipEligible: true,
    offer1Result: 'DECLINED',
    flipOutcome: 'FAILED',
    disconnectionReason: 'agent_hangup',
    transcript: 'Agent: hello',
    costCents: 30,
    billedSeconds: 120,
    llmAvgTokens: 3000,
    latencyP50Ms: 900,
    latencyP95Ms: 1500,
    ...o,
  });
  const rows = [
    row({}),
    row({ offer1Result: 'ACCEPTED', flipOutcome: 'ACCEPTED' }),
    row({ offer1Result: 'NOT_ATTEMPTED', flipOutcome: 'NOT_ATTEMPTED', disconnectionReason: 'user_hangup' }),
    row({ durationSeconds: 12, offer1Result: 'NOT_ATTEMPTED', flipOutcome: 'NOT_ATTEMPTED' }), // voicemail
    row({ transcript: 'Agent: they will be there at 4 pm' }),
    row({ arm: 'legacy', costCents: 90, llmAvgTokens: 14800, latencyP50Ms: 1200, latencyP95Ms: 2400 }),
  ];

  it('applies the documented definitions', () => {
    const s = summarizeAb(rows).find((r) => r.arm === 'slim_gemini')!;
    expect(s.calls).toBe(5);
    expect(s.connected).toBe(4);
    expect(s.eligible_connected).toBe(4);
    expect(s.offer_made).toBe(3);
    expect(s.offer_accepted).toBe(1);
    expect(s.hard_refusals).toBe(2);
    expect(s.hangup_before_offer).toBe(1);
    expect(s.eta_violations).toBe(1);
    expect(s.avg_cost_per_min).toBeCloseTo(0.15, 5);
    expect(s.avg_llm_tokens).toBe(3000);
    expect(s.latency_p50_ms).toBe(900);
  });

  it('totals feed the rollback check', () => {
    const tot = totalsFor(rows, 'slim_gemini');
    expect(tot).toMatchObject({ connected: 4, eligibleConnected: 4, accepted: 1 });
    expect(tot.costDollars / tot.billedMinutes).toBeCloseTo(0.15, 5);
  });

  it('exports CSV with a header and one line per day and arm', () => {
    const csv = abCsv(summarizeAb(rows));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toMatch(/^day,arm,calls,connected,/);
    expect(lines).toHaveLength(3);
  });
});
