import { defineConfig, devices } from '@playwright/test';
import { randomBytes } from 'node:crypto';

function e2eSecret(name: 'MKFD_E2E_PASSKEY' | 'MKFD_E2E_COOKIE_SECRET' | 'MKFD_E2E_ENCRYPTION_KEY'): string {
  const override = process.env[name];
  const value = override && override.length > 0 ? override : randomBytes(32).toString('base64url');
  process.env[name] = value;
  return value;
}

const e2ePasskey = e2eSecret('MKFD_E2E_PASSKEY');
const e2eCookieSecret = e2eSecret('MKFD_E2E_COOKIE_SECRET');
const e2eEncryptionKey = e2eSecret('MKFD_E2E_ENCRYPTION_KEY');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173/public/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 390 px is the narrowest viewport the redesign supports. Built on the
      // Chromium engine deliberately rather than an iOS device preset, so
      // mobile coverage exercises the same browser the desktop project does.
      name: 'chromium-mobile-390',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'bun run dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      cwd: './'
    },
    {
      command: 'bun index.ts',
      port: 5000,
      reuseExistingServer: !process.env.CI,
      cwd: '..',
      env: {
        PASSKEY: e2ePasskey,
        COOKIE_SECRET: e2eCookieSecret,
        ENCRYPTION_KEY: e2eEncryptionKey,
      },
    }
  ],
});
