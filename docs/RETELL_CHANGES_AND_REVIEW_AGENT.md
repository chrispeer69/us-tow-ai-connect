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

### And one thing the aggregate hides

`competitor_repair` shows 0% because it is **95% never pitched** — 309 of 326 eligible calls,
with a **20-second median duration** on those. Only **17** were ever actually pitched, so we
can't yet conclude those customers reject flips. The open question is why the calls end so
early, and that is what the transcripts should answer next.

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
| `competitor_repair` calls dying at ~20s, never pitched | ~25 wins/mo | diagnosing |
| Offer ladder abandoned after first decline (201 of 408) | ~8–9 wins/mo | open |
| `issue_type` unknown on 99.6% of calls; `motor_club` empty on 100% | unknown | open |
| Retire Offer 3; fold its incentive into Offer 2 | time saved | agreed |
| Add `named_competitor` tag + soft-seed route | — | agreed |
| Move prompt rules 17–20 out of Retell into rendered script body | — | proposed |

That last one is the architectural one. "When not to pitch" is currently specified in two
places — `flip-scripts.ts` and the Retell prompt, which carries 20 numbered rules including
flip-suppression logic. Two sources of truth for the same decision is how you get a scenario
that never pitches. Consolidating into the rendered body puts it in git, makes it diffable in
a PR, and gives `SCRIPT_VERSION` real meaning.

---

*Figures queried directly against the production database over 1 June – 31 July 2026.
Retell state read live via the API.*
