#!/usr/bin/env node
/**
 * One-time setup: create the "ClaimShield Driver Interview" Retell agent.
 *
 * A short (<180s), tightly-scoped outbound call to confirm a driver's own
 * account of a tow for a damage claim file. Separate agent from Emily
 * inbound/outbound — different purpose, different max duration, and no
 * shared phone-number binding (it's dialled with override_agent_id on each
 * call, same as any other outbound call placed through RetellOutboundClient).
 *
 *   RETELL_API_KEY=... node scripts/claimshield-driver-interview-setup.js
 *
 * Prints the created llm_id / agent_id / published version. Re-run is safe:
 * it reuses the agent by name instead of creating a duplicate.
 */
const fs = require('fs');
const path = require('path');

const API = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;
const AGENT_NAME = 'ClaimShield-Driver-Interview-v1';
const FILE = path.join(__dirname, 'claimshield-driver-interview.txt');

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
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function greetingFrom(prompt) {
  const m = prompt.match(/^OPENING[^"]*"([^"]+)"/m);
  if (m) return m[1];
  return "Hi, this is Emily, an automated assistant calling from Roadside Towing — got a quick minute for a damage claim question?";
}

async function main() {
  const prompt = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').trim();

  const agents = await retell('/list-agents');
  let agent = agents.find((a) => a.agent_name === AGENT_NAME);
  let llmId;

  if (!agent) {
    console.log('Creating LLM...');
    const llm = await retell('/create-retell-llm', 'POST', {
      model: 'gpt-4.1',
      general_prompt: prompt,
      begin_message:
        "Hi, is this {{driver_name}}? This is Emily, an automated assistant calling from Roadside Towing about the tow on {{incident_date}} for the damage claim. This is being recorded for the claim file. About four quick questions, under three minutes.",
      general_tools: [{ type: 'end_call', name: 'end_call', description: 'End the call politely once the interview is done or the driver cannot talk.' }],
    });
    llmId = llm.llm_id;
    console.log(`  llm_id ${llmId}`);

    console.log('Creating agent...');
    agent = await retell('/create-agent', 'POST', {
      agent_name: AGENT_NAME,
      response_engine: { type: 'retell-llm', llm_id: llmId },
      voice_id: '11labs-Emily',
      language: 'en-US',
      // 210s hard cap — 30s of headroom above the 180s script target so a
      // slow answer can't get cut off mid-sentence, but nowhere near enough
      // room for the call to wander.
      max_call_duration_ms: 210000,
      enable_backchannel: false,
    });
    console.log(`  agent_id ${agent.agent_id}`);
  } else {
    console.log(`Agent exists: ${agent.agent_id} — patching prompt`);
    const re = agent.response_engine;
    llmId = re.llm_id;
    await retell(`/update-retell-llm/${llmId}`, 'PATCH', {
      general_prompt: prompt,
      begin_message:
        "Hi, is this {{driver_name}}? This is Emily, an automated assistant calling from Roadside Towing about the tow on {{incident_date}} for the damage claim. This is being recorded for the claim file. About four quick questions, under three minutes.",
    });
  }

  await retell(`/publish-agent/${agent.agent_id}`, 'POST', {}).catch((e) =>
    console.log(`  publish warning: ${e.message.slice(0, 140)}`),
  );
  const version = Math.max(
    ...(await retell('/list-agents'))
      .filter((a) => a.agent_id === agent.agent_id && a.is_published)
      .map((a) => Number(a.version))
      .filter(Number.isFinite),
  );
  console.log(`  published as version ${version}`);
  console.log(`\nRESULT: agent_id=${agent.agent_id} llm_id=${llmId} version=${version}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
