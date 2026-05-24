# Session 34 — blockers

## B1 — Local visual test blocked by Windows symlink EPERM (non-blocking)

- `pnpm exec next build` **compiles successfully** and renders all 26 routes (onboarding included): `✓ Compiled successfully` + `✓ Generating static pages (26/26)`.
- Build then fails only in the `output: 'standalone'` trace-copy phase with `EPERM: operation not permitted, symlink ...`. This is Windows refusing symlink creation without Developer Mode / elevation, against the pnpm content-addressed store — an **environment** limitation, not a code defect.
- Same symlink constraint blocks a clean local dev-server visual pass.
- **Conservative path taken:** rely on `tsc --noEmit` (clean for owned files) + successful Next compile/page-gen as the correctness gate. CI on Linux (where symlinks are permitted) will exercise the full build/visual path.
- No action needed in code. Recorded for the owner.
