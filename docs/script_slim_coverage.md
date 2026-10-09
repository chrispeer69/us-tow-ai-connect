# Slim script coverage map (SCRIPT_MODE=slim)

Every rule, heading and spoken line in the legacy outbound context, and where it lives in the slim design.
Nothing is marked dropped. Where a rule was redundant, its surviving copy is named.

**Tiers**
- **CORE n**: `retell/core_prompt.md`, rule n. This is the static Retell general prompt, about 1,190 cl100k tokens.
- **SCRIPT [label]**: `flip-scripts-slim.ts`, the per-call `script_body` step with that label.
- **CODE**: the decision is taken in the generator before the call (`flip-scripts.ts` / `flip-scripts-slim.ts`), and only the branch that applies is emitted.
- **KB file**: `retell/knowledge/<file>.md`, retrieved only when relevant.

Legacy sources: `globalRules()`, the scenario renderers in `flip-scripts.ts`, tenant `custom_agent_rules` (Roadside and the platform default), and the live general prompt `scripts/emily-outbound-prompt.txt` (agent v61). In slim mode the core prompt replaces that general prompt.

## 1. Headings from the current script

| Legacy heading | New home |
|---|---|
| GLOBAL RULES (preamble) | Removed as a block. Every line is mapped in section 2. |
| AT MOST TWO OFFERS | CORE 8 |
| TWO REFUSALS END EVERY OFFER | CORE 8, plus its exit line verbatim |
| NEVER CONFIRM OR STATE AN ARRIVAL TIME | CORE 14, ETA line verbatim. Also KB safety-reassurance |
| THE SCRIPT DECIDES WHETHER TO PITCH | CORE 5 |
| NEVER REPEAT THE CUSTOMER'S ANSWER | CORE 4 |
| TENANT CUSTOM RULES | CODE `uncoveredTenantRules()`. Known duplicates are resolved (section 3); any other line ships verbatim under `TENANT RULES:` |
| INSURANCE RULE (Roadside tenant) | SCRIPT `TENANT RULES:`, verbatim |
| SCENARIO A / COMPETITOR REPAIR / ONE OFFER, ONE FOLLOW-UP | CODE: the scenario is chosen before the call and the label is not shipped. The offer structure is SCRIPT [8 OFFER] … [10 REASSURANCE], and the two-offer cap is CORE 8 |
| PHASE 1: DATA CONFIRMATION | SCRIPT steps 1–7b, in legacy order for each A/B arm (CODE `confirmSteps`) |
| STEP 1 OPENING / IDENTIFICATION | SCRIPT [1 OPENING]. The greeting stays verbatim and is picked in code by arm and by whether the name is usable |
| STEP 2 PURPOSE | SCRIPT [2 PURPOSE], verbatim and picked by arm |
| STEP 2b CONFIRM FULL NAME | SCRIPT [2b NAME]. One of 3 asks, picked in code |
| STEP 3 PICKUP | SCRIPT [3 PICKUP]. The correction rule is CORE 4 |
| STEP 6 DESTINATION WITHOUT LOCKING IT | SCRIPT [6 DESTINATION (DO NOT LOCK IT)] or [6 DESTINATION MISSING], picked in code |
| STEP 4 VEHICLE | SCRIPT [4 VEHICLE] |
| STEP 5 CLARIFY ISSUE | SCRIPT [5 ISSUE]. The question is picked per scenario and issue in code |
| STEP 6B WINCH-OUT PHOTO GUIDANCE | SCRIPT [6B WINCH-OUT], emitted only for winch-out jobs |
| STEP 7 DISPATCH INTAKE | SCRIPT [7a ACCESS] and [7b KEYS — A GATE] |
| PHASE 2: THE OFFER | SCRIPT [8 OFFER], emitted only when CODE `offersAllowed` |
| THE OFFER (offer 1: single shop, multi shop, tire) | SCRIPT [8 OFFER]. The variant is picked in code and spoken verbatim |
| VISUAL INSPECTION | CORE 12. Also KB visual-inspection |
| NEW VIP | SCRIPT [8 OFFER] note. Also KB new-vip |
| UP TO wording | CORE 12. Also KB up-to-terms |
| DISTANCE OBJECTION (IS NOT A HARD DECLINE) | SCRIPT [8c TOO FAR], with the other shops listed in code. Also KB objection-too-far |
| CONSTRAINT | CORE 10, and SCRIPT [9] `IF they name a constraint → "That makes sense, I'll leave it as it is"` |
| PREFERENCE | CORE 10, and SCRIPT [10 REASSURANCE]. Also KB objection-regular-shop |
| EXCEPTION — INTERRUPTED OFFER | CORE 9. The reframe-only addendum is in the SCRIPT [8a ANNOUNCE] note. Also KB refusals-and-interruptions |
| REFUSAL (offer-2 bucket) | SCRIPT [9] note ("Another no, 'I'm good' or silence is the second refusal") and CORE 8 |
| AUTHORIZED ANSWERS | Disclosures → SCRIPT [11 IF ASKED] (ride + payment, keeping, not stuck, rental), emitted only where they apply. The rest → KB getting-the-car-home, app-questions, insurance-coverage-question |
| RENTAL CARS | SCRIPT [11 IF ASKED], verbatim (full coverage included). Scenario A offers only, and only when the tenant mentions rentals (F5) |
| GETTING HOME — NOW | SCRIPT [11 IF ASKED]: ride offer + RoadsideMC/invoice disclosure in ONE quoted line, on every call carrying an offer (F5). The distance version is the SCRIPT [8c] ride line |
| KEEPING (their own destination) | SCRIPT [11 IF ASKED], verbatim |
| GETTING THE CAR HOME — LATER | KB getting-the-car-home, verbatim |
| CONVINI SOFT CLOSE | SCRIPT [CLOSE]. The close is verbatim and picked by arm; the app rules are CORE 16 |
| WARM CLOSE | SCRIPT [WARM CLOSE], verbatim. "Don't ask if the text came through" is CORE 16 |

