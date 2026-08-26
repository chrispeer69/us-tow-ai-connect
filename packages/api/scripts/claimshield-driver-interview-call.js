#!/usr/bin/env node
/**
 * Place ONE ClaimShield driver-interview call.
 *
 *   RETELL_API_KEY=... node scripts/claimshield-driver-interview-call.js --apply
 *
 * Hardcoded to today's pilot: claim #10, driver Tim Moore. Not meant to be a
 * durable script — if this becomes a repeated thing, the variables below
 * should move to real CLI args or a DB-backed queue.
 */
const API = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;
const AGENT_ID = 'agent_ff919fc1305f7a512b45707350';
const AGENT_VERSION = 1;
const FROM_NUMBER = '+18447011345';
const TO_NUMBER = '+16142262773'; // Tim Moore

const DYNAMIC_VARS = {
  driver_name: 'Tim Moore',
  incident_date: 'August 18th',
  claim_id: '10',
  vehicle: '2020 GMC Acadia',
  pickup_location: 'Morse Road, Columbus, Ohio',
  dropoff_location: 'Lindsey Buick on North Hamilton Road in Whitehall, Ohio',
  damage_description: 'body damage near the lights',
  equipment_type: 'flatbed',
  securing_method: 'winch cable and soft straps on the tires',
};

const APPLY = process.argv.includes('--apply');

if (!KEY) {
  console.error('RETELL_API_KEY is required');
  process.exit(2);
}

async function main() {
  const body = {
    from_number: FROM_NUMBER,
    to_number: TO_NUMBER,
    override_agent_id: AGENT_ID,
    override_agent_version: AGENT_VERSION,
    retell_llm_dynamic_variables: DYNAMIC_VARS,
    metadata: { purpose: 'claimshield_driver_interview', claim_id: '10' },
  };

  if (!APPLY) {
    console.log('--dry-run (default). Would POST /v2/create-phone-call with:');
    console.log(JSON.stringify(body, null, 2));
    console.log('\nRe-run with --apply to actually place the call.');
    return;
  }

  const res = await fetch(`${API}/v2/create-phone-call`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`create-phone-call -> ${res.status}: ${text.slice(0, 500)}`);
    process.exit(1);
  }
  const json = JSON.parse(text);
  console.log(`Call placed: call_id=${json.call_id}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
