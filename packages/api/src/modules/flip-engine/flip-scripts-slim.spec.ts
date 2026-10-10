import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTHORIZED_LINES,
  CONFIRM_LINES,
  REFRAME_OFFER_BRIDGE,
  activeScriptVersion,
  baseVars,
  conviniCloseFor,
  interpolate,
  renderCallBody,
  renderLegacyCallBody,
  scenarioAOffer,
  scenarioBLines,
  scenarioCConditionalOffer,
  scriptMode,
  SCRIPT_VERSION,
} from './flip-scripts';
import { SLIM_MAX_TOKENS, estimateTokens, renderSlimCallBody, uncoveredTenantRules } from './flip-scripts-slim';
import { GLOBAL_DEFAULT_RULES, ROADSIDE_CUSTOM_RULES, SCRIPT_SAMPLES, baseContext } from './script-samples';

const RETELL = join(__dirname, '../../../../../retell');
// Line endings normalized: a Windows checkout (core.autocrlf) adds a byte per line.
const core = readFileSync(join(RETELL, 'core_prompt.md'), 'utf8').replace(/\r\n/g, '\n');
const kbFiles = readdirSync(join(RETELL, 'knowledge')).filter((f) => f.endsWith('.md'));
const kb = kbFiles.map((f) => readFileSync(join(RETELL, 'knowledge', f), 'utf8')).join('\n');

/** The quoted words of every `AI: "…"` line. */
function aiLines(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('AI: "'))
    .map((l) => l.slice(4));
}

const render = (x: (typeof SCRIPT_SAMPLES)[number]) => ({
  legacy: renderLegacyCallBody(x.scenario, x.ctx),
  slim: renderSlimCallBody(x.scenario, x.ctx),
});

describe('SCRIPT_MODE flag', () => {
  const saved = process.env.SCRIPT_MODE;
  afterEach(() => {
    if (saved === undefined) delete process.env.SCRIPT_MODE;
    else process.env.SCRIPT_MODE = saved;
  });
  const x = SCRIPT_SAMPLES[0];

  it('defaults to legacy, byte for byte', () => {
    delete process.env.SCRIPT_MODE;
    expect(scriptMode()).toBe('legacy');
    expect(renderCallBody(x.scenario, x.ctx)).toBe(renderLegacyCallBody(x.scenario, x.ctx));
    expect(activeScriptVersion()).toBe(SCRIPT_VERSION);
  });

  it('anything but "slim" is legacy', () => {
    for (const v of ['', 'legacy', 'SLIMMER', 'true', '1']) {
      process.env.SCRIPT_MODE = v;
      expect(scriptMode(), v).toBe('legacy');
    }
  });

  it('slim renders the slim body and stamps a separate script version', () => {
    process.env.SCRIPT_MODE = ' Slim ';
    expect(renderCallBody(x.scenario, x.ctx)).toBe(renderSlimCallBody(x.scenario, x.ctx));
    expect(activeScriptVersion()).toBe(`${SCRIPT_VERSION}-slim`);
  });
});

describe('slim script_body — every sample', () => {
  for (const x of SCRIPT_SAMPLES) {
    describe(x.name, () => {
      const { legacy, slim } = render(x);

      it('keeps every legacy AI: line verbatim', () => {
        for (const line of aiLines(legacy)) expect(slim, line).toContain(line);
      });

      it(`stays within ${SLIM_MAX_TOKENS} tokens`, () => {
        expect(estimateTokens(slim)).toBeLessThanOrEqual(SLIM_MAX_TOKENS);
      });

      it('is a fraction of the legacy size', () => {
        expect(slim.length).toBeLessThan(legacy.length * 0.3);
      });

      it('has at most one [AGENT:] note per step, each ≤ 25 words', () => {
        let notes = 0;
        for (const l of slim.split('\n')) {
          if (/^\[(?!AGENT)/.test(l)) {
            notes = 0;
            continue;
          }
          const m = l.match(/^\[AGENT: (.*)\]$/);
          if (!m) continue;
          notes += 1;
          expect(notes, l).toBe(1);
          // The cap is on the instruction, not on the call data dropped into it.
          let text = m[1];
          for (const v of [x.ctx.nearestShop, x.ctx.destination, x.ctx.callbackNumber]) {
            if (v) text = text.split(v).join('X');
          }
          expect(text.split(/\s+/).length, l).toBeLessThanOrEqual(25);
        }
      });

      it('ships no GLOBAL RULES preamble and nothing unspeakable', () => {
        expect(slim).not.toContain('GLOBAL RULES');
        expect(slim).not.toContain('TENANT CUSTOM RULES');
        expect(slim).not.toMatch(/\{\{[^}]*\}\}/);
      });
    });
  }
});

