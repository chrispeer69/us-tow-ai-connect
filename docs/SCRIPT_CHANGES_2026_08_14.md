# Outbound Call Script — Changes, 14–15 August 2026

Prepared for Chris Peer, Alpha Automotive management, and Sidd.
All figures pulled from production `outbound_call_logs`.

**Live now: script 3.2, Retell agent v40.** Sections 1–8 cover 14 August.
**Section 9 covers 15 August** — knowledge-pack round 1, the tire offer, the
ride home, and a review pass that found four more defects.

---

## 1. Summary

Seven releases shipped on 14 August. Most are defect fixes. One — script 3.0 —
is a new call structure running as an **A/B test against the current script**,
not as a replacement. (Superseded by 3.1 and 3.2 on 15 August — see section 9.)

| Version | What it is | Type |
|---|---|---|
| 2.8 | Offer ladder switched back on | Defect fix |
| Retell agent v36 | Prompt rules stopped contradicting the script | Defect fix |
| 2.9 | Offer 1 offers a choice of shops; "too far" has an answer | Defect fix + copy |
| 3.0 | Chris's new call structure, as an A/B split | **Experiment** |
| Offer terms | VIP visual diagnostic, up to an hour, $179, up to 10% | Accuracy fix |
| Retell agent v38 | Agent may not inflate the offer terms | Guardrail |
| — | AAA guardrail; partner-shop self-poach | Defect fix |

**The single most important number to watch is not wins.** It is the share of
offer-1 declines that reach offer 2, and the share of calls where an offer is
made at all. Those move within a day. Wins take weeks.

---

## 2. What was actually broken

### 2.1 The offer ladder had switched itself off

On 14 August, offer 2 fired on **0 of 13** offer-1 declines. Escalation had run
29–44% of declines on 7–11 August and 0–15% since 12 August.

Offer 2 is worth having: it has produced **12 of the programme's 62 all-time
wins**, 12 across 282 runs. It is the backstop for days when offer 1 goes cold —
and on 14 August offer 1 went 0-for-13 with no second rung behind it.

**Cause.** Both the script directives and the Retell agent prompt treated
*"it's my regular shop"* as a reason to stop. That is the single most common way
a customer declines a shop switch, so the ladder terminated on nearly every
decline. From version 2.7 — the first version whose words actually reached
customers — offer 2 also *spoke* the exit line before asking the question:

> "If that's your regular shop or your insurer picked it, I'll leave it exactly
> as it is."

Customers took it. On one 14 August call the agent said that line, the customer
answered "It's my regular shop", and the agent closed without a second offer.

**Fix (2.8).** The script now separates two things it had collapsed:

- **A constraint** — the insurer or motor club chose the shop, a warranty, a
  dealership obligation, work already underway. There is genuinely no offer to
  make; pressing only costs goodwill. The graceful exit is kept.
- **A preference** — "my regular shop", "I know the guy", "it's closer", "it's
  what was on the ticket". Not a constraint. Still gets offer 2.

Offer 3 is left restrictive on purpose: 2 wins across 175 runs.

### 2.2 The Retell prompt would have overruled the fix

Two rules in the published v35 agent prompt said the opposite of what 2.8 does:

> **23.** "…or when they name a real reason such as **their regular shop**, their
> insurer, a warranty…"
>
> **32. ONE OFFER PER CALL AFTER A DECLINE WITH A REASON.** "…accept it the first
> time and go to the close. A second attempt after a stated reason reads as
> pressure and **has never once converted**."

Rule 32's closing claim is false. Offer 2 has produced 12 wins across 282 runs,
every one of them a second attempt after a decline.

Both rules now draw the same constraint/preference line as the script. Shipped
as **agent v36**, published. Superseded by **v38**, then **v40** (section 9.5), which is what
`RETELL_AGENT_VERSION` now points to. **v35, v36 and v38 are untouched and
remain working rollback targets.** (v37 and v39 are unpublished drafts created as a
side effect of versioning; live calls are pinned to a published version, so they
are inert.)

Both prompts are checked into `docs/backups/` because Retell edits are otherwise
invisible to this repo.

### 2.3 The test-call path invented a shop and a distance

A test call from Lewis Center was offered **Complete Brake Service — 18 miles
away, the ninth-nearest of nine shops — and told it was "just 3 miles from you".**
When asked for somewhere more local, the agent said there were no other partner
shops. There are nine, and the nearest was Wayne's Powell at 4 miles.

The cause was two lines in `outbound-voice.service.ts`:

