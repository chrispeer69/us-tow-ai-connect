#!/usr/bin/env node
/**
 * `usta` — the outreach campaign CLI.
 *
 * Talks to the same admin endpoints the Campaigns page uses, so there is ONE
 * implementation of "add a lead" and "run a batch", not two that drift. Nothing
 * here touches the database directly.
 *
 * Setup (once):
 *   export USTA_API=https://api.ustowaiconnect.com
 *   export USTA_TOKEN=<an admin JWT for the US Tow Alliance tenant>
 *   export USTA_TENANT=34ad702f-83f1-457b-93da-977aa56a9619
 *
 * Get a token:
 *   curl -s -X POST $USTA_API/v1/auth/login -H 'content-type: application/json' \
 *     -d '{"email":"...","password":"..."}' | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token"
 *
 * Commands:
 *   usta status
 *   usta add <file.csv>            # or: cat list.txt | usta add -
 *   usta remove <phone>            # profile claimed — removes from the pool
 *   usta dnc <phone>               # permanent do-not-call
 *   usta run [--limit N] [--dry-run]
 *   usta calls [--disposition PITCHED] [--limit N]
 */

const fs = require('node:fs');

const API = (process.env.USTA_API || 'https://api.ustowaiconnect.com').replace(/\/$/, '');
const TOKEN = process.env.USTA_TOKEN;
const TENANT = process.env.USTA_TENANT;
const SLUG = process.env.USTA_CAMPAIGN || 'usta';

