# scripts/security

Security tooling for the secret sweep + rotation workflow (Session 41).

## Contents

| Path | Purpose |
|------|---------|
| `bin/gitleaks.exe` | gitleaks v8.21.2 (Windows). **Git-ignored** — install per below. |
| `rotate-encryption-key.ts` | Re-encrypt `tenant_credentials` when rotating `ENCRYPTION_KEY`. Dry-run by default. |

## Install gitleaks (Windows)

```powershell
curl -sL -o scripts/security/bin/gitleaks.zip `
  https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_windows_x64.zip
Expand-Archive scripts/security/bin/gitleaks.zip -DestinationPath scripts/security/bin/ -Force
Remove-Item scripts/security/bin/gitleaks.zip, scripts/security/bin/LICENSE, scripts/security/bin/README.md
scripts/security/bin/gitleaks.exe version
```

macOS/Linux: `brew install gitleaks` or grab the matching release asset.

## Run the secret sweep

```
scripts/security/bin/gitleaks.exe detect --source . --config .gitleaks.toml --no-banner
```

Clean state = exit 0, "no leaks found". See `docs/security/SECRET_FINDINGS.md`.

## Rotate ENCRYPTION_KEY

See the full runbook in `docs/security/ROTATION_PLAYBOOK.md` §ENCRYPTION_KEY.
Quick reference:

```
# Dry run (no writes — the default):
OLD_ENCRYPTION_KEY=<64-hex> NEW_ENCRYPTION_KEY=<64-hex> DATABASE_URL=<url> \
  pnpm --filter @ustow/api exec tsx ../../scripts/security/rotate-encryption-key.ts

# Apply (single transaction, rolls back on any error):
OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... DATABASE_URL=... \
  pnpm --filter @ustow/api exec tsx ../../scripts/security/rotate-encryption-key.ts --apply
```

The script mirrors `packages/api/src/common/utils/encryption.util.ts`
(AES-256-GCM, 12-byte IV per field, `iv`/`authTag` stored as `<u>:<p>` pairs).
Always snapshot the database before `--apply`.
