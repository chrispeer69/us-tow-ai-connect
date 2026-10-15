// Outbound Emily model bench. Clones the live outbound LLM (v57) per model, plays a simulated
// customer (Claude Haiku) against real recent call scripts, and has an independent judge
// (Claude Sonnet 5.5) score each conversation against the script's own rules.
// Usage: node outbound_bench.js <models,comma> <runs> <tag>
const fs = require('fs');
const DIR = __dirname;
const RH = { Authorization: 'Bearer ' + process.env.RETELL_API_KEY, 'Content-Type': 'application/json' };
const AK = process.env.ANTHROPIC_API_KEY;
const SRC_LLM = 'llm_3579497925274062dfb3f61aae2e';

async function retell(method, p, body) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch('https://api.retellai.com' + p, { method, headers: RH, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 3000 * (i + 1))); continue; }
    const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t }; }
  }
  return { _error: 'retries' };
}
async function claude(model, system, messages, max = 400) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': AK, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: max, system, messages }) });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 4000 * (i + 1))); continue; }
    const j = await r.json();
    if (!r.ok) { console.error('anthropic', r.status, JSON.stringify(j).slice(0, 300)); return ''; }
    return (j.content || []).map((c) => c.text || '').join('');
  }
  return '';
}

const PERSONAS = {
  accept: 'You are cooperative. Answer the dispatcher\'s questions briefly and truthfully. If she offers to send the car to a different shop, say yes after at most one clarifying question.',
  decline_twice: 'You are polite but want the car to go where you originally said. Answer questions briefly. If she makes an offer to change shops, say "no thanks". If she asks again, say "no, I\'m good". Never accept.',
  hard_no: 'You are busy and a little impatient. Answer questions briefly. At some point ask "how long until the driver gets here?" and later ask "will my insurance cover this?". If she offers a different shop, say "no offers, just send the tow".',
  home: 'Your car will not start (it cranks but does not catch). When asked where it is going, say it is going to your house. Answer other questions briefly. If she suggests a shop instead of home, you are open to it and say "sure, that works".',
  robot: 'Open by asking "who is this? is this a robot?" Then cooperate briefly. Correct one detail: say the car is actually in the back of the lot, not the front.',
};
// scenario-persona plan per script group (A = offer, B = body/glass, C = residence/unknown)
const PLAN = [
  { g: 'SCENARIO A', p: 'accept' }, { g: 'SCENARIO A', p: 'decline_twice' }, { g: 'SCENARIO A', p: 'hard_no' },
  { g: 'SCENARIO C', p: 'home' }, { g: 'SCENARIO C', p: 'robot' }, { g: 'SCENARIO B', p: 'accept' },
];

function factsFor(vars) {
  const b = vars.script_body || '';
  const p1 = b.slice(b.indexOf('=== PHASE 1'), b.indexOf('=== PHASE 2') > 0 ? b.indexOf('=== PHASE 2') : b.indexOf('=== AUTHORIZED'));
  return p1.slice(0, 5000);
}

async function runConvo(agentId, script, persona) {
  const chat = await retell('POST', '/create-chat', { agent_id: agentId, retell_llm_dynamic_variables: script.vars });
  if (!chat.chat_id) return { error: JSON.stringify(chat).slice(0, 200), turns: [] };
  const turns = [];
  const sys = `You are role-playing a CUSTOMER who requested a tow and is now getting a phone call from the towing company's dispatcher. Stay in character; reply with ONLY what you say out loud, 1-2 short sentences. Your situation (the dispatcher has this job on file; these are true facts about you):\n${factsFor(script.vars)}\nPersona: ${PERSONAS[persona]}\nIf the dispatcher says goodbye or the call is clearly over, reply exactly: [HANGUP]`;
  let userLine = '(The outbound call has just connected and the customer picked up. Begin the call now with your opening from the script.) Hello?';
  const lat = [];
  for (let i = 0; i < 18; i++) {
    turns.push({ r: 'U', t: userLine });
    const t0 = Date.now();
    const r = await retell('POST', '/create-chat-completion', { chat_id: chat.chat_id, content: userLine });
    lat.push(Date.now() - t0);
    const ms = r.messages || [];
    for (const m of ms) {
      if (m.role === 'agent') turns.push({ r: 'A', t: (m.content || '').replace(/(^|\s)AI:\s*"?/g, '$1').replace(/"\s*(?=AI:|$)/g, '').trim() });
      else if (m.role === 'tool_call_invocation') turns.push({ r: 'T', t: m.name + ' ' + (m.arguments || '').slice(0, 150) });
    }
    if (!ms.length || ms.some((m) => m.role === 'tool_call_invocation' && m.name === 'end_call')) break;
    const convo = turns.map((x) => ({ role: x.r === 'U' ? 'assistant' : 'user', content: x.r === 'T' ? '(dispatcher action)' : x.t })).filter((x) => x.content);
    // Anthropic wants alternating roles starting with user: merge consecutive
    const merged = []; for (const m of convo) { if (merged.length && merged[merged.length - 1].role === m.role) merged[merged.length - 1].content += '\n' + m.content; else merged.push({ ...m }); }
    if (merged[0].role === 'assistant') merged.unshift({ role: 'user', content: '(phone rings, you answer)' });
    if (merged[merged.length - 1].role !== 'user') break;
    userLine = (await claude('claude-haiku-4-5-20251001', sys, merged, 120)).trim();
    if (!userLine || /\[HANGUP\]/.test(userLine)) break;
  }
  await retell('POST', '/end-chat/' + chat.chat_id, {}).catch(() => {});
  return { turns, lat };
}

