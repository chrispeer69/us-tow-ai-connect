// Inbound Emily model/prompt matrix: builds throwaway chat agents, runs the 20-scenario
// suite N times each, grades every transcript automatically, reports pass rates + latency.
// Usage: node matrix.js <configs.json> <runs> [testIds]
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const H = { Authorization: 'Bearer ' + process.env.RETELL_API_KEY, 'Content-Type': 'application/json' };
const BASE_LLM = 'llm_5de3f737a66db98138167cc13e7b';
const KB_ID = 'knowledge_base_44a341b6406ec9cd';
const ORIG = process.env.ORIG_PROMPT || path.join(__dirname, 'prompts', 'inbound_v24_original.txt');

async function api(method, p, body) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch('https://api.retellai.com' + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 3000 * (i + 1))); continue; }
    try { return JSON.parse(t); } catch { return { _raw: t, _status: r.status }; }
  }
  return { _error: 'retries exhausted' };
}

const S = [
  { id: 1, turns: ['hello?'] },
  { id: 2, turns: ['Representative.'] },
  { id: 3, turns: ["Yeah my car's been sitting here two hours, where's the truck?"] },
  { id: 4, turns: ['Checking on my tow', '614-802-9020', 'When will the truck get here?'] },
  { id: 5, turns: ['This is AAA calling on PO 1062178599', "What's the ETA on it?"] },
  { id: 6, turns: ["I'm calling about my tow again. I already called, they told me thirty minutes an hour ago.", '614-290-2630'] },
  { id: 7, turns: ['Checking on a tow, the PO is 115113948', 'What time did it get dropped off?'] },
  { id: 8, turns: ['checking on my tow', "uh it's six one... hang on... six one", 'sorry, six... I cant read it'] },
  { id: 9, turns: ["I need a tow, I'm on 270 northbound, standing on the shoulder next to my car."] },
  { id: 10, turns: ['I need to get my car out of impound.'] },
  { id: 11, adaptive: true, turns: ['I need a tow'] },
  { id: 12, adaptive: true, night: true, vars: { 'current_time_America/New_York': 'Wednesday, October 1, 2026 at 11:05 PM EDT' }, turns: ['I need a tow'] },
  { id: 13, turns: ['Hi this is Agero, calling on PO 0010357581'] },
  { id: 14, turns: ['Hi this is Honk, can you take a tow in Greenwich today?'] },
  { id: 15, turns: ['Are you a real person?', 'Okay. Does my insurance cover this tow?'] },
  { id: 16, turns: ['My car went to your storage yard, where is it and when can I pick it up?'] },
  { id: 17, turns: ['I need a tow', "I'm safe, I'm in a parking lot", "I'm in downtown Dayton, at the Day Air Ballpark lot"] },
  { id: 18, turns: ['How do I pay for a tow? Can I pay cash?'] },
  { id: 19, turns: ["Hi, calling about a damage claim, last six of the VIN 482913. What's the settlement figure on it?"] },
  { id: 21, turns: ['How much is a tow?', "That's too expensive honestly, is there anything cheaper?"] },
  { id: 20, adaptive: true, turns: ['Hi I need to leave word for your accounting department'] },
];

