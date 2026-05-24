# Session 41 — Operator TODO

Actions only the operator (Chris) can perform. Numbered by priority.

## 1. Rotate the AAA password (DO THIS FIRST) ⚠️

The AAA portal password for `chrispeer69@yahoo.com` was disclosed in a chat
transcript (value intentionally not reproduced here). It was **never committed to
the repo** (verified clean across all 112 commits), but a chat disclosure is an
exposure.

- [ ] Log in to the AAA partner portal (Salesforce) → change the password.
- [ ] Enable MFA on the AAA account if available.
- [ ] Admin dashboard → tenant onboarding → re-enter AAA credentials (re-encrypts
      the `tenant_credentials` row).
- [ ] Verify an AAA adapter login succeeds (`session_status` → `ACTIVE`).
- [ ] Record in `docs/security/ROTATION_SCHEDULE.md` rotation log.

Full steps: `docs/security/ROTATION_PLAYBOOK.md` §AAA.

## 2. Confirm Railway has no stray real secrets in committed files

Already verified: production secrets are Railway-only; repo history is clean.
No action unless you have a local `.env` — keep it out of git (now enforced by
`.gitignore`).

## 3. Enable the secret-scan CI workflow (optional, recommended)

`.github/workflows/secret-scan.yml` runs gitleaks on every PR. It is committed
and ready. To activate:

- [ ] Confirm GitHub Actions is enabled for the repo.
- [ ] (Org repos only) add a `GITLEAKS_LICENSE` secret if your org enforces it.
- [ ] First PR will run it automatically.

## 4. Quarterly rotation (ongoing)

- [ ] Put the Q2 2026 rotation window (week of 2026-06-15) on your calendar.
- [ ] Follow `docs/security/ROTATION_SCHEDULE.md`.

---

## gitleaks install (how it was set up this session)

gitleaks is **not** committed to the repo (binary is git-ignored). To (re)install
the Windows binary used in Session 41:

```powershell
# From repo root:
curl -sL -o scripts/security/bin/gitleaks.zip `
  https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_windows_x64.zip
Expand-Archive scripts/security/bin/gitleaks.zip -DestinationPath scripts/security/bin/ -Force
Remove-Item scripts/security/bin/gitleaks.zip, scripts/security/bin/LICENSE, scripts/security/bin/README.md
scripts/security/bin/gitleaks.exe version   # expect 8.21.2
```

macOS/Linux: `brew install gitleaks` or download the matching release asset.

### Run the sweep manually

```
scripts/security/bin/gitleaks.exe detect --source . --config .gitleaks.toml --no-banner
```

- Exit 0 + "no leaks found" = clean (current state).
- The raw JSON report (`docs/security/gitleaks-report.json`) is git-ignored
  because it embeds matched strings. Regenerate with `--report-path` if needed.
