# Session 67 — Operator TODO

Order-of-operations for completing Twilio CNAM caller-ID + A2P 10DLC compliance.
**Estimated operator hands-on time: ~30 minutes spread over 4-7 calendar days
(most time is Twilio review windows).**

Prerequisites:
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` set in `packages/api/.env` (or
  exported in the shell).
- EIN, legal company name, authorized representative info ready (for 10DLC).
- Access to a phone on T-Mobile, AT&T, and Verizon for verification.

---

## Phase 1 — Caller-ID Name (CNAM) registration

### 1.1 Audit current state (read-only)

```bash
pnpm --filter @ustow/api exec tsx ../../scripts/twilio/check-caller-id-status.ts
```

Confirms `+18783563281` is on the account and prints its current
`friendlyName`, existing TrustHub CustomerProfiles, and existing TrustProducts.

### 1.2 List all numbers + their hooks (read-only)

```bash
pnpm --filter @ustow/api exec tsx ../../scripts/twilio/list-numbers.ts
```

Full inventory audit. Run any time you want to see what Twilio numbers exist
and how they're wired up.

### 1.3 Apply CNAM friendlyName

```bash
# Dry-run (default) — shows what WOULD change
pnpm --filter @ustow/api exec tsx ../../scripts/twilio/register-cnam.ts

# Apply
pnpm --filter @ustow/api exec tsx ../../scripts/twilio/register-cnam.ts \
  --apply --name "ROADSIDE TOWING"
```

Updates `+18783563281`'s `friendlyName` to `ROADSIDE TOWING` (idempotent —
safe to re-run). Prints the SIDs needed for the next step.

### 1.4 Finish in the Twilio Console

> **Twilio Console → Trust Hub → Branded Calls (or "Caller Name")**

- If no primary CustomerProfile exists, create one (legal entity info).
- Create a Branded Calls TrustProduct, attach the phone-number SID printed by
  step 1.3, set the display name to **`ROADSIDE TOWING`**, submit.

**Review window: 24-48 hours.**

### 1.5 Wait

After Twilio approves: **24-48 more hours** for the major US carrier CNAM
databases to refresh.

### 1.6 Verify with a live call

```bash
pnpm --filter @ustow/api exec tsx ../../scripts/twilio/test-outbound-call.ts \
  --to +17408129489 --apply
```

Receiving phone should display **ROADSIDE TOWING** (not "Unknown" or a random
city). Repeat against personal cells on T-Mobile, AT&T, and Verizon.

Expect ~80% honor rate — that's the carrier average and is fine.

---

## Phase 2 — A2P 10DLC SMS compliance

Run in parallel with Phase 1 (no dependency between them).

### 2.1 Register the Brand

> **Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC → Brands → Register a Brand**

Direct link: https://console.twilio.com/us1/develop/sms/regulatory-compliance/brands

- Brand type: **Standard Brand** (not Sole Proprietor).
- Fill in legal name, EIN, address, authorized rep, vertical = **TRANSPORTATION**.
- Submit. Vetting: **1-3 business days**.

Cost: **$4/mo** + optional **$40** one-time secondary vetting.

### 2.2 Register the Campaign

> **Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC → Campaigns → Create a new Campaign**

Direct link: https://console.twilio.com/us1/develop/sms/regulatory-compliance/campaigns

- Campaign type: **Customer Care**.
- Use the sample messages + opt-in language from `docs/A2P_10DLC.md`.
- Attach the Messaging Service that includes `+18783563281`.
- Submit. Review: **1-5 business days**.

Cost: **$10/mo**.

### 2.3 Verify SMS delivery to T-Mobile

After campaign is `VERIFIED`:

- Trigger a real tracking-link SMS via the app to a T-Mobile number.
- Confirm `sms_messages` row reaches `delivered`.
- T-Mobile is the strictest filter; a clean delivery confirms registration.

---

## Phase 3 — Optional follow-ups

### 3.1 Free Caller Registry

https://www.freecallerregistry.com/ — one form covers T-Mobile, AT&T, and
Verizon analytics overlays ("Scam Likely", "Spam Risk"). Submit after CNAM is
approved. Updates roll out in 5-7 business days.

### 3.2 Per-tenant CNAM (future)

When onboarding additional tenant brands, each tenant needs:
- Its own Twilio outbound number.
- Its own CNAM (≤15 chars).
- Its own Branded-Calls TrustProduct (one CustomerProfile per legal entity,
  one TrustProduct per brand).

Implementation is out of scope for S67 — touches
`packages/api/src/modules/outbound/` which is DO-NOT-TOUCH this session.

---

## Reference

- `docs/TWILIO_CALLER_ID.md` — full CNAM doc (theory + runbook + troubleshooting).
- `docs/A2P_10DLC.md` — full 10DLC doc.
- `scripts/twilio/_env.ts` — shared env loader.
- `scripts/twilio/register-cnam.ts` — CNAM friendlyName updater.
- `scripts/twilio/check-caller-id-status.ts` — read-only audit.
- `scripts/twilio/list-numbers.ts` — full number inventory.
- `scripts/twilio/test-outbound-call.ts` — places a live test call.
- `docs/sessions/S67_DECISIONS.md` — decisions log.
- `docs/sessions/S67_BLOCKERS.md` — deferred-to-operator items.
