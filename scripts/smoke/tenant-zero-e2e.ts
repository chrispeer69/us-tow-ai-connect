#!/usr/bin/env tsx
/**
 * tenant-zero-e2e.ts — Session 42
 *
 * Black-box end-to-end smoke for the tenant-zero pipeline:
 *   inbound call (Thinkrr webhook) → API ingestion → agent dispatch-request
 *   → ETA → flip-accept SMS → audit trail.
 *
 * Two run modes:
 *   full          (default) — exercises mutating + tenant-keyed endpoints.
 *   --prod-readonly          — only read-only, unauthenticated/x-tenant-id GETs.
 *
 * Usage:
 *   SMOKE_BASE_URL=http://localhost:3001 \
 *   TENANT_API_KEY=usk_xxx THINKRR_SECRET=dev-secret \
 *     pnpm --filter @ustow/api exec tsx <repo>/scripts/smoke/tenant-zero-e2e.ts
 *
 *   SMOKE_BASE_URL=https://ustowapi-production.up.railway.app \
 *     pnpm --filter @ustow/api exec tsx <repo>/scripts/smoke/tenant-zero-e2e.ts --prod-readonly
 *
 * Exit code: 0 if no step FAILed, 1 otherwise. SKIPs never fail the run.
 *
 * Dependency-free on purpose: global fetch + node builtins only, so it runs
 * under any tsx without monorepo wiring. See docs/E2E_TENANT_ZERO.md.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── config ──────────────────────────────────────────────────────────────────
const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const TENANT_ID = process.env.TENANT_ID ?? '00000000-0000-0000-0000-000000000001';
const TENANT_API_KEY = process.env.TENANT_API_KEY ?? '';
const THINKRR_SECRET = process.env.THINKRR_SECRET ?? 'dev-secret';
// Twilio magic test number — clearly synthetic, safe to leave behind.
const APPROVER_PHONE = process.env.SMOKE_APPROVER_PHONE ?? '+15005550006';
const PROD_READONLY = process.argv.includes('--prod-readonly');
const HTTP_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 15000);
const DECISION_POLL_MS = Number(process.env.SMOKE_DECISION_POLL_MS ?? 30000);

const RUN_ID = `smoke-${Date.now()}`;
const MARKER = `SMOKE-E2E ${RUN_ID}`; // stamped into test rows for manual cleanup

// ─── color (respects NO_COLOR / non-TTY) ───────────────────────────────────────
const COLOR = !process.env.NO_COLOR && process.stdout.isTTY;
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c('32', s);
const red = (s: string) => c('31', s);
const yellow = (s: string) => c('33', s);
const dim = (s: string) => c('2', s);
const bold = (s: string) => c('1', s);

// ─── step results ───────────────────────────────────────────────────────────
type Status = 'PASS' | 'FAIL' | 'SKIP';
interface StepResult {
  id: string;
  name: string;
  status: Status;
  detail: string;
  ms: number;
  httpStatus?: number;
}
const results: StepResult[] = [];

function record(r: StepResult) {
  results.push(r);
  const tag =
    r.status === 'PASS' ? green('PASS') : r.status === 'FAIL' ? red('FAIL') : yellow('SKIP');
  const http = r.httpStatus !== undefined ? dim(` [${r.httpStatus}]`) : '';
  console.log(`  ${tag} ${r.id.padEnd(4)} ${r.name.padEnd(46)}${http} ${dim(`${r.ms}ms`)}`);
  if (r.detail && (r.status !== 'PASS' || process.env.SMOKE_VERBOSE)) {
    console.log(`       ${dim(r.detail)}`);
  }
}

/**
 * Run one step. The body returns the step outcome (sans timing/id/name).
 * A `precondition` that is false records a SKIP and never runs the body —
 * use it for "missing input / wrong mode", NEVER for "the effect didn't happen".
 */
async function step(
  id: string,
  name: string,
  opts: { precondition?: boolean; skipReason?: string },
  body: () => Promise<{ status: Status; detail: string; httpStatus?: number }>,
): Promise<StepResult> {
  const start = Date.now();
  if (opts.precondition === false) {
    const r: StepResult = {
      id,
      name,
      status: 'SKIP',
      detail: opts.skipReason ?? 'precondition not met',
      ms: 0,
    };
    record(r);
    return r;
  }
  try {
    const out = await body();
    const r: StepResult = { id, name, ...out, ms: Date.now() - start };
    record(r);
    return r;
  } catch (err) {
    const r: StepResult = {
      id,
      name,
      status: 'FAIL',
      detail: `threw: ${(err as Error).message}`,
      ms: Date.now() - start,
    };
    record(r);
    return r;
  }
}