```js
nearestShop: repairShops[0]?.name || 'Downtown Auto Care',
nearestShopDistanceMiles: 3,
```

It measured nothing. The shop was whichever row Postgres returned first, and the
distance was a hardcoded constant spoken on every test call regardless of
location.

**Real customer calls were never affected.** The orchestrator renders its own
script and passes it in, so this code was unreachable for live jobs — which is
precisely why the defect survived: it only fired where we were testing. It also
backed the **public demo**, so prospects heard the same fabricated pitch.

**Fix.** The test path now geocodes the pickup and runs the same selector and
12-mile catchment as production. When it can't — no pickup, failed geocode,
nothing in range — it offers **nothing** and logs why, rather than inventing.

### 2.4 The AAA hard guardrail was never hard

`aaa-branded.matcher.ts` has always documented rule 1 as a hard-coded
`/\bAAA\b/i` check that "survives even if the database is empty". **It did not
exist.** Rule 1 only iterated blocklist rows.

Production carries four blocklist rows. All four are `NAME_PATTERN` and none is
`STANDALONE_WORD`, so that branch had **never fired on a live call**. The only
protection was a substring match on four exact brand strings. Anything else
AAA-branded — "AAA Approved Auto Repair", "AAA Columbus Automotive" — was
cleared to receive a flip offer.

Per CLAW.md this is a fireable-offense rule. It is now hard-coded and cannot be
switched off by data. Three tests asserting this behaviour were already in the
repo and had been failing on `main`.

### 2.5 We were poaching our own partner shop

A customer already booked into Wayne's Auto Repair — one of our own shops — was
pitched a flip to a different partner shop, because Towbook put the business name
in the *address* field and left the name field empty. The same job with the name
field populated classified correctly 90 minutes later. The partner-shop check now
runs against the name Google returns, not just the raw Towbook field.

---

## 3. Script 3.0 — the A/B split

Rather than cut over to the new call structure, it alternates against the current
one call by call. That removes day-of-week, weather, and motor-club-mix as
confounds.

### 3.1 How assignment works

- Seeded on the **job id**, hashed (FNV-1a), then parity. Even → `control`,
  odd → `reframe`.
- **Stable per job.** A retried call stays in the arm it started in. A coin flip
  at render time would count one conversation under two different scripts.
- Stamped onto `outbound_call_logs.script_variant`.

> **Reading historical data:** `script_variant` has existed since 2.0 but was
> **never written** — every row before 3.0 reads `control` because that is the
> column default, not because it was in a control arm. Only rows with
> `script_version = '3.0'` carry a real arm.

### 3.2 What differs between the arms

| | **Control** (2.9 flow) | **Reframe** (new) |
|---|---|---|
| Opening | "…helping confirm the details" | "…I'm an AI assistant, calling about your tow request" |
| Pre-frame | none | "I can also save you some money at one of our partner repair shops" |
| Order | pickup → car → problem → drop-off | pickup → **drop-off** → car → problem |
| Offer intro | "Before I confirm the drop-off — one quick option…" | "Now I would like to mention a few great offers from our in-network partner shops." |
| Close | CONVINIcar app, track this tow live | **Roadside Emergency Management App**, 24/7 access to partner towing and repair |
| Sign-off | "Drive safe." | "Bye for now." |

### 3.3 The reframe arm, as spoken

> "Hi, is that Juan? This is Emily from Roadside Towing — I'm an AI assistant,
> and I'm calling about your tow request."
>
> "I'll confirm your tow details, and I can also save you some money at one of
> our partner repair shops. Let's get the details out of the way first."
>
> *pickup → destination → vehicle → problem*
>
> "Now I would like to mention a few great offers from our in-network partner
> shops."
>
> "We work with several certified partner shops in your area, and as a new VIP
> customer you'd get a free visual mechanical diagnostic — a visual inspection of
> up to an hour, normally a $179 value — plus up to 10 percent off parts and
> labor. The closest to you are Wayne's Auto Repair —
> Powell, about 7 miles away; Wayne's Auto Repair — Columbus, about 8 miles;
> Wayne's Auto Repair — Westerville, about 9 miles. Would one of those work
> instead of 5816 Columbus Pike, or would you like me to just send the driver to
> the closest one?"
>
> "You're all set, Juan. […] One last thing — we've built a free app that gives
> you 24/7 access to all our partner towing companies and repair shops. It's
> called the Roadside Emergency Management App, and I've just texted you a link
> to it. Take a look, and let us know if you have any questions. Thanks again for
> using Roadside Towing."
>
> "Anything else before you go?" / "Bye for now."

