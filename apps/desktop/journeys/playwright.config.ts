import { defineConfig, devices } from '@playwright/test';
import type { JourneyOptions } from './src/journey.ts';

// The journeys drive the desktop app's page, which `pnpm dev` serves (it opens src/sample.md, keeps
// its saves in memory, and has a scripted agent in place of the agent programs), in WebKit, the
// engine the app draws with. The server is started for the run, on JOURNEYS_PORT (1482 unless a
// lane has its own port), and one that is already running there is reused when not in CI.
// A server already running on that port is driven as it is, whatever code it serves: in your own
// worktree, use your own port. `JOURNEYS_BASE_URL` points the run at a server you started yourself,
// and then none is started.
const port = Number(process.env['JOURNEYS_PORT'] ?? 1482);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('JOURNEYS_PORT is not a port number');
const baseURL = process.env['JOURNEYS_BASE_URL'] ?? `http://localhost:${port}`;

// The looks a journey runs in. A baseline's file name carries its look (`name-dark-200.png`), so
// every look keeps its own approved image. A short run is the light 100% look alone; the
// other three are for main and the sweep: JOURNEYS_PROJECTS=all, or names from the list, separated
// by commas (JOURNEYS_PROJECTS=light,dark).
const looks: Record<string, JourneyOptions> = {
  light: { scheme: 'light', textSize: 1 },
  dark: { scheme: 'dark', textSize: 1 },
  'light-200': { scheme: 'light', textSize: 2 },
  'dark-200': { scheme: 'dark', textSize: 2 },
};
const asked = process.env['JOURNEYS_PROJECTS'] ?? 'light';
const chosen =
  asked === 'all'
    ? Object.keys(looks)
    : [
        ...new Set(
          asked
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean),
        ),
      ];
for (const name of chosen) {
  if (!(name in looks)) throw new Error(`JOURNEYS_PROJECTS: no look called "${name}"`);
}

export default defineConfig<JourneyOptions>({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  // The approved screenshots, in the repository: one folder per spec file, one image per baseline.
  // `pnpm journeys:accept` writes them, on purpose (see the README).
  snapshotPathTemplate: '{testDir}/../baselines/{testFilePath}/{arg}{ext}',
  // A run never writes a baseline: a missing one fails, and `pnpm journeys:accept` is what writes
  // (`--update-snapshots=changed`), on purpose.
  updateSnapshots: 'none',
  expect: {
    toHaveScreenshot: {
      // At most 15 pixels differ, each by more than a small colour distance: antialiasing doesn't
      // fail a run, a letter that changed, a moved line or a menu does (one letter is some 40
      // pixels). A share of the window would let a word through: the window is a million pixels.
      // The caret is hidden in a baseline (`baseline()`), since where it is a journey asserts.
      maxDiffPixels: 15,
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  // Journeys share one dev server and each starts its own page: they don't touch each other.
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  // The JSON report is what `pnpm journeys:look` reads: which journey took which pictures.
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
    ...(process.env['CI'] ? ([['html', { open: 'never' }]] as const) : []),
  ],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: chosen.map((name) => ({
    name,
    // One size and one pixel density, so that a screenshot is the same on every run.
    use: {
      ...devices['Desktop Safari'],
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      ...looks[name]!,
    },
  })),
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
