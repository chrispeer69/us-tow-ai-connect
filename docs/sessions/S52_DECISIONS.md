# Session 52 — Decisions

## Goal
Production-ready Omadi adapter mirroring the AAA + Towbook + TowLogs Playwright pattern.

## Decisions

### 1. Interface conformance
- Implement `TowingSoftwareAdapter` exactly: `login`, `scrapeAllActiveJobs`,
  `testConnection`, optional `acceptJob`/`declineJob`.
- `dispatchJob` lives on the adapter class as an additional method (not in
  the shared interface), returning a structured not-applicable result — same
  pattern Towbook + TowLogs use for their inverse no-ops.

### 2. Selectors are best-effort (no live discovery)
- `OMADI_USERNAME` / `OMADI_PASSWORD` not in env at build time. Discovery
  script written and committed, but not run live.
- Login form: union locator over the four most common patterns
  (`name="email"`, `type="email"`, `name="username"`, `#email`, `#username`)
  with a `getByRole('button', { name: /sign in|log ?in|login/i })` submit.
- Row selectors: ordered candidate list with "first non-empty wins". Includes
  `data-dispatch-id` ahead of `data-job-id` since Omadi is dispatch-focused.
- Action buttons: role-based locators that pierce open shadow DOM.
- Every guess gates on count > 0 + visible + enabled before clicking;
  misses screenshot to `/tmp` and return `{ success:false, error }`.

### 3. Session caching mirrors Towbook/AAA/TowLogs
- Storage state cached in Redis under `session:omadi:<tenantId>` with the
  shared 1-hour TTL. Jobs cached under `jobs:omadi:<tenantId>` for 5 minutes.

### 4. Adapter registration
- Edited the two centralized files (`adapter.factory.ts`, `adapters.module.ts`)
  to route `SoftwareType.OMADI` to the new adapter. The session spec listed
  the existing adapter folders (AAA / Towbook / TowLogs) as DO NOT TOUCH;
  these registry files were not in that list and needed updating for the
  factory to dispatch rather than throw "not implemented yet".

### 5. dispatchJob = not-applicable
- Omadi is dispatch software for the operator's own jobs; not a motor-club
  intake broker with a verified public write API. Returning
  `{ success: false, error: 'not-applicable: ...' }` is symmetric with
  Towbook + TowLogs.

### 6. Test mock strategy mirrors AAA + TowLogs
- Full `vi.mock('playwright')` with a hoisted handle pattern; `makePage()`
  factory controls jobLinkCount + actionButton match. Default `locator(...)`
  resolves to count=0 so the optional reason/dialog flow is inert by default.

### 7. Pre-existing test failure ignored
- `digital-dispatch/conditions.spec.ts > distance_max_miles > rejects when no
  driver has a recent ping` fails on `main` (independent of S52). File is in
  the DO NOT TOUCH list — left untouched.

### 8. URL guesses
- Login: `https://app.omadi.com/login`.
- Dispatch board: `https://app.omadi.com/dispatch`.
- Both flagged as best-effort in selectors doc and operator checklist.