### 3.4 Two decisions made during the design

**The permission question was dropped.** The first draft asked *"Would you like
to hear a little about our in-network partner shops' great offers?"* and skipped
the offer on a no. That was removed by agreement: an explicit yes/no puts a
second decline point in front of the one we already have, and converts the
undecided middle into a clean no. The pre-frame in the opening does the same
honesty work without handing out an exit. The agent is now explicitly forbidden
from turning the bridge back into a question.

**The AI disclosure was kept**, against the draft. The tenant's own agent rules
require it, and AI-voice disclosure rules are tightening. It costs six words.

---

## 3.5 The offer terms, stated accurately

The offer we were describing was not the offer being given. Three corrections,
all in the same pass:

| Was said | Actually is |
|---|---|
| "the diagnostic", no scope | a **visual mechanical diagnostic** — a visual inspection |
| "a full hour of diagnostic time" | **up to** one hour |
| "$89" | **$179** |
| "10 percent off the repair" | **up to 10 percent off parts and labor** |
| no mention of VIP | free for **new VIP customers** |

As spoken now:

> "…as a new VIP customer you'd get a free visual mechanical diagnostic — a
> visual inspection of up to an hour, normally a $179 value — plus up to 10
> percent off parts and labor."

Two of these mattered beyond tidiness. **$89 undersold the giveaway by half.**
And **"a full hour" promised more than the shops agreed to** — that was an error
introduced earlier the same day and corrected within the hour.

Applied to all five places the offer is stated: offer 1, the single-shop
fallback, the conditional offer, and the two legacy helpers. Offer 2's
reassurance restates it in short form — repeating full terms on a second pass
reads as pressure.

**Both "up to"s are load-bearing**, so they are now guarded in two layers:

- **Script directive.** Never promise a full hour, never promise a flat 10
  percent, never imply a teardown, road test, computer scan, or parts removed.
- **Retell agent v38, rule 33.** The same constraint at the prompt layer, which
  is where improvisation happens. Also forbids quoting any dollar figure or
  percentage the script did not supply.

If asked what the diagnostic covers, the authorized answer is that a technician
looks the vehicle over and gives a written quote before any work begins. That
question gets asked, and previously the agent would have improvised the answer —
it has invented policy on live calls twice this week.

VIP already had a pronunciation rule in the agent prompt ("vee-eye-pee"), so it
is not read as a word.

---

## 4. Offer 1 now offers a choice (2.9)

Previously the script carried exactly **one** shop name, so a customer asking
"is there anywhere closer?" got told we had no other partner shops. We have nine.

- `alternateShops` — the next-nearest partners — is now passed to the script.
- Offer 1 names up to three shops and asks which, or offers to send the driver
  to the closest.
- A distance objection now names the rest of the network. It never promises
  anything *nearer* than the closest shop, because once selection is correct
  there isn't one — a "too far" objection is usually about direction, not miles.
- Falls back to the single-shop wording when only one shop is in catchment.

> **Risk, stated plainly.** Offer 1 carries **48 of the programme's 62 all-time
> wins**. It is the rung with the most to lose, and unlike the ladder fix this is
> a copy change, not a defect fix. It could go either way.

---

## 5. What to measure, and when

Read these in order. The top two move within a day; the bottom one takes weeks.

1. **Offers made per connected call.** If the reframe arm suppresses the pitch,
   this shows it immediately. Baseline on 14 August: 23 offers from 64 calls;
   57% of connected calls in the post-fix cohort.
2. **Escalation rate** — offer-2 attempts as a share of offer-1 declines. Ran
   29–44% before 12 August, collapsed to 0–15%, and was 0 of 13 on the morning of
   14 August. It had recovered to **3 of 8** within 90 minutes of the 2.8 deploy.
3. **Wins per offer, by arm.** At ~20–25 offers/day split two ways that is ~10–12
   per arm per day. Expect **weeks**, not days. Do not call a winner off a good
   morning.

A caution that still applies: `flip_eligible` in the database is overwritten
after every call by Retell's post-call extractor, so it reflects the agent's
opinion of its own call, not the pre-call gate. Read `scenario` instead — it is
stamped at render time and never overwritten.

---

## 6. Open decisions

**The app link.** The close renames the app to the **Roadside Emergency
Management App**, but the link still resolves to the CONVINI URL, and the
`convini_link_sent` tracking column and SMS copy are unchanged. The script never
reads a URL aloud, so this is only visible when the customer opens the text —
but hearing one name and receiving another is worse than either alone. **Needs a
URL decision.**

