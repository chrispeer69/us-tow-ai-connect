# Dispatch Knowledge Pack — working document

> **Status: scaffold.** Built with Chris across ~5 rounds of Q&A starting
> 2026-08-15, then extended in small pieces as cases come up.
>
> **Everything below is either empty or marked `TBD — Chris`.** Nothing in this
> file is invented. Where the pack is silent, the script says the office will
> call the customer back rather than guess — that rule already governs the keys
> gate, and it exists because the agent has improvised policy on two live calls
> this week.

Not to be confused with `KNOWLEDGE_PACK_V2.md`, which is the company profile
(identity, hours, fleet, pricing) used to answer questions *about the business*.
This document is the **job-intake playbook**: what the AI asks, what the answers
mean, and what a driver needs to know before rolling.

---

## Why this exists

Motor-club notes on a Towbook ticket get deleted on arrival. Chris's word is
"deplorable" — a lot of data that means nothing in the field. The dispatcher
then rebuilds the notes by talking to the customer.

**The AI is now the one talking to the customer.** So it should author the note.
This pack is the source material for the questions it asks.

---

## The four categories

Each item collected in Q&A sorts into exactly one. They behave differently in
code, which is why the distinction matters more than it looks.

| Category | What it is | Where it lands |
|---|---|---|
| **Gate** | Determines whether or how we can tow | Hard flag on the job; can stop a dispatch |
| **Field fact** | What the driver needs to arrive ready | A line in the AI Notes block |
| **Authorized answer** | Approved wording for what the customer asks back | `[AGENT:]` directive in the script |
| **Driver SOP** | What the driver does on scene | Driver-side; at most a reminder in the note |

For each item, four things are needed:

1. **What the AI asks** — in Chris's words, how he'd say it
2. **Why it matters** — what goes wrong if we get it wrong
3. **What each answer means we do**
4. **Is it a gate?**

---

## Round plan

| Round | Topic | Why this order |
|---|---|---|
| **1** | **Gates** — keys, presence, release, when we refuse | Highest value: a gate answered on the phone is a truck that doesn't roll for nothing |
| **2** | **Vehicle condition & equipment** — what decides flatbed vs wheel-lift vs dollies; EVs, AWD, no-start, won't-roll, won't-shift | The equipment question is the one the ticket can never answer |
| **3** | **Location playbooks** — OSU, Fairgrounds, parking garages, apartment complexes, gated communities | Columbus-specific and high volume |
| **4** | **Customer-facing answers** — pricing, ETA, insurance, riding along, storage, "where's my car" | Stops the agent inventing policy |
| **5** | **Edge cases & escalation** — impound, police holds, accidents, hazmat, hand-off to a human | Rare, expensive, and currently unscripted |

---

## Round 1 — Gates

*To be completed 2026-08-15.*

### 1.1 Customer presence and keys

The only rule captured so far, from Chris on 2026-08-14, and **not yet in
approved customer-facing wording**:

> The customer must be present prior to arrival with the keys. If the customer
> is not present we will not tow the car — unless they leave the keys with the
> car and sign a release of liability. Then we take 4 to 8 photos prior to
> touching the car.

That decomposes into three separate items:

| Item | Category | Status |
|---|---|---|
| "Will you be there to meet the driver with the keys?" | **Gate** | ✅ Asked on every call |
| What we say when the answer is no | **Authorized answer** | ⛔ **TBD — Chris.** Script currently defers to the office |
| Release of liability — who signs, how, when | **Gate + SOP** | ⛔ TBD — Chris |
| 4–8 photos before touching the car | **Driver SOP** | ⛔ TBD — Chris |

**Open questions for round 1:**

- Exact wording the AI may use when the customer says they won't be there.
- Can the release be handled on the phone, by text, or must it be in person?
- Does "keys in the mailbox" satisfy the rule, or does it still need a release?
- Are there jobs we refuse outright regardless of keys?
- Does the answer differ for a motor-club job versus a cash call?

### 1.2 Other gates

*TBD — round 1.*

---

## Tire jobs — captured 2026-08-15, Chris

