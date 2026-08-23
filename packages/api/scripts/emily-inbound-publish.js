#!/usr/bin/env node
/**
 * Publish the Emily INBOUND prompt — the 844-701-1345 line.
 *
 * This is a live customer line. People on it are frequently stranded, often at
 * night, sometimes on a shoulder. Every change ships through here so that the
 * text under review is the text that answers the phone.
 *
 *   cd packages/api
 *   RETELL_API_KEY=... node scripts/emily-inbound-publish.js            # show live
 *   RETELL_API_KEY=... node scripts/emily-inbound-publish.js --dry-run
 *   RETELL_API_KEY=... node scripts/emily-inbound-publish.js --apply
 *
 * No version re-pin here, unlike the USTA script: 844-701-1345 binds this agent
 * as `latest_published`, so publishing IS the deploy. Check that with --apply's
 * final line rather than assuming it — if the binding is ever pinned to a
 * number, publishing alone will silently change nothing.
 */

const fs = require('fs');
const path = require('path');

const API = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;

const AGENT = 'agent_d070aed59fd269162e2268a386'; // Emily INBOUND | Roadside Towing
const LLM = 'llm_5de3f737a66db98138167cc13e7b';
const NUMBER = '+18447011345';
const FILE = path.join(__dirname, 'emily-inbound.txt');

/**
 * The greeting is spoken from begin_message, NOT from the OPENING section of
 * the prompt — the prompt never gets a turn before it. Editing the opening in
 * the text file alone changes nothing a caller hears, which is exactly what
 * happened on the first publish of the three-way triage. It is derived from the
 * file here so the two cannot drift apart again.
 */
function greetingFrom(prompt) {
  const m = prompt.match(/^OPENING\.[^"]*"([^"]+)"/m);
  if (!m) throw new Error('no quoted greeting found under OPENING. in the prompt file');
  return m[1];
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY = args.includes('--dry-run');

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
 * Rules that have been paid for with real calls. If an edit drops one of these
 * the publish stops, because the failure mode is not a bad call — it is telling
 * somebody who has waited all night that they are five hours late.
 */
const MUST_CONTAIN = [
  'NEVER READ THE ETA FIELD ALOUD',
  'somewhere around thirty minutes',
  'NEVER quote a price',
  'NEVER discuss insurance',
  'lookup_job_by_phone',
  'transfer_to_dispatch',
  "I'm an automated assistant",
];

async function main() {
  const llm = await retell(`/get-retell-llm/${LLM}`);
  const live = (llm.general_prompt || '').replace(/\r\n/g, '\n').trim();

  if (!APPLY && !DRY) {
    console.log(`# live — llm v${llm.version}, ${live.length} chars\n`);
    console.log(live);
    return;
  }

  const next = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').trim();
  const missing = MUST_CONTAIN.filter((r) => !next.includes(r));
  if (missing.length) {
    throw new Error(`the new prompt drops rules that must survive:\n  - ${missing.join('\n  - ')}`);
  }

  console.log(`live : llm v${llm.version}, ${live.length} chars`);
  console.log(`new  : ${path.basename(FILE)}, ${next.length} chars`);
  if (next === live) {
    console.log('Identical. Nothing to publish.');
    return;
  }
  if (!APPLY) {
    console.log('\n--dry-run: nothing written. Re-run with --apply.');
    return;
  }

  const greeting = greetingFrom(next);
  await retell(`/update-retell-llm/${LLM}`, 'PATCH', {
    general_prompt: next,
    begin_message: greeting,
  });
  console.log(`  prompt patched (draft), greeting: "${greeting.slice(0, 70)}..."`);

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

  const num = await retell(`/get-phone-number/${encodeURIComponent(NUMBER)}`);
  const bound = (num.inbound_agents || []).find((a) => a.agent_id === AGENT);
  if (!bound) {
    console.log(`  WARNING: ${AGENT} is not bound inbound on ${NUMBER} — nothing you just published answers the phone.`);
    process.exitCode = 1;
  } else if (bound.agent_version === 'latest_published' || bound.agent_version == null) {
    console.log(`  ${NUMBER} inbound follows latest_published -> now v${version}`);
  } else {
    console.log(`  ${NUMBER} is PINNED to v${bound.agent_version}; re-pinning to v${version}`);
    await retell(`/update-phone-number/${encodeURIComponent(NUMBER)}`, 'PATCH', {
      inbound_agents: [{ agent_id: AGENT, agent_version: version, weight: 1 }],
      outbound_agents: num.outbound_agents,
    });
  }
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
