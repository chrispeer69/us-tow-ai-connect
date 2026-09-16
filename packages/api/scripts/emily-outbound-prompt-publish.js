/**
 * Publish the OUTBOUND flip agent's general_prompt from the checked-in file.
 *
 * Why this exists (2026-09-16): the outbound prompt lived only in the Retell
 * dashboard, and its numbered rules silently override the code script.
 * Rule 18 kept "is going home" as a no-offer case for a month after the
 * script said the opposite, and rules 23/32 did the same to the offer
 * ladder on 08-14. Chris: "we have been over this before." The prompt is
 * now `scripts/emily-outbound-prompt.txt`, guarded by
 * `flip-prompt-contract.spec.ts`, and published only from here.
 *
 *   RETELL_API_KEY=... node scripts/emily-outbound-prompt-publish.js --dry-run
 *   RETELL_API_KEY=... node scripts/emily-outbound-prompt-publish.js --apply
 *
 * --apply: new draft from the live pinned version, patch the prompt, publish,
 * then print the version to pin. The API reads RETELL_AGENT_VERSION once at
 * start, so the last step is still yours:
 *   railway variables --service '@ustow/api' --set RETELL_AGENT_VERSION=<v>
 *   railway redeploy --service '@ustow/api' --yes
 * Every version keeps its own prompt, so the previous number is the rollback.
 */
const fs = require('fs');
const path = require('path');

const API = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;
const AGENT = 'agent_c22b4105cef66b8a374fd54483'; // Emily OUTBOUND | Roadside Towing
const LLM = 'llm_3579497925274062dfb3f61aae2e';
const FILE = path.join(__dirname, 'emily-outbound-prompt.txt');

const H = { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
async function call(method, url, body) {
  const r = await fetch(`${API}${url}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const norm = (s) => (s || '').replace(/\r\n/g, '\n').trim();

(async () => {
  if (!KEY) throw new Error('RETELL_API_KEY is not set');
  const apply = process.argv.includes('--apply');
  const base = Number(process.env.RETELL_AGENT_VERSION || process.argv.find((a) => a.startsWith('--base='))?.slice(7));
  if (!base) throw new Error('need RETELL_AGENT_VERSION (the live pinned version) or --base=N');

  const next = norm(fs.readFileSync(FILE, 'utf8'));
  const agent = await call('GET', `/get-agent/${AGENT}?version=${base}`);
  const llmVersion = agent.response_engine?.version ?? base;
  const llm = await call('GET', `/get-retell-llm/${LLM}?version=${llmVersion}`);
  const live = norm(llm.general_prompt);
  console.log(`live : agent v${base} (llm v${llmVersion}), ${live.length} chars`);
  console.log(`new  : ${path.basename(FILE)}, ${next.length} chars`);
  if (live === next) {
    console.log('Identical. Nothing to publish.');
    return;
  }
  if (!apply) {
    console.log('\n--dry-run: nothing written. Re-run with --apply.');
    return;
  }
  const draft = await call('POST', `/create-agent-version/${AGENT}`, { base_version: base });
  const v = draft.version;
  await call('PATCH', `/update-retell-llm/${LLM}?version=${v}`, { general_prompt: next });
  await call('POST', `/publish-agent/${AGENT}`, { version: v });
  const check = await call('GET', `/get-retell-llm/${LLM}?version=${v}`);
  if (norm(check.general_prompt) !== next) throw new Error(`published v${v} but its prompt does not match the file`);
  const old = await call('GET', `/get-retell-llm/${LLM}?version=${llmVersion}`);
  console.log(`  published agent v${v}; v${base} unchanged: ${norm(old.general_prompt) === live}`);
  console.log(`\nNow pin it:\n  railway variables --service '@ustow/api' --set RETELL_AGENT_VERSION=${v}\n  railway redeploy --service '@ustow/api' --yes\nRollback = RETELL_AGENT_VERSION=${base}.`);
})().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
