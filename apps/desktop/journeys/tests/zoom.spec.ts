// A zoom changes only the window it is made in (#532): the text size, which a plain page can show;
// the window zoom is the app's and is covered by the Rust tests (src-tauri/src/zoom.rs).

import { expect, test } from '../src/journey.ts';

const scale = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--rl-text-scale'));

test.describe('zoom is per window @views', () => {
  test('larger text in one window leaves the other alone, and a new window takes the last', async ({
    start,
  }) => {
    const j = await start({ doc: 'Hello\n', tracking: false, view: 'clean' });
    const other = await j.page.context().newPage();
    await other.goto('/');
    await other.waitForFunction(() => window.__redlines !== undefined);
    expect(await scale(other)).toBe('1');

    await j.press('Control+Meta+=');
    await expect.poll(() => scale(j.page)).toBe('1.1');
    // The other window heard nothing of it.
    await other.waitForTimeout(300);
    expect(await scale(other)).toBe('1');
    await j.shot('text-size-first-window');

    // A window opened now starts at the last size set anywhere.
    const third = await j.page.context().newPage();
    await third.goto('/');
    await third.waitForFunction(() => window.__redlines !== undefined);
    expect(await scale(third)).toBe('1.1');
  });
});
