# S29 — Blockers / pre-existing conditions

Append-only. Nothing here blocked completion; documented per CLAW.md.

## B1 — VAPID keys not yet on prod (expected, operator follow-up)
Push *delivery* requires `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`
on the API service. Keys are generated and in `docs/sessions/S29_OPERATOR_TODO.md`
(gitignored, not committed). Until set, `PushService.send*` is a logged no-op and
subscriptions still persist — safe to deploy. Conservative path taken: no keys in repo.

## B2 — Pre-existing web typecheck noise (NOT introduced by S29)
`pnpm exec tsc --noEmit` in `packages/web` reports errors in `tests/e2e/*.spec.ts` and
`playwright.config.ts`: `Cannot find module '@playwright/test'`. `@playwright/test` is not
a declared dependency in `packages/web/package.json`, so this fails on `main` too — it is
not caused by this branch. Production build is `next build`, which does not compile the
Playwright e2e suite. All S29-authored web files (`driver/page.tsx`, `_lib/push-client.ts`,
`api/driver/push/**`) typecheck clean. Left untouched — outside S29 scope.

## B3 — Deep-link `?job=ID` lands on /driver active view
Notification URL is `/driver?job=ID`. The driver home already surfaces the driver's active
(assigned) job, so the tap lands on the correct job. A dedicated job-detail-by-id route was
out of scope; `?job=` is reserved for that future view. Conservative: no new route added.