**Settles a live contradiction.** Script 2.5 made single flat tires flip-eligible
again; the tenant `custom_agent_rules` still said do not pitch them; the
2026-08-14 analyst recommended suppressing them outright. All three were arguing
the wrong question. The answer is not *whether* to pitch — it is that **the
mechanical-diagnostic flip is the wrong offer for a tire job.**

**Why we lose the tire job itself, in Chris's words:**

- A flat-tire customer does not need a flip. They need a **quick tire repair**.
- Auto shops carry a few tires but not an immediate solution, and they tend to
  **upsell to the most expensive tire available, because they know you need it**.
- **Alpha shops are not the best option for a quick tire replacement.** A focused
  tire store is. Alpha lacks the speed tire stores typically have.
- Even a tire store takes **1–4 hours, possibly a half day** — they hold more
  inventory but often not the brand you want, so a warehouse order is common.

So pitching "come to us, it'll be quick" on a single tire is a promise we lose
on, and it costs trust. The free mechanical diagnostic is also simply not the
relevant benefit — one customer on 08-14 said *"No, it's a tire. I got my tire
flat. I want to bring it to the tire shop"* and was offered a $89 mechanical
diagnostic anyway.

**Why we still want the customer.** A single tire repair leads to:

- a **full set of tires**
- a **brake job**
- a **caliper replacement**

> "These are the jobs we are seeking to capture — either on this visit, or the
> next visit."

**Design consequence.** Tire jobs need their own path, not the standard offer and
not silence:

- No mechanical-diagnostic flip, and no speed claim we cannot keep.
- Position for the follow-on work — the set, the brakes, the calipers — on this
  visit or a later one.
- Honesty about turnaround is a feature here, not a concession.

**Still open (round 2):** does the tow still route to our shop on a tire job or
go where the customer chose; does a full set / blown tire / damaged rim / no
spare change the answer back; what exactly the AI offers; whether anything is
done to enable the *next* visit; and whether there is a partner tire store we
refer to.

---

## Round 2 — Vehicle condition & equipment

*TBD.* Currently asked on every call:

> "And are all four tires up, or is any of them flat?"

Captured as the `CONDITION` line. What we still need: the mapping from answer to
equipment, and the other conditions that change the truck (won't roll, won't
steer, won't come out of park, EV, AWD, lowered, oversized).

---

## Round 3 — Location playbooks

Columbus-specific, per Chris on 2026-08-14. **All TBD.**

### 3.1 Ohio State University
High volume. Open: campus access and permits, which lots and garages we can
enter, game-day and event restrictions, university police involvement, student
vehicles where the caller isn't the owner.

### 3.2 Ohio State Fairgrounds
Has its own rules. Open: what they are, who authorizes entry, event-day access,
gate contacts.

### 3.3 Parking garages
Frequent in Columbus, and **clearance is a truck-selection problem, not a note**
— a flatbed that cannot clear the entrance is a wasted roll. Open: the clearance
question the AI should ask, which garages we know are a problem, whether we
handle by level, and what we do when a vehicle can't roll inside a garage.

### 3.4 Apartment complexes and gated communities
Open: gate codes, callbox, after-hours access, towing from private property.

---

## Round 4 — Customer-facing answers

*TBD.* Two authorized answers already exist in the script, both confirmed as
real policy on 2026-08-13: the onward tow if a repair doesn't go ahead, and the
office checking an aftermarket policy with the insurer. Everything else the
customer might ask is currently unscripted.

---

## Round 5 — Edge cases & escalation

*TBD.* Impound, police holds, accidents and injuries, hazmat/leaking fluids,
hostile callers, and when the agent should stop and hand to a human.

---

## What already ships

For reference, so rounds don't re-specify what exists:

- **Intake questions** on every call: where it's parked and nose-in/nose-out;
  all four tires up or flat; will you be there with the keys.
- **Color and drivetrain** asked open rather than confirmed — the club ticket is
  ~50% accurate on both.
- **AI Notes** block: `KEYS` / `ACCESS` / `CONDITION` / `VEHICLE` / `ISSUE` /
  `NOTES`, appended never overwritten, skipped entirely when there's nothing
  worth a driver's attention.
- **Winch-out photo guidance** for stuck vehicles.
- **The no-invention rule**: where policy is unknown, the office calls back.
