# S53 — Dispatch Anywhere adapter — Decisions

Session goal: production-ready `DispatchAnywhereAdapter` mirroring the
TowLogs / Omadi Playwright pattern (Redis-cached session, role-based locators,
no-throw accept / decline / dispatch).

## D1 — Reference adapter: Omadi (and AAA Portal for verified shadow-DOM pattern)

The brief named Omadi as the freshest reference; Omadi was just shipped in
session 52 but is not yet merged into `main`, so the worktree at
`C:\Users\chris\Documents\usw-omadi` is the canonical copy I read against.
Where the Omadi pattern was lighter (e.g., not yet probed against a live DOM),
I cross-referenced AAA Portal — the only adapter in this repo with verified
shadow-DOM-pierced selectors. The structural choices match Omadi line-for-line
so a future operator can diff the two and read each one as a sibling.

## D2 — Session key namespace + jobs cache key

- Session: `session:dispatchanywhere:<tenantId>` (TTL 3600s, matches Omadi)
- Jobs:    `jobs:dispatchanywhere:<tenantId>`    (TTL 300s, matches Omadi)

Compact `dispatchanywhere` (no separator) is the storage form — keeps the key
short, mirrors the lowercase factory key called for in the brief.

## D3 — Enum value `SoftwareType.DISPATCH_ANYWHERE`

Added a new enum member `DISPATCH_ANYWHERE = 'DISPATCH_ANYWHERE'` to
`adapter.interface.ts`. The brief asked for the factory to register a
lowercase `'dispatchanywhere'` key; the factory now accepts **both**
`DISPATCH_ANYWHERE` (enum form) and `DISPATCHANYWHERE` (compact form, what the
brief literally specified) by `.toUpperCase()` comparison. This keeps the enum
self-consistent with `AAA_PORTAL` / `OMADI` while preserving the caller-side
flexibility the brief implied.

**Why:** the `tenant_credentials` row could land either form depending on who
seeds it; this resolver eats the difference. Conservative — neither form
silently fails.

## D4 — `dispatchJob` returns structured `not-applicable`

Dispatch Anywhere is primarily a tow-operator dispatch product. There is no
public, verified outbound dispatch write surface. Following the Omadi / TowLogs
precedent, `dispatchJob(tenantId, payload)` returns
`{ success:false, error:'not-applicable: Dispatch Anywhere has no verified
outbound dispatch write surface' }` — never throws, no Playwright launched.
If Dispatch Anywhere publishes a write surface later, swap this stub for a
real implementation. The method is on the class but not on the
`TowingSoftwareAdapter` interface (mirrors Omadi).

## D5 — Selector strategy: best-effort union + role-by-name primary

Without verified DOM, the adapter uses:
- Login form: a union locator covering common field names.
- Submit: role lookup with a regex `/sign in|log ?in|login/i`, with a
  `button[type="submit"]` fallback.
- Job rows: a 10-candidate `ROW_SELECTOR_CANDIDATES` array, first non-empty
  wins.
- Accept / Decline: candidate label lists passed through `firstVisibleButton`,
  which uses `getByRole('button', { name, exact: true })` (pierces open shadow
  DOM, same approach proven in the AAA Portal adapter).
- Confirm modal: `[role="dialog"], .modal`; reason field is last visible
  `textarea`, falling back to last visible `input[type="text"]`.

Every action method returns `{ success:false, error }` and screenshots to
`os.tmpdir()` on failure — operator can pull the screenshot to debug a missed
selector without re-running discovery.

## D6 — Discovery script filename: `dispatchanywhere-selectors-YYYYMMDD.json`

Brief specified `YYYYMMDD` (day stamp), not the second-resolution timestamp
the Omadi script uses. Adopted literally: one file per day, same-day reruns
overwrite. Keeps `docs/diagnostics/` from accumulating clutter when the
operator iterates on a discovery run.

## D7 — Discovery skipped: no creds in environment

No `DISPATCHANYWHERE_USERNAME` / `DISPATCHANYWHERE_PASSWORD` in this worktree's
env. Per CLAW (conservative path → document → continue), I ran the script's
graceful-skip path (which wrote `docs/diagnostics/dispatchanywhere-selectors-20260527.json`
with `{ ok:false, stage:'env' }`) and logged the live-probe blocker in
`S53_BLOCKERS.md`. The adapter ships with placeholder selectors clearly marked
in `docs/ADAPTER_SELECTORS.md`; first live tenant onboarding will trigger
verification + tightening.

## D8 — Env vars are discovery-only

`DISPATCHANYWHERE_USERNAME` / `DISPATCHANYWHERE_PASSWORD` exist solely to drive
the one-off discovery script. Production tenants supply credentials through
the encrypted `tenant_credentials` store; the adapter never reads env in any
of its login / scrape / action paths. No deploy-time secret to provision.
