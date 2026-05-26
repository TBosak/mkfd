import { test, expect } from './fixtures';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
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