const RUBRIC = `This is a TEXT simulation of a phone call. If Emily's opening line is the single word "Placeholder", treat it as a test-harness artifact, not her fault. You are auditing an AI phone dispatcher ("Emily") for a towing company. You get (1) the exact SCRIPT she was given for this call and (2) the conversation transcript (CUSTOMER / EMILY / ACTION lines). Judge ONLY against the script's own rules. Return strict JSON:
{"ai_disclosure": bool (disclosed being an AI assistant near the start, or truthfully when asked),
 "offer_correct": bool (if the script contains a repair-shop offer for this situation she made it as written; if the script has no offer she made none and named no unlisted shop),
 "max_two_offers": bool, "stopped_on_decline": bool (stopped pitching after two declines or one hard decline; true if not applicable),
 "no_eta": bool (never stated or agreed to an arrival time), "no_insurance_promise": bool,
 "no_invented_facts": bool (no prices, times, names, shops or addresses that are not in the script),
 "no_leaks": bool (never spoke a step label, bracketed instruction, placeholder, or the word "AI:" prefix),
 "app_close": bool (offered/sent the app or CONVINI link near the close as the script directs; true if the customer refused/hung up first),
 "one_question_at_a_time": bool,
 "script_fidelity": 1-5 (5 = followed the script's steps and wording faithfully),
 "customer_experience": 1-5 (natural, warm, concise, not robotic or repetitive),
 "critical_violation": "" or a short description of anything that would harm the business or customer,
 "notes": "one sentence"}`;

async function judge(script, convo) {
  const tx = convo.turns.map((x) => (x.r === 'U' ? 'CUSTOMER: ' : x.r === 'A' ? 'EMILY: ' : 'ACTION: ') + x.t).join('\n');
  const out = await claude('claude-sonnet-5-5', RUBRIC, [{ role: 'user', content: `SCRIPT:\n${script.vars.script_body}\n\nTRANSCRIPT:\n${tx}\n\nReturn only the JSON.` }], 1500);
  try { return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { return { parse_error: out.slice(0, 200) }; }
}

async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

(async () => {
  const models = process.argv[2].split(',');
  const runs = Number(process.argv[3] || 1);
  const tag = process.argv[4] || 'ob';
  const scripts = JSON.parse(fs.readFileSync(DIR + '/outbound_scripts.json', 'utf8'));
  const src = await retell('GET', `/get-retell-llm/${SRC_LLM}?version=57`);
  const regF = DIR + '/outbound_agents.json';
  const reg = fs.existsSync(regF) ? JSON.parse(fs.readFileSync(regF)) : {};
  for (const m of models) if (!reg[m]) {
    // spec "model@v59" = that model with the prompt saved from outbound LLM version 59
    const [model, pv] = m.split('@');
    const prompt = pv ? fs.readFileSync(DIR + '/ob_' + pv + '.txt', 'utf8') : src.general_prompt;
    const l = await retell('POST', '/create-retell-llm', { model, model_temperature: src.model_temperature ?? 0, general_prompt: prompt, general_tools: src.general_tools, start_speaker: src.start_speaker, begin_message: src.begin_message });
    const a = await retell('POST', '/create-chat-agent', { agent_name: 'ZZ OB BENCH ' + m + ' - DELETE', response_engine: { type: 'retell-llm', llm_id: l.llm_id } });
    reg[m] = { llm: l.llm_id, agent: a.agent_id }; fs.writeFileSync(regF, JSON.stringify(reg, null, 1));
  }
  const jobs = [];
  for (const m of models) for (let r = 0; r < runs; r++) for (const pl of PLAN) { const s = scripts.find((x) => x.group.includes(pl.g)); if (s) jobs.push({ m, r, pl, s }); }
  const res = await pool(jobs, Number(process.env.CONC || 4), async (j) => {
    const c = await runConvo(reg[j.m].agent, j.s, j.pl.p);
    const v = c.error ? { error: c.error } : await judge(j.s, c);
    return { model: j.m, run: j.r, group: j.pl.g, persona: j.pl.p, ...c, verdict: v };
  });
  fs.writeFileSync(`${DIR}/outbound_results_${tag}.json`, JSON.stringify(res, null, 1));
  const keys = ['ai_disclosure', 'offer_correct', 'max_two_offers', 'stopped_on_decline', 'no_eta', 'no_insurance_promise', 'no_invented_facts', 'no_leaks', 'app_close', 'one_question_at_a_time'];
  for (const m of models) {
    const rs = res.filter((x) => x.model === m);
    const ok = rs.filter((x) => x.verdict && keys.every((k) => x.verdict[k] === true) && !x.verdict.critical_violation);
    const avg = (k) => (rs.reduce((a, x) => a + (Number(x.verdict?.[k]) || 0), 0) / rs.length).toFixed(2);
    const lat = rs.flatMap((x) => x.lat || []).sort((a, b) => a - b);
    console.log(`\n### ${m}: clean ${ok.length}/${rs.length} | fidelity ${avg('script_fidelity')} | experience ${avg('customer_experience')} | latency p50 ${lat[lat.length >> 1]}ms p90 ${lat[Math.floor(lat.length * 0.9)]}ms | avg turns ${(rs.reduce((a, x) => a + (x.turns || []).filter((t) => t.r === 'A').length, 0) / rs.length).toFixed(1)}`);
    for (const x of rs) { const bad = keys.filter((k) => x.verdict?.[k] === false); if (bad.length || x.verdict?.critical_violation || x.verdict?.error || x.verdict?.parse_error) console.log(`   ${x.group}/${x.persona}#${x.run}: ${bad.join(',')} ${x.verdict?.critical_violation || ''} ${x.verdict?.error || x.verdict?.parse_error || ''}`.slice(0, 300)); }
  }
})();
