/**
 * Session 68 — standalone Retell outbound smoke test.
 *
 * Hits the live Retell API with the dispatch dynamic variables. Use this
 * to verify the agent/number/llm wiring without booting the full Nest
 * app. Phone provided in --to will ring.
 *
 * Usage:
 *   pnpm exec tsx scripts/retell/smoke-outbound-call.ts \
 *     --to +16146337935 \
 *     --name "Chris Peer" \
 *     --body "Your tow truck is 5 minutes away. Driver Mike is in a black Ford F-450." \
 *     --purpose eta_confirmation
 *
 * Required env:
 *   RETELL_API_KEY, RETELL_AGENT_ID, RETELL_FROM_NUMBER
 */
import { argv, env, exit } from 'process';

function arg(name: string, fallback?: string): string {
  const idx = argv.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  if (fallback != null) return fallback;
  console.error(`missing --${name}`);
  exit(1);
}

async function main() {
  const apiKey = env.RETELL_API_KEY?.trim();
  const agentId = env.RETELL_AGENT_ID?.trim();
  const fromNumber = env.RETELL_FROM_NUMBER?.trim();
  if (!apiKey || !agentId || !fromNumber) {
    console.error('Set RETELL_API_KEY, RETELL_AGENT_ID, RETELL_FROM_NUMBER');
    exit(1);
  }

  const to = arg('to');
  const name = arg('name', 'Test Customer');
  const body = arg(
    'body',
    'This is a smoke test of US Tow AI-Connect outbound voice.',
  );
  const purpose = arg('purpose', 'eta_confirmation');
  const callId = `ustow_smoke_${Date.now()}`;

  const payload = {
    from_number: fromNumber,
    to_number: to,
    override_agent_id: agentId,
    retell_llm_dynamic_variables: {
      customer_name: name,
      outbound_body: body,
      outbound_purpose: purpose,
      us_tow_call_id: callId,
      script_template: 'smoke_test',
      script_body: body,
      tenant_id: '00000000-0000-0000-0000-000000000001',
      ustow_call_id: callId,
    },
    metadata: {
      tenant_id: '00000000-0000-0000-0000-000000000001',
      ustow_call_id: callId,
      script_template: 'smoke_test',
    },
  };

  console.log(`POST /v2/create-phone-call to=${to} agent=${agentId}`);
  const res = await fetch('https://api.retellai.com/v2/create-phone-call', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log(`status=${res.status}`);
  console.log(text);
  if (!res.ok) exit(1);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
