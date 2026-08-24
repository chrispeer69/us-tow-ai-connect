#!/usr/bin/env node
/**
 * Publish the Emily INBOUND prompt — the 844-701-1345 line.
 *
 * This is a live customer line. People on it are frequently stranded, often at
 * night, sometimes on a shoulder. Every change ships through here so that the
 * text under review is the text that answers the phone.
 *
 *   cd packages/api
 *   RETELL_API_KEY=... node scripts/emily-inbound-publish.js            # show live
 *   RETELL_API_KEY=... node scripts/emily-inbound-publish.js --dry-run
 *   RETELL_API_KEY=... node scripts/emily-inbound-publish.js --apply
 *
 * No version re-pin here, unlike the USTA script: 844-701-1345 binds this agent
 * as `latest_published`, so publishing IS the deploy. Check that with --apply's
 * final line rather than assuming it — if the binding is ever pinned to a
 * number, publishing alone will silently change nothing.
 */

const fs = require('fs');
const path = require('path');

const API = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;

const AGENT = 'agent_d070aed59fd269162e2268a386'; // Emily INBOUND | Roadside Towing
const LLM = 'llm_5de3f737a66db98138167cc13e7b';
const NUMBER = '+18447011345';
const FILE = path.join(__dirname, 'emily-inbound.txt');
const TENANT_API_KEY = 'usk_fDvU0YsvFs5phHAKuUWxpcQC'; // Roadside's key — same one lookup_job_by_phone already uses

/**
 * general_tools, owned here rather than left to drift in the Retell
 * dashboard — the same reasoning as the prompt text itself. Only ADD to
 * this list; removing a tool an already-published version still calls
 * from mid-call would break that call outright.
 */
