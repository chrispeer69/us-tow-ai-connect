#!/usr/bin/env node
/**
 * 3.13 (2026-09-10) — publish a new OUTBOUND agent version that adds the two
 * post-call fields the confirmed-name feature needs:
 *
 *   customer_first_name / customer_last_name
 *
 * The script (flip-scripts.ts STEP 2b) asks for or confirms the name; without
 * these fields the agent has nowhere to put the answer and the DB columns stay
 * null — the same shape of gap that ai-notes-pipeline.spec.ts exists to catch.
 *
 * What it does, in order (see the retell-version-workflow memory note):
 *   1. create-agent-version  base_version = BASE (default: the latest draft)
 *   2. update-agent ?version=N  post_call_analysis_data = base fields + the two
 *   3. publish-agent  version = N
 *   4. prints the two commands that make it LIVE — the env var repoint and the
 *      redeploy. Publishing alone changes nothing: RETELL_AGENT_VERSION pins
 *      the version that dials.
 *
 * Usage (from the repo root, key from Railway):
 *   eval "$(railway variables --service '@ustow/api' --kv | grep '^RETELL_API_KEY=' | sed 's/^/export /')"
 *   node scripts/retell/add-confirmed-name-fields.js            # base = latest draft
 *   node scripts/retell/add-confirmed-name-fields.js 52         # base = the live version instead
 */
const fs = require('fs');
const path = require('path');

const AGENT = 'agent_c22b4105cef66b8a374fd54483'; // Emily, OUTBOUND flip agent
const key = process.env.RETELL_API_KEY;
if (!key) {
  console.error('RETELL_API_KEY is not set');
  process.exit(1);
}
const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const api = (p) => `https://api.retellai.com${p}`;

const NEW_FIELDS = [
  {
    type: 'string',
    name: 'customer_first_name',
    description:
      "The customer's FIRST name as confirmed or given on this call, in the confirm-name step " +
      '("I have you down as Pat Smith — is that right?" / "can I get your first and last name"). ' +
      'Use the spelling the customer gave if they spelled it. If the customer confirmed the name the agent read out, use that first name. ' +
      'Leave EMPTY if the customer never confirmed or gave a first name, if the call never reached that step, or if the agent only spoke to voicemail or the wrong person. ' +
      'Never copy a name from the ticket that the customer did not confirm.',
    examples: ['Pat', 'Maria', 'DeShawn'],
  },
  {
    type: 'string',
    name: 'customer_last_name',
    description:
      "The customer's LAST name (surname) as confirmed or given on this call. Use the spelling the customer gave if they spelled it. " +
      'If they confirmed a full name the agent read out, use that surname. ' +
      'Leave EMPTY if they declined to give a last name, only gave a first name, never reached the step, or the call went to voicemail or the wrong person. ' +
      'Never guess and never copy an unconfirmed name from the ticket.',
    examples: ['Smith', "O'Brien", 'de la Cruz'],
  },
];

async function call(method, p, body) {
  const res = await fetch(api(p), { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${typeof json === 'string' ? json.slice(0, 300) : JSON.stringify(json).slice(0, 300)}`);
  return json;
}

(async () => {
  const latest = await call('GET', `/get-agent/${AGENT}`);
  const baseVersion = Number(process.argv[2] || latest.version);
  const base = baseVersion === latest.version ? latest : await call('GET', `/get-agent/${AGENT}?version=${baseVersion}`);
  const names = new Set(NEW_FIELDS.map((f) => f.name));
  const fields = [...(base.post_call_analysis_data || []).filter((f) => !names.has(f.name)), ...NEW_FIELDS];
  console.log(`base v${baseVersion} (published=${base.is_published}) has ${base.post_call_analysis_data.length} fields; new version will have ${fields.length}`);

  const created = await call('POST', `/create-agent-version/${AGENT}`, { base_version: baseVersion });
  const v = created.version;
  console.log(`created draft v${v}`);

  const updated = await call('PATCH', `/update-agent/${AGENT}?version=${v}`, {
    post_call_analysis_data: fields,
    version_title: `v${v} confirmed customer name`,
    version_description: '3.13: customer_first_name / customer_last_name post-call fields',
  });
  const backupDir = path.join(__dirname, '..', '..', 'docs', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `${new Date().toISOString().slice(0, 10)}-retell-agent-v${v}.json`);
  fs.writeFileSync(backup, JSON.stringify(updated, null, 2));
  console.log(`patched v${v}: fields=${updated.post_call_analysis_data.length}; backup ${path.relative(process.cwd(), backup)}`);

  await call('POST', `/publish-agent/${AGENT}`, { version: v });
  const check = await call('GET', `/get-agent/${AGENT}?version=${v}`);
  console.log(`published v${v}: is_published=${check.is_published} fields=${check.post_call_analysis_data.length}`);

  console.log('\nNOT LIVE YET. Make it live with:');
  console.log(`  railway variables --service '@ustow/api' --set RETELL_AGENT_VERSION=${v}`);
  console.log(`  railway redeploy --service '@ustow/api' --yes`);
  console.log('Then confirm the next outbound call shows agent_version ' + v + ' in Retell list-calls.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
