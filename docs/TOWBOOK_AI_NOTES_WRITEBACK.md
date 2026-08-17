# Towbook AI Notes write-back — design

> Status (2026-08-17): **built, off, and blocked on two selectors.** The
> composer, the adapter contract, the browser automation, the sweep, the audit
> table and the admin endpoints all exist and are tested. Nothing writes yet.
>
> **The one remaining step** is capturing the Notes textarea and Save Changes
> selectors from a live Update Call modal, which no longer needs a developer:
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

## Known gap — the intake lines are still empty

`composeAiNotes` renders `KEYS / ACCESS / CONDITION / VEHICLE` from post-call
analysis fields (`keys_and_presence`, `access_notes`, `vehicle_condition`,
`vehicle_details`, `issue_description`, `confirmed_destination`) that
`extractRetellAnalysis` now reads — but **the Retell agent does not emit them
yet**. Until a post-call analysis field is added per line, the write-back carries
the corrections and destination lines only. That is still the 24.7% of calls the
2026-08-14 dry run measured, and the composer correctly renders nothing for the
rest rather than inventing it.

This is the highest-value remaining piece: the script has been *asking* all four
questions on every call since 2026-08-15 and throwing every answer away.

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
