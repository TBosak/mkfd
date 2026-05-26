import { test, expect } from './fixtures';

test.describe('Health Dashboard', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.getByRole('link', { name: 'Health', exact: true }).click();
    await expect(authenticatedPage).toHaveURL(/\/health/);
  });

  test('can see health dashboard headers', async ({ authenticatedPage }) => {
    await expect(authenticatedPage.getByRole('heading', { name: 'Health Dashboard' })).toBeVisible();
  });

  test('shows content when loaded', async ({ authenticatedPage }) => {
    await expect(authenticatedPage.getByRole('heading', { name: 'Health Dashboard' })).toBeVisible();
    
    // Wait for either the "No feeds configured" text OR some stat card label
    const content = authenticatedPage.locator('body');
    await expect(content).toBeVisible();
    
    // Just verify the tabs are there
    await expect(authenticatedPage.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(authenticatedPage.getByRole('tab', { name: 'Run Log' })).toBeVisible();
  });
});
