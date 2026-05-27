/**
 * register-cnam.ts — Twilio outbound caller-ID-name (CNAM) registration helper.
 *
 * What it does
 *   1. Validates env (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_OUTBOUND_NUMBER).
 *   2. Looks up the outbound phone-number resource and prints its current
 *      friendlyName + the cached carrier callerName (read-only inspection).
 *   3. Lists existing TrustHub primary CustomerProfiles + TrustProducts on the
 *      account so the operator can see what is already registered.
 *   4. In `--apply` mode, idempotently updates the IncomingPhoneNumber's
 *      friendlyName to the requested CNAM. Twilio uses friendlyName as the
 *      display name for CNAM-dip lookups by carriers that honor it.
 *   5. Prints the next manual step (Branded Calls / TrustHub review submission
 *      in the Twilio Console) since the final review-submission requires a
 *      policySid that varies per account region and is selected in-console.
 *      Operator runbook is in docs/TWILIO_CALLER_ID.md.
 *
 * Usage
 *   pnpm exec tsx scripts/twilio/register-cnam.ts                       # dry-run
 *   pnpm exec tsx scripts/twilio/register-cnam.ts --apply               # use default name
 *   pnpm exec tsx scripts/twilio/register-cnam.ts --apply --name "ROADSIDE TOWING"
 *
 * Notes
 *   - CNAM propagation across US carriers takes 24-48 hours after the carrier
 *     refreshes its CNAM-dip cache. Verify by calling your own cell.
 *   - Carrier honor rate for CNAM is ~80% (T-Mobile and AT&T honor, Verizon
 *     uses its own database for many lines). See docs/TWILIO_CALLER_ID.md.
 */
import { loadTwilioEnv, parseFlags, banner, log, fail } from './_env';

const MAX_CNAM_LEN = 15; // legacy CNAM databases truncate at 15 chars.

async function main(): Promise<void> {
  const env = loadTwilioEnv();
  const flags = parseFlags(process.argv.slice(2));
  const name = (flags.name ?? env.registeredName).toUpperCase();

  if (name.length > MAX_CNAM_LEN) {
    fail(
      `CNAM name "${name}" is ${name.length} chars — legacy CNAM databases truncate at ${MAX_CNAM_LEN}. ` +
        `Choose a shorter brand string.`,
    );
  }

  banner('Twilio CNAM registration helper');
  log(`Mode               : ${flags.apply ? 'APPLY' : 'DRY-RUN (pass --apply to write)'}`);
  log(`Account SID        : ${env.accountSid}`);
  log(`Outbound number    : ${env.outboundNumber}`);
  log(`Requested CNAM     : "${name}"  (${name.length}/${MAX_CNAM_LEN} chars)`);

  banner('Step 1 — Look up outbound number');
  const numbers = await env.client.incomingPhoneNumbers.list({
    phoneNumber: env.outboundNumber,
    limit: 5,
  });
  if (numbers.length === 0) {
    fail(
      `Outbound number ${env.outboundNumber} not found on this Twilio account. ` +
        `Confirm TWILIO_ACCOUNT_SID matches the account that owns the number.`,
    );
  }
  const number = numbers[0];
  log(`Phone-number SID   : ${number.sid}`);
  log(`friendlyName       : "${number.friendlyName}"`);
  log(`Voice URL          : ${number.voiceUrl || '(none)'}`);
  log(`Capabilities       : voice=${number.capabilities.voice} sms=${number.capabilities.sms} mms=${number.capabilities.mms}`);

  banner('Step 2 — Existing TrustHub CustomerProfiles');
  const profiles = await env.client.trusthub.v1.customerProfiles.list({ limit: 20 });
  if (profiles.length === 0) {
    log('(none — primary customer profile must be created in the Twilio Console first)');
  } else {
    for (const p of profiles) {
      log(`- ${p.sid}  status=${p.status}  friendlyName="${p.friendlyName}"`);
    }
  }

  banner('Step 3 — Existing TrustHub TrustProducts');
  const products = await env.client.trusthub.v1.trustProducts.list({ limit: 20 });
  if (products.length === 0) {
    log('(none — no Branded Calls / CNAM trust products registered yet)');
  } else {
    for (const tp of products) {
      log(`- ${tp.sid}  status=${tp.status}  friendlyName="${tp.friendlyName}"  policySid=${tp.policySid}`);
    }
  }

  banner('Step 4 — Update friendlyName (CNAM dip source)');
  if (number.friendlyName.toUpperCase() === name) {
    log(`friendlyName already matches "${name}" — no-op (idempotent).`);
  } else if (!flags.apply) {
    log(`WOULD update friendlyName "${number.friendlyName}" -> "${name}". Pass --apply to write.`);
  } else {
    const updated = await env.client.incomingPhoneNumbers(number.sid).update({ friendlyName: name });
    log(`Updated friendlyName to "${updated.friendlyName}" (SID ${updated.sid}).`);
  }

  banner('Next manual step (Twilio Console)');
  log('Programmatic CNAM submission requires a TrustHub policy SID that varies by');
  log('account region and is chosen interactively in the Console. To complete:');
  log('  1. Console > Trust Hub > Branded Calls (or "Caller Name" product).');
  log('  2. Select the primary CustomerProfile listed above.');
  log(`  3. Attach phone-number SID ${number.sid} to the new TrustProduct.`);
  log(`  4. Set the CNAM display name to "${name}" and submit for review.`);
  log('  5. Review window is 24-48 hours. After approval, propagation across');
  log('     US carriers also takes 24-48 hours.');
  log('Operator runbook: docs/TWILIO_CALLER_ID.md');
}

main().catch((err) => {
  process.stderr.write(`\nregister-cnam.ts failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
