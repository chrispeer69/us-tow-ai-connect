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

## TowLogs (towlogs.com)

TowLogs is a dispatch SaaS used by tow operators. Built **best-effort** in
Session 51 — no live credentials were available at build time, so selectors are
educated guesses derived from common dispatch-SPA conventions and the role-based
locator strategy that worked for AAA. Every guess is verified by the adapter at
runtime (count > 0 + visible + enabled) before it clicks anything; misses
return `{ success: false, error }` and screenshot to `/tmp` rather than
throwing.
## Omadi (omadi.com)

Omadi is dispatch software for tow operators. Built **best-effort** in Session
52 — no live credentials were available at build time, so selectors are
educated guesses derived from common dispatch-SPA conventions and the
role-based locator strategy that worked for AAA. Every guess is verified by
the adapter at runtime (count > 0 + visible + enabled) before it clicks
anything; misses return `{ success: false, error }` and screenshot to `/tmp`
rather than throwing.

### Login (best-effort)
| Step | Selector | Confidence |
|------|----------|------------|
| username | `input[name="email"]`, `input[type="email"]`, `input[name="username"]`, `#email`, `#username` (first hit) | best-effort |
| password | `input[type="password"]`, `input[name="password"]`, `#password` (first hit) | best-effort |
| submit | `getByRole('button', { name: /sign in|log ?in|login/i })` then fallback to `button[type="submit"]` | best-effort |
| success | URL no longer contains `/login` | best-effort |

### Open jobs list
- URL: `https://app.towlogs.com/jobs` (assumed — needs confirmation)
- Row selector candidates (first non-empty wins, in this order):
  `[data-job-id]`, `[data-call-id]`, `table tbody tr[data-id]`, `tr.job-row`,
  `.job-row`, `.job-card`, `li.job`, `[role="row"]`
- Per-row fields read from optional child selectors (`[data-customer]` /
  `.customer-name`, `[data-vehicle]` / `.vehicle`, etc.) — `cleanText()` returns
  empty string when absent, so adapter does not crash on a minimal row.

### Action buttons (best-effort, role-based)
The adapter locates Accept / Decline with `getByRole('button', { name, exact: true })`,
which pierces open shadow DOM. Tried in order, first visible+enabled hit wins:

| Action | Accessible name candidates | Confidence |
|--------|---------------------------|------------|
| **Accept** | `Accept`, `Accept Job`, `Accept Call`, `Accept Dispatch` | placeholder |
| **Decline** | `Decline`, `Decline Job`, `Decline Call`, `Reject` | placeholder |
### Dispatch board / open-jobs list
- URL: `https://app.omadi.com/dispatch` (assumed — needs confirmation)
- Row selector candidates (first non-empty wins, in this order):
  `[data-job-id]`, `[data-call-id]`, `[data-dispatch-id]`,
  `table tbody tr[data-id]`, `tr.dispatch-row`, `.dispatch-row`,
  `tr.job-row`, `.job-row`, `.job-card`, `[role="row"]`
- Per-row fields read from optional child selectors (`[data-customer]` /
  `.customer-name`, `[data-vehicle]` / `.vehicle`, etc.) — `cleanText()` returns
  empty string when absent.

### Action buttons (best-effort, role-based)
The adapter locates Accept / Decline with `getByRole('button', { name, exact: true })`,
which pierces open shadow DOM. Tried in order, first visible+enabled wins:

| Action | Accessible name candidates | Confidence |
|--------|---------------------------|------------|
| **Accept** | `Accept`, `Accept Job`, `Accept Dispatch`, `Accept Call` | placeholder |
| **Decline** | `Decline`, `Decline Job`, `Decline Dispatch`, `Reject` | placeholder |
| **Confirm modal** | `Decline`, `Accept`, `Submit`, `Confirm`, `Save`, `OK`, `Yes` | placeholder |

### Confirmation indicators
The adapter reads the first match from `[role="status"], .toast, .notification, .alert`
as `confirmationEvidence`. If absent, falls back to a synthetic timestamp string
(`"action submitted at <ISO> (no toast captured)"`) — the click still succeeded;
the audit row just doesn't carry a toast quote.

### dispatchJob — not-applicable stub
TowLogs appears to be intake-oriented (we accept jobs offered to us). No
verified public write/dispatch API surface. Adapter returns
`{ success: false, error: 'not-applicable: ...' }` — matches the Towbook
inverse pattern.

