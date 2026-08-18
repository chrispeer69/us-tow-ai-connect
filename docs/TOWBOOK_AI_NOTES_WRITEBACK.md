# Towbook AI Notes write-back — design

> Status (2026-08-18): **complete except for two selectors.** The intake
> capture chain is closed end to end — the agent emits the fields, they are
> extracted, stored (migration `0045`), selected and composed. The write-back
> itself is still `AI_NOTES_WRITEBACK_ENABLED=false`.
>
> **The one remaining step** is capturing the Notes textarea and Save Changes
> selectors from a live Update Call modal, which does not need a developer:
>
> ```
> POST /v1/admin/flip-engine/ai-notes/discover-selectors   { "sourceJobId": "<row data-id>" }
> ```
>
> That opens one job read-only and logs the modal's element metadata (tag, id,
> class, name, label — never a field value, see the PCI section). Set the two
> selectors it reveals, dry-run for a day, then enable. No redeploy is needed to
> correct a wrong selector.

## Configuration

| Env var | Default | What it does |
|---|---|---|
| `TOWBOOK_NOTES_TEXTAREA_SELECTOR` | *(unset)* | The Notes field. **Unset is the safe state** — `updateJobNotes` returns `not-configured` rather than typing into whichever textarea is first, which might be Billing Notes. |
| `TOWBOOK_SAVE_BUTTON_SELECTOR` | *(unset)* | The green Save Changes button. |
| `AI_NOTES_WRITEBACK_ENABLED` | `false` | Master switch for the sweep. |
| `AI_NOTES_WRITEBACK_DRY_RUN` | `true` | Compose and verify, write nothing. Two switches, because "enabled" and "actually writing" are separate decisions and the interesting day is the one where the first is true and the second is not. |
| `AI_NOTES_BATCH_SIZE` | `10` | One Playwright session per job. |
| `AI_NOTES_LOOKBACK_HOURS` | `6` | A note is worthless once the tow is done. |
| `AI_NOTES_RETRY_BACKOFF_HOURS` | `2` | Stops a broken selector re-opening a browser every 5 minutes forever. |

Review a dry-run day from `ai_note_writes` (migration `0044`), or
`GET /v1/admin/flip-engine/ai-notes/writes`. Every attempt is audited, including
the ones that decline to write; the composed block is stored so the decision to
go live is made from evidence.

## The intake lines — closed 2026-08-18 (Session 77)

`composeAiNotes` renders `KEYS / ACCESS / CONDITION / VEHICLE / ISSUE` from
post-call analysis fields. Until 2026-08-18 **not one of them could ever
render**, because the chain was broken in three places at once and each piece
passed its own tests:

1. the Retell agent emitted no field for any of them,
2. so `extractRetellAnalysis` read nulls,
3. and `findCandidates` hardcoded `null` on top of that anyway,
4. with no column to store them in if it had not.

All four are fixed:

| Piece | Where |
|---|---|
| 7 post-call analysis fields on the agent | Retell agent version, backed up under `docs/backups/2026-08-18-retell-agent-v*-post-call-analysis.json` |
| Extraction | `retell-call-mapping.ts` (already read them; unchanged) |
| Storage | migration `0045_intake_answers` — 6 new `outbound_call_logs` columns |
| Persist on webhook AND reconcile | `outbound-voice.service.ts`, `assignIfPresent` |
| Selection | `ai-notes-writer.service.ts` — real columns, widened candidate filter |

**`new_destination` was in the same state** and is the reason both 2026-08-17
wins stored a null destination on calls where the customer plainly named the
shop. It now has a field, and the agent is told to leave it empty unless the
customer gave an unambiguous yes.

### Why `assignIfPresent` rather than `if (value)`

Three cases have to stay distinct and a truthiness check collapses them:

- a real answer → store it;
- the literal string `unknown` → **store it**. The agent is instructed to record
  an honest unknown rather than guess, and a driver reading "drivetrain unknown"
  behaves differently from one reading nothing — it means *check before you put
  it on dollies*;
- `null` / `''` (question never reached) → **leave what is already stored**. Late
  `call_analyzed` events and the reconciliation sweep both re-enter this path for
  the same call, and a later empty must not blank an earlier answer.

### Expected coverage change

The candidate filter used to be `corrections_made OR new_destination`, which the
2026-08-14 dry run measured at **24.7%** of calls. The intake answers are
captured on every call that gets past the opening, so a note becomes the normal
case rather than the exception. `composeAiNotes` remains the real gate and still
returns `null` for a call that captured nothing — silence beats noise, and a
details box full of "nothing to report" teaches dispatchers to skip the block.

## Why

On 2026-08-14, 118 of 421 calls captured a real, dispatch-useful correction —
*"Corrected pickup address from 766 to 763 South Richardson Avenue and clarified
car is parked in the alley behind the address"* — and `towbook_notes_updated` was
false on all 421. Every one died in our database while the driver went to the
address on the ticket.

Dry run over those same 421 calls: **104 (24.7%) would produce a note**, 317
correctly produce nothing.

---

## ⚠️ Never touch Billing Notes

The **Billing Notes** field on the Update Call modal contains raw cardholder data
— full PAN, expiry, security code and billing ZIP — observed 2026-08-15.

**Storing a security code is prohibited under PCI DSS at any time after
authorization.** That is a Towbook/upstream problem, not ours, but it constrains
us absolutely:

