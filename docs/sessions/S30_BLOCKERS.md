# Session 30 — Blockers / Known Issues

Branch: `session/30-sidebar-cleanup` · Date: 2026-05-24

## B1. Web Playwright e2e tsc errors — pre-existing, environmental
- `npx tsc --noEmit` in `packages/web` (which sweeps `**/*.ts`) reports errors **only** in:
  - `tests/e2e/*.spec.ts` (`driver-home`, `driver-map`, `onboarding`) — implicit `any` + `Cannot find module '@playwright/test'`
  - `playwright.config.ts` — `Cannot find module '@playwright/test'`
- Root cause: `@playwright/test` is **not installed** in this environment.
- **Not caused by Session 30.** Zero errors in app code; zero in `Sidebar.tsx`. The canonical web typecheck is `next build`, which does not compile these Playwright files.
- Scope: those e2e files cover driver/onboarding flows — **DO NOT TOUCH** per session ownership.
- **Conservative path taken:** left untouched. Resolution belongs to the owner / another session: `pnpm --filter @ustow/web add -D @playwright/test`.
- Kept building — does not block the Session 30 deliverables.
