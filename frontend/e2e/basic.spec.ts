import { test, expect } from './fixtures';

test('has title', async ({ authenticatedPage }) => {
  await expect(authenticatedPage).toHaveTitle(/Feed Builder/i);
});

test('can navigate to My Feeds', async ({ authenticatedPage }) => {
  // The link text in Sidebar.tsx is "Feeds" for MyFeedsPage
  const myFeedsLink = authenticatedPage.getByRole('link', { name: 'Feeds', exact: true });
  await myFeedsLink.click();
  await expect(authenticatedPage).toHaveURL(/\/feeds/);
});
