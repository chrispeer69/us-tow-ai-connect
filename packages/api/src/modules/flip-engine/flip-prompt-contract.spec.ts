import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Retell OUTBOUND prompt (scripts/emily-outbound-prompt.txt) sits on top
 * of the code script and wins every contradiction. Twice now a rule in it
 * quietly undid a decision made in code — the offer ladder on 2026-08-14
 * (rules 23/32) and "going home" on 2026-09-16 (rule 18). Chris: "we have
 * been over this before." This spec is the contract: the prompt may only
 * withhold a WRITTEN offer for the reasons the code recognises.
 */
const prompt = readFileSync(join(__dirname, '../../../scripts/emily-outbound-prompt.txt'), 'utf8');

describe('outbound Retell prompt — contract with the flip script', () => {
  it('never lists "going home" as a reason to skip an offer (Chris, 2026-09-16)', () => {
    expect(prompt).not.toMatch(/is going home, only needs fuel/);
    expect(prompt).toContain('GOING HOME IS NOT ON THIS LIST');
    expect(prompt).toMatch(/If the script contains an offer and the customer says the drop-off is home, make the offer/);
  });

  it('withholds a written offer only for jobs that need no repair', () => {
    const rule18 = prompt.split('\n').find((l) => l.startsWith('18. '));
    expect(rule18).toBeDefined();
    expect(rule18).toMatch(/fuel delivery only/);
    expect(rule18).toMatch(/jump start only/);
    expect(rule18).toMatch(/lockout only/);
    // Nothing about the type of destination may appear as a skip reason.
    expect(rule18).not.toMatch(/dealership|body shop|residence|not going to a repair facility/);
  });

  it('keeps the rules that make the script the authority on offers', () => {
    expect(prompt).toMatch(/16\. The script body decides whether a repair-shop offer applies/);
    expect(prompt).toMatch(/Never skip an offer that IS written/);
    expect(prompt).toMatch(/18a\. A FLAT TIRE IS REPAIR WORK/);
    expect(prompt).toMatch(/never say "per rule 18"/);
  });

  it('never narrates its reasoning to the customer', () => {
    expect(prompt).toMatch(/21\. NEVER speak your own reasoning/);
  });
});
