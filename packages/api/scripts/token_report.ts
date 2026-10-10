/**
 * Token report — legacy vs slim script_body, and the projected Retell $/min.
 *
 *   cd packages/api
 *   npx tsx scripts/token_report.ts                 # the built-in sample matrix
 *   DB_URL=… npx tsx scripts/token_report.ts --db   # + real calls from outbound_call_logs
 *
 * Counts tokens with cl100k (js-tiktoken) when it can be resolved — set
 * TIKTOKEN_MODULE to a path if it is installed outside this package — and
 * falls back to chars ÷ 4 otherwise (it says which in the header).
 *
 * Projected $/min = 0.085 + 0.064 × max(1, (prompt + script + 1,500 transcript) ÷ 4,000)
 *   legacy prompt = scripts/emily-outbound-prompt.txt (the live v61 wrapper)
 *   slim prompt   = retell/core_prompt.md
 * The prompt's own {{script_body}} placeholder is not counted twice.
 *
 * Read-only. Never writes to the database or to Retell.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  renderLegacyCallBody,
  scenarioForDestinationTag,
  type ScenarioKey,
  type ScriptContext,
} from '../src/modules/flip-engine/flip-scripts';
import { renderSlimCallBody } from '../src/modules/flip-engine/flip-scripts-slim';
import {
  GLOBAL_DEFAULT_RULES,
  ROADSIDE_CUSTOM_RULES,
  SCRIPT_SAMPLES,
  baseContext,
  type ScriptSample,
} from '../src/modules/flip-engine/script-samples';

const TRANSCRIPT_TOKENS = 1_500;
const STACK_PER_MIN = 0.085;
const LLM_PER_MIN = 0.064;

function loadCounter(): { name: string; count: (s: string) => number } {
  for (const id of [process.env.TIKTOKEN_MODULE, 'js-tiktoken'].filter(Boolean) as string[]) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getEncoding } = require(id);
      const enc = getEncoding('cl100k_base');
      return { name: 'cl100k (js-tiktoken)', count: (s) => enc.encode(s).length };
    } catch {
      /* try the next one */
    }
  }
  return { name: 'chars ÷ 4 (js-tiktoken not found)', count: (s) => Math.ceil(s.length / 4) };
}

const counter = loadCounter();
const tok = counter.count;
const strip = (prompt: string) => prompt.replace('{{script_body}}', '');
const legacyPrompt = tok(strip(readFileSync(join(__dirname, 'emily-outbound-prompt.txt'), 'utf8')));
const corePrompt = tok(strip(readFileSync(join(__dirname, '../../../retell/core_prompt.md'), 'utf8')));

const perMin = (prompt: number, script: number) =>
  STACK_PER_MIN + LLM_PER_MIN * Math.max(1, (prompt + script + TRANSCRIPT_TOKENS) / 4_000);

interface Row {
  name: string;
  legacy: number;
  slim: number;
}

function measure(samples: ScriptSample[]): Row[] {
  return samples.map((x) => ({
    name: x.name,
    legacy: tok(renderLegacyCallBody(x.scenario, x.ctx)),
    slim: tok(renderSlimCallBody(x.scenario, x.ctx)),
  }));
}

function print(title: string, rows: Row[]) {
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log(`\n${title}`);
  console.log(
    `${'sample'.padEnd(44)}${pad('legacy', 8)}${pad('slim', 7)}${pad('cut', 6)}${pad('$/min legacy', 14)}${pad('$/min slim', 12)}`,
  );
  for (const r of rows) {
    console.log(
      `${r.name.slice(0, 43).padEnd(44)}${pad(r.legacy, 8)}${pad(r.slim, 7)}${pad(`${Math.round((1 - r.slim / r.legacy) * 100)}%`, 6)}` +
        `${pad(`$${perMin(legacyPrompt, r.legacy).toFixed(3)}`, 14)}${pad(`$${perMin(corePrompt, r.slim).toFixed(3)}`, 12)}`,
    );
  }
  const avg = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  const max = (f: (r: Row) => number) => Math.max(...rows.map(f));
  console.log(
    `${'AVERAGE'.padEnd(44)}${pad(Math.round(avg((r) => r.legacy)), 8)}${pad(Math.round(avg((r) => r.slim)), 7)}${pad('', 6)}` +
      `${pad(`$${avg((r) => perMin(legacyPrompt, r.legacy)).toFixed(3)}`, 14)}${pad(`$${avg((r) => perMin(corePrompt, r.slim)).toFixed(3)}`, 12)}`,
  );
  console.log(`${'MAX'.padEnd(44)}${pad(max((r) => r.legacy), 8)}${pad(max((r) => r.slim), 7)}`);
}

