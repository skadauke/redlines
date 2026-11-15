// A zoom changes only the window it is made in (#532): the text size, which a plain page can show;
// the window zoom is the app's and is covered by the Rust tests (src-tauri/src/zoom.rs).

import { expect, test } from '../src/journey.ts';

const scale = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--rl-text-scale'));

test.describe('zoom is per window @views', () => {
  test('larger text in one window leaves the other alone, and a new window opens at the default', async ({
    start,
  }) => {
    // The run's look sets the Default text size (1 at 100%, 2 at 200%), which a window opens at.
    const j = await start({ doc: 'Hello\n', tracking: false, view: 'clean' });
    const first = await scale(j.page);
    const other = await j.page.context().newPage();
    await other.goto('/');
    await other.waitForFunction(() => window.__redlines !== undefined);
    expect(await scale(other)).toBe(first);

    await j.press('Control+Meta+=');
    await expect.poll(() => scale(j.page)).not.toBe(first);
    const larger = await scale(j.page);
    expect(Number(larger)).toBeGreaterThan(Number(first));
    // The other window heard nothing of it.
    await other.waitForTimeout(300);
    expect(await scale(other)).toBe(first);
    await j.shot('text-size-first-window');

    // A window opened now starts at the Default text size (what is stored: the look's own size),
    // not at the last size a window was zoomed to (#557).
    const third = await j.page.context().newPage();
    await third.goto('/');
    await third.waitForFunction(() => window.__redlines !== undefined);
    expect(await scale(third)).toBe(first);
  });
});
