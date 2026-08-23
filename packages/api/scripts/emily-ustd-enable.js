#!/usr/bin/env node
/**
 * Give Emily the ability to create a real job in US Tow Dispatch.
 *
 * Everything except the credential is already built:
 *   - USTD exposes POST /v1/jobs/phone-intake (API key, scope jobs:write),
 *     which creates the customer, matches the vehicle, prices the job off the
 *     live rate sheet and returns the quote.
 *   - Emily's prompt already runs a full intake and stops one step short.
 *
 * This script closes that step. It is separate from emily-inbound-publish.js
 * because it needs a credential that publishing does not, and because turning
 * it on changes what a customer is TOLD at the end of the call — from "someone
 * will ring you back" to "you're booked".
 *
 *   cd packages/api
 *   RETELL_API_KEY=... USTD_API_KEY=tc_live_... node scripts/emily-ustd-enable.js --dry-run
 *   RETELL_API_KEY=... USTD_API_KEY=tc_live_... node scripts/emily-ustd-enable.js --apply
 *
 * To take it back off:  node scripts/emily-ustd-enable.js --disable --apply
 *
 * The USTD key is read from the environment and never written to this repo.
 * Mint it in USTD under Settings -> API & Webhooks for the Roadside Towing
 * tenant, with scope jobs:write and nothing else.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const API = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;
const USTD_KEY = process.env.USTD_API_KEY;
const USTD_BASE = process.env.USTD_API_BASE_URL || 'https://api.ustowdispatch.com';

const LLM = 'llm_5de3f737a66db98138167cc13e7b'; // Emily INBOUND
const PROMPT = path.join(__dirname, 'emily-inbound.txt');
const TOOL = 'create_tow_job';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DISABLE = args.includes('--disable');

if (!KEY) {
  console.error('RETELL_API_KEY is required');
  process.exit(2);
}
if (!DISABLE && !USTD_KEY) {
  console.error(
    'USTD_API_KEY is required.\n' +
      'Mint one in US Tow Dispatch: Settings -> API & Webhooks, Roadside Towing tenant,\n' +
      'scope jobs:write. The plaintext is shown once.',
  );
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
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

/**
 * The tool Emily calls at the end of a new-tow intake.
 *
 * Only the fields she can actually get on a phone call are here. VIN and email
 * are deliberately absent from `required` — the endpoint accepts their absence
 * and stamps the job with the instruction to capture them at pickup.
 */
const toolDefinition = {
  type: 'custom',
  name: TOOL,
  url: `${USTD_BASE}/v1/jobs/phone-intake`,
  method: 'POST',
  timeout_ms: 15000,
  headers: {
    authorization: `Bearer ${USTD_KEY}`,
    'content-type': 'application/json',
  },
  description:
    'Create the tow job in US Tow Dispatch. Call this ONCE, after you have the ' +
    'callback number, the location, what happened and the vehicle. Returns the ' +
    'job number and the price.',
  speak_during_execution: true,
  execution_message_description: 'Tell them you are getting it into the system now, in a few words.',
  speak_after_execution: true,
  parameters: {
    type: 'object',
    required: ['customer', 'vehicle', 'serviceType', 'pickup'],
    properties: {
      customer: {
        type: 'object',
        required: ['name', 'phone'],
        properties: {
          name: { type: 'string', description: "The caller's name. Use 'Unknown' if they would not give one." },
          phone: { type: 'string', description: 'Callback number. Digits are fine, e.g. 6145550101.' },
          email: { type: 'string', description: 'Only if they volunteered it. Leave out otherwise.' },
        },
      },
      vehicle: {
        type: 'object',
        properties: {
          vin: { type: 'string', description: 'Only if they read you all 17 characters. Leave out otherwise.' },
          plate: { type: 'string' },
          plateState: { type: 'string', description: 'Two letters, e.g. OH' },
          year: { type: 'number' },
          make: { type: 'string' },
          model: { type: 'string' },
          color: { type: 'string' },
          vehicleClass: {
            type: 'string',
            enum: ['light_duty', 'medium_duty', 'heavy_duty', 'motorcycle', 'commercial', 'rv', 'unknown'],
            description: "Use 'unknown' rather than guessing. A wrong class sends the wrong truck.",
          },
          drivetrain: {
            type: 'string',
            enum: ['2WD', '4WD', 'RWD', 'AWD', 'EV', 'Hybrid'],
            description: 'Only what they TOLD you. Never inferred from the model.',
          },
          specialInstructions: {
            type: 'string',
            description:
              'Low ceiling or parking garage level, whether it rolls/steers/brakes, keys, ' +
              'and anything the driver needs before hooking up.',
          },
        },
      },
      serviceType: {
        type: 'string',
        enum: ['tow', 'jump_start', 'lockout', 'tire_change', 'fuel', 'winch', 'recovery', 'impound', 'repo', 'other'],
      },
      pickup: {
        type: 'object',
        required: ['address'],
        properties: {
          address: {
            type: 'string',
            description:
              'As specific as you got. On a highway include the route, the DIRECTION of travel ' +
              'and the nearest exit or mile marker.',
          },
        },
      },
      dropoff: {
        type: 'object',
        required: ['address'],
        properties: { address: { type: 'string' } },
      },
      notes: { type: 'string', description: 'What the customer said, in their words.' },
      callReference: { type: 'string', description: 'The Retell call id, so a retry cannot double-book.' },
    },
  },
};

