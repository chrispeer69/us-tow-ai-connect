/**
 * check-caller-id-status.ts — read-only CNAM status audit.
 *
 * Prints, for TWILIO_OUTBOUND_NUMBER and every other number on the account:
 *   - friendlyName (what carriers will display via CNAM dip)
 *   - voiceCallerIdLookup (whether we PAY for inbound CNAM lookups, $0.01/call)
 *   - voice/SMS/MMS capabilities
 *   - associated TrustHub CustomerProfile statuses
 *   - associated TrustHub TrustProduct statuses (Branded Calls / CNAM review)
 *
 * Usage
 *   pnpm exec tsx scripts/twilio/check-caller-id-status.ts
 */
import { loadTwilioEnv, banner, log } from './_env';

async function main(): Promise<void> {
  const env = loadTwilioEnv();

  banner('Twilio caller-ID status audit');
  log(`Account SID        : ${env.accountSid}`);
  log(`Outbound number    : ${env.outboundNumber}`);
  log(`Expected CNAM      : "${env.registeredName}"`);

  banner('All phone numbers on this account');
  const numbers = await env.client.incomingPhoneNumbers.list({ limit: 100 });
  if (numbers.length === 0) {
    log('(none)');
  } else {
    for (const n of numbers) {
      const isOutbound = n.phoneNumber === env.outboundNumber ? ' <-- OUTBOUND' : '';
      log(`- ${n.phoneNumber}${isOutbound}`);
      log(`    sid               : ${n.sid}`);
      log(`    friendlyName      : "${n.friendlyName}"`);
      log(`    capabilities      : voice=${n.capabilities.voice} sms=${n.capabilities.sms} mms=${n.capabilities.mms}`);
      log(`    voiceCallerIdLookup (inbound CNAM dip, billed): ${n.voiceCallerIdLookup}`);
      log(`    statusCallback    : ${n.statusCallback || '(none)'}`);
      log(`    voiceUrl          : ${n.voiceUrl || '(none)'}`);
      log(`    smsUrl            : ${n.smsUrl || '(none)'}`);
    }
  }

  banner('TrustHub CustomerProfiles (brand identity)');
  const profiles = await env.client.trusthub.v1.customerProfiles.list({ limit: 50 });
  if (profiles.length === 0) {
    log('(none — operator must create a primary CustomerProfile in the Console)');
  } else {
    for (const p of profiles) {
      log(`- ${p.sid}  status=${p.status}  friendlyName="${p.friendlyName}"  created=${p.dateCreated?.toISOString() ?? '-'}`);
    }
  }

  banner('TrustHub TrustProducts (Branded Calls / CNAM / 10DLC)');
  const products = await env.client.trusthub.v1.trustProducts.list({ limit: 50 });
  if (products.length === 0) {
    log('(none — no CNAM or 10DLC TrustProducts submitted yet)');
  } else {
    for (const tp of products) {
      log(`- ${tp.sid}  status=${tp.status}`);
      log(`    friendlyName     : "${tp.friendlyName}"`);
      log(`    policySid        : ${tp.policySid}`);
      log(`    created          : ${tp.dateCreated?.toISOString() ?? '-'}`);
      log(`    updated          : ${tp.dateUpdated?.toISOString() ?? '-'}`);
    }
  }

  banner('Summary');
  const outboundEntry = numbers.find((n) => n.phoneNumber === env.outboundNumber);
  if (!outboundEntry) {
    log(`WARN: outbound number ${env.outboundNumber} not found on this account.`);
  } else if (outboundEntry.friendlyName.toUpperCase() !== env.registeredName.toUpperCase()) {
    log(`WARN: outbound number friendlyName "${outboundEntry.friendlyName}" does not match expected "${env.registeredName}".`);
    log('      Run: pnpm exec tsx scripts/twilio/register-cnam.ts --apply');
  } else {
    log(`OK: outbound number friendlyName matches "${env.registeredName}".`);
    log('Carrier CNAM-dip propagation can still take 24-48 hours after any change.');
  }
}

main().catch((err) => {
  process.stderr.write(`\ncheck-caller-id-status.ts failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