- **Never write** to Billing Notes.
- **Never read, log, screenshot or store** it. Not into `source_payload`, not
  into logs, not into a debug artifact.
- If a selector ever matches it, that is a bug to fix immediately.

Verified 2026-08-15: we currently ingest none of it. Zero matches for card-like
digit runs, `CCN`, or `Security Code` across every `unified_jobs.source_payload`
and every call transcript. **Keep that at zero.**

---

## Navigating to the right job

**Use click-through, not the search bar.** The adapter already scrapes
`li.entryRow[data-id]` from the dispatch list, and our `source_job_id` *is* that
`data-id` — the Towbook job number (Chris, 2026-08-15), an exact handle we
already hold. Clicking the row opens the modal directly. Towbook typically has
5–20 jobs open at once, so the row is in a list we parse every poll cycle. There
is a search bar top-right if click-through ever fails, but it should not be the
primary path.

**One thing to confirm during discovery.** All 883 stored ids are 9 digits
(`278515215` … `280215679`), while the modal observed on 2026-08-15 was titled
`Update Call #126258` — six digits, and not present anywhere in our data. Those
may simply be two different Towbook identifiers (a row/job id and a displayed
call number). It does not block anything, because click-through uses `data-id`
and never needs the displayed number — but it does mean **searching by our
stored id may not find the job**, so confirm which is which before relying on
search. The row selector list also references `[data-id][data-call-number]`; if
the row carries both, capture and store the second so the two identities are
linked permanently.

**Keep the identifier abstract.** Chris, 2026-08-15: US Tow Dispatch job numbers
will be used as well once that software comes in. Nothing here should hard-code
Towbook's scheme — the job handle is whatever `source_job_id` holds for the
adapter that produced the job.

### Identity verification — fail closed

Chris, 2026-08-15: the job can be verified by **phone number, customer name, or
Towbook job number.** All three must agree before a single character is written:

1. Row `data-id` equals our `source_job_id`
2. Customer name on the modal matches the job
3. Customer phone matches

Any mismatch → **do not write**, log it, move on. Writing an AI note onto the
wrong customer's ticket is worse than not writing at all.

---

## Concurrency

The modal shows **`Users Editing: Chris Peer`**. If a human is in the record,
**back off and try later.** A dispatcher mid-edit who hits Save after us could
lose our note — or worse, we clobber theirs.

---

## The write

Target the **Notes** textarea (the one holding "Cross Street / Coordinates /
Remain with Vehicle"), then the green **Save Changes** button.

1. Read the current Notes value
2. `appendAiNotes(existing, block)` — pure, tested, append-only and idempotent
3. Write the combined value back
4. Click Save Changes
5. **Re-read and confirm the block is present** — a click that silently did
   nothing is the failure mode these portals actually have
6. Only then set `towbook_notes_updated = true`

Never construct the new value inline; always via `appendAiNotes`. That is what
keeps "never overwrite" a property rather than a promise.

---

## Rollout

- Behind a flag, **default off**
- **Dry-run mode first** — log what it *would* write, for a day, and read those
  logs before enabling
- Then enable for one tenant and watch

---

## Phase 2 — the structured fields

The modal already has structured fields for things the AI now asks on every
call. These are better than prose, because a driver reads a field, not a blob:

| Towbook field | Our intake question |
|---|---|
| **Have Keys** toggle + **key location** | "Will you be there with the keys?" |
| **Not Drivable** dropdown | will it roll / tires |
| **Color** dropdown (e.g. Gray) | "What color is it?" |
| **4X4** (beside VIN) | "Front, rear or all-wheel drive?" |
| **odometer** | — |

Deliberately phase 2. One append-only text field is easy to verify and trivial
to undo; setting structured fields is more DOM surface, more ways to be wrong,
and harder to reverse. Prove the note first.

---

## Still needed

The selectors inside the modal — element IDs/classes for the Notes textarea and
the Save Changes button. **This is now self-service**, via
`POST /v1/admin/flip-engine/ai-notes/discover-selectors` (see the status block at
the top), which runs `TowbookAdapter.discoverNotesModal` against the existing
authenticated session and logs the structure. The two manual alternatives still
work if you prefer them:

1. A **read-only discovery pass** — open one job in the existing authenticated
   session, capture the panel's DOM, change nothing; or
2. **Saved HTML** — DevTools → Elements → right-click the Notes field → Copy
   outerHTML.

Whichever route: pick the field whose label mentions *Cross Street / Coordinates
/ Remain with Vehicle*, and **never** one whose label mentions Billing.

## What was built (2026-08-17)

- `TowbookAdapter.updateJobNotes` — click-through by `data-id`, `Users Editing`
  back-off, three-way identity check that fails closed, append via
  `appendAiNotes`, Save, then **re-open the record from a fresh page load** and
  confirm the block is present before reporting success.
- `TowbookAdapter.discoverNotesModal` — structural capture, values suppressed.
- `looksLikeCardData` — Luhn-checked PAN and label tripwire, run on the block
  before writing *and* on whatever was just read. If the configured Notes
  selector ever reads card-like data the write aborts as
  `refused_selector_hit_billing_field`, because that means the selector is
  pointing at a billing field and it is a bug to fix, not to work around.
- `AiNotesWriterService` — the sweep, composing first so a null block never opens
  a browser, and auditing every attempt.
- `ai_note_writes` — the audit table behind `towbook_notes_updated`.