**A live contradiction, not yet resolved.** The tenant's `custom_agent_rules`
still says *"Do not pitch repair-shop offers for … single flat tire …"*, which
contradicts script 2.5 and agent prompt rule 18a, both of which made single flat
tires eligible again. The config rule should be removed or the code rule
reverted — currently they disagree.

**Still outstanding from July.** `issue_type` is `'unknown'` on effectively every
call, so the script opens with "I see the issue is listed as a service request"
instead of the actual problem. The script's personalisation cannot fire without
it.

---

## 7. Rollback

Each piece reverses independently:

| To undo | Do this |
|---|---|
| Retell prompt rules | Repoint `RETELL_AGENT_VERSION` to `36` (or `35`) and redeploy |
| Script 3.0 A/B | `git revert f523ecd` — all calls return to the 2.9 flow |
| Choice-of-shops offer | `git revert db3ae6b` |
| Offer ladder (2.8) | `git revert 3650a3b` |

Setting a Railway variable does **not** restart the process on its own — run
`railway redeploy --service '@ustow/api' --yes` or the old value stays live.

---

## 8. Commits

| Commit | Change |
|---|---|
| `268ad88` | Do not poach our own partner shop when Towbook leaves the name blank |
| `f9b6600` | The AAA hard guardrail was never actually hard |
| `3650a3b` | Script 2.8: the offer ladder is switched back on |
| `b7e225d` | Retell agent v36: the prompt no longer contradicts the script |
| `db3ae6b` | Fix the test-call path that invented a shop and a distance |
| `f523ecd` | Script 3.0: run the new call structure as an A/B split |
| `e99b8cd` | Diagnostic is a full hour, and it is worth $179 not $89 |
| `bcfa4c4` | State the offer accurately: VIP visual diagnostic, up to an hour, up to 10% |

Test status: **164 of 164 flip-engine tests pass.** Eleven pre-existing failures
remain elsewhere in the API suite (`admin-auth.guard`, `outbound-voice.service`,
`tenant-onboarding`); they were failing on `main` before today's work and are
untouched by it.

---

# 9. 15 August 2026 — knowledge-pack round 1, and a review pass

## 9.1 What shipped

| Version | What it is | Type |
|---|---|---|
| 3.1 | The close says what the app actually is | Copy |
| 3.2 | Tire offer; the ride home enters the offer; rentals | Copy + capability |
| Retell agent v40 | Rule 33 stopped contradicting the tire offer | **Defect fix** |
| — | Conditional offer got a consent gate | **Defect fix** |
| — | CONVINIcar retired from everything spoken | **Defect fix** |
| — | Tire suppression removed from tenant + global config | Config |

## 9.2 The tire decision — a contradiction live in three places

Script 2.5 made single flat tires flip-eligible. The tenant config said *do not
pitch them*. The 14 August analyst recommended suppressing them outright.

**All three were arguing the wrong question.** Chris's call: the tow still goes
to the nearest network shop — what was wrong was pitching a *mechanical*
diagnostic to someone with a flat. On 14 August a customer said *"No, it's a
tire. I got my tire flat. I want to bring it to the tire shop"* and was offered
an $89 mechanical diagnostic anyway.

Tire jobs now get a tire-relevant offer:

> "…while they're fixing the tire they'll do a **free visual brake inspection and
> tire condition assessment**, and **check and top off your fluids** — no charge.
> You'd also get **10 percent off your next** set of tires, brake job, or oil
> change and rotation."

Note the discount **moves**: on a normal flip it is off *today's* parts and
labor; on a tire job it is a coupon for the *next* visit. The agent is told
explicitly these are never stated together. It is also forbidden from promising a
turnaround time — a tire can take an hour or most of a day depending on stock,
and we do not compete there.

The rationale is Chris's: a single tire repair is what leads to a full set, a
brake job or a caliper replacement.

## 9.3 The ride home — the answer to the objection a discount cannot touch

The two objections that dominated 14 August were **loyalty (9)** — *"it's my
regular shop"* — and **dealership/warranty (6)**. Fifteen of twenty-five
declines. Neither is answerable with a discount, and a discount is what we had
been answering both with.

The offer now carries:

> "And if you need a ride home from there, we can sort that too."

**It runs from our shops only.** That is what makes it a genuine reason to
switch rather than a courtesy — and the billing falls out of the same rule: a
RoadsideMC member has it included, everyone else has it added to the repair
invoice, and a repair invoice only exists if the repair happens with us.