const ENABLED_CLOSING = `You have everything. Call ${TOOL} now, once, and then tell them:

"You're all set — I've got you in the system. Dispatch will call you right back on this number with your driver and a time."

If ${TOOL} fails or does not come back, do NOT tell them they are booked. Say "let me get you to dispatch to lock this in" and transfer_to_dispatch.

Never read the job number or the price out unless they ask. If they ask the price, give them the number the tool returned and nothing else — do not explain it, do not add to it.`;

const DISABLED_CLOSING = `"Got it — I've got everything dispatch needs. Someone will call you right back on this number to confirm and get a truck to you."`;

function swapClosing(text, enabled) {
  const begin = '[USTD:BEGIN]';
  const end = '[USTD:END]';
  const i = text.indexOf(begin);
  const j = text.indexOf(end);
  if (i === -1 || j === -1) throw new Error(`markers ${begin}/${end} not found in the prompt`);
  return (
    text.slice(0, i + begin.length) +
    '\n' +
    (enabled ? ENABLED_CLOSING : DISABLED_CLOSING) +
    '\n' +
    text.slice(j)
  );
}

async function main() {
  const llm = await retell(`/get-retell-llm/${LLM}`);
  const tools = (llm.general_tools || []).filter((t) => t.name !== TOOL);
  const next = DISABLE ? tools : [...tools, toolDefinition];

  const before = fs.readFileSync(PROMPT, 'utf8');
  const after = swapClosing(before, !DISABLE);

  console.log(`${DISABLE ? 'REMOVING' : 'ADDING'} tool ${TOOL}`);
  console.log(`  tools: ${(llm.general_tools || []).length} -> ${next.length}`);
  console.log(`  prompt closing: ${DISABLE ? 'ring-back' : 'booked'}`);
  if (!DISABLE) console.log(`  endpoint: POST ${USTD_BASE}/v1/jobs/phone-intake`);

  if (!APPLY) {
    console.log('\n--dry-run: nothing written. Re-run with --apply.');
    return;
  }

  fs.writeFileSync(PROMPT, after, 'utf8');
  await retell(`/update-retell-llm/${LLM}`, 'PATCH', { general_tools: next });
  console.log('  tool list updated');

  // Reuse the publisher so the greeting sync and the must-keep rule checks all
  // still run. Doing it here by hand is how one of them gets skipped.
  execFileSync(process.execPath, [path.join(__dirname, 'emily-inbound-publish.js'), '--apply'], {
    stdio: 'inherit',
    env: process.env,
  });
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
