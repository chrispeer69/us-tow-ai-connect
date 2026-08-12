# Call review 2026-08-11 — corrections implemented

**Date shipped:** 12 August 2026
**For:** Chris and Sidd
**Source:** daily AI review of 96 outbound calls placed 2026-08-11 (60 transcripts analysed, 41 flip-eligible, 2 wins)

All ten recommendations were worked. **Eight are fully implemented and verified in
production. Two are partial and one of those is deliberately not built** — details and
reasoning below, in §4. Nothing here was shipped unverified.

**Live now:**

| | |
|---|---|
| Retell agent | **v31** published, `RETELL_AGENT_VERSION=31` |
| Script version | `SCRIPT_VERSION` **1.0 → 2.0** |
| Code | `876126b`, `2845c83` on `main` |
| Rollback | repoint `RETELL_AGENT_VERSION` to `30` or `29`; each version holds its own prompt |

---

## 1. What changed, by recommendation

### 1. Fix `{{destination}}` rendering; hard stop instead of an improvised fallback
**Status: implemented for the flip scenario; partial elsewhere.**

The literal string `{{destination}}` was spoken in 6 of 60 transcripts, and in 5 more the
agent covered a missing value with a vague phrase. Scenario A now branches: with a
destination on file it confirms it, and without one it asks outright —

> "I want to make sure I have the right drop-off for you — can you tell me the name or
> address of the shop this is going to?"

