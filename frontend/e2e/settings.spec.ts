import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// Below the `lg:` Tailwind breakpoint (1024px), Sidebar.tsx (which has the
// only "Settings" link) is CSS-hidden, and BottomNav.tsx - which has no
// Settings entry at all, by design - renders instead. The app has no SPA
// deep-link fallback (index.ts only maps GET / to index.html; any other
// client route requested directly 404s as a static-file miss), so there is
// no way to reach Settings at 390px in the current UI at all - a genuine,
// recorded product gap for Packet 4 / the UI Redesign Correction Pass, not
// something this slice fakes a navigation path around. The mobile project
// is skipped with an explicit reason; desktop still exercises the real
// sidebar click.
const MOBILE_UNREACHABLE_REASON =
  'Settings has no mobile navigation entry point at 390px - BottomNav.tsx exposes only My Feeds, Build Feed, and Catalog, and the only Settings link (Sidebar.tsx) is lg:-hidden. Recorded product gap for Packet 4 / the UI Redesign Correction Pass, not this slice\'s to fix.';

async function isMobileViewport(page: Page): Promise<boolean> {
  const size = page.viewportSize();
  return !!size && size.width < 1024;
}

test.describe('Settings Page', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    test.skip(await isMobileViewport(authenticatedPage), MOBILE_UNREACHABLE_REASON);
    await authenticatedPage.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(authenticatedPage).toHaveURL(/\/settings/);
  });

  test('can see settings sections', async ({ authenticatedPage }) => {
    await expect(authenticatedPage.getByText('Security', { exact: true })).toBeVisible();
    await expect(authenticatedPage.getByText('Runtime / Storage', { exact: true })).toBeVisible();
    await expect(authenticatedPage.getByText('Network & Fetch Policy', { exact: true })).toBeVisible();
  });

  test('security settings are read-only', async ({ authenticatedPage }) => {
    // Passkey is a class C setting, should be masked/read-only
    const passkeyRow = authenticatedPage.locator('div').filter({ hasText: /^Passkey/ }).first();
    // In SettingRow.tsx, read-only settings show an "Env-managed" badge
    await expect(passkeyRow.getByText('Env-managed', { exact: true })).toBeVisible();
    // And also an "ENV" source badge
    await expect(passkeyRow.getByText('ENV', { exact: true })).toBeVisible();
  });

  test('can modify and discard changes', async ({ authenticatedPage }) => {
    // Use getByRole for better specificity
    const retentionInput = authenticatedPage.getByRole('spinbutton', { name: /Retention Days/i }).first();
    const originalValue = await retentionInput.inputValue();
    
    await retentionInput.fill('999');
    
    // Check if Save/Discard buttons appeared in the header
    const header = authenticatedPage.locator('header');
    await expect(header.getByRole('button', { name: /Discard/i })).toBeVisible();
    
    await header.getByRole('button', { name: /Discard/i }).click();
    
    await expect(retentionInput).toHaveValue(originalValue);
    await expect(header.getByRole('button', { name: /Discard/i })).not.toBeVisible();
  });

  test('can save changes', async ({ authenticatedPage }) => {
    const retentionInput = authenticatedPage.getByRole('spinbutton', { name: 'Retention Days' });
    const currentValue = await retentionInput.inputValue();
    const newValue = currentValue === '42' ? '43' : '42';
    
    await retentionInput.fill(newValue);
    
    const header = authenticatedPage.locator('header');
    await header.getByRole('button', { name: /Save 1 change/i }).click();
    
    // Wait for toast
    await expect(authenticatedPage.getByText('Settings saved')).toBeVisible();
    await expect(retentionInput).toHaveValue(newValue);
  });
});