## 2. `globalRules()` lines (legacy preamble, every call)

| Legacy rule | New home |
|---|---|
| [AGENT]/[STEP] lines are context, never read aloud | CORE 1 ("anything in [square brackets]") |
| Warm, reassuring dispatcher; one question at a time; never a telemarketer | CORE 3, CORE 2 |
| Disclose you are the company's AI assistant; don't deny it | CORE 3. The greeting itself discloses it (SCRIPT [1]) |
| Confirm details first; acknowledge corrections | Script order (SCRIPT 1–7b) and CORE 4 |
| Don't ask "is now a good time?" | CORE 3 |
| Only pitch when repairable and the destination isn't ours or protected | CODE: scenario routing, `offersAllowed`, and the AAA scenario. CORE 5 |
| No offers for lockout, fuel, jump-only, winch-out-only | CORE 6 |
| A flat tire IS a repair job | CORE 6, and CODE `isTireJob` picks the tire offer |
| One objection-handling flow; STOP the moment it's accepted | CORE 11 ("skip remaining offers") |
| AT MOST TWO OFFERS … never invent a third | CORE 8 |
| Hard decline phrases stop pitching | CORE 8 |
| Refusal or interruption mid-offer → stop talking | CORE 9 |
| TWO REFUSALS END EVERY OFFER + exit line | CORE 8 |
| NEVER CONFIRM OR STATE AN ARRIVAL TIME + line | CORE 14 |
| ALWAYS send-frame the app near the close (if pitchConvini) | CORE 16. CODE emits the [CLOSE] step only where legacy did |
| Never invent prices, times, names, addresses | CORE 13 |
| THE SCRIPT DECIDES WHETHER TO PITCH | CORE 5 |
| No named shop → never refer to "a partner shop" | CORE 5 |
| Never promise anything about the tow; never a ride in the tow truck | CORE 15 |
| Never claim a partner is faster or sooner; if asked how long → shop gives a time | CORE 12 |
| Never say what insurance or warranty covers, costs, or who pays | CORE 13 |
| Speak only the words after "AI:"; never "AI", quotes, labels, placeholders | CORE 1 |
| One question at a time; never question + sign-off | CORE 2 |
| NEVER REPEAT THE CUSTOMER'S ANSWER | CORE 4 |
| Read back only address, phone, email, shop name, own name | CORE 4. Email was dropped from the script in 3.16, so the rule now lists address, phone, shop name and name |
| PACE: about two minutes (target) | CORE 3 |
| PACE: never cut off, rush or drop a question | CORE 3 |
| Never read lat/long; say "the location we have on file" | CORE 19. Also KB address-handling |
| Only phone number is {{callback_number}}; never caller ID | CORE 19. The number itself is in the SCRIPT [1 OPENING] note |
| App: "I'm texting you the link now", no permission, no link, no "did it arrive" | CORE 16 |
| Never mention Google reviews, incentives or gift cards | CORE 16 |
| Hostile, in danger, or asks to stop → end the call | CORE 17. Changed per F2: injured or in danger → 911 advice, reassure, no offers, warm close; never just hang up. Hostile or asks to stop → end |