if (!TOKEN) {
  console.error('USTA_TOKEN is required (an admin JWT). See the header of this file.');
  process.exit(2);
}

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function call(path, method = 'GET', body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/json',
      ...(TENANT ? { 'x-tenant-id': TENANT } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${method} ${path} -> ${res.status}`);
    console.error(text.slice(0, 600));
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

/** Resolve the campaign id once, by slug, so commands read naturally. */
async function campaignId() {
  const { data } = await call('/v1/admin/campaigns');
  const match = data.find((c) => c.slug === SLUG);
  if (!match) {
    console.error(`No campaign with slug '${SLUG}'. Found: ${data.map((c) => c.slug).join(', ') || '(none)'}`);
    process.exit(1);
  }
  return match.id;
}

function readInput(source) {
  if (!source || source === '-') return fs.readFileSync(0, 'utf8');
  if (!fs.existsSync(source)) {
    console.error(`No such file: ${source}`);
    process.exit(1);
  }
  return fs.readFileSync(source, 'utf8');
}

const COMMANDS = {
  async status() {
    const { data } = await call(`/v1/admin/campaigns/${await campaignId()}/status`);
    const c = data.campaign;

    console.log(`\n${c.name}  [${c.status}]`);
    console.log(`  number      ${c.fromNumber ?? '(none — not ready to dial)'}`);
    console.log(`  agent       ${c.outboundAgentId ?? '(none)'}`);
    console.log(
      `  pacing      ${c.concurrency} at a time, cap ${c.dailyCap}/day, ${c.maxAttempts} attempts`,
    );
    console.log(
      `  window      ${c.window.startHour}:00-${c.window.endHour}:00 local to each number, days ${c.window.days.join(',')}`,
    );

    console.log('\n  Queue');
    for (const [status, n] of Object.entries(data.leads).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${status.padEnd(12)} ${n}`);
    }

    console.log(`\n  Today (${data.dialedToday} dialed)`);
    const today = Object.entries(data.today).sort((a, b) => b[1] - a[1]);
    if (today.length === 0) console.log('    (nothing yet)');
    for (const [disposition, n] of today) {
      console.log(`    ${(disposition || 'PENDING').padEnd(16)} ${n}`);
    }

    console.log(`\n  Suppressed (all time)  ${data.suppressedTotal}\n`);
  },

  async add(source) {
    const text = readInput(source);

    // A headered CSV carries better data than column-guessing can recover.
    // The exported lists have company/phone/city/state as named columns; the
    // free-text path has to infer which cell is which and gets `state` wrong
    // when the file spells it "Ohio" instead of "OH". Use the header when
    // there is one, and fall back to the paste parser when there is not.
    const structured = parseHeaderedCsv(text);
    const body = structured
      ? { rows: structured, source: source && source !== '-' ? 'csv' : 'paste' }
      : { text, source: source && source !== '-' ? 'csv' : 'paste' };

    if (structured) {
      console.log(`  (read ${structured.length} rows using the CSV header)`);
    }

    const { data } = await call(`/v1/admin/campaigns/${await campaignId()}/leads`, 'POST', body);

    console.log(`\n  received    ${data.received}`);
    console.log(`  added       ${data.added}`);
    console.log(`  duplicates  ${data.duplicates}`);
    console.log(`  suppressed  ${data.suppressed}`);
    console.log(`  invalid     ${data.invalid.length}`);

    if (data.invalid.length > 0) {
      // Always print these. An ingest that cannot say what it dropped is how a
      // list quietly rots.
      console.log('\n  Rejected:');
      const byReason = {};
      for (const row of data.invalid) {
        (byReason[row.reason] ||= []).push(row.input);
      }
      for (const [reason, inputs] of Object.entries(byReason)) {
        console.log(`    ${reason} (${inputs.length}):`);
        for (const input of inputs.slice(0, 10)) console.log(`      ${input}`);
        if (inputs.length > 10) console.log(`      … and ${inputs.length - 10} more`);
      }
    }
    console.log('');
  },

  async remove(phone) {
    if (!phone) return usage('remove <phone>');
    const { data } = await call('/v1/admin/campaigns/leads/accepted', 'POST', { phone });
    console.log(`marked claimed — ${data.updated} lead(s) updated`);
  },

  async dnc(phone) {
    if (!phone) return usage('dnc <phone>');
    const { data } = await call('/v1/admin/campaigns/leads/dnc', 'POST', { phone });
    console.log(
      data.alreadySuppressed
        ? `${data.phone} was already suppressed`
        : `${data.phone} suppressed — will never be dialled again`,
    );
  },

  async run() {
    const dryRun = process.argv.includes('--dry-run');
    const limit = flag('limit');
    const { data } = await call(`/v1/admin/campaigns/${await campaignId()}/run`, 'POST', {
      dryRun,
      limit: limit ? Number(limit) : undefined,
    });

    console.log(`\n  ${data.dryRun ? 'DRY RUN' : 'LIVE'} — ${data.campaign}`);
    console.log(`  considered  ${data.considered}`);
    console.log(data.dryRun ? `  would dial  ${data.wouldDial.length}` : `  placed      ${data.placed}`);

    if (data.errors.length > 0) {
      console.log('\n  Errors:');
      for (const e of data.errors) console.log(`    ${e}`);
    }
    if (Object.keys(data.skipped).length > 0) {
      console.log('\n  Skipped:');
      for (const [reason, n] of Object.entries(data.skipped).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${reason.padEnd(26)} ${n}`);
      }
    }
    if (data.wouldDial.length > 0) {
      console.log('\n  Would dial:');
      for (const d of data.wouldDial) {
        console.log(`    ${d.phone.padEnd(14)} ${(d.company ?? '').padEnd(30)} ${d.timezone ?? ''}`);
      }
    }
    console.log('');
  },

  async calls() {
    const disposition = flag('disposition');
    const limit = flag('limit', '25');
    const query = new URLSearchParams();
    if (typeof disposition === 'string') query.set('disposition', disposition);
    query.set('limit', String(limit));

    const { data } = await call(`/v1/admin/campaigns/${await campaignId()}/calls?${query}`);
    if (data.length === 0) {
      console.log('no calls');
      return;
    }
    console.log('');
    for (const c of data) {
      const when = new Date(c.createdAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      console.log(
        `  ${when.padEnd(18)} ${c.phone.padEnd(14)} ${(c.disposition ?? c.status).padEnd(16)} ` +
          `${String(c.durationSeconds ?? '-').padStart(4)}s  ${c.company ?? ''}`,
      );
      if (c.recordingUrl) console.log(`      ${c.recordingUrl}`);
    }
    console.log('');
  },
};

/** Split one CSV line, honouring double quotes (addresses contain commas). */
function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else inQuotes = !inQuotes;
    } else if ((ch === ',' || ch === '\t') && !inQuotes) {
      cells.push(current);
      current = '';
    } else current += ch;
  }
  cells.push(current);
  return cells.map((c) => c.trim().replace(/^"|"$/g, ''));
}

/**
 * Read a CSV that names its columns. Returns null when there is no usable
 * header, so the caller can fall back to the messy-paste parser.
 *
 * Only a phone column is required. Everything else is a bonus that makes the
 * call list readable later — `company` is what shows on the Campaigns page.
 */
function parseHeaderedCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const idx = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const phoneAt = idx('phone', 'phonenumber', 'telephone', 'tel', 'number');
  if (phoneAt === -1) return null;

  const companyAt = idx('company', 'companyname', 'business', 'businessname', 'name');
  const cityAt = idx('city', 'town');
  const stateAt = idx('state', 'province');
  const contactAt = idx('contact', 'contactname', 'owner', 'ownername');

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const phone = cells[phoneAt];
    // Keep blank-phone rows out entirely rather than shipping them to the API
    // to be rejected — an empty cell is not an interesting ingest error.
    if (!phone) continue;
    rows.push({
      phone,
      company: companyAt !== -1 ? cells[companyAt] || null : null,
      city: cityAt !== -1 ? cells[cityAt] || null : null,
      state: stateAt !== -1 ? cells[stateAt] || null : null,
      contactName: contactAt !== -1 ? cells[contactAt] || null : null,
    });
  }
  return rows.length > 0 ? rows : null;
}

function usage(detail) {
  console.log(`usage: usta <command>

  status                            queue depth, today's dispositions, suppression count
  add <file.csv|->                  bulk ingest; normalizes, dedupes, drops suppressed
  remove <phone>                    profile claimed — take out of the dialling pool
  dnc <phone>                       permanent do-not-call
  run [--limit N] [--dry-run]       launch a batch inside the calling window
  calls [--disposition D] [--limit N]

${detail ? `\nexpected: usta ${detail}\n` : ''}`);
  process.exit(detail ? 1 : 0);
}

const [command, arg] = process.argv.slice(2);
if (!command || !COMMANDS[command]) usage();
COMMANDS[command](arg).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
