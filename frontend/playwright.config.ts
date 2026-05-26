import { defineConfig, devices } from '@playwright/test';

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
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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
      command: 'PASSKEY=admin123 COOKIE_SECRET=a18c1fd2211edd76a18c1fd2211edd76 ENCRYPTION_KEY=a18c1fd2211edd76 bun index.ts',
      port: 5000,
      reuseExistingServer: !process.env.CI,
      cwd: '..',
    }
  ],
});