## 3. Tenant `custom_agent_rules`

Lines are matched after normalizing whitespace, case, the leading "-" and the company name (`COVERED_TENANT_RULES` in `flip-scripts-slim.ts`). Any line that does not match ships verbatim.

| Tenant line | Covered by |
|---|---|
| Be a warm, reassuring dispatcher… | CORE 2, 3 |
| Disclose that you are {company}'s AI assistant… | CORE 3 |
| Confirm details first… | Script order, CORE 4 |
| Do not ask "is now a good time?"… | CORE 3 |
| Only pitch a repair-shop flip when the call is repairable… | CODE, CORE 5 |
| Do not pitch … lockout, fuel, jump, winch-out. Tire jobs DO get an offer (tire-specific terms) | CORE 6, and CODE `isTireJob` plus the tire offer text |
| Make flip offers as one objection-handling flow… | CORE 11 |
| Hard decline phrases… | CORE 8 |
| ALWAYS send-frame the app… | CORE 16 |
| Never invent prices, times, names, or addresses… | CORE 13 |
| The ONLY phone number … {{callback_number}} | CORE 19 |
| When you offer the app, say "I'm texting you the link now"… | CORE 16 |
| Never mention Google reviews… | CORE 16 |
| If the customer is hostile, in danger, or asks you to stop… | CORE 17 |
| **-INSURANCE RULE: …"We understand you are under agreement with your insurance…"** | **SCRIPT `TENANT RULES:`, verbatim (not covered, so it ships)** |

## 4. Scenario `[AGENT:]` notes

