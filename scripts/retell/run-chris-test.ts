import { env } from 'process';
import { renderCallBody, ScriptContext } from '../../packages/api/src/modules/flip-engine/flip-scripts';

async function main() {
  const apiKey = env.RETELL_API_KEY?.trim();
  const agentId = env.RETELL_AGENT_ID?.trim();
  const fromNumber = env.RETELL_FROM_NUMBER?.trim();
  if (!apiKey || !agentId || !fromNumber) {
    throw new Error('Missing Retell env vars');
  }

  const toPhone = '+16146337935';
  
  // Fake context exactly like Chris's test endpoint
  const ctx: ScriptContext = {
    repName: 'Ethan',
    companyName: 'Roadside Towing',
    motorClub: 'Test Motor Club',
    callbackNumber: '+18447011345',
    conviniLink: 'https://convini.live',
    customerFirstName: 'Chris',
    vehicle: '2019 Honda Civic',
    pickupLocation: '123 Main Street',
    destination: 'Downtown Auto Care',
    issue: 'a flat tire',
    issueSubcategory: null,
    nearestShop: 'Downtown Auto Care',
    nearestShopDistanceMiles: 3,
    bodyShop1: null,
    bodyShop2: null,
    rentalsAvailable: true,
  };

  const fullBody = renderCallBody('competitor_repair', ctx);
  console.log('\n=== GENERATED SCRIPT BODY ===\n');
  console.log(fullBody);
  console.log('\n==============================\n');
  const callId = `test_call_${Date.now()}`;

  const payload = {
    from_number: fromNumber,
    to_number: toPhone,
    override_agent_id: agentId,
    retell_llm_dynamic_variables: {
      script_body: fullBody,
      script_template: 'custom',
      customer_name: 'Chris',
      outbound_purpose: 'custom',
      tenant_id: 'test-tenant',
      us_tow_call_id: callId,
      ustow_call_id: callId,
    },
    metadata: {
      tenant_id: 'test-tenant',
      ustow_call_id: callId,
      script_template: 'custom',
    },
  };

  console.log(`Making real call to ${toPhone}...`);
  
  const res = await fetch('https://api.retellai.com/v2/create-phone-call', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(`Response: ${text}`);
}

main().catch(console.error);
