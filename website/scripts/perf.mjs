// @ts-check
//
// Measures the hero editor's load on a slow CPU: the time from the page asking for the bundle
// (`redlines-embed-requested`) to the editor mounted (`redlines-embed-mounted`), at 4x CPU
// throttling in Chromium. Serves `out/` itself; run `npm run embed && npm run build` first.
//   npm run perf

import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const LIMIT_MS = 250;
const PORT = 4174;

const server = spawn(process.execPath, ['scripts/serve.mjs', 'out', String(PORT)], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.stdout.on('data', (chunk) => String(chunk).includes('serving') && resolve(undefined));
});

let took = NaN;
try {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(
      () => performance.getEntriesByName('redlines-embed-mounted').length > 0,
      undefined,
      { timeout: 30000 },
    );
    took = await page.evaluate(() => {
      const [from] = performance.getEntriesByName('redlines-embed-requested');
      const [to] = performance.getEntriesByName('redlines-embed-mounted');
      return to.startTime - from.startTime;
    });
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}

const ms = Math.round(took);
console.log(
  `perf: loading and mounting the hero's editor took ${ms} ms at 4× CPU throttling (limit ${LIMIT_MS} ms)`,
);
process.exit(ms <= LIMIT_MS ? 0 : 1);
