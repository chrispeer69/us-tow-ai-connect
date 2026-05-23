# Adapter Action Selectors — Accept / Decline

Harvested live on **2026-05-23** by `packages/api/scripts/discover-aaa-selectors.ts`
(read-only: logs in, reads DOM, navigates by URL — never clicks a mutating
control). Redacted dumps live in `docs/diagnostics/aaa-selectors-*.json`.
Screenshots are intentionally git-ignored (real member PII).

## AAA Club Alliance Portal (Salesforce Experience Cloud)

### How the DOM is structured
The contractor portal is Salesforce Lightning. Action buttons render **inside
`lightning-button` shadow roots**, so a flat `document.querySelectorAll('button')`
does **not** see them. Playwright's `getByRole` / text locators **do** pierce
open shadow DOM, so the adapter uses role locators, not `page.evaluate`.

### Login (already in production, unchanged)
| Step | Selector |
|------|----------|
| username | `#username` |
| password | `#password` |
| submit | `#Login` |
| success | URL matches `**/ACACONTRACTORCOMMUNITY/s/**` |

### Work Order detail view
- URL shape: `https://aaacluballiance.my.site.com/ACACONTRACTORCOMMUNITY/s/workorder/{SF_RECORD_ID}/detail`
- `{SF_RECORD_ID}` is the **18-char Salesforce id** (e.g. `0WOJx000016oKR0OAM`),
  **not** the human Work Order Number we scrape (e.g. `14808690`). To reach a
  specific job the adapter opens the Work Orders list and clicks the row link
  whose visible text is the Work Order Number.

### Action buttons — live probe results (shadow-DOM pierced)
Probed on a real Work Order that was in **`Cleared`** status:

| Button | Locator | count | visible | enabled | Status |
|--------|---------|------:|:-------:|:-------:|--------|
| **Decline** | `getByRole('button', { name: 'Decline', exact: true })` | 1 | ✅ | ✅ | **CONFIRMED** |
| Edit | `getByRole('button', { name: 'Edit', exact: true })` | 1 | ✅ | ✅ | confirmed (not used) |
| Called Member | `getByRole('button', { name: 'Called Member', exact: true })` | 1 | ✅ | ✅ | confirmed (not used) |
| Change Final Status | `getByRole('button', { name: 'Change Final Status', exact: true })` | 1 | ✅ | ✅ | confirmed (not used) |
| Follow | `getByRole('button', { name: 'Follow', exact: true })` | 1 | ✅ | ✅ | confirmed (not used) |
| **Accept** | `getByRole('button', { name: 'Accept', exact: true })` | 0 | — | — | **UNVERIFIED** |

### Why Accept is unverified
The Accept button only appears on a job that is **offered / pending acceptance**.
At discovery time the account had no such job — the only Work Order available
was already `Cleared`, which surfaces `Decline` but not `Accept`. The adapter
implements Accept with the symmetric `getByRole('button', { name: 'Accept' })`
locator and a fallback set (`Accept Call`, `Accept Job`), and returns a
structured `success:false` (never throws) when the button is absent, with a
failure screenshot.

### Post-click confirmation flow — UNVERIFIED
We did **not** click Decline/Accept during discovery (it would decline/accept a
real member's tow). After clicking, Salesforce typically opens a reason/confirm
modal. The adapter handles this defensively: it looks for a reason textarea and
a confirming button (`Submit` / `Confirm` / `Save` / `Decline`), fills the
reason, confirms, then captures a confirmation string (toast / status text).
**This modal flow needs a human to verify against a live offered job.**

## Towbook
Towbook is **dispatch-out** (we push calls *to* it), not motor-club intake.
There is no Accept/Decline surface — `docs/TOWBOOK_DOM_MAP.md` documents only
login / search / parse. Towbook credentials are also not present in any
environment we can read (no `TOWBOOK_USERNAME` / `TOWBOOK_PASSWORD` in Railway;
real creds live encrypted in the tenant credentials store). See
`docs/BLOCKERS.md`. The adapter keeps a structured no-op that returns
`success:false, error:'not-applicable'`.

## Human verification checklist (Chris)
1. When a **real offered/pending** AAA job exists, open it and confirm the
   button label is exactly **"Accept"** (vs "Accept Call"/"Accept Job"). Update
   `ACCEPT_BUTTON_NAMES` in `aaa-portal.adapter.ts` if different.
2. Click **Decline** on a test job and confirm the reason-modal flow: is there a
   reason textarea? What is the confirming button's label? Update
   `DECLINE_CONFIRM_NAMES` / `REASON_FIELD` if needed.
3. Confirm the post-action confirmation indicator (toast text / status change)
   so `confirmationEvidence` captures something meaningful.
