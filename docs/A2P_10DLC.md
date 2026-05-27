# A2P 10DLC registration (Twilio outbound SMS compliance)

US carriers require **Application-to-Person 10-Digit Long Code** registration
for any business that sends SMS from a US 10-digit number. Unregistered traffic
is filtered, throttled, surcharged, or outright blocked starting at T-Mobile
and rolling across the other majors.

This doc explains the model, what specifically needs to be registered for
Roadside Towing, and the operator runbook for completing both brand and
campaign registration in the Twilio Console.

---

## What 10DLC is

- **A2P** = Application-to-Person (our app sending to a customer's phone).
- **10DLC** = 10-Digit Long Code (a standard US phone number, as opposed to a
  short code or toll-free number).
- Mandated by US mobile carriers (via the industry registry **TCR — The
  Campaign Registry**) starting 2021; enforcement tightened through 2023-2025.
- Twilio is a CSP (Communications Service Provider) on TCR and registers on
  our behalf via Trust Hub.

Two layers must be registered:

1. **Brand** — the legal entity sending the messages (Roadside Towing's LLC).
2. **Campaign** — the type of messages being sent (customer-care updates).

---

## Why it's required

Without 10DLC registration:

- **Filtering.** Carriers silently drop a growing percentage of messages.
  T-Mobile blocks 100% of unregistered traffic as of mid-2023.
- **Throttling.** Unregistered numbers are throttled to ~1 msg/sec, vs.
  10-100+ msg/sec for registered campaigns.
- **Surcharges.** Twilio passes through carrier "unregistered traffic" fees
  ($0.005-$0.030 per message) on top of the base SMS price.
- **Forced opt-out keywords.** Carriers may inject "Reply STOP" and other
  overlays, garbling templated messages.

For Roadside Towing's caller-tracking-link SMS and flip-accept manager pings,
unregistered = unreliable. Registration is non-negotiable.

---

## What to register for Roadside Towing

### Brand registration

| Field                    | Value                                       |
|--------------------------|---------------------------------------------|
| **Brand type**           | **Standard Brand** (not Sole Proprietor)    |
| Legal company name       | Roadside Towing's registered LLC name       |
| EIN                      | The company's federal EIN                   |
| Country of registration  | US                                          |
| Stock symbol / exchange  | N/A (private company)                       |
| Vertical                 | **TRANSPORTATION** or **AUTOMOTIVE**        |
| Brand relationship       | Direct customer (operator) → end-user       |
| Brand website            | https://ustowdispatch.com (or tenant brand) |
| Support email + phone    | ops@ustowdispatch.com + support number      |

> **Decision (S67):** Standard Brand (not Sole Proprietor) because (a) the
> business has an EIN and operates as an LLC, and (b) Sole Prop campaigns
> have a 1,000-msg/day cap that we will exceed during peak hours.

Cost: **$4/month** (TCR brand fee, billed by Twilio).

One-time vetting fee: **$40** (Standard Brand secondary vetting — strongly
recommended for higher throughput tiers).

### Campaign registration

Roadside Towing's outbound SMS use cases (caller live-tracking links, ETA
updates, flip-accept manager pings) all fall under one campaign:

| Field                | Value                                                              |
|----------------------|--------------------------------------------------------------------|
| **Campaign type**    | **Customer Care**                                                  |
| Description          | "Outbound roadside-assistance service updates: live ETA tracking links, dispatch confirmations, and operator notifications to opted-in customers and partner managers." |
| Message flow         | Customer requests service via inbound voice call → AI agent collects details → outbound SMS with tracking link and status updates is triggered as part of service fulfillment. Opt-in is captured by the inbound caller agreeing to receive service-related SMS during the call. |
| Sample message 1     | "Hi [Name], your tow truck is on the way. Track live: https://track.ustowdispatch.com/abc123. Reply STOP to opt out." |
| Sample message 2     | "Your driver Mike has arrived at the pickup location. Reply STOP to opt out." |
| Sample message 3     | "Tow complete. Drop-off confirmed at [Shop]. Reply STOP to opt out." |
| Opt-in method        | Verbal consent during inbound voice call (logged in `sms_messages`) |
| Opt-out keywords     | STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT (Twilio handles automatically) |
| Help keyword         | HELP                                                               |
| Subscriber count     | Estimate based on monthly call volume                              |
| Use case attributes  | Includes URLs (yes), embedded phone numbers (no), age-gated (no), affiliate marketing (no), direct lending (no) |

Cost: **$10/month per campaign** (TCR campaign fee, billed by Twilio).

> **Decision (S67):** One campaign covers all current outbound SMS. Marketing
> or promotional SMS (if added later) require a separate **Marketing**
> campaign at the same monthly rate.

---

## Operator runbook

### Prerequisites

- A Twilio Trust Hub primary CustomerProfile for Roadside Towing's LLC.
  Created in the Console; the script `scripts/twilio/check-caller-id-status.ts`
  prints existing CustomerProfile SIDs. If none exists, create one first.
- Brand information ready: EIN, legal name, registered address, authorized
  representative name + email + phone.

### Step 1 — Inspect current state

```bash
pnpm --filter @ustow/api exec tsx ../../scripts/twilio/check-caller-id-status.ts
```

The output lists TrustHub CustomerProfiles and TrustProducts. If you already
see a TrustProduct with `policySid` matching the A2P 10DLC policy
(`RNb0d4771c2c98518d916a3d4cd70a8c8b` for US A2P standard brand; verify in
the Console), brand registration is already in flight or complete.

### Step 2 — Register the Brand in the Twilio Console

Navigate:

> **Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC → Brands → Register a Brand**

Or direct link: https://console.twilio.com/us1/develop/sms/regulatory-compliance/brands

Fill in the Standard Brand form with the values from the "Brand registration"
table above. Submit.

Vetting takes **1-3 business days**. Status moves from `PENDING` → `VERIFIED`.

If status is `VERIFIED` with a vetting score ≥ 75, the brand can run higher
volume campaigns. Below 75, you may want to pay the $40 secondary vetting fee
for a manual review.

### Step 3 — Register the Campaign

Navigate:

> **Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC → Campaigns → Create a new Campaign**

Or direct link: https://console.twilio.com/us1/develop/sms/regulatory-compliance/campaigns

- Select the verified Brand from Step 2.
- Campaign type: **Customer Care**.
- Fill in the "Campaign registration" fields above (description, sample
  messages, opt-in method, etc.).
- Attach the Messaging Service that includes `+18783563281` (or whichever
  sender pool sends roadside SMS).

Submit. Campaign review takes **1-5 business days**.

### Step 4 — Attach phone numbers to the Campaign's Messaging Service

If not already done, in Console:

> **Messaging → Services → [your messaging service] → Sender Pool → Add Senders → +18783563281**

Then under **Integration**, ensure the service is tied to the registered
campaign.

### Step 5 — Verify

After Twilio reports the campaign as `VERIFIED`:

1. Send a real SMS via the production app (or call
   `pnpm --filter @ustow/api exec tsx ../../scripts/twilio/test-outbound-call.ts`
   for voice, or trigger a tracking-link SMS via the normal flow).
2. Confirm delivery receipt (the `sms_messages` row reaches `delivered`).
3. Send to a known T-Mobile number specifically — T-Mobile is the strictest
   carrier, and a delivered T-Mobile message confirms registration is honored.

---

## Cost summary

| Item                                   | Cost                |
|----------------------------------------|---------------------|
| Brand registration (one-time)          | $4/mo (TCR fee)     |
| Standard Brand vetting (optional)      | $40 one-time        |
| Customer Care campaign (one per use)   | $10/mo              |
| Per-message carrier fee (registered)   | $0.0030-0.0050/msg  |
| Per-message carrier fee (unregistered) | $0.0035-0.0300/msg  |

Total recurring overhead for one brand + one campaign: **~$14/month** + Twilio
SMS usage. Negligible relative to the cost of message failures.

---

## Failure modes & how to spot them

### "Why is no SMS reaching T-Mobile customers?"

- Almost always 10DLC registration. Run
  `pnpm --filter @ustow/api exec tsx ../../scripts/twilio/check-caller-id-status.ts`
  and confirm a `VERIFIED` campaign TrustProduct exists. If not, complete the
  runbook above.

### "We're getting charged carrier fees but messages still fail"

- The Messaging Service may not be linked to the campaign. Console →
  Messaging → Services → [service] → Integration tab — confirm the campaign
  is selected.

### "Sample messages don't match what we actually send"

- Carriers spot-check campaigns. If real traffic diverges materially from
  registered samples (e.g., the campaign claims customer-care but real
  traffic is promotional), the campaign can be revoked. Keep samples honest
  and update the campaign if the SMS templates change substantially.

---

## Related

- `docs/TWILIO_CALLER_ID.md` — companion doc for outbound voice CNAM.
- `packages/api/src/modules/outbound-sms/` — the production SMS sender.
- `docs/sessions/S67_DECISIONS.md` — session-level decisions for this work.
