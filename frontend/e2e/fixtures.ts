import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  // This fixture will automatically run before each test that uses it
  authenticatedPage: async ({ page }, use) => {
    await page.goto('/');
    
    // Check if we are on the passkey page
    // Wait a bit for the title to settle
    await page.waitForFunction(() => document.title !== "");
    
    let title = await page.title();
    if (title === 'Enter Passkey') {
      await page.fill('input[name="passkey"]', 'admin123');
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