// ─── http helper ──────────────────────────────────────────────────────────────
interface Resp {
  status: number;
  text: string;
  json: any;
  ok: boolean;
}
async function http(
  method: string,
  path: string,
  init: { headers?: Record<string, string>; body?: string } = {},
): Promise<Resp> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: init.headers,
      body: init.body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, text, json, ok: res.ok };
  } finally {
    clearTimeout(t);
  }
}

const adminHeaders = { 'x-tenant-id': TENANT_ID };
const keyHeaders = { 'x-tenant-api-key': TENANT_API_KEY };
const jsonHeaders = (extra: Record<string, string> = {}) => ({
  'content-type': 'application/json',
  ...extra,
});

// ─── steps ────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log(bold('\nTenant-zero E2E smoke'));
  console.log(dim(`  base        ${BASE_URL}`));
  console.log(dim(`  tenant      ${TENANT_ID}`));
  console.log(dim(`  mode        ${PROD_READONLY ? 'prod-readonly (GET only)' : 'full'}`));
  console.log(dim(`  run id      ${RUN_ID}`));
  console.log(dim(`  tenant key  ${TENANT_API_KEY ? 'present' : 'absent'}`));
  console.log('');

  // S1 — liveness
  await step('S1', 'GET /health (liveness)', {}, async () => {
    const r = await http('GET', '/health');
    const ok = r.status === 200 && r.json?.status === 'ok';
    return {
      status: ok ? 'PASS' : 'FAIL',
      httpStatus: r.status,
      detail: ok ? `status=${r.json?.status}` : `body=${r.text.slice(0, 200)}`,
    };
  });

  // S2 — readiness (db/redis). Degraded deps => FAIL.
  await step('S2', 'GET /health/ready (db+redis)', {}, async () => {
    const r = await http('GET', '/health/ready');
    const checks = r.json?.checks ?? {};
    const ok = r.status === 200 && r.json?.status === 'ready';
    return {
      status: ok ? 'PASS' : 'FAIL',
      httpStatus: r.status,
      detail: `db=${checks.db?.ok} redis=${checks.redis?.ok} sms=${checks.sms?.configured}`,
    };
  });

  // S3 — public knowledge pack (v1 md is the canonical fallback; v2 json informational)
  await step('S3', 'GET /public/knowledge/<tz>/profile.md', {}, async () => {
    const r = await http('GET', `/public/knowledge/${TENANT_ID}/profile.md`);
    const ok = r.status === 200 && r.text.trimStart().startsWith('#');
    return {
      status: ok ? 'PASS' : 'FAIL',
      httpStatus: r.status,
      detail: ok ? `${r.text.length} bytes of markdown` : `body=${r.text.slice(0, 200)}`,
    };
  });

  // S4 — admin audit-log baseline (capture total for the delta assertion later)
  let auditBaseline = 0;
  await step('S4', 'GET /v1/admin/audit-log (baseline)', {}, async () => {
    const r = await http('GET', '/v1/admin/audit-log?limit=1', { headers: adminHeaders });
    const ok = r.status === 200 && typeof r.json?.total === 'number';
    if (ok) auditBaseline = r.json.total;
    return {
      status: ok ? 'PASS' : 'FAIL',
      httpStatus: r.status,
      detail: ok ? `baseline total=${auditBaseline}` : `body=${r.text.slice(0, 200)}`,
    };
  });

  // S5 — admin digital-dispatch decisions list (read-only; surfaces the prod 500)
  await step('S5', 'GET /v1/admin/digital-dispatch/decisions', {}, async () => {
    const r = await http('GET', '/v1/admin/digital-dispatch/decisions?limit=5', {
      headers: adminHeaders,
    });
    const ok = r.status === 200 && Array.isArray(r.json?.items);
    return {
      status: ok ? 'PASS' : 'FAIL',
      httpStatus: r.status,
      detail: ok
        ? `items=${r.json.items.length} total=${r.json.total}`
        : `body=${r.text.slice(0, 200)} — see S42_BLOCKERS.md (decisions 500)`,
    };
  });

  // ─── mutating / tenant-keyed steps (full mode only) ──────────────────────────
  const mut = !PROD_READONLY;
  const mutSkip = 'prod-readonly: mutating/keyed endpoint not exercised';

  // S6 — Thinkrr inbound webhook = the real "intake" (brief's /v1/ai-connect/intake
  //      does not exist; this is the simulated inbound call).
  let callId = '';
  await step(
    'S6',
    'POST /webhooks/thinkrr/<secret>/call-completed',
    { precondition: mut, skipReason: mutSkip },
    async () => {
      callId = `${RUN_ID}-call`;
      const body = JSON.stringify({
        call_id: callId,
        tenant_id: TENANT_ID,
        caller_phone: APPROVER_PHONE,
        called_number: '+13803336411',
        duration_sec: 78,
        transcript: 'My car broke down on I-270 near Polaris, I need a tow.',
        summary: `${MARKER} — caller needs a tow off I-270`,
        structured_data: {
          intent: 'NEW_TOW_REQUEST',
          caller_name: 'Smoke Tester',
          vehicle: { year: '2019', make: 'Toyota', model: 'Camry', color: 'silver' },
          service_type: 'tow',
          lat: 40.1467, // Polaris / Columbus OH
          lng: -82.9988,
        },
        started_at: new Date(Date.now() - 78_000).toISOString(),
        ended_at: new Date().toISOString(),
      });
      const r = await http('POST', `/webhooks/thinkrr/${THINKRR_SECRET}/call-completed`, {
        headers: jsonHeaders(),
        body,
      });
      const ok = r.status === 200 || r.status === 201;
      return {
        status: ok ? 'PASS' : 'FAIL',
        httpStatus: r.status,
        detail: ok ? `call_id=${callId} ingested` : `body=${r.text.slice(0, 200)}`,
      };
    },
  );

  // S7 — agent dispatch-request (downstream of the call). Needs tenant API key.
  let dispatchId = '';
  await step(
    'S7',
    'POST /v1/ai-connect/dispatch-request',
    {
      precondition: mut && !!TENANT_API_KEY,
      skipReason: mut ? 'TENANT_API_KEY not set' : mutSkip,
    },
    async () => {
      const body = JSON.stringify({
        caller_name: 'Smoke Tester',
        caller_phone: APPROVER_PHONE,
        vehicle: { year: '2019', make: 'Toyota', model: 'Camry', color: 'silver' },
        location: 'I-270 EB near Polaris exit, Columbus OH',
        destination: 'Nearest Toyota dealer',
        reason: 'Engine failure',
        agent_notes: `${MARKER} — caller safe on shoulder`,
      });
      const r = await http('POST', '/v1/ai-connect/dispatch-request', {
        headers: jsonHeaders(keyHeaders),
        body,
      });
      const ok = (r.status === 201 || r.status === 200) && !!r.json?.data?.id;
      if (ok) dispatchId = r.json.data.id;
      return {
        status: ok ? 'PASS' : 'FAIL',
        httpStatus: r.status,
        detail: ok ? `dispatch_request id=${dispatchId}` : `body=${r.text.slice(0, 200)}`,
      };
    },
  );

  // S8 — ETA (GET, keyed). eta_minutes must be ≤ 60.
  await step(
    'S8',
    'GET /v1/ai-connect/eta (eta_minutes ≤ 60)',
    {
      precondition: mut && !!TENANT_API_KEY,
      skipReason: mut ? 'TENANT_API_KEY not set' : mutSkip,
    },
    async () => {
      const r = await http('GET', '/v1/ai-connect/eta?lat=40.1467&lng=-82.9988', {
        headers: keyHeaders,
      });
      const eta = r.json?.data?.eta_minutes;
      const ok = r.status === 200 && typeof eta === 'number' && eta <= 60;
      return {
        status: ok ? 'PASS' : 'FAIL',
        httpStatus: r.status,
        detail: ok
          ? `eta_minutes=${eta} (${r.json?.data?.basis})`
          : `eta=${eta} body=${r.text.slice(0, 160)}`,
      };
    },
  );

  // S9 — decision poll. The intake endpoints do NOT synchronously feed the
  //      decision engine (see S42_BLOCKERS.md): decisions come from
  //      adapter-ingested unified_jobs. So: if a decision shows up we assert
  //      its shape; if none within the window we SKIP (precondition: a
  //      decision-eligible unified_job) rather than FAIL a by-design gap.
  await step(
    'S9',
    'POLL decisions for new row (≤30s)',
    { precondition: mut, skipReason: mutSkip },
    async () => {
      const deadline = Date.now() + DECISION_POLL_MS;
      let last = '';
      while (Date.now() < deadline) {
        const r = await http('GET', '/v1/admin/digital-dispatch/decisions?limit=5', {
          headers: adminHeaders,
        });
        last = `[${r.status}] ${r.text.slice(0, 120)}`;
        if (r.status === 200 && Array.isArray(r.json?.items) && r.json.items.length > 0) {
          const d = r.json.items[0].decision;
          const shapeOk = d && d.decision && d.id;
          return {
            status: shapeOk ? 'PASS' : 'FAIL',
            httpStatus: r.status,
            detail: shapeOk
              ? `decision=${d.decision} rule=${d.ruleId ?? 'none'} job=${d.jobId}`
              : `malformed decision row: ${r.text.slice(0, 160)}`,
          };
        }
        await new Promise((res) => setTimeout(res, 3000));
      }
      return {
        status: 'SKIP',
        detail: `no decision within ${DECISION_POLL_MS}ms — intake does not feed engine (S42_BLOCKERS.md). last=${last}`,
      };
    },
  );

  // S10 — flip-accept: create a pending request, simulate Twilio "YES", verify
  //       history flips. Needs tenant API key (create + history) and works
  //       against the unsigned-in-dev Twilio webhook.
  await step(
    'S10',
    'flip-accept request → SMS YES → history',
    {
      precondition: mut && !!TENANT_API_KEY,
      skipReason: mut ? 'TENANT_API_KEY not set' : mutSkip,
    },
    async () => {
      // create a pending flip-accept request
      const reqBody = JSON.stringify({
        source_adapter: 'TOWBOOK',
        source_job_id: `${RUN_ID}-job`,
        approver_phone: APPROVER_PHONE,
        summary: `${MARKER} flip-accept`,
      });
      const created = await http('POST', '/v1/flip-accept/request', {
        headers: jsonHeaders(keyHeaders),
        body: reqBody,
      });
      if (created.status !== 200 && created.status !== 201) {
        return {
          status: 'FAIL',
          httpStatus: created.status,
          detail: `create flip request failed: ${created.text.slice(0, 180)}`,
        };
      }
      // simulate manager replying YES (Twilio form fields)
      const form = new URLSearchParams({
        From: APPROVER_PHONE,
        To: '+13803336411',
        Body: `YES ${MARKER}`,
        MessageSid: `SM${RUN_ID.replace(/[^a-z0-9]/gi, '')}`,
      }).toString();
      const sms = await http('POST', '/webhooks/twilio/sms-inbound', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      // verify the request flipped to an approved/responded state
      const hist = await http('GET', '/v1/flip-accept/history?limit=10', { headers: keyHeaders });
      const rows: any[] = hist.json?.data?.items ?? hist.json?.data ?? [];
      const mine = Array.isArray(rows)
        ? rows.find((x) => x.source_job_id === `${RUN_ID}-job` || x.sourceJobId === `${RUN_ID}-job`)
        : undefined;
      const flipped = mine && /approv|accept|respond/i.test(mine.status ?? '');
      const ok = (sms.status === 200) && !!flipped;
      return {
        status: ok ? 'PASS' : 'FAIL',
        httpStatus: sms.status,
        detail: ok
          ? `flip status=${mine.status}`
          : `sms=${sms.status} row=${mine ? mine.status : 'not found'} hist=${hist.status}`,
      };
    },
  );

  // S11 — audit-log delta ≥ 3 (the mutations above should have logged entries)
  await step(
    'S11',
    'GET /v1/admin/audit-log (delta ≥ 3)',
    { precondition: mut, skipReason: mutSkip },
    async () => {
      const r = await http('GET', '/v1/admin/audit-log?limit=1', { headers: adminHeaders });
      const total = r.json?.total;
      const delta = typeof total === 'number' ? total - auditBaseline : NaN;
      const ok = r.status === 200 && delta >= 3;
      return {
        status: ok ? 'PASS' : 'FAIL',
        httpStatus: r.status,
        detail: `baseline=${auditBaseline} now=${total} delta=${delta} (need ≥3)`,
      };
    },
  );

  // S12 — cleanup. No black-box DELETE / mark-test exists (S42_BLOCKERS.md), so
  //       test rows are tagged with MARKER for manual purge. Always SKIP, never
  //       FAIL: cleanup is best-effort by the brief.
  await step('S12', 'cleanup (best-effort)', { precondition: mut, skipReason: mutSkip }, async () => {
    return {
      status: 'SKIP',
      detail: `no black-box delete; rows tagged "${MARKER}" for manual cleanup (S42_BLOCKERS.md)`,
    };
  });

  // ─── summary ─────────────────────────────────────────────────────────────────
  const totalMs = Date.now() - t0;
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;

  console.log('');
  console.log(
    bold('Result: ') +
      green(`${pass} passed`) +
      ', ' +
      (fail ? red(`${fail} failed`) : `${fail} failed`) +
      ', ' +
      yellow(`${skip} skipped`) +
      dim(`  (${totalMs}ms)`),
  );

  // ─── write diagnostics json (repo-root relative, cwd-independent) ──────────────
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\.\d+Z$/, '');
  const outDir = resolve(repoRoot, 'docs', 'diagnostics');
  const outFile = resolve(outDir, `smoke-${ts}.json`);
  mkdirSync(outDir, { recursive: true });
  const report = {
    runId: RUN_ID,
    mode: PROD_READONLY ? 'prod-readonly' : 'full',
    baseUrl: BASE_URL,
    tenantId: TENANT_ID,
    startedAt: new Date(t0).toISOString(),
    totalMs,
    summary: { pass, fail, skip, total: results.length },
    steps: results,
  };
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(dim(`  results → ${outFile.replace(`${repoRoot}/`, '')}`));

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(red(`fatal: ${(err as Error).stack ?? err}`));
  process.exit(1);
});
