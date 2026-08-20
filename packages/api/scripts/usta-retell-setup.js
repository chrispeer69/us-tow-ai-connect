#!/usr/bin/env node
/**
 * USTA Outreach — Retell provisioning.
 *
 * Everything this script does is a WRITE to the Retell account, which is why it
 * is a script you run rather than something already applied: buying a number
 * costs money and publishing an agent changes what live callers hear.
 *
 * Run it once, in order. Every step is idempotent and prints what it found or
 * created, so re-running after a partial failure is safe.
 *
 *   cd packages/api
 *   RETELL_API_KEY=... DB_URL=... node scripts/usta-retell-setup.js --dry-run
 *   RETELL_API_KEY=... DB_URL=... node scripts/usta-retell-setup.js --buy-number
 *   RETELL_API_KEY=... DB_URL=... node scripts/usta-retell-setup.js --apply
 *
 * Get the values from Railway:
 *   RETELL_API_KEY: railway variables --service '@ustow/api' --kv | grep RETELL_API_KEY
 *   DB_URL:         railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL
 *
 * Steps:
 *   1  --buy-number : purchase a 614 number and nickname it USTA-Outreach
 *   2  --apply      : patch the outbound agent (post-call schema + webhook),
 *                     create the inbound agent, publish both, bind the number,
 *                     and write the ids back onto the campaign row.
 */

const { Client } = require('pg');

const API = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com';
const KEY = process.env.RETELL_API_KEY;
const DB_URL = process.env.DB_URL;

const OUTBOUND_AGENT_ID = 'agent_0e40fadbd07e21659e3e06026b';
const CAMPAIGN_SLUG = 'usta';
const WEBHOOK_URL =
  process.env.USTA_WEBHOOK_URL || 'https://api.ustowaiconnect.com/webhooks/retell/campaign/result';
const AREA_CODE = Number(process.env.USTA_AREA_CODE || 614);

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run') || args.length === 0;
const BUY = args.includes('--buy-number');
const APPLY = args.includes('--apply');

if (!KEY) {
  console.error('RETELL_API_KEY is required');
  process.exit(2);
}

