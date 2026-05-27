/**
 * test-outbound-call.ts — places one test call from TWILIO_OUTBOUND_NUMBER
 * to the --to number, playing a short TwiML message. Operator verifies the
 * caller-ID display on the receiving phone.
 *
 * Usage
 *   pnpm exec tsx scripts/twilio/test-outbound-call.ts --to +17408129489
 *
 * Notes
 *   - Caller-ID display is only useful to validate after CNAM has propagated
 *     across carriers (24-48 hours after register-cnam.ts --apply + Console
 *     submission). See docs/TWILIO_CALLER_ID.md.
 *   - Costs ~$0.014 for a 10-second US-to-US call.
 */
import { loadTwilioEnv, parseFlags, banner, log, fail } from './_env';

const TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">This is a test call from Roadside Towing. Please verify the caller I D shown on your phone screen. Goodbye.</Say>
  <Pause length="1"/>
  <Hangup/>
</Response>`;

function normalizeE164(input: string): string {
  const cleaned = input.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  return cleaned;
}

async function main(): Promise<void> {
  const env = loadTwilioEnv();
  const flags = parseFlags(process.argv.slice(2));

  if (!flags.to) {
    fail('Required: --to <E.164 number>. Example: --to +17408129489');
  }
  const to = normalizeE164(flags.to);

  banner('Twilio outbound test call');
  log(`Mode               : ${flags.apply ? 'APPLY' : 'DRY-RUN (pass --apply to actually place the call)'}`);
  log(`From               : ${env.outboundNumber}`);
  log(`To                 : ${to}`);
  log(`Expected CNAM      : "${env.registeredName}"`);

  if (!flags.apply) {
    banner('TwiML that would be played');
    log(TWIML);
    log('\nPass --apply to actually place the call.');
    return;
  }

  banner('Placing call');
  const call = await env.client.calls.create({
    to,
    from: env.outboundNumber,
    twiml: TWIML,
  });
  log(`Call SID           : ${call.sid}`);
  log(`Initial status     : ${call.status}`);
  log('Operator: pick up the receiving phone and confirm the caller-ID display.');
  log('         If "Unknown" or a random city name shows, CNAM has not yet propagated');
  log('         (or has not yet been approved). See docs/TWILIO_CALLER_ID.md.');
}

main().catch((err) => {
  process.stderr.write(`\ntest-outbound-call.ts failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
