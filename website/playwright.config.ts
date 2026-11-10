import { defineConfig, devices } from '@playwright/test';

// The browser smoke test runs against the built site, `out/`, served as a plain static folder:
//   npm run build && npm run test:e2e
// To run it against a server you started yourself (scripts/serve.mjs out 4173), set
// PLAYWRIGHT_BASE_URL to its address, and it starts none. PLAYWRIGHT_PROJECT picks one browser.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'node scripts/serve.mjs out 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
      },
});
