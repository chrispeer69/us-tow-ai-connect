# Session 34 — blockers

## B1 — Local visual test blocked by Windows symlink EPERM (non-blocking)

- `pnpm exec next build` **compiles successfully** and renders all 26 routes (onboarding included): `✓ Compiled successfully` + `✓ Generating static pages (26/26)`.
- Build then fails only in the `output: 'standalone'` trace-copy phase with `EPERM: operation not permitted, symlink ...`. This is Windows refusing symlink creation without Developer Mode / elevation, against the pnpm content-addressed store — an **environment** limitation, not a code defect.
- Same symlink constraint blocks a clean local dev-server visual pass.
- **Conservative path taken:** rely on `tsc --noEmit` (clean for owned files) + successful Next compile/page-gen as the correctness gate. CI on Linux (where symlinks are permitted) will exercise the full build/visual path.
- No action needed in code. Recorded for the owner.

## B2 — CI red check is a pre-existing API test, out of owned scope

- PR #1 "Type-check + tests" fails on `packages/api/src/modules/digital-dispatch/conditions.spec.ts > distance_max_miles > rejects when no driver has a recent ping` (1 failed / 152). Dockerfile lint passes.
- `packages/api/**` is **DO NOT TOUCH** this session, and the spec predates this branch (last changed in the sessions 21+22 commit `81f2f35`).
- This PR's diff is **web + docs only** — it cannot have caused an API unit-test failure. Looks like a time-dependent "recent ping" assertion gone stale at 2026-05-24.
- **Conservative path:** do not modify `packages/api` to chase a failure I don't own and didn't cause. Documented; owner to triage separately.
