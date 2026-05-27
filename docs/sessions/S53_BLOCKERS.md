# S53 — Dispatch Anywhere adapter — Blockers

## B1 — Live DOM unverified

**Status:** open, non-blocking for ship.

`DISPATCHANYWHERE_USERNAME` / `DISPATCHANYWHERE_PASSWORD` are not present in
this build environment, so the discovery script could not be run against a
live account. All selectors in `dispatch-anywhere.adapter.ts` are
**best-effort placeholders** (see `docs/ADAPTER_SELECTORS.md` →
"Dispatch Anywhere"):
- Login URL: `https://app.dispatchanywhere.com/login` (assumed standard SaaS).
- Dispatch list URL: `https://app.dispatchanywhere.com/dispatch` (assumed).
- Row selector: tried in order, first non-empty wins.
- Accept / Decline / confirm button labels: candidate lists.

**Mitigation:**
- Every action method is no-throw and screenshots on failure.
- `credentials-not-configured` is the explicit no-session result, so the
  scheduler never crash-loops on a tenant without configured creds.
- Discovery script (`packages/api/scripts/discover-dispatch-anywhere-selectors.ts`)
  is committed and read-only — operator can run it the moment a test account
  exists and selectors land in the diagnostic JSON.

**Unblock path:**
1. Operator obtains test creds and exports the two env vars.
2. `cd packages/api && pnpm exec tsx scripts/discover-dispatch-anywhere-selectors.ts`.
3. Read `docs/diagnostics/dispatchanywhere-selectors-YYYYMMDD.json` →
   collapse selector candidates to the verified ones, push a small
   follow-up PR.

## B2 — `dispatchJob` write surface unknown

**Status:** open, intentionally stubbed.

Same posture as Omadi / TowLogs: no verified outbound-write surface, so
`dispatchJob` returns `{ success:false, error:'not-applicable: …' }`.

**Unblock path:** if Dispatch Anywhere publishes a public dispatch API (or a
DOM affordance), swap the stub for a real Playwright (or HTTP) flow. Not on
the critical path today.

## B3 — Reason-modal flow unverified

**Status:** open, defensive code in place.

We have no live capture of the post-Decline modal. The adapter:
- Looks for a dialog (`[role="dialog"], .modal`).
- If present, fills the last visible `textarea` (or last `input[type="text"]`)
  with the supplied reason.
- Clicks one of `Decline | Accept | Submit | Confirm | Save | OK | Yes`.

**Unblock path:** once an operator declines a test job, replace the candidate
arrays with the exact labels and replace the field-finder with the verified
selector.
