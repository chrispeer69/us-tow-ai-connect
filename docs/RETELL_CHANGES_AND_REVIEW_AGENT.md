# Retell changes and the daily call-review agent

**For:** Sidd
**Date:** 11 August 2026
**Agent:** Emily | US Tow AI-Connect
**Live version:** v29

What we changed in the Retell agent, why production was unprotected until today,
and how the automated daily transcript review works.

---

## 1. Retell had no staging — every dashboard save was live

The agent's version history showed `v28` as an unpublished draft, with `v27` the newest
published version, so we assumed live calls ran v27. They did not. Sampling the last 20
calls through the Retell API:

| Agent version on recent calls | Calls | Publish state |
|---|---:|---|
| `agent_version=28` | 19 | **draft — unpublished** |
| `agent_version=4` | 1 | published |

`create-phone-call` resolves to the agent's **latest** version when `override_agent_version`
is omitted — publish state is not considered. So every edit saved in the Retell dashboard
reached customers on the next call, with no review step and nothing to roll back to. The
version history in the panel (including the entries titled "Claude Recommendation Edits")
had been shipping straight to production.

**The fix.** Outbound calls now send `override_agent_version`, driven by a
`RETELL_AGENT_VERSION` environment variable. Unset preserves the old behaviour and logs a
warning, so deploying the change did not silently move production to a different version.
Numeric values are sent as numbers; anything else (an environment tag, or
`latest_published`) passes through as a string.

### 1b. Per-tenant Retell config (Session 74)

`RETELL_AGENT_ID` / `RETELL_AGENT_VERSION` / `RETELL_FROM_NUMBER` are process-wide, which
is fine with one customer and wrong with two: a script change could not ship to one company
without moving every company on the deployment at the same time. All three now live on
`tenants.outbound_voice_config`, with the env vars kept as the fallback:

| Key | Falls back to | Meaning |
|---|---|---|
| `retell_outbound_agent_id` | `RETELL_AGENT_ID` | Retell agent this tenant's calls run |
| `retell_agent_version` | `RETELL_AGENT_VERSION` *(only when the tenant uses the default agent)* | published version live calls are pinned to |
| `retell_from_number` | `RETELL_FROM_NUMBER` | E.164 caller-ID this tenant dials from |

Nothing needs migrating — a tenant that sets none of these behaves exactly as before.

**Agent and version are a pair.** A Retell version number is scoped to its agent: version 31
of agent A and version 31 of agent B are unrelated scripts, and agent B may have no version
31 at all. So a tenant running its own agent never inherits `RETELL_AGENT_VERSION`; it must
pin its own. `resolveRetellTenantConfig` (`common/utils/retell-tenant-config.ts`) enforces
this, `RetellOutboundClient` enforces it again on the wire, and the super-admin patch clears
a stale pinned version whenever the agent id changes.

A tenant with its own agent and no version set is therefore **unpinned** — Retell serves its
latest draft to live calls. That is the same unsafe state the env path warns about: the call
client logs it per call, the tenant page flags it, and draft writes are refused until a
version is pinned.

Edit it at **super-admin → tenant → Retell voice agent**, or
`PATCH /v1/super-admin/tenants/:id/call-controls` with `retellAgentId`, `retellAgentVersion`,
`retellFromNumber` (`null` clears an override, an absent key leaves it alone). The tenant
detail response carries `retellEffective`, which shows the resolved values and whether each
came from the tenant or the env.

Every `/v1/admin/call-review/retell/*` endpoint is tenant-scoped off the caller's JWT, so
staging a prompt edit for one company cannot reach another company's agent.

---

## 2. Versions published today

### v28 — "Production baseline — pinned"

Published the draft that was already serving live traffic. **Zero behavioural change** — it
froze the running configuration as an immutable version so production could be pinned to it.

### v29 — "Post-call taxonomy fix" (live now)

Two post-call analysis field descriptions contradicted each other. `flip_eligible` was
defined as *"TRUE if destination is competitor_repair"*, while `destination_type` instructed
the extractor to classify into *"car_repair, auto_body, residential_unknown, or our_shop"* —
a list that does not contain `competitor_repair`. The model was being asked to key
eligibility off a value it was never offered.

`destination_type` now enumerates the full tag set the pre-call classifier actually emits,
with a one-line rule for each, and `flip_eligible` is defined by the situation rather than by
a single tag.

Extraction-only: post-call analysis runs after the call on the transcript, so **this cannot
change anything a customer hears**. Enum *values* were deliberately left alone — the API maps
`SUCCESS/FAILED/NOT_ATTEMPTED` on ingest and changing them would break that.

### Two API notes worth knowing

- `publish-agent-version` does **not** create a follow-on draft, unlike the dashboard's
  "Auto Create a New Draft". After publishing, the agent has no editable draft and every
  `update-agent` returns `422 Cannot update published agent`.
