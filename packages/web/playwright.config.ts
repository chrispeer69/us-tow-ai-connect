import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the driver app E2E suite.
 *
 * Run with `pnpm --filter @ustow/web exec playwright test` (requires
 * `@playwright/test` to be installed first — see docs/BLOCKERS.md if the
 * dep hasn't landed in the lockfile yet).
 *
 * The webServer block starts `next dev` automatically and reuses an
 * existing dev server when one is already on :3000.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    viewport: { width: 390, height: 844 }, // Phone-ish portrait.
  },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        port: 3000,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
