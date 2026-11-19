// A right-click and ⇧⌘P open the same bar (#1190): on a change, a comment or a highlight, the place's
// review card is stacked above the bar as one widget; a left click opens the card alone; the
// selection keeps its highlight while the bar is open.

import { expect, test, type Journey } from '../src/journey.ts';

const DOC = [
  '# Plan',
  '',
  'The new importer<!--ins k3x9--> now<!--/k3x9--> ships <!--cmt c2dk-->in April<!--/c2dk--> with a <!--hl h4kz-->highlight<!--/h4kz--> to see.',
  '',
  'A second paragraph of text.',
  '',
  '<!-- redlines',
  'version: 1',
  'people:',
  '  ada: {name: Ada Lovelace}',
  '  bo: {name: Bo Chen}',
  'marks:',
  '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
  '  h4kz: {by: bo, at: 2026-10-31T09:41Z}',
  'comments:',
  '  c2dk:',
  '    by: bo',
  '    at: 2026-10-31T09:41Z',
  '    text: |-',
  '      Which month?',
  '-->',
  '',
].join('\n');

const toolbar = (j: Journey) => j.page.locator('.rl-toolbar');
const bubble = (j: Journey) => toolbar(j).locator('.rl-toolbar-bubble');

test.describe('the bar and the review card of a place @views', () => {
  test('a right-click on a change stacks its card above the bar, as one widget', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, view: 'redlines' });
    await j.click('now', { button: 'right' });
    await expect(toolbar(j)).toBeVisible();
    await expect(bubble(j)).toContainText('Inserted');
    await expect(bubble(j).getByRole('button', { name: 'Accept' })).toBeVisible();
    // The change's own card is not also shown, over the page.
    await expect(j.page.locator('.cm-tooltip .rl-card')).toHaveCount(0);
    const [card, bar] = await Promise.all([
      bubble(j).boundingBox(),
      toolbar(j).locator('.rl-toolbar-bar').boundingBox(),
    ]);
    expect(card!.y + card!.height).toBeLessThanOrEqual(bar!.y);
    await j.shot('right-click-change');
  });

  test('⇧⌘P at the same place opens the same card and bar', async ({ start }) => {
    const j = await start({ doc: DOC, view: 'redlines' });
    await j.caretAfter('no');
    await j.press('Meta+Shift+P');
    await expect(bubble(j)).toContainText('Inserted');
    await j.shot('keyboard-change');
  });

  test('a right-click on a comment and on a highlight stacks theirs', async ({ start }) => {
    const j = await start({ doc: DOC, view: 'redlines' });
    await j.click('April', { button: 'right' });
    await expect(bubble(j)).toContainText('Which month?');
    await expect(bubble(j).getByRole('button', { name: 'Reply' })).toBeVisible();
    await j.shot('right-click-comment');
    await j.press('Escape');
    await j.click('highlight', { button: 'right' });
    await expect(bubble(j)).toContainText('Highlighted');
    await j.shot('right-click-highlight');
  });

  test('a left click on a highlight opens its card alone, and a change’s too', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, view: 'redlines' });
    await j.click('highlight');
    await expect(j.page.locator('.cm-tooltip .rl-card')).toContainText('Highlighted');
    await expect(toolbar(j)).toBeHidden();
    // Over the page beside the highlight, not off to one side of the window.
    const [card, word] = await Promise.all([
      j.page.locator('.cm-tooltip').boundingBox(),
      j.page.getByText('highlight', { exact: false }).first().boundingBox(),
    ]);
    expect(card!.y).toBeGreaterThan(0);
    expect(Math.abs(card!.x - word!.x)).toBeLessThan(400);
    await j.shot('left-click-highlight');
  });

  test('the selection keeps its highlight while the bar is open', async ({ start }) => {
    const j = await start({ doc: DOC, view: 'redlines' });
    await j.selectText('second paragraph');
    await j.press('Meta+Shift+P');
    await expect(toolbar(j)).toBeVisible();
    await expect(j.page.locator('.rl-toolbar-held')).toHaveText('second paragraph');
    await j.shot('selection-held');
    await j.press('Escape');
    await expect(j.page.locator('.rl-toolbar-held')).toHaveCount(0);
  });
});
