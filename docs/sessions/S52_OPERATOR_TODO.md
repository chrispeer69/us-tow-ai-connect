# Session 52 — Operator follow-up

## Before enabling Omadi for any tenant

### 1. Run live discovery once
Set the discovery env vars locally and run the read-only script to confirm
selectors before any production tenant ships:

```powershell
$env:OMADI_USERNAME = "<your-account-email>"
$env:OMADI_PASSWORD = "<your-account-password>"
Set-Location C:\Users\chris\Documents\us-tow-ai-connect\packages\api
pnpm exec tsx scripts/discover-omadi-selectors.ts
```

Output lands in `docs/diagnostics/omadi-selectors-<timestamp>.json` plus
`docs/diagnostics/omadi-discovery.png` (screenshot, gitignored). Send both
to whoever maintains the adapter.

### 2. Spot-check the verification checklist
Walk through the **Human verification checklist (Omadi — first live job)**
at the bottom of `docs/ADAPTER_SELECTORS.md`. Update the adapter constants
if any of:
- `LOGIN_URL`
- `DISPATCH_URL`
- `ROW_SELECTOR_CANDIDATES`
- `ACCEPT_BUTTON_NAMES` / `DECLINE_BUTTON_NAMES`
- `CONFIRM_BUTTON_NAMES`
- the toast-locator inside `readConfirmation`

…differ from the placeholders.

### 3. Enter Omadi credentials in admin onboarding (tenant zero)
Production credentials are read from the encrypted `tenant_credentials` table.
For tenant zero (or whichever pilot tenant goes first with Omadi):

1. Go to admin onboarding → integration credentials.
2. Select **Omadi** as the dispatch software type.
3. Enter the Omadi account email + password — encrypted at rest with
   AES-256-GCM, same path used by AAA / Towbook / TowLogs.
4. Confirm a green check on `testConnection` before flipping the tenant's
   `softwareType` to `OMADI` in their config.

### 4. Watch the first live accept/decline
The adapter screenshots every failure to `/tmp/omadi-<method>-<jobId>-<ts>.png`.
For the first real Accept and first real Decline, pull the API container's
`/tmp` (or the equivalent in your deploy) and verify either:
- success result with `confirmationEvidence` quoting a real toast/status, or
- a failure screenshot showing exactly which DOM element the adapter expected
  but didn't find — then patch the selector and redeploy.

### 5. dispatchJob expectations
The adapter's `dispatchJob` returns `success:false, error:'not-applicable: ...'`
by design. If Omadi exposes a verified outbound dispatch surface later,
replace the stub. Until then, do not route US-Tow outbound dispatches through
the Omadi adapter — they will no-op (audit row will reflect that).