### Known gotchas
1. **Login URL unverified** — `https://app.towlogs.com/login` is the
   conventional pattern; if TowLogs lives on a marketing-vs-app split host
   (e.g. `app.` vs `dispatch.`), update `LOGIN_URL` in the adapter constant.
2. **Row schema unknown** — the row extractor reads optional child selectors;
   real rows will likely surface only a subset, so adapter scrape may return
   sparse `ActiveJob` records until selectors are spot-checked against a live
   account.
3. **Modal flow unverified** — the optional reason-modal flow is best-effort
   only. If TowLogs uses a custom dialog component (not `[role="dialog"]` or
   `.modal`), the confirm-button click will be skipped silently and the primary
   click result is still recorded.

### Human verification checklist (TowLogs — first live job)
1. Confirm login URL (`https://app.towlogs.com/login` vs alternate host).
2. Confirm open-jobs URL (`https://app.towlogs.com/jobs` vs `/dispatch`, `/calls`).
3. Open browser devtools on a real open-jobs list and report which `ROW_SELECTOR_CANDIDATES`
   resolves > 0 rows; pin that selector at the top of the array.
4. Note exact button label for Accept (`Accept` vs `Accept Job` vs `Accept Call`)
   and Decline.
as `confirmationEvidence`. If absent, falls back to a synthetic timestamp
string (`"action submitted at <ISO> (no toast captured)"`).

### dispatchJob — not-applicable stub
Omadi is dispatch software for the operator's own jobs; it is not a motor-club
intake broker with a verified public write API. Adapter returns
`{ success: false, error: 'not-applicable: ...' }` — matches the
Towbook / TowLogs pattern.

### Known gotchas
1. **Login URL unverified** — `https://app.omadi.com/login` is the
   conventional pattern; confirm against the real marketing/app split if
   different.
2. **Dispatch URL unverified** — `https://app.omadi.com/dispatch` is a guess;
   the real path may be `/jobs`, `/calls`, `/board`, etc.
3. **Row schema unknown** — the row extractor reads optional child selectors;
   real rows will likely surface only a subset, so scrape may return sparse
   `ActiveJob` records until selectors are spot-checked.
4. **Modal flow unverified** — best-effort `[role="dialog"], .modal` scope; if
   Omadi uses a custom component, the confirm-button click will be skipped
   silently and the primary click is still recorded.

### Human verification checklist (Omadi — first live job)
1. Confirm login URL (`https://app.omadi.com/login` vs alternate host).
2. Confirm dispatch URL (`/dispatch` vs `/jobs`, `/calls`, `/board`).
3. Open browser devtools on a real dispatch list and report which
   `ROW_SELECTOR_CANDIDATES` resolves > 0 rows; pin that selector at the top
   of the array.
4. Note exact button label for Accept (`Accept` vs `Accept Job` vs
   `Accept Dispatch`) and Decline.
5. Confirm the reason-modal label/structure when declining a real job.
6. Note the post-action confirmation indicator (toast / status change / route
   change) so `confirmationEvidence` captures something meaningful.

After verification, update `LOGIN_URL`, `OPEN_JOBS_URL`, `ROW_SELECTOR_CANDIDATES`,
`ACCEPT_BUTTON_NAMES`, `DECLINE_BUTTON_NAMES`, `CONFIRM_BUTTON_NAMES`, and the
toast-locator in `towlogs.adapter.ts`.
After verification, update `LOGIN_URL`, `DISPATCH_URL`,
`ROW_SELECTOR_CANDIDATES`, `ACCEPT_BUTTON_NAMES`, `DECLINE_BUTTON_NAMES`,
`CONFIRM_BUTTON_NAMES`, and the toast-locator in `omadi.adapter.ts`.

## Human verification checklist (Chris)
1. When a **real offered/pending** AAA job exists, open it and confirm the
   button label is exactly **"Accept"** (vs "Accept Call"/"Accept Job"). Update
   `ACCEPT_BUTTON_NAMES` in `aaa-portal.adapter.ts` if different.
2. Click **Decline** on a test job and confirm the reason-modal flow: is there a
   reason textarea? What is the confirming button's label? Update
   `DECLINE_CONFIRM_NAMES` / `REASON_FIELD` if needed.
3. Confirm the post-action confirmation indicator (toast text / status change)
   so `confirmationEvidence` captures something meaningful.
