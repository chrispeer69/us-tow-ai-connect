#!/usr/bin/env node
/**
 * Replace the ecosystem section of the USTA INBOUND agent's prompt.
 *
 * The inbound prompt is long and hand-tuned; only the block between
 * "## THE ECOSYSTEM" and the next "## " heading is touched. Everything the
 * agent knows about how to talk, when to offer Chris, and how to say the brand
 * name is left exactly as found.
 *
 * The block is read from scripts/usta-inbound-ecosystem.md so the facts live in
 * a reviewable file rather than a string literal in a script. The long-form
 * version with sources and dates is docs/USTA_ECOSYSTEM_KNOWLEDGE.md.
 *
 *   cd packages/api
 *   RETELL_API_KEY=... node scripts/usta-inbound-kb.js --dry-run
 *   RETELL_API_KEY=... node scripts/usta-inbound-kb.js --apply
 *
 * Publishing is not optional. A PATCH creates a draft, and the phone number
 * pins an explicit version — so without the publish-and-re-pin the dashboard
 * shows the new text while every caller still hears the old one.
 */

const fs = require('fs');
const path = require('path');

const API = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;

const AGENT = 'agent_65ae77d4320c10fae26f8e4ad9'; // USTA-Inbound-v1
const LLM = 'llm_5346026231a827f598e7bd101b73';
const NUMBER = process.env.USTA_FROM_NUMBER || '+17408807758';
const SECTION = path.join(__dirname, 'usta-inbound-ecosystem.md');
const HEADING = '## THE ECOSYSTEM';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

if (!KEY) {
  console.error('RETELL_API_KEY is required');
  process.exit(2);
}

async function retell(p, method = 'GET', body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

/**
 * Swap the ecosystem block for a new one.
 *
 * Anchored on the NEXT "## " heading rather than on a known trailing string:
 * the section that follows has been renamed once already, and an anchor that
 * silently fails to match would append a second copy of the whole pack instead
 * of replacing the first.
 */
function spliceSection(prompt, section) {
  const start = prompt.indexOf(HEADING);
  if (start === -1) {
    throw new Error(`"${HEADING}" not found in the inbound prompt — refusing to guess where it goes`);
  }
  const after = prompt.indexOf('\n## ', start + HEADING.length);
  const end = after === -1 ? prompt.length : after + 1;
  return prompt.slice(0, start) + section.trim() + '\n\n' + prompt.slice(end);
}

async function main() {
  const section = fs.readFileSync(SECTION, 'utf8').replace(/\r\n/g, '\n');
  if (!section.startsWith(HEADING)) {
    throw new Error(`${SECTION} must start with "${HEADING}"`);
  }

  const llm = await retell(`/get-retell-llm/${LLM}`);
  const before = llm.general_prompt.replace(/\r\n/g, '\n');
  const next = spliceSection(before, section);

  console.log(`inbound llm v${llm.version}: ${before.length} chars -> ${next.length}`);
  if (next === before) {
    console.log('No change. Nothing to publish.');
    return;
  }
  if (next.split(HEADING).length > 2) {
    throw new Error('the splice produced two ecosystem sections — aborting');
  }

  if (!APPLY) {
    console.log('\n--dry-run: nothing written. Re-run with --apply.');
    return;
  }

  await retell(`/update-retell-llm/${LLM}`, 'PATCH', { general_prompt: next });
  console.log('  prompt patched (draft)');

  await retell(`/publish-agent/${AGENT}`, 'POST', {}).catch((e) =>
    console.log(`  publish warning: ${e.message.slice(0, 140)}`),
  );
  const version = Math.max(
    ...(await retell('/list-agents'))
      .filter((a) => a.agent_id === AGENT && a.is_published)
      .map((a) => Number(a.version))
      .filter(Number.isFinite),
  );
  console.log(`  published as agent v${version}`);

  // Send outbound_agents back untouched. Omitting it clears the binding, and an
  // unbound outbound agent means the whole campaign stops dialling.
  const num = await retell(`/get-phone-number/${encodeURIComponent(NUMBER)}`);
  await retell(`/update-phone-number/${encodeURIComponent(NUMBER)}`, 'PATCH', {
    inbound_agents: [{ agent_id: AGENT, agent_version: version, weight: 1 }],
    outbound_agents: num.outbound_agents,
  });
  console.log(`  ${NUMBER} inbound -> v${version}`);

  const check = await retell(`/get-retell-llm/${LLM}`);
  for (const probe of [
    'CLAIM SHIELD',
    'Vol. 07',
    '$4,999',
    'Shareholder is the CHEAPEST',
    'sold to CPAs',
    'Not up yet',
  ]) {
    console.log(`  ${probe.padEnd(30)} ${check.general_prompt.includes(probe) ? 'ok' : 'MISSING'}`);
  }
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