— with an explicit instruction never to state, imply or improvise a destination it does not
have. Scenarios B/C/D still use the pre-existing shared fallback ("I do not have a separate
tow destination listed, so I have this as service at {pickup}"), which is correct for
service-on-site jobs and wrong for a tow with a genuinely unknown destination. See §4.

### 2. Gate the offer ladder on the eligibility flag, not the agent's judgement
**Status: implemented, both halves.**

The ladder had fired on a call marked `eligible=false`, and separately the agent talked
itself out of pitching eligible jobs it decided were "just a flat tire".

- Prompt rule 16 previously read *"Always ensure you are… performing flip opportunity when
  the tow job requires it"* — an instruction to judge. It now reads: the script body decides
  whether an offer applies; make the offer if it is written, never construct one if it is
  not, and never skip a written offer because you judge the customer unlikely to accept.
- The second half had a concrete cause nobody had spotted: `issuePhrase()` rendered **both**
  `single_tire_issue` (on the no-flip list) and `full_tire_set` (flip-eligible) as
  *"a flat tire"*. The agent saw a flip-eligible job described with the exact words the rules
  told it never to pitch. A full set now reads *"tire damage needing replacement"*.

### 3. Stop the agent inventing shops, specialties and policies
**Status: implemented.**

On one call with no `nearest_our_shop` the agent offered an unnamed *"partner shop that
specializes in that kind of work"* and told the customer they could ride in the tow truck.

Global rules now forbid naming an unnamed shop and forbid the tow-truck-ride claim outright.
More importantly the **no-offer scenario now says so explicitly** rather than presenting an
empty section for the agent to fill:

> `[AGENT: THERE IS NO REPAIR-SHOP OFFER ON THIS CALL. Do not mention a partner shop, a
> nearby shop, a certified shop, a discount, a free diagnostic, or switching the drop-off —
> not even in passing, and not as a suggestion for "next time".]`

### 4. Suppress the mechanical-diagnostic flip on collision and glass jobs
**Status: implemented.**

Four customers with collision or glass damage were offered a free *mechanical* diagnostic at
a brake shop; all declined instantly and two had said "body shop" a turn earlier.

Both are now refused in `flip-decision.engine.ts` — before the script is even chosen, so the
call log records `flip_eligible=false` with a reason code instead of counting the call as an
eligible one that converted at 0%. Glass also required a new `glass_damage` subcategory in
the issue classifier, because glass had no classification anywhere in the pipeline.

### 5. Front-load the ask so customers stop declining mid-sentence
**Status: implemented.**

Four customers cut the old pitch off before the terms finished — declining its length, not
its content. Offer 1 now asks first, justifies second, and names the alternative so "no" is a
real choice:

> "Before I confirm the drop-off — one quick option and then I'll let you go. We work with a
> certified shop, Wayne's Westerville, just 2 miles from you: they include the diagnostic at
> no charge, normally around $89, and take 10 percent off the repair. Want me to send the
> driver there instead, or keep Firestone on Main?"

### 6. Replace the offer-2 restatement with a question that finds the real reason
**Status: implemented.**

Offer 2 went 0-for-11 and offer 3 0-for-5, because offer 2 restated the benefits the customer
had just declined. It is now a question, and the agent is instructed to stop when the answer
is a real one:

> "Totally fair — can I ask what's taking you to Firestone on Main? If that's your regular
> shop or your insurer picked it, I'll leave it exactly as it is. If it's just what was on
> the ticket, Wayne's Westerville would include the diagnostic and 10 percent off the repair."

If the reason is a regular shop, a dealership, an insurer or a warranty, the agent accepts it
and goes to the close — it does **not** continue to offer 3.

### 7. Fix the distance value and stop calling distant shops "just X miles away"
**Status: phrasing implemented; the underlying value is not fixed.**

One pitch said *"just zero miles away"* for a shop in another suburb, and four described shops
7–10 miles out as "just". Now: under half a mile claims **no distance at all**, "just" is
reserved for ≤3 miles, everything further says "about", and 1 mile is singular. The distance
*value* is still straight-line — see §4.

### 8. Screen the dial list
**Status: in-call mitigation only — not implemented. See §4.**

### 9. Strip prompt scaffolding from spoken output
**Status: implemented as instruction, in both places.**

Two calls voiced an `AI:` role label and wrapping quotation marks, and one ran a question and
a sign-off together. Prompt rule 9 and the script's global rules now both say: speak only what
is inside the quotation marks, never say "AI", never read the quotation marks, a step label, a
bracketed instruction or a placeholder; ask one question at a time and wait.

### 10. Require an unambiguous yes before logging a destination change
**Status: implemented.**

One of the two wins rested on a reply given amid unrelated, partly unintelligible speech. A
consent gate now sits before **all three** offers:

> `[AGENT: …If the answer is unclear, partial, or arrives amid other speech, ask: "Just so I
> have it clearly — is that a yes to sending the driver to Wayne's Westerville instead?" Only
> log a destination change on an explicit yes.]`

---

## 2. A second round, after an independent review

The first implementation (`876126b`) was reviewed adversarially by a separate agent whose only
brief was to find mistakes. **It found four real defects, three of which meant a fix silently
did nothing.** Worth recording, because all three had passing tests and looked correct:

| Found | Why it mattered |
|---|---|
| **The glass gate was dead code.** `isCollisionOrGlass()` regexed the free-text issue, but the orchestrator only ever passes one of eight canned phrases from `issuePhrase()` — none containing "glass" or "windshield" — and the classifier had no glass keyword at all. | A cracked windshield classified as `unknown`, stayed flip-eligible, and got the full mechanical ladder. Exactly the behaviour rec 4 was written to stop. |
| **Adding `accident_minor` to the no-flip list did nothing.** That list is confidence-gated at 0.85; the collision classifier emits 0.70. | The rule never fired. Body and glass are now refused *unconditionally* — pitching mechanical repair on a wrecked car is wrong at any confidence. |
| **The no-partner-shop notice was unreachable.** The orchestrator nulls `nearestShop` exactly when it downgrades the scenario, so Scenario A always has a shop. | The invented-shop incident happened in Scenario C, which had no notice at all. Moved there. |
| **A dead variable dropped "a certified shop"** from offer 1. `tsconfig` has `noUnusedLocals: false`, so the build never flagged it. | An untracked wording regression riding along inside a change whose entire purpose was measurable wording attribution. |

The review also found four **prompt/script contradictions** — the same decision specified in
two places with different answers, which is the pattern that produced the original findings.
All four are resolved in v31: CONVINI now follows the script rather than being an absolute;
the tire wording matches; the "Did you get that?" confirmation is no longer appended to every
sentence (it directly fought the front-loaded offer); and the destination question defers to
the script.

---

## 3. Verification

- **Test suite:** 416 tests, 14 failures — the **same 14** that fail on an untouched
  checkout. Verified by stashing the change and re-running. 24 tests added; 2 pre-existing
  failures in `flip-scripts.spec.ts` fixed along the way (their fixtures omitted
  `pitchConvini`, which production defaults to `true`).
- **Typecheck and lint:** clean.
- **End-to-end against live production:** 34 checks covering every recommendation, the live
  Retell prompt, the post-call analysis fields, and the rollback path. All pass.
- **Version isolation confirmed:** v29, v30 and v31 each hold their own prompt, so repointing
  `RETELL_AGENT_VERSION` is a genuine rollback.

---

## 4. What is not done, and why

**Rec 8 — dial-list screening. Not built.** Six reviewed calls reached a dealership, tow
company or parking-authority IVR rather than a customer; one pickup was read aloud as latitude
and longitude. What shipped is in-call mitigation: the agent is told to end the call on
reaching a switchboard, unusable name fields are never spoken, and coordinates are never read
aloud. **Nothing filters the list before dialling**, so we still pay for the connected minute.
Doing it properly needs a persistent suppression list keyed on number, fed by the calls that
hit an IVR — a real feature with a data model, not a script tweak. Recommended as the next
unit of work; it is the one item here with a direct cost saving attached.

**Rec 7 — the distance value. Phrasing only.** `nearest-shop.selector.ts` computes
**straight-line** haversine distance. The agent can now describe it honestly, but "just 2
miles" may still be a 6-mile drive across a river. Fixing the value needs a routing provider
(Google Distance Matrix is already in the stack for Places). Small job, but it changes a
number customers can check, so it should ship deliberately rather than bundled here.

**Rec 1 — non-flip scenarios.** Scenarios B/C/D keep the older shared fallback, which asserts
service-at-pickup when no destination is on file. That is right for roadside service and wrong
for a tow with an unknown destination, and the two cannot be told apart from the data
currently on the job. Flagged rather than guessed at.

**Rec 9 is instruction, not enforcement.** The rendered body still contains `AI: "…"`,
`[STEP …]` and `[AGENT: …]` markers by design — compliance rests on the model following rules
in two places. That is the existing architecture and it is defensible, but this recommendation
exists *because* the model already failed to comply once, so it is not a guarantee.

**One judgement call worth naming:** `SCRIPT_VERSION 2.0` bundles roughly eight independent
wording and gating changes into a single attribution bucket. It will not be possible to tell
whether the front-loaded offer 1 helped or the offer-2 rewrite hurt — only whether 2.0 beats
1.0 overall. That was a deliberate speed-over-rigour choice given all ten findings landed at
once. Future changes should move one lever at a time.

**And a caution on the evidence base.** These ten recommendations come from a single day: 96
calls, 41 eligible, 2 wins. The defects are worth fixing on sight — a spoken `{{destination}}`
is broken regardless of sample size. The *wording* changes are not yet evidence of anything;
at roughly 190 eligible calls a week it will take 4–6 weeks before 2.0 can be said to beat
1.0. Do not read next week's numbers as a verdict.

---

## 5. Open question for Sidd

Unchanged from the previous note and still unanswered: **`car_repair` stops being emitted
after 31 July** and `competitor_repair` picks up its volume. The only commit touching the
classifier in that window is `c58acd8` (29 Jul). Was collapsing the two tags intentional? It
matters because offer routing keys off these tags, and because any analysis that segments on
`destination_type` across that boundary is comparing different things.
