import { test, expect } from '@playwright/test';

// Tenant zero ID: 00000000-0000-0000-0000-000000000001 (used implicitly by
// the seeded default tenant — kept as a comment for runbook context).

const INITIAL_BRANDING = {
  companyDisplayName: 'Roadside Towing',
  logoUrl: '',
  faviconUrl: '',
  primaryColor: '#3b82f6',
  secondaryColor: '#1e293b',
  accentColor: '#facc15',
  fontFamily: 'Inter',
  emailSignatureHtml: '',
  smsSignature: '',
  supportPhone: '',
  supportEmail: '',
  customDomain: null,
  hidePoweredBy: false,
};

test('branding admin updates the primary color and reflects in CSS variable', async ({ page }) => {
  let stored = { ...INITIAL_BRANDING };

  await page.route('**/v1/admin/branding', (route) => {
    if (route.request().method() === 'PUT') {
      stored = { ...stored, ...JSON.parse(route.request().postData() ?? '{}') };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  await page.goto('/admin/branding');
  await expect(page.getByTestId('branding-display-name')).toHaveValue('Roadside Towing');

  // Change primary color
  await page.getByTestId('primary-color').fill('#ff0000');

  // Save
  await page.getByTestId('branding-save').click();
  await expect(page.getByText('Branding saved.')).toBeVisible();

  // CSS var should reflect the new color
  const primaryVar = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim(),
  );
  expect(primaryVar).toBe('#ff0000');
});
