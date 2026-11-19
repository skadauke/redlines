// One document in two tabs of a browser, side by side (apps/desktop/two-windows.html: the page of the
// app twice, as two frames). The tabs find each other and agree on who leads through Web Locks and a
// BroadcastChannel (src/session-tabs.ts, session-browser.ts); each is typed into with the real
// keyboard. Both converge, each one's Undo is its own, the title says which window each is, and
// when the leader's page hangs, the other tab takes the lead and goes on.

import type { Frame, Page } from '@playwright/test';
import { expect, test } from '../src/journey.ts';

/** What a frame's page lets a journey reach (src/journey-hook.ts, src/session-browser.ts). */
interface Reach {
  __redlines: {
    editor: {
      getDoc(): string;
      focus(): void;
      setTracking(on: boolean, options?: { inFile?: boolean }): void;
      view: {
        dispatch(spec: { selection: { anchor: number } }): void;
      };
    };
  };
  __redlinesTab: { freeze(): void; thaw(): void };
}

async function frameOf(page: Page, pattern: RegExp): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      () => {
        found = page.frames().find((frame) => pattern.test(frame.url()));
        return found !== undefined;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return found!;
}

const textOf = (frame: Frame) =>
  frame.evaluate(() => (window as unknown as Reach).__redlines.editor.getDoc());

/** Puts the caret right after `after` in the frame's document and gives it the keyboard. */
const caretAfter = (frame: Frame, after: string) =>
  frame.evaluate((word) => {
    const { editor } = (window as unknown as Reach).__redlines;
    const at = editor.getDoc().indexOf(word) + word.length;
    editor.view.dispatch({ selection: { anchor: at } });
    editor.focus();
  }, after);

test('two tabs show one document, each with its own Undo, and the other goes on when the leader hangs', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/two-windows.html');
  const left = await frameOf(page, /session=host/);
  const right = await frameOf(page, /join=/);
  await left.waitForFunction(() => document.documentElement.dataset['session'] === 'leading');
  await right.waitForFunction(() => document.documentElement.dataset['session'] === 'following');
  await expect.poll(async () => (await textOf(right)) === (await textOf(left))).toBe(true);
  for (const frame of [left, right]) {
    await frame.evaluate(() =>
      (window as unknown as Reach).__redlines.editor.setTracking(true, { inFile: false }),
    );
  }

  // Both type, with the real keyboard, at once.
  await caretAfter(left, 'Redlines shows every change');
  await page.keyboard.type(' LEFT');
  await caretAfter(right, 'Open this document.');
  await page.keyboard.type(' RIGHT');
  await expect
    .poll(async () => {
      const [a, b] = [await textOf(left), await textOf(right)];
      return a === b && a.includes('LEFT') && a.includes('RIGHT');
    })
    .toBe(true);
  // The title of each says the document is in two windows.
  await expect(left.locator('.rl-title')).toContainText('Window 1');
  await expect(right.locator('.rl-title')).toContainText('Window 2');
  // The name stands alone: what the window is and that it was edited is set apart from it.
  await expect(left.locator('.rl-titlebar')).toHaveScreenshot(
    `title-bar-window-1-${test.info().project.name}.png`,
  );
  await expect(right.locator('.rl-titlebar')).toHaveScreenshot(
    `title-bar-window-2-${test.info().project.name}.png`,
  );

  // Undo in the first takes back its own edit and leaves the other tab's.
  await caretAfter(left, 'Redlines shows every change');
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => {
      const [a, b] = [await textOf(left), await textOf(right)];
      return a === b && !a.includes('LEFT') && a.includes('RIGHT');
    })
    .toBe(true);
  // The other tab's caret and name, a moment after it moved.
  await caretAfter(right, 'Try it');
  await expect(left.locator('.rl-presence-caret')).toHaveCount(1);
  await page.addStyleTag({
    content: '.rl-presence-flag { animation: none !important; opacity: 1 !important; }',
  });
  await right.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.cm-cursorLayer { visibility: hidden !important; }';
    document.head.append(style);
  });
  await left.evaluate(() => {
    const style = document.createElement('style');
    style.textContent =
      '.rl-presence-flag { animation: none !important; opacity: 1 !important; } .cm-cursorLayer { visibility: hidden !important; }';
    document.head.append(style);
  });
  await expect(page).toHaveScreenshot('two-tabs.png', { timeout: 10_000 });

  // The leader's page hangs: its lock is still held, and nothing comes from it. The other tab
  // takes the lock and the log, and the session goes on.
  await left.evaluate(() => (window as unknown as Reach).__redlinesTab.freeze());
  await right.waitForFunction(
    () => document.documentElement.dataset['session'] === 'leading',
    null,
    {
      timeout: 20_000,
    },
  );
  await caretAfter(right, 'Redlines shows every change');
  await page.keyboard.type(' AFTER');
  await expect.poll(async () => (await textOf(right)).includes('AFTER')).toBe(true);
  // The page that hung runs again, is a window of the session, and catches up.
  await left.evaluate(() => (window as unknown as Reach).__redlinesTab.thaw());
  await expect
    .poll(async () => (await textOf(left)) === (await textOf(right)), { timeout: 20_000 })
    .toBe(true);
  expect(await textOf(left)).toContain('AFTER');
});