/** Rebuild script contexts from real outbound_call_logs rows (fields the log keeps). */
async function realCallSamples(): Promise<{ samples: ScriptSample[]; sentBodies: number[] }> {
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const tenants = await c.query(
      `select id, company_name, flip_engine_config->>'custom_agent_rules' rules from tenants`,
    );
    const rulesFor = new Map<string, { name: string; rules: string | null }>(
      tenants.rows.map((t: any) => [t.id, { name: t.company_name, rules: t.rules }]),
    );
    // A few of the most recent calls per (tenant, scenario, eligibility, arm).
    const logs = await c.query(`
      select * from (
        select l.*, row_number() over (
          partition by l.tenant_id, l.scenario, l.flip_eligible, l.script_variant order by l.call_time desc) rn
        from outbound_call_logs l
        where l.call_time > now() - interval '14 days' and l.scenario is not null
      ) x where rn <= 2 order by tenant_id, scenario`);
    const sent = await c.query(`
      select length(script_variables->>'body') len from outbound_calls
      where created_at > now() - interval '3 days' and script_variables ? 'body'`);

    const samples: ScriptSample[] = logs.rows.map((r: any) => {
      const t = rulesFor.get(r.tenant_id);
      const scenario: ScenarioKey = scenarioForDestinationTag(r.scenario ?? r.destination_type ?? 'unknown');
      const first = (r.confirmed_first_name || r.customer_name || '').split(' ')[0] || 'there';
      const ctx: ScriptContext = baseContext({
        companyName: t?.name || 'Roadside Towing',
        customAgentRules: t?.rules ?? GLOBAL_DEFAULT_RULES,
        customerFirstName: first,
        customerFullName: r.customer_name,
        vehicle: r.vehicle || 'vehicle',
        destination: r.original_destination || r.destination_business_name || '',
        issue: r.issue_description || r.issue_type || 'a breakdown',
        issueSubcategory: r.issue_type ?? null,
        motorClub: r.motor_club || '',
        nearestShop: r.flip_eligible ? r.nearest_our_shop || baseContext().nearestShop : null,
        scriptVariant: r.script_variant === 'reframe' ? 'reframe' : 'control',
      });
      return {
        name: `${(t?.name || '?').slice(0, 12)} ${r.scenario} ${r.flip_eligible ? 'elig' : 'inelig'} ${r.script_variant || 'control'}`,
        tenant: 'roadside',
        scenario,
        ctx,
      };
    });
    return { samples, sentBodies: sent.rows.map((r: any) => Math.ceil(Number(r.len) / 4)) };
  } finally {
    await c.end();
  }
}

async function main() {
  console.log(`Tokenizer: ${counter.name}`);
  console.log(`Prompt tokens — legacy (v61 wrapper): ${legacyPrompt} · slim core: ${corePrompt} · transcript allowance: ${TRANSCRIPT_TOKENS}`);
  void ROADSIDE_CUSTOM_RULES;
  print('SAMPLE MATRIX (every tenant rule set, scenario, arm and offer shape)', measure(SCRIPT_SAMPLES));

  if (process.argv.includes('--db')) {
    if (!process.env.DB_URL) throw new Error('--db needs DB_URL');
    const { samples, sentBodies } = await realCallSamples();
    print(`REAL CALLS, rebuilt from outbound_call_logs (last 14 days, ${samples.length} rows)`, measure(samples));
    if (sentBodies.length) {
      const avg = Math.round(sentBodies.reduce((a, b) => a + b, 0) / sentBodies.length);
      console.log(
        `\nScript bodies actually sent, last 3 days: ${sentBodies.length} calls, avg ${avg} tokens (chars ÷ 4), max ${Math.max(...sentBodies)}.`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
