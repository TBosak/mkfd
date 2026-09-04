import { test as base, expect, type Page } from '@playwright/test';

interface AuthenticatedPageFixtures {
  authenticatedPage: Page;
}

// Playwright's config loads the backend webServer's PASSKEY via env and
// publishes the same value onto process.env.MKFD_E2E_PASSKEY for worker
// processes to inherit (see tests/e2e-harness-config.test.ts). Fail fast and
// clearly rather than silently falling back to a hard-coded value if that
// contract is unexpectedly broken.
const passkey = process.env.MKFD_E2E_PASSKEY;
if (!passkey) {
  throw new Error(
    'MKFD_E2E_PASSKEY is not set. frontend/playwright.config.ts must generate or ' +
      'accept an override for MKFD_E2E_PASSKEY and publish it to process.env before ' +
      'E2E tests run.',
  );
}

export const test = base.extend<AuthenticatedPageFixtures>({
  // This fixture will automatically run before each test that uses it
  authenticatedPage: async ({ page }, use) => {
    await page.goto('/');

    // Check if we are on the passkey page
    // Wait a bit for the title to settle
    await page.waitForFunction(() => document.title !== "");

    const title = await page.title();
    if (title === 'Enter Passkey') {
      await page.fill('input[name="passkey"]', passkey);
      await page.click('button[type="submit"]');
      // Wait for navigation back to home under /public/
      await page.waitForURL('**/public/');
    }

    // Ensure the root element is there and contains some content
    await expect(page.locator('#root')).toBeVisible();

    await use(page);
  },
});

export { expect } from '@playwright/test';
