import { expect, test } from '@playwright/test';

/**
 * E2E coverage for the driver map page. The Google Maps script is blocked
 * to avoid a network dependency in CI; the page falls back to the
 * "missing key" notice which we then assert against.
 *
 * When a real GOOGLE key is plumbed into the test env, drop the block
 * route and assert on the map container instead.
 */

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
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
        getCurrentPosition: (ok: (p: { coords: GeolocationCoordinates; timestamp: number }) => void) => {
          ok({
            coords: {
              latitude: 40.0001,
              longitude: -82.5001,
              accuracy: 12,
              heading: null,
              speed: null,
              altitude: null,
              altitudeAccuracy: null,
            } as GeolocationCoordinates,
            timestamp: Date.now(),
          });
        },
        watchPosition: () => 0,
        clearWatch: () => {},
      },
    });
  });
  // Block the Maps script entirely to avoid 3rd-party flakes.
  await page.route('**/maps.googleapis.com/**', (route) => route.abort());
});

test('map page renders (mocked Maps loader)', async ({ page }) => {
  await page.route('**/api/driver/jobs/active*', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ status: 'success', data: { job: null } }) }),
  );

  await page.goto('/driver/map');
  await expect(page.getByTestId('driver-map')).toBeVisible();
  await expect(page.getByTestId('map-sheet')).toBeVisible();
  // Without a Maps key the placeholder shows; with one the LoadScript spinner
  // would render. Either way the sheet is interactive.
  const sheet = page.getByTestId('map-sheet');
  await expect(sheet).toContainText(/Show details|Hide details/);
});
