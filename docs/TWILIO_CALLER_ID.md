# Twilio Caller-ID Name (CNAM) registration

Outbound calls from `TWILIO_OUTBOUND_NUMBER` (+1 878-356-3281) should display
**"ROADSIDE TOWING"** (or the per-tenant brand) on the receiving phone instead
of "Unknown", a random city, or a Twilio spam-tagged label. This is CNAM —
Caller ID Name.

This doc explains the model, the operator runbook, the propagation window, and
the per-tenant strategy as we grow into multi-brand multi-tenant.

---

## What CNAM is

CNAM is a label stored in carrier-operated databases that maps an E.164 phone
number to a 15-character display name. When a US mobile or landline receives an
inbound call, the **terminating** carrier (the recipient's carrier — not ours)
performs a "CNAM dip" against one of those databases to resolve the display
name.

Important consequences:

- We don't push CNAM to every phone in real time. We register **once** with
  Twilio; Twilio publishes to the major CNAM databases; carriers dip those
  databases on inbound.
- **15 characters max.** Legacy databases truncate at 15. The
  `register-cnam.ts` script enforces this.
- Some carriers honor CNAM-dip results, some use their own internal database,
  and some don't dip at all. Real-world honor rate is **~80%**.

### Carrier behavior (US)

| Carrier            | CNAM-dip honored? | Notes                                              |
|--------------------|-------------------|----------------------------------------------------|
| T-Mobile           | Yes               | Reliable, fast propagation after Twilio approval.  |
| AT&T               | Yes               | Reliable. May also overlay STIR/SHAKEN attestation.|
| Verizon (mobile)   | Partial           | Uses its own database for many lines; CNAM-dip is fallback. |
| Verizon (landline) | Yes               | Standard CNAM behavior.                            |
| US Cellular        | Yes               | Standard.                                          |
| MVNOs              | Mixed             | Depends on host network.                           |

Bottom line: register CNAM, accept that ~20% of receivers may still see
generic city/state labels, and don't let perfect be the enemy of "Roadside
Towing shows up on 4 out of 5 calls."

---

## Why it matters

- **Answer rate.** Spam-labeled or "Unknown" calls are answered ~25% of the
  time. Branded calls are answered 55-70%.
- **Trust.** Customers in distress (stranded by the roadside) need to recognize
  the inbound caller as their dispatcher, not screen it as spam.
- **Spam mitigation.** Combined with STIR/SHAKEN attestation (handled
  separately by Twilio), CNAM registration is the single largest lever against
  carrier-imposed "Scam Likely" / "Spam Risk" overlays.

---

## Operator runbook

### Prerequisites

- `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` set in `packages/api/.env` (or
  shell). Production values are in Railway.
- `TWILIO_OUTBOUND_NUMBER` defaults to `+18783563281` (the outbound voice
  number). Override via `.env` if needed.
- `TWILIO_CNAM_REGISTERED_NAME` defaults to `ROADSIDE TOWING`. Override per
  brand.

### Step 1 — Inspect current state (read-only)

```bash
pnpm --filter @ustow/api exec tsx ../../scripts/twilio/check-caller-id-status.ts
```

This lists every Twilio number on the account, current `friendlyName`,
capabilities, and existing TrustHub CustomerProfiles + TrustProducts.

### Step 2 — Update `friendlyName` to the CNAM display string

```bash
# Dry-run first (the default — shows what WOULD change)
pnpm --filter @ustow/api exec tsx ../../scripts/twilio/register-cnam.ts

# Apply
pnpm --filter @ustow/api exec tsx ../../scripts/twilio/register-cnam.ts \
  --apply --name "ROADSIDE TOWING"
```

The script is idempotent — re-running with the same name is a no-op.

### Step 3 — Submit for review in the Twilio Console

Programmatic submission of the **final** CNAM/Branded-Calls trust product
requires a `policySid` that varies per account region and is selected
interactively in the Console. The script prints the exact SIDs you need; the
operator finishes in the browser:

1. Twilio Console → **Trust Hub** → **Branded Calls** (or **Caller Name**).
2. Select the primary CustomerProfile (the script printed its SID).
3. Attach the phone-number SID for `+18783563281` (the script printed it).
4. Set the display name to **`ROADSIDE TOWING`** (must match step 2).
5. Submit. Review window: **24-48 hours**.

> **Decision (S67):** We did not hardcode the Trust Hub policy SID in the
> script because Twilio rotates them by region and account tier. Doing the
> final attach + submit in the Console is one click for the operator and
> avoids a brittle script. The script does the heavy lifting (env validation,
> idempotent `friendlyName` update, SID discovery).

### Step 4 — Wait

CNAM propagation across US carrier databases takes **24-48 hours** after
Twilio approves the submission. Total elapsed time from registration to
"works everywhere it's going to work" is typically **48-96 hours**.

### Step 5 — Verify with a test call

```bash
pnpm --filter @ustow/api exec tsx ../../scripts/twilio/test-outbound-call.ts \
  --to +17408129489 --apply
```

This places a real call from `+18783563281` to the human-transfer number
(`+1 740-812-9489`). The operator picks up and confirms the display reads
"ROADSIDE TOWING".

Repeat against a personal cell on each major US carrier (T-Mobile, AT&T,
Verizon) to validate honor rate.

---

## Troubleshooting

### Display shows "Unknown"

- Most likely: CNAM hasn't propagated yet. Wait 48 hours from approval, retry.
- Less likely: the terminating carrier doesn't dip CNAM at all (some prepaid
  MVNOs). Nothing you can do — accept the ~20% miss rate.

