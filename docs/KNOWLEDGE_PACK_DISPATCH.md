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

## What we can actually do — captured 2026-08-15, Chris

The operational capability behind every offer. **This is the reason the speed
objection is answerable**, and it should be read before the tire section below.

- **16 tow trucks** working the Columbus area daily, across three brands:
  Roadside Towing, Auto Lyft USA, Excite Towing.
- **We own the Roadside Emergency Management App** — it is our product, not a
  third-party integration.
- **Round-trip towing.** Tow to a destination, have the car repaired anywhere,
  then collect it and tow it back to the customer's home. Repeatedly, all day.
- **30 rental cars** at 5511 Westerville Rd, Columbus. We can collect a rental
  and deliver it to any local location or store.

**The positioning, in Chris's words:** *"we sell convenience — hence the name
CONVINI. We go the extra mile, we go the distance, to make a difference in the
experience a customer has when a breakdown occurs."* Winning on creativity,
effort, time invested, and care — not on price or turnaround.

### Why this matters to the script

The two objections that dominated 2026-08-14 were **loyalty** (9 — "it's my
regular shop") and **dealership/warranty** (6). Neither is answerable with a
discount, and we have been answering both with a discount.

Convenience answers both, because it does not ask the customer to give anything
up. Their regular shop is still their regular shop; what changes is whether they
have to sit in a waiting room.

The same logic dissolves the tire problem below. **We do not need to be faster
than a tire store. We need the four hours to stop being the customer's
problem** — a rental, a lift home, or the car returned to their driveway.

Open: how these are actually offered, what they cost the customer, what
eligibility rules apply, and which of them the AI is allowed to promise on a
call versus flag for the office. Nothing here is in the script yet, and none of
it should be spoken until that is answered — an over-promise on a rental is
worse than not mentioning it.

**Data note:** 5511 Westerville Rd is also the address of `Excite Collision
Repair` in `alpha_shops`, where it is marked **inactive**. The 08-13 report
already asked whether the two body shops are meant to be switched off and that
is still unanswered. Worth resolving, since the rental depot lives there.

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

**SUPERSEDED 2026-08-15 — see "The tire offer, decided" below.** Chris's call:
the flip still applies and the tow still goes to the closest network shop. What
changes is only the offer. The reasoning above still explains WHY the standard
offer was wrong; it was wrong about what to do instead.

**Design consequence.** Tire jobs need their own path, not the standard offer and
not silence:

- No mechanical-diagnostic flip, and no speed claim we cannot keep.
- Position for the follow-on work — the set, the brakes, the calipers — on this
  visit or a later one.
- Honesty about turnaround is a feature here, not a concession.

---

## The tire offer, decided — 2026-08-15, Chris. **SHIPPED**

Chris's decision, which answers the open questions above and supersedes the
"design consequence" framing:

> "If a customer has a flat tire — a single flat or two flats — the tow should go
> to the closest shop in our network (flip script). The visual diag still
> applies. Someone with a flat tire should want a brake inspection."

**So the flip is unchanged. Only the offer changes.** The tow still routes to the
nearest network shop exactly as any other job. What was wrong was never the
routing — it was pitching a *mechanical* diagnostic to someone with a flat.

The tire offer, in Chris's terms:

- free **visual brake inspection**
- **tire condition assessment**
- **fluids checked and topped off**
- **10% off the next** set of tires, brake job, or oil change and rotation
- the Roadside App by CONVINI Inc, there to serve them 24/7

Note what moved: on a normal flip the 10% is off *today's* parts and labor. On a
tire job it is a coupon for the **next** visit. The two must never be stated
together, and the script says so explicitly.

**Why it is a better offer for this customer.** It is the same free visual
inspection, described in terms a person with a flat actually cares about. It is
also the honest route to the jobs worth having — a single tire repair is what
leads to a full set, a brake job or a caliper replacement.

**Live in the script** as of 2026-08-15, keyed on issue subcategory
`single_tire_issue` and `full_tire_set`. Non-tire jobs are untouched. The agent
is forbidden from promising a turnaround time on a tire, because a tire can take
an hour or most of a day depending on stock and we do not compete on that.

**Consequence for the tenant config:** `custom_agent_rules` still says *do not
pitch repair-shop offers for … single flat tire …*. That is now wrong and should
be **removed** — the code pitches, with the right offer. Left in place, the
config is what the agent reads, so it suppresses the pitch entirely.

**Still open:** whether a damaged rim, no spare, run-flats or tire-caused
suspension damage change anything; whether we refer to a tire store when we
genuinely are the wrong choice; and how the rental / round-trip capability is
offered here (see above — not yet approved for the agent to say).

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
