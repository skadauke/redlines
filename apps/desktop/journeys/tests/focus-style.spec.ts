// An item chosen with the keys looks as one under the pointer (#1191): in the toolbar and its
// palette, and in Preferences' top bar. No ring; the hover style.

import { expect, test, type Journey } from '../src/journey.ts';
import { shotName, writeShot } from '../src/shots.ts';

const DOC = 'The quick brown fox jumps over the lazy dog.\n\nA second paragraph of text.\n';
const toolbar = (j: Journey) => j.page.locator('.rl-toolbar');

const look = (el: import('@playwright/test').Locator) =>
  el.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, shadow: style.boxShadow, color: style.color };
  });

test.describe('keys and pointer choose alike @views', () => {
  test('the bar: the button the keys are on looks as one the pointer is over', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.caretAfter('brown');
    await j.press('Meta+Shift+P');
    const [ask, insert] = [
      toolbar(j).locator('.rl-toolbar-ask'),
      toolbar(j).locator('.rl-toolbar-top', { hasText: 'Insert' }),
    ];
    await expect(ask).toBeFocused();
    await toolbar(j).locator('.rl-toolbar-top', { hasText: 'Edit' }).hover();
    const [keyed, pointed] = await Promise.all([
      look(ask),
      look(toolbar(j).locator('.rl-toolbar-top', { hasText: 'Edit' })),
    ]);
    expect(keyed.shadow, 'no ring').toBe('none');
    expect(keyed.background).toBe(pointed.background);
    expect(keyed.color).toBe(pointed.color);
    await insert.hover();
    await j.shot('bar-keys-and-pointer');
  });

  test('the palette: the line the keys chose looks as one the pointer is over', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.caretAfter('brown');
    await j.press('Meta+Shift+P');
    await j.page.keyboard.type('list');
    const results = toolbar(j).locator('.rl-toolbar-result');
    await expect(results.nth(1)).toBeVisible();
    await j.page.keyboard.press('ArrowDown');
    const chosen = toolbar(j).locator('.rl-toolbar-result[aria-selected="true"]');
    await expect(chosen).toHaveCount(1);
    await results.last().hover();
    const [keyed, pointed] = await Promise.all([look(chosen), look(results.last())]);
    expect(keyed.shadow, 'no ring').toBe('none');
    expect(keyed.background).toBe(pointed.background);
    await j.shot('palette-keys-and-pointer');
  });

  test('Preferences’ top bar: the tab the keys are on looks as one the pointer is over', async ({
    start,
  }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const { page } = j;
    await page.goto('/preferences.html');
    await page.emulateMedia({ colorScheme: j.options.scheme });
    const tabs = page.getByRole('tab');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    const focused = page.locator('.rl-pref-tab:focus-visible');
    await expect(focused).toHaveCount(1);
    const other = tabs.nth(3);
    await other.hover();
    const [keyed, pointed] = await Promise.all([look(focused), look(other)]);
    expect(keyed.shadow, 'no ring').toBe('none');
    expect(keyed.color, 'the hover color').toBe(pointed.color);
    await writeShot(page, j.info, shotName('tabs-keys-and-pointer', j.options));
  });
});