async function retell(path, method = 'GET', body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------------------
// The post-call schema. Every field here is read by campaign-disposition.ts —
// adding a field the code does not read, or renaming one it does, silently
// breaks auto-disposition. Keep the two in step.
// ---------------------------------------------------------------------------
const POST_CALL_FIELDS = [
  {
    name: 'pitch_delivered',
    description:
      'TRUE only if a human heard the actual offer — that a free profile is waiting for their company at USTowAlliance.com. FALSE if the call reached voicemail, an IVR, a gatekeeper who was never pitched, or ended before Ray got the offer out. The greeting alone is not the pitch.',
    type: 'boolean',
  },
  {
    name: 'reached_voicemail',
    description: 'TRUE if the call reached an answering machine or voicemail greeting rather than a live person.',
    type: 'boolean',
  },
  {
    name: 'reached_gatekeeper',
    description:
      'TRUE if the person who answered was a receptionist, dispatcher or employee who is NOT the owner or a decision maker. Ray is instructed not to pitch these people — he asks when to catch the owner and ends the call. A gatekeeper call is a correctly-handled call, not a failed one.',
    type: 'boolean',
  },
  {
    name: 'callback_time',
    description:
      "If a gatekeeper gave a best time to reach the owner, record it in their own words, e.g. 'after 4pm', 'mornings', 'Tuesday'. Empty string if none was given.",
    type: 'string',
  },
  {
    name: 'will_claim_profile',
    description:
      "TRUE only if the person said something indicating they intend to go to the site — 'I'll check it out', 'what's the address again', 'let me write that down'. A neutral 'okay' or 'uh huh' is NOT intent.",
    type: 'boolean',
  },
  {
    name: 'opted_out',
    description:
      "TRUE if the person asked not to be called again in any form — 'do not call', 'take me off your list', 'stop calling', 'remove my number'. This is NOT the same as 'not interested'. Only TRUE when they asked to stop being contacted.",
    type: 'boolean',
  },
  {
    name: 'not_interested',
    description:
      "TRUE if the person declined the offer but did NOT ask to be removed from the list. 'Not interested', 'no thanks', \"we're all set\".",
    type: 'boolean',
  },
  {
    name: 'asked_if_ai',
    description:
      'TRUE if the person asked whether they were speaking to a real person or an AI. Tracked so we can verify Ray answered honestly every time.',
    type: 'boolean',
  },
  {
    name: 'company_name_heard',
    description: 'The company name the person gave or confirmed for their business. Empty string if never stated.',
    type: 'string',
  },
  {
    name: 'contact_name',
    description: 'The name of the person who spoke, if given. Empty string if never stated.',
    type: 'string',
  },
  {
    name: 'wrong_number',
    description: 'TRUE if this is not a towing company at all, or the number does not belong to the business we expected.',
    type: 'boolean',
  },
  {
    name: 'objection_raised',
    description:
      "The main objection or question raised, in a few words: 'cost', 'who are you', 'busy', 'already listed', 'thinks it is a scam', or empty string.",
    type: 'string',
  },
];

// ---------------------------------------------------------------------------
// The inbound agent. A SEPARATE agent from the outbound one because
// max_call_duration_ms is agent-level in Retell and the spec wants 60s out /
// 90s in. Retell binds inbound_agents and outbound_agents separately on a
// number, so both directions still live on one line — the same arrangement the
// Roadside 844 number already uses.
// ---------------------------------------------------------------------------
const INBOUND_PROMPT = `You are Ray, answering the phone for the US Tow Alliance. This is an INBOUND call: they dialled us.

## OPENING — your first words, and nothing else

"US Tow Alliance, this is Ray — how can I help?"

Never say "this is Ray CALLING from". They called you.

## WHO IS ON THIS LINE

Almost everyone here is returning a missed call from us about their free profile. A few are checking whether we are legitimate. A few want off the list. Work out which from what they say — do not assume, and do not launch into a pitch.

## IF THEY ASK "WHO CALLED ME" OR "WHAT IS THIS"

Answer plainly, in two sentences:
"That was us — the US Tow Alliance. Your company has a free profile waiting at USTowAlliance.com, no cost, and I can point you straight to it."

Then stop and let them respond. Do not keep selling.

## IF THEY WANT THE PROFILE

"Just go to USTowAlliance.com and accept your free profile. That's U-S Tow Alliance dot com."

Say the site slowly. Offer to spell it if they hesitate.

## IF THEY ASK WHAT IT COSTS

"The profile is free. Zero dollars."

## IF THEY ASK WHETHER YOU ARE A REAL PERSON

Tell the truth immediately, without hedging: "I'm an AI assistant." Then carry on and answer their question. Never deny it, never dodge it, never change the subject.

## IF THEY WANT OFF THE LIST — this overrides everything else

The moment they ask to be removed, stop. Do not pitch, do not ask why, do not try to keep them.

Say exactly: "Understood — I'll take you off the list right now. Sorry to bother you." Then end the call.

## CAPTURE, WITHOUT INTERROGATING

Over the course of the call, try to get: their company name, their name, and the best callback number. Ask for at most ONE of these at a time and never more than twice in a call. If they will not give it, let it go — the call matters more than the field.

## THINGS YOU MAY NEVER SAY

- Never quote a price for anything.
- Never promise a revenue number, a percentage, a saving, or a result.
- Never say or imply you are affiliated with their current network, motor club, or association.
- Never claim they already owe anything or already have an account beyond the free profile waiting for them.
- Never say anything you cannot point at on USTowAlliance.com.

## LENGTH

Keep it under ninety seconds. Answer what they asked, point at the site, and let them go. Never more than three sentences in one turn.`;

const INBOUND_POST_CALL_FIELDS = [
  {
    name: 'caller_intent',
    description:
      "Why they rang: 'returning_missed_call', 'claim_profile', 'question', 'remove_me', 'wrong_number', or 'other'.",
    type: 'enum',
    choices: ['returning_missed_call', 'claim_profile', 'question', 'remove_me', 'wrong_number', 'other'],
  },
  {
    name: 'opted_out',
    description: 'TRUE if the caller asked to be removed from the calling list.',
    type: 'boolean',
  },
  {
    name: 'company_name_heard',
    description: 'The company name the caller gave. Empty string if never stated.',
    type: 'string',
  },
  { name: 'contact_name', description: 'The caller name, if given. Empty string otherwise.', type: 'string' },
  {
    name: 'callback_number',
    description: 'A callback number the caller gave, digits only. Empty string if none.',
    type: 'string',
  },
  {
    name: 'will_claim_profile',
    description: 'TRUE if the caller said they would go to USTowAlliance.com and claim the profile.',
    type: 'boolean',
  },
  {
    name: 'asked_if_ai',
    description: 'TRUE if the caller asked whether they were speaking to a real person.',
    type: 'boolean',
  },
];

async function main() {
  console.log(`\n=== USTA Retell setup (${DRY ? 'DRY RUN' : BUY ? 'BUY NUMBER' : 'APPLY'}) ===\n`);

  // ---- Inspect current state ---------------------------------------------
  const outbound = await retell(`/get-agent/${OUTBOUND_AGENT_ID}`);
  console.log('Outbound agent:');
  console.table([
    {
      agent_id: outbound.agent_id,
      name: outbound.agent_name,
      version: outbound.version,
      published: outbound.is_published,
      max_ms: outbound.max_call_duration_ms,
      webhook: outbound.webhook_url || '(none)',
      analysis_fields: (outbound.post_call_analysis_data || []).length,
    },
  ]);

  const numbers = await retell('/list-phone-numbers');
  const existing = numbers.find((n) => n.nickname === 'USTA-Outreach');
  console.log('\nUSTA number:', existing ? existing.phone_number : '(not purchased yet)');

  if (DRY) {
    console.log('\nWould apply:');
    console.log(`  - ${POST_CALL_FIELDS.length} post-call analysis fields to the outbound agent`);
    console.log(`  - webhook_url = ${WEBHOOK_URL}`);
    console.log('  - publish the outbound agent');
    console.log('  - create USTA-Inbound-v1 (90s cap) and publish it');
    console.log(`  - buy a ${AREA_CODE} number (only with --buy-number)`);
    console.log('  - bind outbound + inbound agents to that number');
    console.log('  - write agent ids, versions and from_number onto the campaign row');
    console.log('\nRe-run with --buy-number then --apply.\n');
    return;
  }

  // ---- Step 1: buy the number --------------------------------------------
  let number = existing;
  if (BUY) {
    if (number) {
      console.log(`\nNumber already purchased (${number.phone_number}) — skipping.`);
    } else {
      console.log(`\nBuying a ${AREA_CODE} number...`);
      number = await retell('/create-phone-number', 'POST', {
        area_code: AREA_CODE,
        nickname: 'USTA-Outreach',
      });
      console.log(`  bought ${number.phone_number}`);
    }
    console.log('\nNow run again with --apply.\n');
    return;
  }

  if (!APPLY) return;

  // ---- Step 2: outbound agent --------------------------------------------
  console.log('\nPatching the outbound agent...');
  await retell(`/update-agent/${OUTBOUND_AGENT_ID}`, 'PATCH', {
    post_call_analysis_data: POST_CALL_FIELDS,
    post_call_analysis_model: 'gpt-4.1',
    webhook_url: WEBHOOK_URL,
    max_call_duration_ms: 60000,
  });

  const publishedOutbound = await retell(`/publish-agent/${OUTBOUND_AGENT_ID}`, 'POST', {}).catch(
    async (err) => {
      console.log(`  publish-agent failed (${err.message.slice(0, 120)}), reading current version`);
      return retell(`/get-agent/${OUTBOUND_AGENT_ID}`);
    },
  );
  const outboundVersion = publishedOutbound.version ?? outbound.version;
  console.log(`  outbound agent published at version ${outboundVersion}`);

  // ---- Step 3: inbound agent ---------------------------------------------
  const agents = await retell('/list-agents');
  let inbound = agents.find((a) => a.agent_name === 'USTA-Inbound-v1');

  if (!inbound) {
    console.log('\nCreating the inbound LLM + agent...');
    const llm = await retell('/create-retell-llm', 'POST', {
      model: 'gpt-4.1',
      general_prompt: INBOUND_PROMPT,
      begin_message: 'US Tow Alliance, this is Ray — how can I help?',
      general_tools: [{ type: 'end_call', name: 'end_call', description: 'End the call politely.' }],
    });
    inbound = await retell('/create-agent', 'POST', {
      agent_name: 'USTA-Inbound-v1',
      response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
      voice_id: '11labs-Adrian', // same voice as outbound: it is the same Ray
      language: 'en-US',
      // 90s, per spec §4. This is the whole reason inbound is a separate agent.
      max_call_duration_ms: 90000,
      webhook_url: WEBHOOK_URL,
      post_call_analysis_model: 'gpt-4.1',
      post_call_analysis_data: INBOUND_POST_CALL_FIELDS,
      enable_backchannel: false,
    });
    console.log(`  created ${inbound.agent_id}`);
  } else {
    console.log(`\nInbound agent exists: ${inbound.agent_id} — patching`);
    await retell(`/update-agent/${inbound.agent_id}`, 'PATCH', {
      webhook_url: WEBHOOK_URL,
      max_call_duration_ms: 90000,
      post_call_analysis_data: INBOUND_POST_CALL_FIELDS,
    });
  }

  const publishedInbound = await retell(`/publish-agent/${inbound.agent_id}`, 'POST', {}).catch(() =>
    retell(`/get-agent/${inbound.agent_id}`),
  );
  const inboundVersion = publishedInbound.version ?? inbound.version;
  console.log(`  inbound agent published at version ${inboundVersion}`);

  // ---- Step 4: bind the number -------------------------------------------
  if (!number) {
    console.log('\nNo USTA number yet — run with --buy-number first, then --apply again.');
    console.log('Agents are configured; the campaign will refuse to dial until a number is bound.\n');
  } else {
    console.log(`\nBinding agents to ${number.phone_number}...`);
    await retell(`/update-phone-number/${encodeURIComponent(number.phone_number)}`, 'PATCH', {
      inbound_agent_id: inbound.agent_id,
      outbound_agent_id: OUTBOUND_AGENT_ID,
      nickname: 'USTA-Outreach',
    });
    console.log('  bound');
  }

  // ---- Step 5: write back onto the campaign row --------------------------
  if (!DB_URL) {
    console.log('\nDB_URL not set — skipping the campaign row update. Set it and re-run --apply.');
  } else {
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const res = await c.query(
      `update campaigns
          set outbound_agent_id = $1,
              outbound_agent_version = $2,
              inbound_agent_id = $3,
              inbound_agent_version = $4,
              from_number = coalesce($5, from_number),
              updated_at = now()
        where slug = $6
        returning id, name, status, from_number, outbound_agent_id, outbound_agent_version,
                  inbound_agent_id, inbound_agent_version`,
      [
        OUTBOUND_AGENT_ID,
        String(outboundVersion),
        inbound.agent_id,
        String(inboundVersion),
        number ? number.phone_number : null,
        CAMPAIGN_SLUG,
      ],
    );
    console.log('\nCampaign row:');
    console.table(res.rows);
    await c.end();
  }

  console.log('\nDone. The campaign is still status=OFF — nothing will dial.');
  console.log('Next: import a list, run a dry run, place one test call, then set status=ACTIVE.\n');
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
