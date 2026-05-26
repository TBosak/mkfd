import { test, expect } from './fixtures';

test.describe('Feeds Management', () => {
  test('can start creating a web scraping feed', async ({ authenticatedPage }) => {
    // We should already be at / from the fixture
    
    // Instead of waiting for text that might be slow to render, 
    // let's wait for the "Web Scraping" button which is the core action
    const webScrapingButton = authenticatedPage.getByRole('button', { name: 'Web Scraping', exact: true });
    await expect(webScrapingButton).toBeVisible({ timeout: 15000 });
    await webScrapingButton.click();
    
    // Should see the multi-step builder
    await expect(authenticatedPage.getByText('Step 01')).toBeVisible();
    await expect(authenticatedPage.getByRole('button', { name: /Step 01 Basic/i })).toBeVisible();
    
    // Fill in basic info
    await authenticatedPage.getByLabel(/Feed Name/i).fill('Test Scraping Feed');
    await authenticatedPage.getByLabel(/Target URL/i).fill('https://news.ycombinator.com');
    
    // Navigate to next step
    await authenticatedPage.getByText('Step 02').click();
    await expect(authenticatedPage.getByRole('button', { name: /Step 02 Headers & Cookies/i })).toBeVisible();
  });

  test('can see my feeds list', async ({ authenticatedPage }) => {
    await authenticatedPage.getByRole('link', { name: 'Feeds', exact: true }).click();
    await expect(authenticatedPage.getByRole('heading', { name: 'Feeds', exact: true })).toBeVisible();
  });
});