- The way back is `POST /create-agent-version/{agent_id}` with a `base_version` in the body,
  which opens a fresh draft to patch and then publish.

```
base v28 (published)
  -> POST /create-agent-version   { base_version: 28 }   -> draft v29
  -> PATCH /update-agent?version=29 { post_call_analysis_data }
  -> POST /publish-agent-version  { version: 29 }
  -> RETELL_AGENT_VERSION=29                             -> live
```

---

## 3. Code fix: placeholders were being spoken to callers

**Defect — fixed.**

The review agent found live calls where the caller heard literal `{{callback_number}}` and
`{{destination}}`, and one call carrying a raw `<parameter name="...">` fragment.

Cause is in `flip-scripts.ts`. Each scenario block interpolates its own text, but
`globalRules()` was concatenated into the body *without* interpolation, and
`renderCallBody()` computed `baseVars(ctx)` and then never used it. Retell substitutes its
prompt template exactly once and does not recurse into the value it injects for
`{{script_body}}`, so any placeholder surviving assembly is read aloud.

Now the assembled body is interpolated (idempotent for blocks that already did it), with a
`stripTemplateArtifacts()` guard removing leftover `{{...}}` and pasted markup before text
can reach a phone. Deliberate `[AGENT:]` and `[STEP]` directives are preserved. The markup
fragment most likely arrived via `custom_agent_rules`, which is free text pasted into tenant
config and was being appended unsanitised. Three regression tests cover it.

### Script attribution

Every call now records `script_version`, `scenario` and `script_variant` at render time.
Previously nothing recorded which script text produced a call, so no win could be attributed
to any revision — a script change and its before/after population merged silently.
`SCRIPT_VERSION` in `flip-scripts.ts` must be bumped whenever rendered wording changes. The
3,658 pre-existing rows are unstamped and cannot be backfilled.

---

## 4. The daily review agent

A cron at **06:15 ET** reads the previous day's calls, samples transcripts, and asks Claude
Opus 5 to classify why calls did and did not close. It writes findings and proposed script
edits to two tables and emails a summary.

**Sampling is stratified, not random.** A random sample of a day's calls is roughly 95%
losses and teaches the model almost nothing about what closes. Priority order: every win,
then near-misses that reached offer 2, then eligible calls that were never pitched, then
ordinary declines — capped at 60 transcripts.

**Structured, not prose.** The response is pinned to a JSON schema via
`output_config.format`, so there is nothing to parse defensively. The system prompt is
identical every day and only the transcripts change, so the prefix is cached.

**The agent proposes; a human publishes.** Recommendations land as `PROPOSED`. Retell's own
API splits along exactly the right line — `PATCH /update-agent` writes the draft,
`POST /publish-agent-version` is a separate call — so an agent can stage a change and a
person decides whether it ships. Our service that writes the draft deliberately has **no
publish method**, and it refuses entirely while `RETELL_AGENT_VERSION` is unset, because
writing a draft *is* publishing when calls resolve to latest.

| Endpoint | Purpose |
|---|---|
| `GET /v1/admin/call-review/runs` | Daily runs, newest first |
| `GET .../recommendations?status=PROPOSED` | Queue awaiting review |
| `POST .../recommendations/:id/review` | Approve / reject, records who and when |
| `GET .../performance` | Win rate by script version / variant / scenario |
| `POST .../run` | Run against any past date (backfill) |
| `GET .../retell/status` | Pin state — is production protected? |

### First real run — 14 Jul, 80 calls, 55 transcripts

It surfaced things neither SQL nor the report could see, because they only exist in the
transcripts:

- The placeholder leak in §3 — found here first.
- The agent spoke an address for "our shop" that was never supplied to it.
- The agent improvised an off-script *"specializes in your brand / get you in faster"* pitch
  — a claim we can't stand behind.
- Some dialled numbers reach business IVRs rather than customers.
- Offers 2 and 3 went **0-for-15** that day.

---

## 5. Reconciling the call analysis report

Sidd — the funnel numbers in your report match the database exactly (27 / 9 / 2 wins across
the three offers), which is good independent corroboration, and the **eliminate Offer 3**
recommendation is solidly supported: 2 wins in 141 attempts. The `named_competitor` tag is a
good idea and fills a real gap. The insurance section with verbatim quotes is directly
usable.

Three figures didn't reproduce when queried, and each one changes a recommendation:

| Claim | Measured |
|---|---|
| **Win rates spike to 12% between 11PM–5AM** | 110 late-night calls → 25 eligible → **8 pitched, 1 win**. The 12% is one win out of eight pitches. Rest of day is 37 of 427 (8.7%) — no detectable difference. |
| **100% of customers who decline Offer 1 stay to hear Offers 2 and 3** | Of 408 offer-1 declines, **207 heard Offer 2 and 201 did not**. Only **139** actually declined all three, not 398 — that figure appears to treat `NOT_ATTEMPTED` as a decline. |
| **Taking the car home is 99.5% of declined flips** | Among offer-1 declines: `car_repair` 363, `auto_body` 22, `competitor_repair` 17, `residential_unknown` **5** — about **1.2%**. |

