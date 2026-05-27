# Session 65 — Session-failure observability + circuit breaker

## Why this session exists

Tenant zero (Roadside Towing) saved Towbook credentials, the
JobPollerCron tried to scrape, the session refresh ran on the next
cycle, and the credential row went straight to `session_status = FAILED`
with `last_login_success = null` — meaning **no successful login has
ever happened on prod**. The catch block recorded "FAILED" and threw the
actual exception message on the floor. The only way to see WHY would
have been to read Railway container logs, which neither operator nor I
had direct access to.

That also meant the poller (every 60 s) and SessionManager (every 15
min) would keep hammering the Towbook account with the same broken
credentials indefinitely, which is exactly how account lockouts and IP
bans happen.

## What this session adds

**Observability**

- New migration **0027_session_failure_reason** adds four columns to
  `tenant_credentials`: `failure_reason` (text — the raw exception
  message, truncated at 2000 chars), `failure_kind` (varchar(40) — a
  coarse category), `failed_login_count` (integer — monotonic, reset
  on success), `last_failure_at` (timestamptz).
- `SessionManagerService` now captures and persists these on every
  failure, and clears them on every success.
- `AdminService.testCredentials` (the path behind the Test button)
  does the same.
- `AdminService.getIntegrationStatus` exposes all four to the admin UI
  so the operator can see exactly why a connection is failing without
  reading container logs.

**Circuit breaker**

- `JobPollerCron.pollSingleTenant` now reads the credential row before
  acting. If `failed_login_count >= 3` and `last_failure_at` is within
  the last hour, the tenant is skipped entirely for that cycle. After
  the hour elapses the poller resumes normal cadence.
- Three strikes per hour was chosen because Towbook itself appears to
  tolerate 3-5 failed logins before slowing the next attempt; we stay
  comfortably under that.

**Classifier**

- A small pure function `classifyFailure(message)` translates the raw
  exception text into one of LAUNCH / NAVIGATION / SELECTOR / AUTH /
  TIMEOUT / NETWORK / CAPTCHA / UNKNOWN. Pure function, no Playwright
  imports, 15 unit tests in `classify-failure.spec.ts`.

## What this session deliberately does NOT do

- It does NOT change the TowbookAdapter login flow. Whatever Towbook is
  doing today (CAPTCHA, MFA, different markup, account hold) will still
  cause the same exception. The point of S65 is to make that exception
  legible — once the operator can see "kind=CAPTCHA" or "kind=AUTH" in
  the admin UI, the next fix is a 5-minute conversation, not a
  half-day investigation.
- It does NOT retry on its own. If credentials fail, the circuit
  stays open until the cooldown expires OR `failed_login_count` is
  cleared by a successful login or a manual DB update.
- It does NOT touch Towbook from this build. The author of S65 paused
  tenant zero (`is_active = false`) before pushing, specifically so
  the new code path isn't tested against a live account that's already
  in a fragile state. The operator should manually re-enable tenant
  zero once they have a fix for the underlying credential issue.

## Migration safety

`0027_session_failure_reason.sql` is fully idempotent:
- All columns use `ADD COLUMN IF NOT EXISTS`
- `failed_login_count` has `NOT NULL DEFAULT 0` so existing rows pick
  up zero on backfill
- The partial index `tenant_credentials_failure_kind_idx` uses
  `CREATE INDEX IF NOT EXISTS`

Safe to run on every deploy. Safe to re-run.
