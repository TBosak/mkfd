import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// Below the `lg:` Tailwind breakpoint (1024px), Sidebar.tsx is CSS-hidden and
// BottomNav.tsx renders instead - with a differently-labeled "My Feeds" link
// (Sidebar uses exact "Feeds"). Branching on the real rendered viewport
// (rather than a hardcoded project name) means this keeps working regardless
// of how mobile projects get named in playwright.config.ts.
async function isMobileViewport(page: Page): Promise<boolean> {
  const size = page.viewportSize();
  return !!size && size.width < 1024;
}

test('has title', async ({ authenticatedPage }) => {
  await expect(authenticatedPage).toHaveTitle(/Feed Builder/i);
});

test('can navigate to My Feeds', async ({ authenticatedPage }) => {
  // Sidebar.tsx labels this link exact "Feeds"; BottomNav.tsx (mobile) labels
  // the equivalent link "My Feeds". Both are exercised via real navigation
  // clicks - genuine coverage of whichever nav is actually visible.
  const myFeedsLink = (await isMobileViewport(authenticatedPage))
    ? authenticatedPage.getByRole('link', { name: 'My Feeds', exact: true })
    : authenticatedPage.getByRole('link', { name: 'Feeds', exact: true });
  await myFeedsLink.click();
  await expect(authenticatedPage).toHaveURL(/\/feeds/);
});