| Destination | Member | Non-member |
|---|---|---|
| **Our shop** | Included in plan | Added to the repair invoice |
| Out of network | **Not offered** | **Not offered** |

Three guardrails, all deliberate:

- It says **"can"**, not "will". Leading with *"we'll get you home"* before the
  billing is disclosed would be a soft bait. A test asserts the offer never says
  it.
- **Payment must be disclosed before the customer accepts.** This is the one
  place the agent can create a charge the customer did not agree to; a ride that
  appears as an unexplained line on a repair bill is a complaint and a
  chargeback.
- Out of network the agent must **refuse and not hint** — *"for a ride we'd need
  the car going to one of our shops."*

## 9.4 Also live

**Rentals** — three delivery options (to the shop, to your home with digital
paperwork, or a lift to the Westerville Road location). **Driver's license and
full coverage insurance stated every time**, because plenty of people carry
liability only and discovering that at the counter is worse than never being
offered. Offers and pricing live in the app, so no rate is quoted.

**The app close** now says what the app is — an all-in-one emergency services
app: 24/7 roadside assistance, plus towing, rentals, auto repair and body work,
with travel, hotels and rewards on top. The previous close described it as
access to partner towing and repair shops, which undersold it to about a third.
It names the four that matter to someone thirty seconds past a breakdown; the
full list is an answer for when they ask.

## 9.5 The review pass — four more defects

**Retell rule 33 contradicted the tire offer.** It enumerated the standard terms
as universal — *"up to one hour, normally a $179 value… plus up to 10 percent off
parts and labor"* — while a tire job carries entirely different terms. The prompt
would have dragged the agent back to the wrong offer. **This is the same class of
bug that made offer 2 unreachable for three days.** Rewritten to state the
principle without enumerating any one variant. Shipped as **agent v40**.

**The conditional offer had no consent gate.** It makes a real destination change
— *"Would you like me to switch the drop-off to X?"* — with nothing requiring an
unambiguous yes. Every other offer has one, because on 11 August a win was logged
from a reply given amid partly unintelligible speech.

**`"certified shopabout 4 miles from you"`** — a missing separator in the same
offer.

**CONVINIcar was still being spoken.** It is retired (CONVINI Inc remains the
parent; it is the *app* brand that is gone), but the name survived in the A/B
**control arm's close — roughly half of all customers** — in the legacy pitch
helpers, and in both tenant and global `custom_agent_rules`, which is what the
agent actually reads. Only the *name* changed in control; its structure and
"track this tow live" framing are untouched, because that is what the A/B is
comparing. Correcting a factual error in both arms does not bias the comparison;
leaving a dead brand in one would have.

## 9.6 A security finding — not ours, but serious

The Towbook **Billing Notes** field carries raw cardholder data: full card
number, expiry, **security code** and billing ZIP.

**Retaining a security code after authorization is prohibited under PCI DSS.**
This is upstream of us and needs raising with Towbook or whichever motor club
populates it.

**We are not making it worse, and this was verified rather than assumed:** zero
matches for card-like digit runs, `CCN`, or `Security Code` across every
`unified_jobs.source_payload` and every call transcript. The write-back design
makes it a hard rule never to read, write, log or store that field.

## 9.7 Still open

- **SendGrid is a free account with zero credits** (`chris@bluecollarai.online`,
  hard limit, allowance exhausted). Daily review emails fail until it is
  upgraded. The 14 August review was delivered by hand. Separately, the sending
  address `alerts@ustowalliance.com` shows as **unverified**.
- **Towbook write-back** — designed in full (`TOWBOOK_AI_NOTES_WRITEBACK.md`),
  blocked only on the DOM selectors inside the Update Call modal.
- **App URL** still resolves to the CONVINI address although nothing says
  CONVINIcar any more — now *more* inconsistent, not less.
- **Repair financing and repair insurance** — parked at Chris's instruction
  pending details. Deliberately not in the script: financing is regulated in
  ways a tow offer is not.
- **Spanish** — leaning toward a second AI dispatcher; demand still unmeasured
  because the STT is pinned to `en-US`.

## 9.8 Test status

**flip-engine: 210 of 210 pass.** Full API suite: **538 pass, 11 fail** — the
same eleven pre-existing failures as 14 August, same test names, in
`admin-auth.guard`, `outbound-voice.service` and `tenant-onboarding`. Untouched
by this work.