// Adaptive caller for the long intakes: answers whatever Emily just asked, so the
// scripted answers can no longer drift out of step with her questions.
function adaptiveAnswer(id, q) {
  const s = q.toLowerCase();
  const night = id === 12;
  if (id === 20) {
    if (/who were you hoping|who .*reach/.test(s)) return 'Just accounting';
    if (/switchboard|extension|direct line to you/.test(s)) return 'Extension 214';
    if (/number|reach you/.test(s)) return "614-555-0100, it's our main line";
    if (/regarding|what.*(about|know)/.test(s)) return 'An invoice we need corrected';
    if (/job number/.test(s)) return 'No job number';
    if (/email/.test(s)) return 'ap.test@example.com';
    if (/anything else/.test(s)) return "No that's all, thanks";
    return 'Okay';
  }
  if (/safe|out of traffic/.test(s)) return night ? 'Yes I am safe, in my driveway' : "Yeah I'm safe, I'm in a parking lot";
  if (/headed|going to|taken to|tow(ed)? (it )?to|destination|drop.?off|where.*(go|going|take)/.test(s)) return night ? 'To Firestone on Morse Road' : 'To Midas on Sawmill Road';
  if (/where('s| is) the vehicle|where are you|location|where.*right now/.test(s)) return night ? '1450 Hamilton Ave, Columbus 43211' : "I'm at the Kroger on Sawmill Road in Dublin, the back side of the building";
  if (/email/.test(s)) return night ? "I don't have email" : 'dana.test@example.com';
  if (/plate/.test(s)) return night ? 'GKL 2290' : 'HXT 4471';
  if (/name/.test(s) && !/business/.test(s)) return night ? 'Sam' : 'Dana';
  if (/number|reach you|cut off/.test(s)) return night ? '614-555-0177' : '614-555-0142';
  if (/what happened|going on with|what.*wrong|issue/.test(s)) return night ? "Flat tire and I don't have a spare" : "It won't start, it just clicks";
  if (/turn over|crank|click/.test(s)) return 'It just clicks, nothing else';
  if (/spare/.test(s)) return "No, I don't have a spare";
  if (/where.*(go|going|taken|tow)|destination|drop/.test(s)) return night ? 'To Firestone on Morse Road' : 'To Midas on Sawmill Road';
  if (/year|make|model/.test(s)) return night ? '2015 Ford Escape, blue' : '2017 Honda Civic, gray';
  if (/all-wheel|four-wheel|drive/.test(s)) return night ? 'Yes, all-wheel drive' : "No, it's front-wheel drive";
  if (/ceiling|garage|underground/.test(s)) return night ? "No, it's in the driveway" : "No, it's an open lot";
  if (/dually|box truck|motorhome|motorcycle/.test(s)) return 'No, just a regular car';
  if (/electric/.test(s)) return "No, it's gas";
  if (/roll|steer|brake/.test(s)) return 'Yes, it rolls and steers fine';
  if (/keys/.test(s)) return 'Yes, I have the keys';
  if (/correct|right\?|confirm|is that/.test(s)) return "Yes, that's right";
  if (/anything else/.test(s)) return "No, that's all, thanks";
  return 'Okay';
}

const fmt = (m) => {
  if (m.role === 'agent') return { r: 'A', t: m.content || '' };
  if (m.role === 'user') return { r: 'U', t: m.content || '' };
  if (m.role === 'tool_call_invocation') return { r: 'T', name: m.name, args: m.arguments || '' };
  if (m.role === 'tool_call_result') return { r: 'R', t: (m.content || '').slice(0, 400) };
  return { r: '?', t: JSON.stringify(m).slice(0, 200) };
};

async function runScenario(agentId, s) {
  const chat = await api('POST', '/create-chat', { agent_id: agentId, ...(s.vars ? { retell_llm_dynamic_variables: s.vars } : {}) });
  if (!chat.chat_id) return { error: JSON.stringify(chat).slice(0, 200), msgs: [], lat: [] };
  const msgs = []; const lat = [];
  let turns = [...s.turns];
  for (let i = 0; i < 24 && turns.length; i++) {
    const t = turns.shift();
    msgs.push({ r: 'U', t });
    // Real calls start with the greeting already spoken; a chat starts with empty history.
    const sent = i === 0 ? '(You have ALREADY greeted the caller with: "Thanks for calling Roadside Towing, this is Emily. Checking on a tow, need a new one, or calling from a motor club?" Do not repeat it. The caller now says:) ' + t : t;
    const t0 = Date.now();
    const r = await api('POST', '/create-chat-completion', { chat_id: chat.chat_id, content: sent });
    lat.push(Date.now() - t0);
    const ms = (r.messages || []).map(fmt);
    msgs.push(...ms);
    if (!ms.length) { msgs.push({ r: '!', t: JSON.stringify(r).slice(0, 200) }); break; }
    if (ms.some((m) => m.r === 'T' && /transfer|end_call/.test(m.name))) break;
    if (s.adaptive && !turns.length) {
      const lastA = [...ms].reverse().find((m) => m.r === 'A');
      if (lastA) turns.push(adaptiveAnswer(s.id, lastA.t));
    }
  }
  await api('POST', '/end-chat/' + chat.chat_id, {}).catch(() => {});
  return { msgs, lat };
}

// ---------- grading ----------
const A = (m) => m.filter((x) => x.r === 'A').map((x) => x.t).join(' \n ');
const tools = (m) => m.filter((x) => x.r === 'T').map((x) => x.name);
const count = (m, n) => tools(m).filter((x) => x === n).length;
const beforeFirstTool = (m) => { const i = m.findIndex((x) => x.r === 'T'); return A(i < 0 ? m : m.slice(0, i)); };
const CLOCK = /\b(1[0-2]|0?[1-9]):[0-5]\d\b/;
const LATE = /\blate\b/i;
const transferred = (m) => tools(m).includes('transfer_to_dispatch');

const CHECKS = {
  1: (m) => [[/what can i do for you|how can i help/i.test(A(m)), 'answers without re-reading menu'], [!/checking on a tow, need a new one/i.test(A(m)), 'no menu repeat']],
  2: (m) => [[tools(m)[0] === 'transfer_to_dispatch', 'transfers on first ask'], [!/\?/.test(beforeFirstTool(m)), 'no question first']],
  3: (m) => [[tools(m)[0] === 'lookup_job_by_phone', 'lookup before answering'], [!/thirty|30 min|minutes/i.test(beforeFirstTool(m)), 'no wait time before lookup']],
  4: (m) => [[/shawn/i.test(A(m)), 'names driver'], [/thirty minutes/i.test(A(m)), 'thirty-minute line'], [!CLOCK.test(A(m)), 'no clock time'], [!LATE.test(A(m)), 'never says late']],
  5: (m) => [[count(m, 'lookup_job_by_phone') >= 1, 'looks up PO'], [/shawn/i.test(A(m)), 'names driver'], [!CLOCK.test(A(m)), 'no clock time'], [!LATE.test(A(m)), 'never says late'], [!/somewhere safe/i.test(A(m)), 'no safety Q to club']],
  6: (m) => { const i = m.findIndex((x) => x.r === 'U' && /614-290/.test(x.t)); const pre = A(m.slice(0, i)); return [[/phone number/i.test(pre) && !/rather not hold|which would you prefer/i.test(pre), 'asks for number before not-found offer'], [/completed/i.test(A(m)), 'reports completed'], [!/thirty minutes/i.test(A(m)), 'no thirty-minute line on completed job']]; },
  7: (m) => { const i = m.findIndex((x) => x.r === 'U' && /what time/i.test(x.t)); const post = A(m.slice(i)); return [[/completed/i.test(A(m)), 'completed line'], [!CLOCK.test(A(m)), 'no clock time anywhere'], [!/BDG0171|BDG 0171/i.test(A(m)), 'never reads plate']]; },
  8: (m) => [[transferred(m), 'transfers after two misses'], [(A(m).match(/phone number on the job|best phone number/gi) || []).length <= 2, 'never a third ask']],
  9: (m) => [[tools(m)[0] === 'transfer_to_dispatch', 'immediate transfer'], [/stay where you are/i.test(A(m)), 'safety line']],
  10: (m) => [[/not currently handling impound/i.test(A(m)), 'impound line'], [transferred(m), 'transfers'], [!tools(m).includes('create_tow_job'), 'no intake']],
  11: (m) => [[count(m, 'lookup_job_by_phone') >= 2, 'both board checks'], [count(m, 'create_tow_job') === 1, 'books once'], [/all-wheel or four-wheel/i.test(A(m)), 'AWD question'], [/plate/i.test(A(m)), 'asks plate'], [/email/i.test(A(m)), 'asks email'], [/you're all set/i.test(A(m)), 'closing line'], [!/6 AM/i.test(A(m)), 'no overnight line by day']],
  12: (m) => [[count(m, 'lookup_job_by_phone') >= 2, 'both board checks'], [count(m, 'create_tow_job') === 1, 'books once'], [/6 AM/i.test(A(m)), 'overnight 6 AM line']],
  13: (m) => [[/po_number/.test(JSON.stringify(m.filter((x) => x.r === 'T'))), 'looks up by PO'], [!/somewhere safe/i.test(A(m)), 'no safety Q'], [!/which (motor )?club|what club/i.test(A(m)), "doesn't ask which club"], [transferred(m), 'closed job -> dispatch']],
  14: (m) => [[transferred(m), 'transfers'], [!tools(m).includes('take_dispatch_message'), 'no message'], [!/\byes\b.*we can|we can take/i.test(A(m)), "doesn't accept the job"]],
  15: (m) => [[/automated assistant/i.test(A(m)), 'AI disclosure'], [/dispatch will go over that/i.test(A(m)) || transferred(m), 'insurance -> dispatch'], [!/(your|the) (insurance|policy) (will|should|does|would) (cover|pay)/i.test(A(m)), 'no coverage claim']],
  16: (m) => [[/harrisburg/i.test(A(m)), 'yard address'], [/8 to 5|8 AM|8:00/i.test(A(m)), 'hours'], [/appointment/i.test(A(m)), 'appointment only'], [transferred(m) || tools(m).includes('take_dispatch_message'), 'hands to dispatch']],
  17: (m) => [[/outside our usual area/i.test(A(m)), 'out-of-area line'], [!tools(m).includes('transfer_to_dispatch'), 'continues intake'], [count(m, 'lookup_job_by_phone') >= 1, 'board check']],
  18: (m) => [[/card/i.test(A(m)) && /up front/i.test(A(m)), 'card, paid up front'], [/convini|roadside app/i.test(A(m)), 'cash -> Convini/app'], [!/apple pay/i.test(A(m)) || /(don't|do not|not) (take|accept).{0,20}apple pay/i.test(A(m)), 'no Apple Pay promise']],
  19: (m) => [[tools(m).includes('lookup_claim') || transferred(m), 'claim lookup or dispatch'], [/claims team/i.test(A(m)) || transferred(m), 'money -> claims team/dispatch'], [!/\$\s?\d|\d+ dollars/i.test(A(m)), 'no dollar figure']],
  21: (m) => [[/confirm the price/i.test(A(m)) || transferred(m), 'price line or transfer'], [!/\$\s?\d|\d+ dollars/i.test(A(m)), 'no price quoted'], [/membership/i.test(A(m)) || transferred(m), 'membership offer (or transfer on push)'], [(A(m).match(/membership/gi) || []).length <= 2, 'offered once']],
  20: (m) => [[/who (were you hoping|should|is (it|the message) for|.{0,30}reach)/i.test(A(m)), 'asks who'], [/switchboard|extension|direct (line|number) for you/i.test(A(m)), 'switchboard follow-up'], [tools(m).includes('take_dispatch_message'), 'writes message'], [!transferred(m), "doesn't transfer blind"]],
};

async function buildAgent(cfg, srcTools) {
  const prompt = cfg.prompt === 'orig' ? fs.readFileSync(ORIG, 'utf8') : fs.readFileSync(cfg.prompt, 'utf8');
  const tools = srcTools.map((t) => (t.name === 'create_tow_job' || t.name === 'take_dispatch_message') ? { ...t, url: 'https://httpbin.org/anything', headers: { 'content-type': 'application/json' } } : t);
  if (cfg.fixTransfer) for (const t of tools) if (t.name === 'transfer_to_dispatch') t.description = 'Transfer the caller to a live dispatcher when your instructions call for it: they ask for a person, safety, money, insurance or a claim, a complaint, they are upset or have waited a long time, a repeat caller, or anything you cannot resolve.';
  const body = { model: cfg.model, model_temperature: cfg.temp ?? 0, general_prompt: prompt, general_tools: tools, start_speaker: 'agent', begin_message: 'Thanks for calling Roadside Towing, this is Emily. Checking on a tow, need a new one, or calling from a motor club?' };
  if (cfg.kb) { body.knowledge_base_ids = [KB_ID]; body.kb_config = { top_k: cfg.top_k ?? 1, filter_score: cfg.filter ?? 0.6 }; }
  const l = await api('POST', '/create-retell-llm', body);
  const a = await api('POST', '/create-chat-agent', { agent_name: 'ZZ MATRIX ' + cfg.name + ' - DELETE', response_engine: { type: 'retell-llm', llm_id: l.llm_id } });
  return { llm: l.llm_id, agent: a.agent_id };
}

async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

(async () => {
  const cfgs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const runs = Number(process.argv[3] || 1);
  const only = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
  const src = await api('GET', `/get-retell-llm/${BASE_LLM}?version=25`);
  const reg = fs.existsSync(DIR + '/matrix_agents.json') ? JSON.parse(fs.readFileSync(DIR + '/matrix_agents.json')) : {};
  for (const c of cfgs) if (!reg[c.name]) { reg[c.name] = await buildAgent(c, src.general_tools); fs.writeFileSync(DIR + '/matrix_agents.json', JSON.stringify(reg, null, 1)); }
  const jobs = [];
  for (const c of cfgs) for (let r = 0; r < runs; r++) for (const s of S) if (!only || only.includes(s.id)) jobs.push({ c, r, s });
  const results = await pool(jobs, Number(process.env.CONC || 3), async (j) => ({ cfg: j.c.name, run: j.r, id: j.s.id, ...(await runScenario(reg[j.c.name].agent, j.s)) }));
  const tag = process.argv[5] || Date.now();
  fs.writeFileSync(`${DIR}/matrix_results_${tag}.json`, JSON.stringify(results, null, 1));
  const sum = {};
  for (const x of results) {
    if (JSON.stringify(x.msgs).includes('RATE_LIMITED')) { (sum._invalid = sum._invalid || []).push(x.cfg + '#' + x.id); continue; }
    const checks = x.error ? [[false, 'ERROR ' + x.error]] : CHECKS[x.id](x.msgs);
    const ok = checks.every((c) => c[0]);
    const k = sum[x.cfg] = sum[x.cfg] || { tests: {}, lat: [] };
    const t = k.tests[x.id] = k.tests[x.id] || { pass: 0, n: 0, fails: {} };
    t.n++; if (ok) t.pass++; else for (const c of checks) if (!c[0]) t.fails[c[1]] = (t.fails[c[1]] || 0) + 1;
    k.lat.push(...x.lat);
  }
  if (sum._invalid) { console.log('INVALID (rate limited, excluded):', sum._invalid.join(' ')); delete sum._invalid; }
  for (const [cfg, k] of Object.entries(sum)) {
    const ids = Object.keys(k.tests).map(Number).sort((a, b) => a - b);
    const full = ids.filter((i) => k.tests[i].pass === k.tests[i].n).length;
    k.lat.sort((a, b) => a - b);
    console.log(`\n### ${cfg}: ${full}/${ids.length} tests at 100%  | latency p50 ${k.lat[k.lat.length >> 1]}ms p90 ${k.lat[Math.floor(k.lat.length * 0.9)]}ms`);
    for (const i of ids) { const t = k.tests[i]; if (t.pass < t.n) console.log(`   test ${i}: ${t.pass}/${t.n}  fails: ${JSON.stringify(t.fails)}`); }
  }
})();
