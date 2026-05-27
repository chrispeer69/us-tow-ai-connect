# Session 67 — Decisions

Decisions made autonomously per CLAW.md (owner unavailable until PR open).
Conservative path chosen and documented; no blocking on owner input.

1. **CNAM submission split: script does prep, operator finishes in Console.**
   Programmatic submission of the final Branded-Calls TrustProduct requires a
   `policySid` that varies by Twilio account region and account tier, and that
   Twilio's docs explicitly direct customers to select interactively. Rather
   than hardcoding a brittle SID, `register-cnam.ts` does the env validation,
   idempotent `friendlyName` update (which IS the CNAM display source for the
   dip lookup), and prints the exact SIDs the operator needs to paste into the
   Console for the final attach + submit. Documented in
   `docs/TWILIO_CALLER_ID.md`.

2. **`friendlyName` is the CNAM dip source.** Twilio publishes the
   IncomingPhoneNumber `friendlyName` (uppercased, ≤15 chars) to the major US
   CNAM databases as part of approved Trust Hub registrations. The script
   enforces the 15-char cap and uppercases the name automatically. This is
   per Twilio Help Center guidance for CNAM registration on US numbers.

3. **Scripts run via `pnpm --filter @ustow/api exec tsx ../../scripts/...`**,
   not `pnpm exec tsx scripts/...`. The `twilio` package lives in
   `packages/api/node_modules` (per workspace dep layout); root invocations
   can't resolve it. Documented the correct invocation in `TWILIO_CALLER_ID.md`,
   `A2P_10DLC.md`, and `S67_OPERATOR_TODO.md`. Owner's runbook commands were
   adjusted accordingly — paths and behavior are otherwise identical.

4. **A2P 10DLC registration is Console-only.** No SDK helper exists that
   completes the brand-vetting + campaign-attach flow end-to-end. The session
   delivers a thorough operator runbook in `docs/A2P_10DLC.md` (brand type,
   campaign type, sample messages, opt-in language, Twilio Console links and
   navigation, costs, failure modes). Not bundling a stub script for 10DLC
   would have been misleading — explicitly chose docs-only.

5. **Standard Brand, not Sole Proprietor, for 10DLC.** Sole Prop is capped at
   1,000 messages/day, which we will exceed during peak hours. Standard Brand
   requires an EIN (which the operator has). Documented as a project-level
   decision in `A2P_10DLC.md` so future tenants can default to the same.

6. **One A2P campaign, type "Customer Care".** All current outbound SMS
   (tracking links, ETA updates, flip-accept manager pings) are
   service-fulfillment messages tied to an inbound voice request — the
   textbook customer-care use case. Marketing SMS, if/when added, would need
   a separate registered campaign. Documented in `A2P_10DLC.md`.

7. **`scripts/twilio/tsconfig.json` added.** Not in the session's owned-paths
   spec explicitly, but the scripts directory is owned and the file is a
   self-contained tsconfig that points `twilio` + `@types/node` at the api
   package's `node_modules`. Lets `tsc --noEmit -p scripts/twilio` validate
   the scripts independently, matching the spec's "scripts must typecheck"
   requirement.

8. **`.env.example` updated additively only.** Appended the Session-67 block
   at the bottom; no existing entries removed or modified. All values are
   placeholder defaults (commented out) — the real values live in Railway
   and `packages/api/.env`. Per the session's "additive only — never delete
   entries" rule.

9. **No `--dry-run` flag added; `--apply` is the explicit write gate.** The
   default behavior is read-only / dry-run; passing `--apply` is the operator
   acknowledging "yes, write to Twilio." Mirrors existing conventions in
   `scripts/seed-reports.ts`. Avoids an extra footgun where `--dry-run` and
   `--apply` could both be passed.

10. **`test-outbound-call.ts` defaults to dry-run too.** Placing a real call
    costs Twilio credit and rings a real phone. Default mode prints the
    TwiML that would be played and exits. `--apply` to actually dial.

11. **No tests added.** Per session spec, scripts hit live Twilio APIs and
    are operator-validated. Mocking Twilio's REST surface would be brittle and
    cover the wrong behaviors. The scripts ARE typecheck-clean via the local
    `tsconfig.json` and the `packages/api` strict typecheck.

12. **Per-tenant CNAM strategy documented but not implemented.** Today
    `TWILIO_CNAM_REGISTERED_NAME` is a single env var. Multi-tenant rollout
    will need a per-tenant config column and one Twilio number per tenant.
    Out of scope for S67 (touches `packages/api/` modules listed in
    DO-NOT-TOUCH). Captured in `S67_OPERATOR_TODO.md` as a future task.