const TOOLS = [
  {
    type: 'end_call',
    name: 'end_call',
    description: 'End the call once the customer has what they need and has said goodbye.',
    speak_after_execution: true,
  },
  {
    type: 'transfer_call',
    name: 'transfer_to_dispatch',
    description:
      'Transfer the caller to a live dispatcher. Use for any status, ETA, price, complaint, or insurance question, if the caller is upset or unsafe, or if you have asked the same question twice without an answer.',
    transfer_destination: { type: 'predefined', number: '+17408129489' },
    transfer_option: { type: 'cold_transfer' },
    speak_after_execution: true,
  },
  {
    type: 'custom',
    name: 'lookup_job_by_phone',
    description:
      "Look up the caller's active tow using the phone number on the job. Call this as soon as they give you a phone number. Returns customer name, vehicle, status, driver, ETA, pickup and destination.",
    url: 'https://api.ustowaiconnect.com/v1/ai-connect/lookup/by-phone',
    method: 'GET',
    timeout_ms: 8000,
    headers: { 'X-Tenant-API-Key': TENANT_API_KEY },
    query_params: { phone: '{{phone}}' },
    parameters: {
      type: 'object',
      required: ['phone'],
      properties: {
        phone: { type: 'string', description: 'The phone number on the tow job, digits only, e.g. 6148818702' },
      },
    },
    speak_during_execution: true,
    speak_after_execution: true,
    execution_message_description: 'Tell the caller you are pulling it up now, in a few words.',
  },
  {
    type: 'custom',
    name: 'create_tow_job',
    description:
      'Create the tow job in US Tow Dispatch. Call this ONCE, after you have the callback number, the location, what happened and the vehicle. Returns the job number and the price.',
    url: 'https://api.ustowdispatch.com/v1/jobs/phone-intake',
    method: 'POST',
    timeout_ms: 15000,
    headers: {
      authorization:
        'Bearer tc_live_a6b58fe38de0_e3bf14d98e3ce636af2635d677bd03364167e8244d753a971b45db741360e838',
      'content-type': 'application/json',
    },
    parameters: {
      type: 'object',
      required: ['customer', 'vehicle', 'serviceType', 'pickup'],
      properties: {
        callReference: { type: 'string', description: 'The Retell call id, so a retry cannot double-book.' },
        intake: {
          type: 'object',
          description:
            'The answers you got that are not fields on the job. These become the labelled block at the top of the notes that dispatch reads first.',
          properties: {
            rollsSteersBrakes: { type: 'boolean' },
            callbackPreference: { type: 'string', description: 'Anything they asked for about being contacted, e.g. call before arrival.' },
            accessNotes: { type: 'string', description: 'Garage level, space number, stairwell, gate code, which side of the building.' },
            safeLocation: { type: 'boolean', description: 'They confirmed they are safe and out of traffic.' },
            keysAvailable: { type: 'boolean' },
            lowOverheadAtPickup: {
              type: 'boolean',
              description: 'True if the vehicle is in a garage, underground, or anywhere with a low ceiling — a flatbed may not physically fit in to reach it.',
            },
          },
        },
        pickup: {
          type: 'object',
          required: ['address'],
          properties: {
            address: { type: 'string', description: 'As specific as you got. On a highway include the route, the DIRECTION of travel and the nearest exit or mile marker.' },
          },
        },
        notes: { type: 'string', description: 'What the customer said, in their words.' },
        serviceType: {
          type: 'string',
          enum: ['tow', 'jump_start', 'lockout', 'tire_change', 'fuel', 'winch', 'recovery', 'impound', 'repo', 'other'],
        },
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
            plate: { type: 'string' },
            drivetrain: { type: 'string', enum: ['2WD', '4WD', 'RWD', 'AWD', 'EV', 'Hybrid'], description: 'Only what they TOLD you. Never inferred from the model.' },
            isLowClearance: {
              type: 'boolean',
              description: 'True if the CAR ITSELF sits low to the ground and needs a flatbed — a lowered or sports car. NOT for a low garage ceiling; that is intake.lowOverheadAtPickup.',
            },
            year: { type: 'number' },
            specialInstructions: { type: 'string', description: 'Low ceiling or parking garage level, whether it rolls/steers/brakes, keys, and anything the driver needs before hooking up.' },
            isElectric: { type: 'boolean', description: 'True if they said it is electric. Usually needs a flatbed.' },
            color: { type: 'string' },
            plateState: { type: 'string', description: 'Two letters, e.g. OH' },
            vehicleClass: {
              type: 'string',
              enum: ['light_duty', 'medium_duty', 'heavy_duty', 'motorcycle', 'commercial', 'rv', 'unknown'],
              description: "Use 'unknown' rather than guessing. A wrong class sends the wrong truck.",
            },
            vin: { type: 'string', description: 'Only if they read you all 17 characters. Leave out otherwise.' },
            model: { type: 'string' },
            make: { type: 'string' },
          },
        },
        dropoff: {
          type: 'object',
          required: ['address'],
          properties: { address: { type: 'string' } },
        },
      },
    },
    speak_during_execution: true,
    speak_after_execution: true,
    execution_message_description: 'Tell them you are getting it into the system now, in a few words.',
  },
  {
    type: 'custom',
    name: 'take_dispatch_message',
    description:
      "Take a message for dispatch instead of transferring, or when you cannot otherwise resolve the call — a caller mentioning something you don't recognise (a membership, a program, a policy), a motor club rep trying to reach a specific person, or a routine status check where they would rather not hold. Never a substitute for transferring someone who is unsafe, angry, or has been waiting a long time — those still go straight through.",
    url: 'https://api.ustowaiconnect.com/v1/ai-connect/dispatch-message',
    method: 'POST',
    timeout_ms: 8000,
    headers: { 'X-Tenant-API-Key': TENANT_API_KEY, 'content-type': 'application/json' },
    parameters: {
      type: 'object',
      required: ['caller_phone', 'message'],
      properties: {
        caller_phone: {
          type: 'string',
          description:
            'The best number to call them back on. If this is a motor club, this MUST be a direct line to a real person whenever possible — never just a general switchboard, especially not an overseas call-centre number nobody there can dial back.',
        },
        message: {
          type: 'string',
          description:
            'What to tell whoever picks this up: who they want to reach if anyone specific, the reason for the call if they gave one, and anything else useful. Write it clearly for someone reading it cold, in a few sentences.',
        },
        caller_name: { type: 'string', description: "The caller's name, or their company/motor club name if that's what they gave instead." },
        job_number: { type: 'string', description: 'A job or reference number, only if they have one handy.' },
        topic: { type: 'string', description: "Short category: 'motor_club', 'status_update', 'billing', or 'other'." },
        urgency: { type: 'string', enum: ['normal', 'urgent'], description: 'urgent only if they are stranded, unsafe, or already angry.' },
        call_reference: { type: 'string', description: 'The current Retell call id, so a retry does not post the message twice.' },
      },
    },
    speak_during_execution: true,
    speak_after_execution: true,
    execution_message_description: "Tell them you're getting that written down for dispatch, in a few words.",
  },
];

/**
 * The greeting is spoken from begin_message, NOT from the OPENING section of
 * the prompt — the prompt never gets a turn before it. Editing the opening in
 * the text file alone changes nothing a caller hears, which is exactly what
 * happened on the first publish of the three-way triage. It is derived from the
 * file here so the two cannot drift apart again.
 */
