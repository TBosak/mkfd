import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// Below the `lg:` Tailwind breakpoint (1024px), Sidebar.tsx (which has the
// only "Health" link) is CSS-hidden, and BottomNav.tsx - which has no Health
// entry at all, by design - renders instead. The app has no SPA deep-link
// fallback (index.ts only maps GET / to index.html; any other client route
// requested directly 404s as a static-file miss), so there is no way to
// reach Health at 390px in the current UI at all - a genuine, recorded
// product gap for Packet 4 / the UI Redesign Correction Pass, not something
// this slice fakes a navigation path around. The mobile project is skipped
// with an explicit reason; desktop still exercises the real sidebar click.
const MOBILE_UNREACHABLE_REASON =
  'Health has no mobile navigation entry point at 390px - BottomNav.tsx exposes only My Feeds, Build Feed, and Catalog, and the only Health link (Sidebar.tsx) is lg:-hidden. Recorded product gap for Packet 4 / the UI Redesign Correction Pass, not this slice\'s to fix.';

async function isMobileViewport(page: Page): Promise<boolean> {
  const size = page.viewportSize();
  return !!size && size.width < 1024;
}

test.describe('Health Dashboard', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    test.skip(await isMobileViewport(authenticatedPage), MOBILE_UNREACHABLE_REASON);
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