### Display shows a random city ("Pittsburgh, PA")

- The terminating carrier dipped a database that hasn't received the Twilio
  update yet. The city-and-state fallback is the LERG (Local Exchange Routing
  Guide) lookup keyed off the area code. Wait, retry.

### Display shows "Scam Likely" or "Spam Risk"

- This is **separate** from CNAM. It's the carrier's analytics overlay (T-Mobile
  Scam Shield, AT&T Active Armor, Verizon Call Filter). To remove:
  1. Register STIR/SHAKEN attestation in the same Twilio Trust Hub flow.
  2. File a "free caller registry" submission at https://www.freecallerregistry.com/
     (covers T-Mobile, AT&T, Verizon analytics in one form).
  3. Wait 5-7 business days for the analytics caches to update.

### Display shows "ROADSIDE" but cuts off

- 15-character limit. "ROADSIDE TOWING" is 15 exactly. Some legacy switches
  display only 12-13 chars. Consider "ROADSIDE TOW" if truncation appears
  consistently in field tests.

### AT&T shows it, Verizon doesn't

- Expected. Verizon's CNAM behavior is the least consistent of the big three.
  File the free-caller-registry submission above; Verizon mobile uses Hiya
  analytics under the hood.

---

## Per-tenant CNAM strategy (multi-tenant future)

Today we have one outbound number (`+18783563281`) with one CNAM
(`ROADSIDE TOWING`). When the system grows to multiple tenant brands:

- **Each tenant gets its own outbound Twilio number.** Sharing a number across
  tenants means sharing a CNAM, which means brand collisions.
- **Each tenant's number is registered separately** via the same flow above,
  with `TWILIO_CNAM_REGISTERED_NAME` set per-tenant (or via a `--name` flag
  passed to `register-cnam.ts`).
- **15-character cap is per-brand.** When onboarding, require the tenant to
  pick a 15-char-or-less display name during signup.
- **One TrustHub CustomerProfile per legal entity, not per brand.** If five
  tenants are all operated by the same LLC, they share one CustomerProfile
  with multiple TrustProducts (one per CNAM). If they're separate legal
  entities, each needs its own CustomerProfile (and its own EIN, address,
  authorized rep) — that registration is owner-driven, not operator-driven.

---

## Related

- `scripts/twilio/register-cnam.ts` — apply CNAM friendlyName + print Console
  finishing steps.
- `scripts/twilio/check-caller-id-status.ts` — read-only audit.
- `scripts/twilio/list-numbers.ts` — full number inventory.
- `scripts/twilio/test-outbound-call.ts` — place a real test call.
- `docs/A2P_10DLC.md` — companion compliance doc for outbound SMS.
- `docs/sessions/S67_DECISIONS.md` — session-level decisions for this work.
