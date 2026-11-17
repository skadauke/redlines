// One document in two windows, side by side (apps/desktop/src/sync-check.ts): two editors joined to
// one authority, typed into through the browser's own input path. The check reports its results in
// the console; the journey holds it to every one of them, and keeps the picture.

import { expect, test } from '../src/journey.ts';

test('two windows type at once and show the same document', async ({ page }) => {
  const lines: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('SYNC-CHECK')) lines.push(text);
  });
  await page.goto('/?sync-check');
  await expect
    .poll(() => lines.some((line) => line.startsWith('SYNC-CHECK done')), {
      timeout: 20_000,
    })
    .toBe(true);
  expect(lines.filter((line) => line.includes(' FAIL '))).toEqual([]);
  expect(lines.at(-1)).toMatch(/done 10 passed, 0 failed/);
  await expect(page).toHaveScreenshot('two-windows.png');
  // The names on the carets fade after a few seconds, and a picture takes animations at their end:
  // held on, to look at them.
  await page.addStyleTag({
    content: '.rl-presence-flag { animation: none !important; opacity: 1 !important; }',
  });
  await expect(page).toHaveScreenshot('two-windows-names.png');
});
