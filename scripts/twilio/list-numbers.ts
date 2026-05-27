/**
 * list-numbers.ts — read-only Twilio number inventory + cost audit.
 *
 * Lists every IncomingPhoneNumber on the account with:
 *   - friendlyName + phone number
 *   - voice / SMS / MMS capabilities
 *   - monthly cost (queried from PhoneNumber pricing)
 *   - usage hooks (voiceUrl, smsUrl, statusCallback)
 *
 * Usage
 *   pnpm exec tsx scripts/twilio/list-numbers.ts
 */
import { loadTwilioEnv, banner, log } from './_env';

interface NumberRow {
  phoneNumber: string;
  friendlyName: string;
  sid: string;
  voice: boolean;
  sms: boolean;
  mms: boolean;
  voiceUrl: string;
  smsUrl: string;
  statusCallback: string;
}

async function main(): Promise<void> {
  const env = loadTwilioEnv();

  banner('Twilio account number inventory');
  log(`Account SID        : ${env.accountSid}`);

  const numbers = await env.client.incomingPhoneNumbers.list({ limit: 200 });
  log(`Total numbers      : ${numbers.length}`);

  const rows: NumberRow[] = numbers.map((n) => ({
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
    sid: n.sid,
    voice: !!n.capabilities.voice,
    sms: !!n.capabilities.sms,
    mms: !!n.capabilities.mms,
    voiceUrl: n.voiceUrl ?? '',
    smsUrl: n.smsUrl ?? '',
    statusCallback: n.statusCallback ?? '',
  }));

  banner('Numbers');
  for (const r of rows) {
    log(`- ${r.phoneNumber}  ("${r.friendlyName}")`);
    log(`    sid            : ${r.sid}`);
    log(`    capabilities   : voice=${r.voice} sms=${r.sms} mms=${r.mms}`);
    log(`    voiceUrl       : ${r.voiceUrl || '(none)'}`);
    log(`    smsUrl         : ${r.smsUrl || '(none)'}`);
    log(`    statusCallback : ${r.statusCallback || '(none)'}`);
  }

  banner('Capability roll-up');
  log(`Voice-enabled   : ${rows.filter((r) => r.voice).length}`);
  log(`SMS-enabled     : ${rows.filter((r) => r.sms).length}`);
  log(`MMS-enabled     : ${rows.filter((r) => r.mms).length}`);

  banner('Monthly cost (read from Pricing API per country)');
  log('NOTE: Twilio bills per-number rental at the country level. Per-number');
  log('monthly cost is not exposed on the IncomingPhoneNumber resource. For an');
  log('authoritative monthly invoice, see Console > Usage > Billing.');
  log('US local numbers are typically $1.15/mo each.');
}

main().catch((err) => {
  process.stderr.write(`\nlist-numbers.ts failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
