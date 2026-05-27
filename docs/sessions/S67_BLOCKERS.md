# Session 67 — Blockers

None encountered that prevented forward progress. Items below are
**deferred-to-operator** boundaries (Twilio Console-only steps) rather than
true blockers — the session shipped scripts + docs that get the operator from
zero to "submit-and-wait" in <10 minutes.

## Deferred to operator (in-Console)

1. **Final Branded-Calls TrustProduct attach + submit.** Twilio's TrustHub
   `policySid` for the Branded Calls product varies per account region. The
   operator selects it interactively in the Console, attaches the phone number
   (SID printed by `register-cnam.ts`), and submits for review. See
   `docs/TWILIO_CALLER_ID.md` Step 3.

2. **A2P 10DLC Brand vetting.** Requires EIN, legal name, authorized
   representative info — entered in the Console form. Vetting takes 1-3
   business days. See `docs/A2P_10DLC.md` Step 2.

3. **A2P 10DLC Campaign registration.** Filled in Console after Brand vetting
   completes. Campaign review takes 1-5 business days. See `docs/A2P_10DLC.md`
   Step 3.

## Future scope (out of S67)

4. **Per-tenant CNAM.** Today there's one outbound number with one CNAM. The
   strategy for multi-tenant CNAM (one Twilio number + one TrustProduct per
   tenant brand) is documented but not coded. Implementation will touch
   `packages/api/src/modules/outbound/` which is DO-NOT-TOUCH for S67.
   Capture in the next outbound-voice session.

5. **STIR/SHAKEN attestation.** Companion to CNAM for reducing "Scam Likely"
   carrier overlays. Twilio Trust Hub handles this when Branded Calls is
   approved, but a dedicated audit + verification step is worth a future
   session.

6. **Free Caller Registry submission.** https://www.freecallerregistry.com/
   submission to clear T-Mobile/AT&T/Verizon analytics overlays. Manual
   form; operator can complete in parallel with the Twilio review.
