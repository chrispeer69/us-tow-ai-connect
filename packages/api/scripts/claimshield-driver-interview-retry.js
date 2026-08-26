#!/usr/bin/env node
/**
 * Place the ClaimShield driver-interview call, retrying every 5 minutes
 * until it's actually answered (not voicemail / no-answer / busy).
 *
 *   RETELL_API_KEY=... node scripts/claimshield-driver-interview-retry.js --apply
 *
 * Hardcoded to today's pilot: claim #10, driver Tim Moore. Stops on a real
 * conversation, on a definitively bad number, or after MAX_ATTEMPTS.
 */
const API = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;
const AGENT_ID = 'agent_ff919fc1305f7a512b45707350';
const AGENT_VERSION = 1;
const FROM_NUMBER = '+18447011345';
const TO_NUMBER = '+16142262773'; // Tim Moore

const RETRY_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 12; // ~1 hour of retrying at 5-minute spacing
const POLL_MS = 10 * 1000;
const CALL_TIMEOUT_MS = 9 * 60 * 1000; // agent's own cap is 8 min

const DYNAMIC_VARS = {
  driver_name: 'Tim Moore',
  incident_date: 'August 18th',
  claim_id: '10',
  vehicle: '2020 GMC Acadia',
  pickup_location: 'Morse Road, Columbus, Ohio',
  dropoff_location: 'Lindsey Buick on North Hamilton Road in Whitehall, Ohio',
  damage_description: 'body damage near the lights',
};

const NOT_ANSWERED_REASONS = new Set([
  'dial_no_answer',
  'dial_busy',
  'dial_failed',
  'voicemail_reached',
  'registered_call_timeout',
]);

const APPLY = process.argv.includes('--apply');

if (!KEY) {
  console.error('RETELL_API_KEY is required');
  process.exit(2);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function retell(p, method = 'GET', body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

async function placeCall() {
  const body = {
    from_number: FROM_NUMBER,
    to_number: TO_NUMBER,
    override_agent_id: AGENT_ID,
    override_agent_version: AGENT_VERSION,
    retell_llm_dynamic_variables: DYNAMIC_VARS,
    metadata: { purpose: 'claimshield_driver_interview', claim_id: '10' },
  };
  const json = await retell('/v2/create-phone-call', 'POST', body);
  return json.call_id;
}

async function waitForOutcome(callId) {
  const deadline = Date.now() + CALL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const call = await retell(`/v2/get-call/${callId}`);
    if (call.call_status === 'ended' || call.call_status === 'error') {
      return call;
    }
  }
  return null; // timed out waiting — treat as unknown, don't auto-retry
}

async function main() {
  if (!APPLY) {
    console.log('--dry-run (default). Re-run with --apply to actually start calling.');
    return;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStart = Date.now();
    console.log(`\n[attempt ${attempt}/${MAX_ATTEMPTS}] placing call at ${new Date().toISOString()}...`);
    let callId;
    try {
      callId = await placeCall();
    } catch (err) {
      console.error(`  create-phone-call failed: ${err.message}`);
      await sleep(Math.max(0, RETRY_MS - (Date.now() - attemptStart)));
      continue;
    }
    console.log(`  call_id ${callId} — waiting for outcome...`);

    const call = await waitForOutcome(callId);
    if (!call) {
      console.log('  timed out waiting for call to end — treating as unknown, will retry.');
    } else {
      console.log(`  ended: status=${call.call_status} reason=${call.disconnection_reason} duration_ms=${call.duration_ms}`);
      const notAnswered = NOT_ANSWERED_REASONS.has(call.disconnection_reason) || (call.duration_ms ?? 0) < 12000;
      if (!notAnswered) {
        console.log('\n=== ANSWERED — INTERVIEW LIKELY COMPLETED ===');
        console.log(`call_id: ${callId}`);
        console.log(`recording_url: ${call.recording_url || '(not yet available)'}`);
        console.log(`duration_ms: ${call.duration_ms}`);
        console.log('--- transcript ---');
        console.log(call.transcript || '(no transcript field yet)');
        return;
      }
      console.log('  not answered — will retry in 5 minutes.');
    }

    const elapsed = Date.now() - attemptStart;
    const remaining = RETRY_MS - elapsed;
    if (remaining > 0) await sleep(remaining);
  }

  console.log(`\n=== GAVE UP after ${MAX_ATTEMPTS} attempts — no answer. ===`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