describe('slim script_body — offers and terms are identical to legacy', () => {
  const aSamples = SCRIPT_SAMPLES.filter((x) => x.scenario === 'competitor_repair');

  for (const x of aSamples) {
    const o = scenarioAOffer(x.ctx);
    if (!o.offersAllowed) continue;
    it(`${x.name}: offer, follow-up and reassurance appear word for word in both`, () => {
      const { legacy, slim } = render(x);
      const vars = baseVars(x.ctx);
      const lines = [interpolate(o.defaultOffer1, vars)];
      if (!x.ctx.destinationIsDealer) {
        lines.push(interpolate(o.defaultOffer2, vars), interpolate(o.defaultOffer2Reassurance, vars));
      }
      for (const l of lines) {
        expect(legacy, l).toContain(l);
        expect(slim, l).toContain(l);
      }
    });
  }

  it('the tire offer and the mechanical offer never mix', () => {
    for (const x of aSamples) {
      const o = scenarioAOffer(x.ctx);
      if (!o.offersAllowed) continue;
      const { slim } = render(x);
      if (o.isTireJob) {
        expect(slim, x.name).toContain('10 percent off your next set of tires');
        expect(slim, x.name).not.toContain('free visual mechanical diagnostic');
      } else {
        expect(slim, x.name).toContain('up to 10 percent off parts and labor');
        expect(slim, x.name).not.toContain('next set of tires');
      }
    }
  });

  it('keeps the $ anchor, "up to" wording and VIP framing exactly', () => {
    const x = SCRIPT_SAMPLES.find((s) => s.name === 'A control single-shop mechanical')!;
    const { slim } = render(x);
    expect(slim).toContain('as a new VIP customer you\'d get a free visual mechanical diagnostic — a visual inspection of up to an hour, normally a $179 value — plus up to 10 percent off parts and labor.');
  });

  it('closes, the body-shop statement and the conditional offers are verbatim', () => {
    for (const x of SCRIPT_SAMPLES) {
      const { legacy, slim } = render(x);
      const vars = baseVars(x.ctx);
      const close = interpolate(conviniCloseFor(x.ctx), vars);
      if (legacy.includes(close)) expect(slim, x.name).toContain(close);
      if (x.scenario === 'auto_body') {
        const statement = interpolate(scenarioBLines(x.ctx).statement, vars);
        expect(legacy).toContain(statement);
        expect(slim).toContain(statement);
      }
      const cond = scenarioCConditionalOffer(x.ctx);
      if (cond && (x.scenario === 'unknown' || x.scenario === 'residence')) {
        for (const l of [cond.repairShop, cond.home]) {
          expect(legacy).toContain(l);
          expect(slim).toContain(l);
        }
      }
    }
  });
});

