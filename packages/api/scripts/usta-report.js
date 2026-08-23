#!/usr/bin/env node
/**
 * End-of-cycle report: one row per number, one column per stage.
 *
 * Chris, 2026-08-22: "then the calls to that number stop and you provide me a
 * full report of each number and the activity — I will then determine the next
 * stage of marketing for that group of businesses, whether it is city or a
 * state."
 *
 * So the report has to answer a decision, not just list calls. Two questions
 * decide it: did anybody actually HEAR us, and does this city or state answer
 * the phone at all. A city where nobody picks up is a mail or email problem,
 * not a calling problem, and no amount of re-dialling changes that.
 *
 *   cd packages/api
 *   DB_URL=... node scripts/usta-report.js                    # rollups only
 *   DB_URL=... node scripts/usta-report.js --csv usta.csv     # + per-number CSV
 *   DB_URL=... node scripts/usta-report.js --city Cleveland   # one market
 *   DB_URL=... node scripts/usta-report.js --state OH --done  # finished only
 */

const fs = require('fs');
const { Client } = require('pg');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : null;
};
const CSV = flag('--csv');
const CITY = flag('--city');
const STATE = flag('--state');
const SLUG = flag('--slug') || 'usta';
const DONE_ONLY = args.includes('--done');

if (!process.env.DB_URL) {
  console.error('DB_URL is required');
  process.exit(2);
}

/** Excel reads a bare +1614... as a formula and a bare 614... as a number. */
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const where = ['ca.slug = $1'];
  const params = [SLUG];
  if (CITY) { params.push(CITY); where.push(`lower(cl.city) = lower($${params.length})`); }
  if (STATE) { params.push(STATE); where.push(`lower(cl.state) = lower($${params.length})`); }
  if (DONE_ONLY) where.push(`cl.status in ('PITCHED','EXHAUSTED','DNC','WARM')`);

  // One row per lead, with each stage's outcome pivoted into its own column.
  // Pivoting in SQL rather than in JS keeps the row count honest when a stage
  // was dialled twice because the first attempt errored before connecting.
  const rows = (
    await c.query(
      `select cl.company, cl.phone, cl.city, cl.state, cl.status, cl.attempts, cl.touches,
              cl.next_eligible_at, cl.last_attempt_at,
              max(case when l.touch_number = 1 then l.disposition end)      as s1,
              max(case when l.touch_number = 1 then l.duration_seconds end) as s1_secs,
              max(case when l.touch_number = 1 then l.created_at end)        as s1_at,
              max(case when l.touch_number = 2 then l.disposition end)      as s2,
              max(case when l.touch_number = 2 then l.duration_seconds end) as s2_secs,
              max(case when l.touch_number = 2 then l.created_at end)        as s2_at,
              max(case when l.touch_number = 3 then l.disposition end)      as s3,
              max(case when l.touch_number = 3 then l.duration_seconds end) as s3_secs,
              max(case when l.touch_number = 3 then l.created_at end)        as s3_at,
              max(case when l.disposition = 'DNC' then 1 else 0 end)        as opted_out,
              max(case when l.disposition = 'WARM' then 1 else 0 end)       as warm,
              sum(coalesce(l.duration_seconds, 0))                          as total_secs
         from campaign_leads cl
         join campaigns ca on ca.id = cl.campaign_id
         left join campaign_call_logs l
                on l.lead_id = cl.id and l.direction = 'OUTBOUND'
        where ${where.join(' and ')}
        group by cl.id
        order by cl.state, cl.city, cl.company`,
      params,
    )
  ).rows;

  if (!rows.length) {
    console.log('No leads match.');
    await c.end();
    return;
  }

  const heard = (r) => Number(r.touches) > 0;
  const finished = (r) => ['PITCHED', 'EXHAUSTED', 'DNC', 'WARM'].includes(r.status);

  // ---- rollups, which is what the next marketing decision is made on -------
  const group = (key) => {
    const m = new Map();
    for (const r of rows) {
      const k = (key === 'city' ? `${r.city || '(no city)'}, ${r.state || '?'}` : r.state || '?');
      const g = m.get(k) || { numbers: 0, done: 0, reached: 0, stage3: 0, warm: 0, optouts: 0 };
      g.numbers++;
      if (finished(r)) g.done++;
      if (heard(r)) g.reached++;
      if (r.s3) g.stage3++;
      if (Number(r.warm)) g.warm++;
      if (Number(r.opted_out)) g.optouts++;
      m.set(k, g);
    }
    return [...m.entries()]
      .map(([k, g]) => ({
        market: k,
        numbers: g.numbers,
        cycleDone: `${g.done}/${g.numbers}`,
        // The number that decides the next move. A market that will not answer
        // the phone is not a script problem.
        reached: `${g.reached} (${Math.round((g.reached / g.numbers) * 100)}%)`,
        allThreeDialed: g.stage3,
        warm: g.warm,
        optOuts: g.optouts,
      }))
      .sort((a, b) => b.numbers - a.numbers);
  };

  const totals = {
    numbers: rows.length,
    cycleComplete: rows.filter(finished).length,
    everReached: rows.filter(heard).length,
    stage1: rows.filter((r) => r.s1).length,
    stage2: rows.filter((r) => r.s2).length,
    stage3: rows.filter((r) => r.s3).length,
    warm: rows.filter((r) => Number(r.warm)).length,
    optOuts: rows.filter((r) => Number(r.opted_out)).length,
    talkMinutes: Math.round(rows.reduce((n, r) => n + Number(r.total_secs || 0), 0) / 60),
  };

  console.log(`\nUSTA Outreach — ${SLUG}${CITY ? ` · ${CITY}` : ''}${STATE ? ` · ${STATE}` : ''}\n`);
  console.table([totals]);
  console.log('\nBy state:');
  console.table(group('state'));
  console.log('\nBy city:');
  console.table(group('city'));

  if (CSV) {
    const head = [
      'company', 'phone', 'city', 'state', 'lead_status', 'dials', 'times_heard',
      'stage1', 'stage1_secs', 'stage1_at',
      'stage2', 'stage2_secs', 'stage2_at',
      'stage3', 'stage3_secs', 'stage3_at',
      'opted_out', 'warm', 'total_talk_secs', 'cycle_complete', 'next_call',
    ];
    const lines = [head.join(',')];
    for (const r of rows) {
      lines.push([
        r.company, `'${r.phone}`, r.city, r.state, r.status, r.attempts, r.touches,
        r.s1, r.s1_secs, r.s1_at && new Date(r.s1_at).toISOString().slice(0, 16).replace('T', ' '),
        r.s2, r.s2_secs, r.s2_at && new Date(r.s2_at).toISOString().slice(0, 16).replace('T', ' '),
        r.s3, r.s3_secs, r.s3_at && new Date(r.s3_at).toISOString().slice(0, 16).replace('T', ' '),
        Number(r.opted_out) ? 'YES' : '', Number(r.warm) ? 'YES' : '', r.total_secs,
        finished(r) ? 'YES' : 'no',
        r.next_eligible_at && new Date(r.next_eligible_at).toISOString().slice(0, 10),
      ].map(csvCell).join(','));
    }
    fs.writeFileSync(CSV, lines.join('\n'), 'utf8');
    console.log(`\n${rows.length} numbers -> ${CSV}`);
  }

  await c.end();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
