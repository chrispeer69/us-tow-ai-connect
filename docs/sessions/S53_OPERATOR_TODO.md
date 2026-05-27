# S53 — Dispatch Anywhere adapter — Operator follow-up

Adapter ships ahead of live DOM verification. None of these are deploy-blocking
— scrapeAllActiveJobs / acceptJob / declineJob all fail soft (no throw,
screenshot on failure, `credentials-not-configured` when no session exists).

## 1. Run the discovery script against a real account

Get test credentials for `app.dispatchanywhere.com`. Then, from the API
package:

```sh
cd packages/api
DISPATCHANYWHERE_USERNAME=… DISPATCHANYWHERE_PASSWORD=… \
  pnpm exec tsx scripts/discover-dispatch-anywhere-selectors.ts
```

- Read-only: never clicks Accept / Decline / Dispatch / any mutating control.
- Writes `docs/diagnostics/dispatchanywhere-selectors-YYYYMMDD.json`
  (PII-redacted, safe to commit) and a screenshot
  `docs/diagnostics/dispatchanywhere-discovery.png` (git-ignored, may contain
  member data).
- Headed inspection: prefix with `HEADFUL=1`.

## 2. Tighten selectors

Open the diagnostic JSON and harvest:
- `landedUrl` — confirm the post-login URL the adapter waits for (currently
  matches any URL that no longer contains `/login`).
- `listView.rowCounts` — pick the first selector that returned > 0 rows,
  promote it to the head of `ROW_SELECTOR_CANDIDATES` in
  `packages/api/src/modules/adapters/dispatch-anywhere/dispatch-anywhere.adapter.ts`.
- `locatorProbe.results` — pick the Accept / Decline labels that came back
  with `count: 1, visible: true, enabled: true` and trim the candidate lists.
- `detailView` — confirm the detail URL shape; if the dispatch list opens
  detail via a URL pattern rather than a row link, adapt `performAction` to
  navigate directly.

## 3. Decline-flow live walkthrough

On a **test** tenant / job:
1. Click Decline once manually with a reason.
2. Capture: is there a textarea or a text input? What is the confirming
   button label exactly?
3. Update `CONFIRM_BUTTON_NAMES` and the reason-field finder in the adapter.

## 4. Confirmation evidence

Confirm what visible element changes post-action (toast text, status badge).
Adjust the `readConfirmation` locator chain so `confirmationEvidence` captures
a meaningful string instead of falling through to the timestamp-only fallback.

## 5. Production credentials

Production tenants store credentials encrypted in `tenant_credentials` — same
flow as Omadi / TowLogs / AAA Portal. The discovery env vars are **discovery
only**; nothing in the runtime adapter reads `DISPATCHANYWHERE_USERNAME` or
`DISPATCHANYWHERE_PASSWORD`. No deploy-time secret to provision.

## 6. Wire a tenant

When a tenant is configured with `softwareType: 'DISPATCH_ANYWHERE'` (or the
compact `'DISPATCHANYWHERE'` — both work, see the factory), the existing
scheduler / scrape pipeline picks up the adapter automatically via
`AdapterFactory.getAdapter`. No additional wiring required.