The middle one matters most. It inverts the conclusion: the ladder isn't
healthy-but-too-long, it is **not being delivered**. Roughly half of declines never hear
Offer 2, which converts at 4.3% — worth about **8–9 wins a month** on its own, entirely
separate from any wording change.

### Correction: `competitor_repair` is not a broken segment

An earlier draft of this note claimed `competitor_repair` was a dead segment with 0 wins in
878 calls and calls "dying at a 20-second median". Both statements were wrong, and the
transcripts corrected them. Recording the correction because the wrong version was circulated
briefly.

**The 0% was a labelling artifact.** The destination tag vocabulary shifted mid-period.
`car_repair` first appears 30 Jun, carries almost every win through July, and then stops being
emitted entirely after 31 Jul:

| Week of | `competitor_repair` | `car_repair` | Wins |
|---|---:|---:|---:|
| 29 Jun | 210 | 3 | 0 |
| 6 Jul | 100 | 165 | 15 |
| 13 Jul | 104 | 171 | 15 |
| 20 Jul | 83 | 98 | 5 |
| 27 Jul | 111 | 66 | 6 |
| **3 Aug** | **290** | **0** | **11** |
| **10 Aug** | **91** | **0** | **1** |

Since 1 August, `competitor_repair` absorbed what used to be tagged `car_repair` — and it
converts normally. August so far: **282 eligible, 208 pitched (74%), 15 wins.** The July "0
wins for competitor_repair" was comparing two tags whose meanings changed underneath us, not
measuring a segment that customers reject.

**The 20-second median was voicemail, not a bad opening.** Splitting the never-pitched
`competitor_repair` calls by duration:

| Bucket | Calls | Have transcript |
|---|---:|---:|
| null duration | 297 | 0 |
| 0s | 107 | 0 |
| 1–29s | 51 | 51 |
| 30–119s | 54 | 54 |
| **120s+** | **186** | **186** |

404 of those never connected at all, and the short ones are plainly answering machines —
*"You've reached Jill's voicemail"*, *"the Google Fi wireless subscriber you have called is
not available"*. Across June–July, **37.5% of all calls never connected** (878 of 2,342).
That is a contactability problem, not a script problem, and it has already improved sharply:
August is at **4.5% never-connected**.

**What is left is a genuine defect, and it is narrower than claimed.** 186 calls ran
**two minutes or longer**, were flip-eligible, and still never made offer 1. Those are real
conversations with a real opportunity and no pitch. That is the thing worth fixing — not the
segment, and not the opening.

### On sample size

At roughly 190 eligible calls a week, an A/B split gives ~95 per arm, and separating 4.6%
from 10% needs 350–500 per arm — **4–6 weeks per wording experiment**. Defects ship
immediately and need no statistical patience; wording changes need the wait. Several of the
segment figures (33% for some vehicle brands, 50% for a partner shop) are single-digit sample
sizes and will not hold.

---

## 6. Open items

| Item | Est. value | Status |
|---|---|---|
| **186 calls of 2min+, eligible, never pitched** — real conversations, no offer 1 | high | needs transcript review |
| **Why did `car_repair` stop being emitted after 31 Jul?** Deliberate or a side effect? | unknown | **question for Sidd** |
| Offer ladder abandoned after first decline (201 of 408) | ~8–9 wins/mo | open |
| `issue_type` unknown on 99.6% of calls; `motor_club` empty on 100% | unknown | open |
| Retire Offer 3; fold its incentive into Offer 2 | time saved | agreed |
| Add `named_competitor` tag + soft-seed route | — | agreed |
| Move prompt rules 17–20 out of Retell into rendered script body | — | proposed |
| Contactability — 37.5% never connected in Jun–Jul | already improving | monitor (Aug: 4.5%) |

**Sidd — the direct question:** `car_repair` stops appearing in the data after 31 July, and
`competitor_repair` picks up its volume. The only commit touching the classifier in that
window is `c58acd8` (29 Jul). Was collapsing the two tags intentional? It matters for two
reasons: any analysis that segments on `destination_type` across the boundary is comparing
different things, and the offer routing keys off these tags. Worth five minutes before either
of us reads more into the July segment numbers.

That last one is the architectural one. "When not to pitch" is currently specified in two
places — `flip-scripts.ts` and the Retell prompt, which carries 20 numbered rules including
flip-suppression logic. Two sources of truth for the same decision is how you get a scenario
that never pitches. Consolidating into the rendered body puts it in git, makes it diffable in
a PR, and gives `SCRIPT_VERSION` real meaning.

---

*Figures queried directly against the production database over 1 June – 31 July 2026.
Retell state read live via the API.*
