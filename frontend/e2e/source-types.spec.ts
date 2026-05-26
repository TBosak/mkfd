import { test, expect } from './fixtures';

test('new Phase 5 feed types are selectable in the builder', async ({ authenticatedPage }) => {
  await authenticatedPage.goto('/');
  for (const label of ['Sitemap', 'Calendar', 'GraphQL', 'Webhook', 'Filesystem', 'Service Connector']) {
    await authenticatedPage.getByRole('button', { name: new RegExp(label, 'i') }).click();
    await expect(authenticatedPage.locator('form')).toContainText(label === 'Webhook' ? 'Incoming Webhook' : label);
    await authenticatedPage.getByRole('button', { name: 'Back' }).click();
  }
});

test('catalog page is reachable from navigation', async ({ authenticatedPage }) => {
  await authenticatedPage.getByRole('link', { name: 'Catalog', exact: true }).click();
  await expect(authenticatedPage).toHaveURL(/\/catalog/);
  await expect(authenticatedPage.getByRole('heading', { name: 'Community Catalog' })).toBeVisible();
});
