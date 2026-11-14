import { defineConfig, devices } from '@playwright/test';

// The journeys drive the desktop app's page, which `pnpm dev` serves (it opens src/sample.md, keeps
// its saves in memory, and has a scripted agent in place of the agent programs), in WebKit, the
// engine the app draws with. The server is started for the run, on JOURNEYS_PORT (1482 unless a
// lane has its own port), and one that is already running there is reused when not in CI.
// `JOURNEYS_BASE_URL` points the run at a server you started yourself, and then none is started.
const port = Number(process.env['JOURNEYS_PORT'] ?? 1482);
const baseURL = process.env['JOURNEYS_BASE_URL'] ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  // Journeys share one dev server and each starts its own page: they don't touch each other.
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL,
    // One size and one pixel density, so that a screenshot is the same on every run.
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 } }],
  webServer: process.env['JOURNEYS_BASE_URL']
    ? undefined
    : {
        command: `pnpm exec vite --port ${port} --strictPort`,
        cwd: '..',
        url: baseURL,
        reuseExistingServer: !process.env['CI'],
        timeout: 120_000,
      },
});
