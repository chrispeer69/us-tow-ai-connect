import { expect, test } from '@playwright/test';

/**
 * E2E coverage for the driver home page.
 *
 * Driver app uses localStorage for the profile and live geolocation for
 * pings. Each test seeds localStorage before navigation and patches
 * `navigator.geolocation` via `context.addInitScript` so the geolocator
 * fires deterministically without a permission dialog.
 *
 * These specs assume:
 *   - the Next.js dev server is running on http://localhost:3000
 *   - `DRIVER_TENANT_API_KEY` is set so the BFF can proxy upstream
 *
 * If Playwright isn't yet wired into the monorepo, run the API + web with
 * `pnpm dev` and execute via `npx playwright test --config=...` once the
 * dep + config land. See docs/BLOCKERS.md.
 */

const MOCK_GEO = {
  latitude: 40.0001,
  longitude: -82.5001,
  accuracy: 12,
};

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript((coords) => {
    window.localStorage.setItem(
      'ustow.driver.profile',
      JSON.stringify({
        driver_phone: '+17408129489',
        driver_name: 'Test Driver',
        ping_interval_sec: 60,
        high_accuracy_gps: false,
      }),
    );
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: (p: { coords: typeof coords; timestamp: number }) => void) => {
          ok({ coords: { ...coords, heading: null, speed: null }, timestamp: Date.now() });
        },
        watchPosition: () => 0,
        clearWatch: () => {},
      },
    });
  }, MOCK_GEO);
});

test('home page renders driver name and empty state', async ({ page }) => {
  await page.route('**/api/driver/jobs/active*', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ status: 'success', data: { job: null } }) }),
  );
  await page.route('**/api/driver/jobs/queue*', (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({ status: 'success', data: { jobs: [], count: 0 } }),
    }),
  );

  await page.goto('/driver');
  await expect(page.getByTestId('driver-name')).toHaveText('Test Driver');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('bottom-nav')).toBeVisible();
});

test('fires a ping when shift is toggled on', async ({ page }) => {
  let pingPayload: Record<string, unknown> | null = null;
  await page.route('**/api/driver/jobs/active*', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ status: 'success', data: { job: null } }) }),
  );
  await page.route('**/api/driver/jobs/queue*', (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({ status: 'success', data: { jobs: [], count: 0 } }),
    }),
  );
  await page.route('**/api/driver/pings', async (route) => {
    pingPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      body: JSON.stringify({ status: 'success', data: { id: 'p-1' } }),
    });
  });

  await page.goto('/driver');
  await page.getByTestId('shift-toggle').click();

  await expect.poll(() => pingPayload?.lat).toBeCloseTo(40.0001, 3);
  expect(pingPayload).toMatchObject({
    driver_phone: '+17408129489',
    source: 'phone_app',
  });
});

test('renders an active job and accepts it', async ({ page }) => {
  const activeJob = {
    job_id: 'job-1',
    source: 'aaa',
    status: 'assigned',
    caller_name: 'Caller A',
    caller_phone: '+17408120000',
    vehicle: { year: '2020', make: 'Toyota', model: 'Camry', color: 'silver' },
    pickup_address: '123 Main St',
    pickup_lat: 40.001,
    pickup_lng: -82.5,
    dropoff_address: null,
    dropoff_lat: null,
    dropoff_lng: null,
    service_type: 'tow',
    priority: 'normal',
    eta_minutes: 15,
    payout_estimate: 88,
    assigned_at: new Date().toISOString(),
    completed_at: null,
  };
  await page.route('**/api/driver/jobs/active*', (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({ status: 'success', data: { job: activeJob } }),
    }),
  );
  await page.route('**/api/driver/jobs/queue*', (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({ status: 'success', data: { jobs: [], count: 0 } }),
    }),
  );
  let statusPayload: Record<string, unknown> | null = null;
  await page.route('**/api/driver/jobs/job-1/status*', async (route) => {
    statusPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        status: 'success',
        data: { event_id: 'evt-1', unified_jobs_updated: true },
      }),
    });
  });

  await page.goto('/driver');
  await expect(page.getByTestId('active-job-card')).toBeVisible();
  await page.getByTestId('action-en_route').click();
  await expect.poll(() => statusPayload?.status).toBe('en_route');
});