| Legacy note | New home |
|---|---|
| STEP 1: never say "AI", never narrate beginning | CORE 1 |
| STEP 1: wrong person or voicemail → message with callback, end | SCRIPT [1] note |
| STEP 1: menu, switchboard or business greeting → don't work the menu, message, end | CORE 20 (see flag F1) |
| STEP 2 (reframe): say it in full, it promises the offer; no permission | SCRIPT [2] note |
| STEP 2 (control): don't ask if now's a good time | CORE 3 |
| STEP 2b: read the name back once; ask once for a missing one; never press, guess, or use the ticket | SCRIPT [2b] note |
| STEP 3: corrections acknowledged and confirmed back | CORE 4 |
| STEP 4: ask color and drivetrain openly; "I don't know" fine; never guess | SCRIPT [4] note |
| STEP 4: correct the vehicle → acknowledge and confirm | CORE 4 |
| STEP 5: stop talking, let them finish, wait on "hold", don't recite, one line of sympathy | SCRIPT [5] note |
| STEP 6 (A): capture the type for notes; their word never changes the offer; re-ask if unclear | SCRIPT [6] note and `IF … → "Sorry, I want to get this right…"` (verbatim) |
| STEP 6 (A): skip only if no offer or a hard decline → exit line | CORE 5, CORE 8 |
| STEP 6 missing destination: never state or imply one; dispatch confirms | SCRIPT [6 DESTINATION MISSING] note |
| STEP 6 winch and service variants | SCRIPT [6 SERVICE LOCATION] notes |
| STEP 6B: what a winch-out is; not a shop tow | SCRIPT [6B] note. CORE 7 |
| STEP 7: two questions, brisk, accept "I don't know", never from the ticket | SCRIPT [7a] note, CORE 4 |
| STEP 7: access and tires in one turn; blockers; which tire; won't roll or steer; ask the missing half | SCRIPT [7a] note |
| STEP 7 keys: GATE; NO → note it, no improvising, office will call (verbatim) | SCRIPT [7b] `IF` line (verbatim) and note |
| Reframe bridge: a statement, not a question | SCRIPT [8a] note |
| Multi-shop: picked shop = new destination; "you choose" = nearest, by name | SCRIPT [8b SHOP CHOICE] note |
| Tire: state exactly, visual only, 10% is NEXT visit, never promise tire speed | SCRIPT [8] note (tire). CORE 12. Also KB up-to-terms, visual-inspection |
| Standard: UP TO hour, UP TO 10%, visual inspection, free for NEW VIP, what it covers | CORE 12, SCRIPT [8] note. Also KB visual-inspection, new-vip |
| Consent gate ("Just so I have it clearly…") | CORE 11 (verbatim, with the offered shop) |
| Distance objection (with alternates / without) | SCRIPT [8c] (the line without alternates is verbatim). Also KB objection-too-far |
| YES → update the destination, skip to close | CORE 11 |
| Dealer: one offer only | SCRIPT [9 DEALERSHIP — ONE OFFER ONLY] (CODE `destinationIsDealer`) |
| Bare "no" is not a hard decline → offer 2 | CORE 8. Also KB refusals-and-interruptions |
| Interrupted offer exception (+ reframe addendum) | CORE 9, SCRIPT [8a] note |
| Offer 2: ask once, never rephrase | SCRIPT [9] note |
| Offer 2 buckets: REFUSAL / CONSTRAINT / PREFERENCE | SCRIPT [9] note + `IF` constraint line, CORE 10. Also KB objection-regular-shop |
| Reassurance interrupted → stop, exit line | CORE 9, CORE 8. Also KB refusals-and-interruptions |
| Second decline → stop; no third offer | CORE 8 |
| Offer 3 (removed in 3.4) | Not rendered by legacy either (kept in CODE only for override compatibility) |
| No partner shop → nothing to offer | SCRIPT [8 NO OFFER] note (no shop). CORE 5 |
| Collision or glass → no mechanical offer | SCRIPT [8 NO OFFER] note (collision). CORE 7 |
| Authorized answer: "You're not stuck there…" | SCRIPT [11 IF ASKED] with this call's real destination; omitted when there is no destination (F4) |
| Authorized answer: what's in the app | KB app-questions, verbatim |
| Authorized answer: rentals (full coverage every time) | SCRIPT [11 IF ASKED], verbatim (F5) |
| Authorized answer: ride now (ours only; payment disclosure before accepting) | SCRIPT [11 IF ASKED] line + note (F5) |
| Authorized answer: keeping their destination → no ride | SCRIPT [11 IF ASKED], verbatim |
| Authorized answer: ride as a distance lever | SCRIPT [8c] `IF` ride line (verbatim, per call). KB objection-too-far for how to use it |
| Authorized answer: car home later | KB getting-the-car-home, verbatim |
| Authorized answer: insurance or warranty coverage | KB insurance-coverage-question, verbatim |
| CONVINI: YES → confirm text; NO → accept | CORE 16 |
| Scenario B: no offer, no question, no wait | SCRIPT [8 ONE STATEMENT] note |
| Scenario B: ladder disabled; volunteer → update; first no final | SCRIPT [8] note + `IF they clearly ask to use ours` line (verbatim) |
| Scenario B: read the room; shaken or injured → short or skip | SCRIPT [8] note |
| Scenario B: the safe lane (own business only; never insurer, rights or who pays) | CORE 13, SCRIPT [8] note ("Only describe our own shops") |
| Scenario B: gate; hedged = NO | CORE 11. Also KB objection-think-about-it |
| Scenario B: open-door line | SCRIPT `IF they decline or stay put → "No problem at all…"` (verbatim, see flag F3) |
| Scenario C: destination unconfirmed → no shop talk first | SCRIPT [8 CONDITIONAL OFFER] note |
| Scenario C: repair-shop offer / home offer (verbatim) | SCRIPT `IF` lines (verbatim) |
| Scenario C: consent gate (twice in legacy) | CORE 11 |
| Scenario C: body shop, dealer, unsure or no repair → no offer, don't name the shop | SCRIPT [8] note, CORE 5 |
| Scenario C: decline → close, no second offer | SCRIPT [8] note ("One offer only; a no ends it") |
| Scenario C: no-offer route — never mention a shop, discount or ride | SCRIPT [8 NO OFFER] note, CORE 5, CORE 15 |
| Scenario C: push the app hard | SCRIPT [CLOSE] note |
| Scenario D: our own shop, VIP treatment; welcome line | SCRIPT [8 VIP WELCOME] (verbatim) |
| AAA: never flip | SCRIPT [8 AAA-BRANDED DESTINATION] note |

