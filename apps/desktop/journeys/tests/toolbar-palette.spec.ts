// The command palette in the toolbar (#550): with the bar open, typing searches every command that
// works at the caret and the app's settings, and a setting is a live control in its line.

import { expect, test, type Journey } from '../src/journey.ts';
import { isOpaque } from '../src/contrast.ts';

const DOC = 'The quick brown fox jumps over the lazy dog.\n\nA second paragraph of text.\n';

const toolbar = (j: Journey) => j.page.locator('.rl-toolbar');
/** The lines found, without the last, which is always "Ask about …" for what was typed. */
async function names(j: Journey) {
  const all = await toolbar(j)
    .locator('.rl-toolbar-result .rl-toolbar-result-name')
    .allTextContents();
  expect(all.at(-1)).toMatch(/^Ask about “/);
  return all.slice(0, -1);
}

/** The bar at the caret with the keyboard in it, then a query typed as a person types it. */
async function search(j: Journey, query: string) {
  if (!(await toolbar(j).isVisible())) {
    await j.caretAfter('brown');
    await j.press('Meta+Shift+P');
  }
  await j.page.keyboard.type(query);
}

test.describe('the palette in the toolbar @views', () => {
  test('finds a command by what a person calls it', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await search(j, 'unordered list');
    await expect(toolbar(j).locator('.rl-toolbar-input')).toBeFocused();
    expect(await names(j)).toEqual(['Make Bulleted List']);
    expect(await isOpaque(toolbar(j))).toBe(true);
    await j.shot('unordered-list');
    // "ordered list" is whole-word: it finds the numbered list, not the bulleted one.
    await j.page.locator('.rl-toolbar-input').fill('ordered list');
    expect(await names(j)).toEqual(['Make Numbered List']);
    await j.page.locator('.rl-toolbar-input').fill('todo');
    expect(await names(j)).toEqual(['Make Checklist']);
    await j.page.locator('.rl-toolbar-input').fill('h2o');
    expect(await names(j)).toEqual(['Subscript']);
    await j.page.locator('.rl-toolbar-input').fill('picture');
    expect(await names(j)).toEqual(['Insert Image']);
    await j.shot('picture');
  });

  test('runs the chosen command on Return, in the text', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await search(j, 'checklist');
    await j.press('Enter');
    await expect(toolbar(j)).toBeHidden();
    expect(await j.text()).toContain('- [ ] The quick brown fox');
  });

  test('a setting is a live control: a switch and a choice, with the palette staying open', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await search(j, 'track');
    const track = toolbar(j).locator('.rl-toolbar-switch');
    await expect(track).toHaveAttribute('aria-checked', 'false');
    await j.shot('track-off');
    await j.press('Enter');
    await expect(track).toHaveAttribute('aria-checked', 'true');
    await expect(toolbar(j).locator('.rl-toolbar-input')).toBeVisible();
    expect((await j.uiState())['tracking']).toBe(true);
    await j.shot('track-on');
    await j.page.locator('.rl-toolbar-input').fill('dark mode');
    expect(await names(j)).toEqual(['Appearance']);
    await j.page.keyboard.press('ArrowRight');
    await expect(toolbar(j).locator('.rl-toolbar-segment[aria-checked="true"]')).toBeVisible();
    await j.shot('appearance');
    await expect(toolbar(j).locator('.rl-toolbar-input')).toBeVisible();
  });

  test('Esc gives the bar back, and the docked bar is searched too', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.page.locator('.rl-wrench-button').click();
    await j.press('Meta+Shift+P');
    await j.page.keyboard.type('bold');
    expect(await names(j)).toContain('Bold');
    await j.press('Escape');
    await expect(toolbar(j).locator('.rl-toolbar-input')).toHaveCount(0);
    await expect(toolbar(j).locator('.rl-toolbar-bar')).toBeVisible();
    await expect(toolbar(j)).toBeVisible();
  });

  test('finds the menu bar’s commands, About Redlines among them (#1192)', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await search(j, 'about');
    expect(await names(j)).toContain('About Redlines');
    await j.shot('menu-about');
    await j.page.locator('.rl-toolbar-input').fill('export');
    expect(await names(j)).toEqual(expect.arrayContaining(['Export to Word', 'Export as PDF']));
    await j.page.locator('.rl-toolbar-input').fill('text');
    expect(await names(j)).toEqual(expect.arrayContaining(['Larger Text', 'Smaller Text']));
    await j.page.locator('.rl-toolbar-input').fill('preferences');
    expect(await names(j)).toEqual(
      expect.arrayContaining(['Open Preferences', 'Open Agents Preferences']),
    );
    await j.shot('menu-preferences');
  });
});