function greetingFrom(prompt) {
  const m = prompt.match(/^OPENING\.[^"]*"([^"]+)"/m);
  if (!m) throw new Error('no quoted greeting found under OPENING. in the prompt file');
  return m[1];
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY = args.includes('--dry-run');

if (!KEY) {
  console.error('RETELL_API_KEY is required');
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
 * Rules that have been paid for with real calls. If an edit drops one of these
 * the publish stops, because the failure mode is not a bad call — it is telling
 * somebody who has waited all night that they are five hours late.
 */
const MUST_CONTAIN = [
  'NEVER READ THE ETA FIELD ALOUD',
  'somewhere around thirty minutes',
  'NEVER quote a price',
  'NEVER discuss insurance',
  'lookup_job_by_phone',
  'transfer_to_dispatch',
  "I'm an automated assistant",
];

/** Remove the USTD toggle markers and normalise line endings. */
function stripMarkers(raw) {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\[USTD:(BEGIN|END)\]$/.test(line.trim()))
    .join('\n')
    .trim();
}

async function main() {
  const llm = await retell(`/get-retell-llm/${LLM}`);
  const live = (llm.general_prompt || '').replace(/\r\n/g, '\n').trim();

  if (!APPLY && !DRY) {
    console.log(`# live — llm v${llm.version}, ${live.length} chars\n`);
    console.log(live);
    return;
  }

  // The [USTD:BEGIN]/[USTD:END] markers are editing scaffolding for
  // emily-ustd-enable.js. They must never reach the model: everything in the
  // prompt is a candidate for being read aloud, and every prompt leak on this
  // project started with a line nobody expected the agent to say.
  const next = stripMarkers(fs.readFileSync(FILE, 'utf8'));
  if (next.includes('[USTD:')) {
    throw new Error('a [USTD:...] marker survived stripping — refusing to publish scaffolding');
  }
  const missing = MUST_CONTAIN.filter((r) => !next.includes(r));
  if (missing.length) {
    throw new Error(`the new prompt drops rules that must survive:\n  - ${missing.join('\n  - ')}`);
  }

  // Tools are edited here in the script, not in emily-inbound.txt — a
  // tools-only change (e.g. a transfer number) must still publish even when
  // the prompt text is byte-identical to what's live.
  const toolsChanged = JSON.stringify(llm.general_tools ?? []) !== JSON.stringify(TOOLS);

  console.log(`live : llm v${llm.version}, ${live.length} chars`);
  console.log(`new  : ${path.basename(FILE)}, ${next.length} chars${toolsChanged ? ' (tools changed)' : ''}`);
  if (next === live && !toolsChanged) {
    console.log('Identical. Nothing to publish.');
    return;
  }
  if (!APPLY) {
    console.log('\n--dry-run: nothing written. Re-run with --apply.');
    return;
  }

  const greeting = greetingFrom(next);
  await retell(`/update-retell-llm/${LLM}`, 'PATCH', {
    general_prompt: next,
    begin_message: greeting,
    general_tools: TOOLS,
  });
  console.log(`  prompt + ${TOOLS.length} tools patched (draft), greeting: "${greeting.slice(0, 70)}..."`);

  await retell(`/publish-agent/${AGENT}`, 'POST', {}).catch((e) =>
    console.log(`  publish warning: ${e.message.slice(0, 140)}`),
  );
  const version = Math.max(
    ...(await retell('/list-agents'))
      .filter((a) => a.agent_id === AGENT && a.is_published)
      .map((a) => Number(a.version))
      .filter(Number.isFinite),
  );
  console.log(`  published as agent v${version}`);

  const num = await retell(`/get-phone-number/${encodeURIComponent(NUMBER)}`);
  const bound = (num.inbound_agents || []).find((a) => a.agent_id === AGENT);
  if (!bound) {
    console.log(`  WARNING: ${AGENT} is not bound inbound on ${NUMBER} — nothing you just published answers the phone.`);
    process.exitCode = 1;
  } else if (bound.agent_version === 'latest_published' || bound.agent_version == null) {
    console.log(`  ${NUMBER} inbound follows latest_published -> now v${version}`);
  } else {
    console.log(`  ${NUMBER} is PINNED to v${bound.agent_version}; re-pinning to v${version}`);
    await retell(`/update-phone-number/${encodeURIComponent(NUMBER)}`, 'PATCH', {
      inbound_agents: [{ agent_id: AGENT, agent_version: version, weight: 1 }],
      outbound_agents: num.outbound_agents,
    });
  }
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
