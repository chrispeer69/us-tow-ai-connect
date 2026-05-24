# Session 41 — Decisions

Decisions made autonomously per CLAW.MD (owner unavailable until PR open).
Conservative path chosen and documented; no blocking on owner input.

1. **gitleaks via downloaded binary, not committed.** No package manager / Go
   toolchain present. Downloaded `gitleaks_8.21.2_windows_x64` to
   `scripts/security/bin/gitleaks.exe`. The 6 MB binary is **git-ignored** (not
   committed) — install steps documented in `S41_OPERATOR_TODO.md`. Keeps the
   repo binary-free while making the tool reproducible.

2. **Raw gitleaks report git-ignored.** `docs/security/gitleaks-report.json`
   embeds matched strings. Even though all 6 matches are placeholders, per the
   "no actual secrets in PR" rule the raw report is git-ignored; only the
   redacted `SECRET_FINDINGS.md` is committed.

3. **All 6 gitleaks hits classified LOW / false-positive.** Doc examples,
   generator constants (`TOKEN_ALPHABET`), `.env.example` placeholders, and a
   unit-test fixture. Suppressed via `.gitleaks.toml` allowlist so CI is green
   without ignoring future real hits. Reviewed individually in `SECRET_FINDINGS.md`.

4. **Created `.gitleaks.toml` at repo root.** Not in the session's listed owned
   paths, but required for the CI workflow (task 8) and the allowlist. It is a
   new file (no overwrite), touches nothing in `packages/**` or the forbidden
   docs, and is squarely within the session's secrets scope. Proceeded.

5. **Env-var delta appended to ROOT `.env.example`, not the package templates.**
   The real variables live in `packages/api/.env.example` and
   `packages/web/.env.example`, but `packages/**` is DO-NOT-TOUCH and the root
   `.env.example` is the only env template I own (append-only). Appended the
   discovered-but-undocumented vars there as a pointer section with placeholders
   + comments. Package templates left for a future package-owning session.

6. **Stripe documented as "not yet wired."** `STRIPE_SECRET_KEY` /
   `STRIPE_WEBHOOK_SECRET` have zero `process.env` references in the codebase.
   Included in `ROTATION_PLAYBOOK.md` (task requested them) but clearly marked
   reserved/not-live so no one assumes a live integration exists.

7. **AAA password: flagged, not rotated.** Rotation requires logging into the
   AAA portal — operator-only. Documented in playbook §AAA and
   `S41_OPERATOR_TODO.md` item 1. Confirmed via `git log -S` it was never
   committed (0 hits / 112 commits).

8. **Rotation script keeps dry-run as the default.** `--apply` required to write;
   all rows verified in memory (decrypt-old → encrypt-new → round-trip) before
   any write; writes wrapped in a single transaction. Conservative by design.