## 5. Live general prompt `emily-outbound-prompt.txt` (v61), replaced by CORE in slim mode

| v61 rule | New home |
|---|---|
| SCRIPT FORMAT 1–4 (AI: lines, [AGENT] silent, never read labels or placeholders) | CORE 1 |
| 5 one question at a time | CORE 2 |
| 6 never narrate; first words = greeting | CORE 1 |
| 7 never improvise; the office will confirm | CORE 13 |
| DELIVERY: warm, calm, about two minutes | CORE 3 |
| DELIVERY: no repeating; read back accuracy-critical details once | CORE 4 |
| DELIVERY: slow for addresses and numbers, digits individually, OH = Ohio, no USA | CORE 19. Also KB address-handling |
| DELIVERY: never VIN, plate, coordinates, caller ID or another number | CORE 19 |
| DELIVERY: VIP pronunciation | CORE 19. Also KB new-vip |
| DELIVERY: never close mid-answer | CORE 2 |
| 16 script decides; never invent or skip | CORE 5 |
| 17 follow the sequence; second refusal ends | CORE 8, SCRIPT order |
| 18 skip list; GOING HOME IS NOT ON THIS LIST | CORE 6 |
| 18a flat tire is repair work; never substitute terms | CORE 6, CORE 12, SCRIPT [8] tire note |
| 19 corrections, corrections_made=true | CORE 4 |
| 20 winch-out or recovery → stop offer, photos | CORE 7 |
| 21 never speak reasoning or "per rule 18" | CORE 1 |
| 22 collision, body or glass → stop mechanical offer | CORE 7 |
| 23 exact terms; UP TO; visual only | CORE 12 |
| CUSTOMER RESPONSES: stop on refusal, human or stop | CORE 9 |
| CUSTOMER RESPONSES: constraint vs preference | CORE 10 |
| CUSTOMER RESPONSES: can't understand → simple confirm, follow up | CORE 18. Also KB language-comprehension |
| CUSTOMER RESPONSES: danger, traffic, dark, cold, injury, kids → acknowledge, reassure | CORE 17. Also KB safety-reassurance |
| CUSTOMER RESPONSES: unclear is not consent | CORE 11 |
| AUTOMATED ANSWERS: press_digit for motorist option, never say a digit, two max | CORE 20 |
| AUTOMATED ANSWERS: voicemail → press nothing, message, end | CORE 20 |
| AUTOMATED ANSWERS: call screening line | CORE 20 (verbatim) |
| AUTOMATED ANSWERS: no offer to recording, switchboard or receptionist | CORE 20 |
| ADDRESS COMPREHENSION (spoken numbers, I-95, exit or mile marker, cross streets, suffix) | KB address-handling |

## 6. Flags — Chris's decisions (2026-10-09)

- **F1 — menus.** Follow v61: press_digit to reach the motorist, two digits at most (CORE 20).
- **F2 — injured or in danger.** Do not end the call. Tell them to call 911, reassure them a driver is coming, skip all offers, warm close; never just hang up (CORE 17, KB safety-reassurance). This is a slim-only change; legacy is untouched.
- **F3 — body-shop open-door line.** Decline-only, as built.
- **F4 — "You're not stuck there".** Moved into the script with this call's real destination (SCRIPT [11 IF ASKED]). The KB file and its placeholder are removed.
- **F5 — disclosures.** The ride offer + RoadsideMC/invoice disclosure, the keeping-your-own-destination answer, and the rental full-coverage answer live in the script, emitted in code only where they apply. Ride: every call carrying an offer, including scenario C's conditional offers, which promise a ride although legacy never disclosed its cost there. Rental: scenario A offers, and only when the tenant's `mention_rentals` is on (legacy showed it regardless of that setting). The KB files are removed.
- **F6 — rollout.** A new agent version is fine. Test first, then flip SCRIPT_MODE=slim.
- **Rule 1 vs rule 3.** Rule 1 now says "never read the `AI:` label aloud" instead of "never say AI", so "Are you a robot?" gets an honest answer under rule 3.
