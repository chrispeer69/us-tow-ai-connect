#!/usr/bin/env node
/**
 * Change the words Ray says, and make sure the change actually reaches callers.
 *
 * Editing the prompt is only the first of four steps, and skipping any of the
 * other three leaves the old script live while the Retell dashboard shows the
 * new one:
 *
 *   1  PATCH the LLM   — the prompt lives on the LLM object, not the agent
 *   2  publish         — a patch only creates a DRAFT; drafts are never dialled
 *   3  re-pin the NUMBER — outbound_agents pins an explicit version
 *   4  re-pin the CAMPAIGN row — the dialler passes its own override
 *
 *   cd packages/api
 *   RETELL_API_KEY=... node scripts/usta-prompt-publish.js --file ray.txt --dry-run
 *   RETELL_API_KEY=... DB_URL=... node scripts/usta-prompt-publish.js --file ray.txt --apply
 *
 * With no --file it prints the live prompt and exits, which is how you start:
 * edit what is live, never a copy that has drifted.
 */

const fs = require('fs');
const { Client } = require('pg');

const API = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;
const DB_URL = process.env.DB_URL;

const AGENT = 'agent_0e40fadbd07e21659e3e06026b'; // USTA outbound
const NUMBER = process.env.USTA_FROM_NUMBER || '+17408807758';
const SLUG = 'usta';

const args = process.argv.slice(2);
const fileArg = args.indexOf('--file');
const FILE = fileArg > -1 ? args[fileArg + 1] : null;
const APPLY = args.includes('--apply');

if (!KEY) {
  console.error('RETELL_API_KEY is required');
  process.exit(2);
}

async function retell(path, method = 'GET', body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

/**
 * The highest PUBLISHED version, re-read after publishing. The version held
 * before the patch is stale the moment the patch lands, and pinning it silently
 * ships the PREVIOUS script.
 */
async function latestPublishedVersion(agentId) {
  const versions = (await retell('/list-agents'))
    .filter((a) => a.agent_id === agentId && a.is_published)
    .map((a) => Number(a.version))
    .filter((n) => Number.isFinite(n));
  if (!versions.length) throw new Error(`no published version for ${agentId}`);
  return Math.max(...versions);
}

async function main() {
  const agent = await retell(`/get-agent/${AGENT}`);
  const llmId = agent.response_engine?.llm_id;
  if (!llmId) throw new Error('the outbound agent has no llm_id');
  const llm = await retell(`/get-retell-llm/${llmId}`);

  if (!FILE) {
    console.log(`# live prompt — agent v${agent.version}, llm ${llmId} v${llm.version}\n`);
    console.log(llm.general_prompt);
    return;
  }

  const next = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').trim();
  if (!next) throw new Error(`${FILE} is empty`);
  if (next === llm.general_prompt.replace(/\r\n/g, '\n').trim()) {
    console.log('The file matches what is live. Nothing to publish.');
    return;
  }

  console.log(`live  : llm v${llm.version}, ${llm.general_prompt.length} chars`);
  console.log(`new   : ${FILE}, ${next.length} chars`);

  if (!APPLY) {
    console.log('\n--dry-run: nothing written. Re-run with --apply to publish.');
    return;
  }

  // begin_message must be NULL, not ''. An empty string still makes the model
  // take a turn, and on 2026-08-20 it took that turn by reading its own system
  // prompt aloud to Bobby's Towing.
  await retell(`/update-retell-llm/${llmId}`, 'PATCH', {
    general_prompt: next,
    begin_message: null,
  });
  console.log('  prompt patched (draft)');

  await retell(`/publish-agent/${AGENT}`, 'POST', {}).catch((e) =>
    console.log(`  publish warning: ${e.message.slice(0, 140)}`),
  );
  const version = await latestPublishedVersion(AGENT);
  console.log(`  published as agent v${version}`);

  const num = await retell(`/get-phone-number/${encodeURIComponent(NUMBER)}`);
  await retell(`/update-phone-number/${encodeURIComponent(NUMBER)}`, 'PATCH', {
    // Send the inbound array back unchanged. Omitting it clears the binding,
    // and an unbound inbound agent means every callback hits a dead number.
    inbound_agents: num.inbound_agents,
    outbound_agents: [{ agent_id: AGENT, agent_version: Number(version), weight: 1 }],
  });
  console.log(`  ${NUMBER} outbound -> v${version}`);

  if (!DB_URL) {
    console.log('\nDB_URL not set — campaigns.outbound_agent_version NOT updated.');
    console.log('The dialler passes its own override, so calls will keep using the OLD version.');
    process.exitCode = 1;
    return;
  }
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const res = await c.query(
    `update campaigns set outbound_agent_version = $1, updated_at = now()
      where slug = $2 returning name, status, outbound_agent_version`,
    [String(version), SLUG],
  );
  console.table(res.rows);
  await c.end();
  console.log(`\nLive. The next call placed uses v${version}.`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
