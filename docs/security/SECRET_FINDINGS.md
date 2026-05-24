# Secret Findings — Session 41

**Scan date:** 2026-05-24
**Tool:** gitleaks v8.21.2 (`detect --source . --no-banner`)
**Scope:** full git history — 112 commits scanned
**Raw report:** regenerate locally; `docs/security/gitleaks-report.json` is git-ignored
because it embeds matched strings (all placeholders here, but ignored on principle).

## Summary

| Severity | Count | Action |
|----------|-------|--------|
| High (real secret in history) | 0 | — |
| Medium (real-looking, needs human confirm) | 0 | — |
| Low (placeholder / test fixture / doc example) | 6 | Allowlisted in `.gitleaks.toml` |

**Bottom line:** no real, live secret has ever been committed to this repository.
All 6 raw hits are non-sensitive placeholders, generator constants, or unit-test
fixtures. They are suppressed via fingerprint allowlist so CI stays green.

## Findings (values redacted)

| # | File | Rule | Why it is NOT a real secret | Disposition |
|---|------|------|------------------------------|-------------|
| 1 | `docs/RATE_LIMITING.md` | generic-api-key | Documentation example key `usk_a1b2…` illustrating the throttle identifier format | Allowlist |
| 2 | `packages/api/src/modules/tracking/tracking.service.ts` | generic-api-key | `TOKEN_ALPHABET` — the base58-style character set used to *generate* tracking tokens; a constant alphabet, not a credential | Allowlist (path) |
| 3 | `packages/api/.env.example` (current) | generic-api-key | `ENCRYPTION_KEY=0123…cdef` — the documented "generate your own" placeholder (repeating hex) | Allowlist (path) |
| 4 | `packages/api/src/common/guards/twilio-signature.guard.spec.ts` | generic-api-key | `AUTH_TOKEN='1234…cdef'` — a unit-test fixture for the Twilio signature guard | Allowlist (path) |
| 5 | `packages/api/.env.example` (earlier commit) | generic-api-key | Same placeholder as #3, older commit in history | Allowlist (fingerprint) |
| 6 | `docs/BUILD_SESSIONS.md` | generic-api-key | Literal placeholder text `a1b2c3d4e5f6...64_hex_chars` in build notes | Allowlist (path) |

## Targeted history checks (out-of-band)

Ran focused `git log -S` / `git grep` across all refs for known-sensitive patterns:

| Pattern | Commits in history | Notes |
|---------|--------------------|-------|
| AAA password (chat-disclosed value) | 0 | **Never committed.** Exposed only in operator chat — see playbook §AAA. |
| `chrispeer69@yahoo.com` | 0 | AAA login email never committed |
| `sk_live_` (Stripe live key) | 0 | Stripe not yet wired into codebase |
| `SG.` (SendGrid) | placeholder only | `SENDGRID_API_KEY=SG.xxx` in `docs/BUILD_SESSIONS.md` — placeholder |
| `AKIA` (AWS) | 0 | — |

## Action items

1. **AAA Salesforce password** — rotate regardless of repo cleanliness; it was
   disclosed in a chat transcript. Tracked in `ROTATION_PLAYBOOK.md` §AAA and
   `S41_OPERATOR_TODO.md`.
2. Keep `.gitleaks.toml` allowlist tight — every entry is a reviewed placeholder.
   New genuine hits must fail CI, not be added to the allowlist.
3. `gitleaks-report.json` stays git-ignored. Operators regenerate on demand:
   `scripts/security/bin/gitleaks.exe detect --source . --report-path docs/security/gitleaks-report.json --no-banner`