describe('slim script_body — what does not apply is not shipped', () => {
  const OFFER_WORDS = /certified|percent|diagnostic|switch the drop-off|ride home/i;

  it('no offer wording where there is no offer', () => {
    const noOffer = SCRIPT_SAMPLES.filter((x) => {
      if (x.scenario === 'competitor_repair') return !scenarioAOffer(x.ctx).offersAllowed;
      if (x.scenario === 'unknown' || x.scenario === 'residence') return !x.ctx.conditionalShop;
      return true; // B, D, AAA never carry an offer
    });
    expect(noOffer.length).toBeGreaterThan(8);
    for (const x of noOffer) {
      const { slim } = render(x);
      // The reframe purpose line promises savings at partner shops on every
      // call, exactly as legacy does — it is not an offer.
      // Only what can be spoken: notes and labels name the offer in order to forbid it.
      const spoken = slim
        .split('\n')
        .filter((l) => !l.startsWith('['))
        .join('\n')
        .replace(/AI: "I'll confirm your tow details[^\n]*/, '');
      expect(spoken, x.name).not.toMatch(OFFER_WORDS);
    }
  });

  it('a dealership gets one offer and no follow-up', () => {
    for (const x of SCRIPT_SAMPLES.filter((s) => s.ctx.destinationIsDealer && s.scenario === 'competitor_repair')) {
      const { slim } = render(x);
      expect(slim).not.toContain('Totally fair');
      expect(slim).not.toContain('REASSURANCE');
      expect(slim).toContain('ONE OFFER ONLY');
    }
  });

  it('control never carries the reframe announcement; single-shop never carries the choice step', () => {
    for (const x of SCRIPT_SAMPLES) {
      const { slim } = render(x);
      if (x.ctx.scriptVariant !== 'reframe') expect(slim, x.name).not.toContain(REFRAME_OFFER_BRIDGE);
      if (!(x.ctx.alternateShops ?? []).length) expect(slim, x.name).not.toContain('SHOP CHOICE');
    }
  });

  it('scenario labels and other scenarios never leak in', () => {
    for (const x of SCRIPT_SAMPLES) {
      const { slim } = render(x);
      expect(slim, x.name).not.toMatch(/SCENARIO [A-D]\b/);
      if (x.scenario !== 'auto_body') expect(slim, x.name).not.toContain('we own our own body shops');
      if (x.scenario !== 'our_shop') expect(slim, x.name).not.toContain('Great news — your vehicle is coming to our shop');
      if (x.ctx.issueSubcategory !== 'winch_out') expect(slim, x.name).not.toContain(CONFIRM_LINES.winchPhotos);
    }
  });
});

describe('F4/F5 — disclosures live in the script, only where they apply', () => {
  const RIDE = `${AUTHORIZED_LINES.rideOffer} ${AUTHORIZED_LINES.ridePayment}`;
  const hasOffer = (x: (typeof SCRIPT_SAMPLES)[number]) =>
    x.scenario === 'competitor_repair'
      ? scenarioAOffer(x.ctx).offersAllowed
      : (x.scenario === 'unknown' || x.scenario === 'residence') && !!x.ctx.conditionalShop;

  it('every call with an offer carries the ride offer and its payment disclosure, together', () => {
    for (const x of SCRIPT_SAMPLES.filter(hasOffer)) {
      const { slim, legacy } = render(x);
      expect(slim, x.name).toContain(RIDE);
      expect(slim, x.name).toContain(AUTHORIZED_LINES.rideKeeping);
      if (x.scenario === 'competitor_repair') {
        expect(legacy, x.name).toContain(AUTHORIZED_LINES.ridePayment);
      }
    }
  });

  it('calls without an offer carry no ride, rental or onward-tow promise', () => {
    for (const x of SCRIPT_SAMPLES.filter((s) => !hasOffer(s))) {
      const { slim } = render(x);
      expect(slim, x.name).not.toContain('RoadsideMC');
      expect(slim, x.name).not.toContain('rental cars');
      expect(slim, x.name).not.toContain("You're not stuck there");
    }
  });

  it('"not stuck there" names this call\'s real destination, and only when there is one', () => {
    const x = SCRIPT_SAMPLES.find((s) => s.name === 'A control multi-shop mechanical')!;
    expect(render(x).slim).toContain(
      "You're not stuck there. If the repair isn't something you want to go ahead with, we'll tow it on to Firestone Complete Auto Care, 939 Linwood Ave, Columbus, OH at no cost to you.",
    );
    const missing = SCRIPT_SAMPLES.find((s) => s.name === 'A control missing destination')!;
    expect(render(missing).slim).not.toContain("You're not stuck there");
    expect(kb).not.toContain("You're not stuck there");
  });

  it('the rental answer keeps full coverage and appears only when the tenant mentions rentals', () => {
    const x = SCRIPT_SAMPLES.find((s) => s.name === 'A control single-shop mechanical')!;
    expect(render(x).slim).toContain(AUTHORIZED_LINES.rental);
    expect(AUTHORIZED_LINES.rental).toContain("You'd need your driver's license and full coverage insurance.");
    const off = renderSlimCallBody('competitor_repair', { ...x.ctx, rentalsAvailable: false });
    expect(off).not.toContain('rental cars');
    for (const c of SCRIPT_SAMPLES.filter((s) => s.scenario !== 'competitor_repair')) {
      expect(render(c).slim, c.name).not.toContain('rental cars');
    }
  });

  it('the knowledge pack no longer carries any disclosure', () => {
    expect(kb).not.toContain('RoadsideMC member');
    expect(kb).not.toContain('full coverage insurance');
  });
});

describe('tenant custom rules are resolved, never dropped', () => {
  it('Roadside keeps only its INSURANCE RULE, verbatim', () => {
    const kept = uncoveredTenantRules(ROADSIDE_CUSTOM_RULES, 'Roadside Towing');
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain('We understand you are under agreement with your insurance. We do have partner shops if you ever need a referral in the future.');
  });

  it('the global default rules are fully covered by the core prompt', () => {
    expect(uncoveredTenantRules(GLOBAL_DEFAULT_RULES, 'Roadside Towing')).toEqual([]);
  });

  it('an unknown tenant rule ships verbatim', () => {
    const rule = '- Always mention our 24-hour lot on Cleveland Ave.';
    const slim = renderSlimCallBody('competitor_repair', baseContext({ customAgentRules: `${GLOBAL_DEFAULT_RULES}\n${rule}` }));
    expect(slim).toContain(rule);
  });
});

describe('tier 1 core prompt and tier 3 knowledge pack', () => {
  it('core prompt fits its budget and injects the script once', () => {
    // 5,000 chars ≈ 1,200 cl100k tokens on this text (measured 1,191 on 2026-10-09).
    expect(core.length).toBeLessThanOrEqual(5_000);
    expect(core.match(/\{\{script_body\}\}/g)).toHaveLength(1);
  });

  it('keeps the rules that make the script the authority on offers', () => {
    expect(core).toContain('THE SCRIPT DECIDES WHETHER TO PITCH, NOT YOU');
    expect(core).toContain('AT MOST TWO OFFERS');
    expect(core).toContain('TWO REFUSALS END EVERY OFFER');
    expect(core).toContain('NEVER CONFIRM OR STATE AN ARRIVAL TIME');
    expect(core).toContain('GOING HOME IS NOT A SKIP');
    expect(core).toContain('A flat tire being towed is repair work');
    expect(core).toContain('"Understood. I\'ll keep your original destination and focus on getting the driver routed."');
    expect(core).toContain('"I don\'t have the exact ETA in front of me, but the driver will call you directly once they\'re dispatched."');
    expect(core).toContain('"Just so I have it clearly — is that a yes to sending the driver to');
  });

  it('withholds a written offer only for jobs that need no repair', () => {
    const rule6 = core.split('\n').find((l) => l.startsWith('6. '))!;
    expect(rule6).toMatch(/fuel, jump start, lockout/);
    expect(rule6).not.toMatch(/dealership|body shop|residence/);
  });

  it('defines the IF line format the slim script uses', () => {
    expect(core).toMatch(/`IF <situation> → "words"`/);
  });

  it('F2 — injury or danger: 911, reassure, no offers, warm close; never just hang up', () => {
    const rule17 = core.split('\n').find((l) => l.startsWith('17. '))!;
    expect(rule17).toMatch(/Injured or in immediate danger: tell them to call 911, reassure them a driver is coming, skip all offers, warm close; never just hang up\./);
    expect(rule17).not.toMatch(/in danger or asks you to stop/);
  });

  it('every knowledge file is small and titled with what a customer says', () => {
    expect(kbFiles.length).toBeGreaterThanOrEqual(12);
    for (const f of kbFiles) {
      const t = readFileSync(join(RETELL, 'knowledge', f), 'utf8');
      expect(estimateTokens(t), f).toBeLessThanOrEqual(300);
      expect(t.split('\n')[0], f).toMatch(/^# ".+"/);
    }
  });

  it('non-disclosure authorized answers moved to the knowledge pack word for word', () => {
    for (const quote of [
      "When the repair's done, you can request a tow home — either through your motor club again, or straight from the Roadside App I'm texting you.",
      "It's an all-in-one emergency services app. You get 24/7 roadside assistance, and from the app you can book towing, car rentals, auto repair and auto body repair.",
      "Our partner shops take most aftermarket repair policies. I can note down who you're insured with and have our office team check your coverage with them directly.",
    ]) {
      expect(kb, quote).toContain(quote);
      // and the legacy script still carries the same words
      const legacy = renderLegacyCallBody('competitor_repair', baseContext());
      expect(legacy, quote).toContain(quote);
    }
  });
});
