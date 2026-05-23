import { test, expect } from '@playwright/test';

/**
 * 4-step onboarding wizard happy path. The API is stubbed via route
 * interception so the test is self-contained and doesn't need a live
 * Nest server.
 */
test('completes the 4-step onboarding wizard end-to-end', async ({ page }) => {
  await page.route('**/v1/onboarding/start', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        draftId: '00000000-0000-0000-0000-000000000abc',
        currentStep: 1,
        formData: {},
        captchaRequired: false,
      }),
    }),
  );
  await page.route('**/v1/onboarding/step', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  );
  await page.route('**/v1/onboarding/complete', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        tenantId: '11111111-1111-1111-1111-111111111111',
        apiKey: 'usk_testkey_abcdef',
        knowledgePackUrl: 'http://localhost:3001/public/knowledge/11111111-1111-1111-1111-111111111111/profile.md',
        adminUrl: 'http://localhost:3000/admin/integrations',
      }),
    }),
  );

  await page.goto('/onboarding');
  await expect(page.getByText('Create your AI dispatcher')).toBeVisible();

  // Step 1
  await page.getByTestId('company-name').fill('Acme Towing');
  await page.getByTestId('next-step').click();

  // Step 2
  await page.getByTestId('admin-email').fill('owner@acme.com');
  await page.locator('input[placeholder="+16145551234"]').fill('+16145551234');
  await page.locator('input[placeholder="billing@yourtowing.com"]').fill('billing@acme.com');
  await page.getByTestId('next-step').click();

  // Step 3 — skip integrations
  await page.getByTestId('next-step').click();

  // Step 4
  await page.getByTestId('transfer-number').fill('+16145559999');
  await page.getByTestId('complete-onboarding').click();

  // Result panel
  await expect(page.getByTestId('onboarding-result')).toBeVisible();
  await expect(page.getByText('usk_testkey_abcdef')).toBeVisible();
});

test('step indicator advances visually as steps are completed', async ({ page }) => {
  await page.route('**/v1/onboarding/start', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ draftId: 'abc', currentStep: 1, formData: {}, captchaRequired: false }),
    }),
  );
  await page.route('**/v1/onboarding/step', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  );

  await page.goto('/onboarding');
  await expect(page.getByTestId('step-indicator-1')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('step-indicator-2')).toHaveAttribute('data-active', 'false');

  await page.getByTestId('company-name').fill('Acme');
  await page.getByTestId('next-step').click();
  await expect(page.getByTestId('step-indicator-2')).toHaveAttribute('data-active', 'true');
});
