// The toolbar's List menu (#506): in the bar only where the selection holds paragraphs or list items,
// converting between paragraphs, bullets, numbers and checkboxes, with Track Changes on and off.

import { expect, test, type Journey } from '../src/journey.ts';
import { isOpaque } from '../src/contrast.ts';

const DOC = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';

const toolbar = (j: Journey) => j.page.locator('.rl-toolbar');
const top = (j: Journey, name: string) => toolbar(j).locator('.rl-toolbar-top', { hasText: name });

/** Selects from the start of `from` to the end of `to`. */
async function select(j: Journey, from: string, to: string) {
  const start = (await j.offsetAfter(from)) - from.length;
  const end = await j.offsetAfter(to);
  await j.place(start, end);
}

/** Chooses `item` of the List menu with the pointer. */
async function convert(j: Journey, item: string) {
  await top(j, 'List').click();
  await toolbar(j)
    .locator('.rl-toolbar-menu:not([hidden]) .rl-toolbar-item', { hasText: item })
    .click();
  await j.settle();
}

test.describe('the List menu @lists', () => {
  test('is in the bar only where there is a paragraph or a list item to convert', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.dockToolbar();
    await j.caretAfter('Title');
    await expect(top(j, 'List')).toHaveCount(0);
    await j.shot('heading-no-list-menu');
    await j.caretAfter('First');
    await expect(top(j, 'List')).toHaveCount(1);
    // A caret at the very start or end of a paragraph is in it too.
    await j.caretBefore('First paragraph.');
    await expect(top(j, 'List')).toHaveCount(1);
    await j.caretAfter('First paragraph.');
    await expect(top(j, 'List')).toHaveCount(1);
    // List sits between Review and Format, so the left of the bar stays put.
    const names = (await toolbar(j).locator('.rl-toolbar-top').allTextContents()).map((n) =>
      n.trim(),
    );
    expect(names).toEqual(['Ask', 'Insert', 'Review', 'List', 'Format', 'Edit']);
    // From a heading into the paragraphs below, the selection holds paragraphs.
    await select(j, 'Title', 'First paragraph.');
    await expect(top(j, 'List')).toHaveCount(1);
  });

  test('turns two paragraphs into checkboxes, bullets, numbers and back', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.dockToolbar();
    await select(j, 'First paragraph.', 'Second paragraph.');
    await top(j, 'List').click();
    const menu = toolbar(j).locator('.rl-toolbar-menu:not([hidden])');
    expect(await isOpaque(menu)).toBe(true);
    // Nothing here is a list yet, so No List is grayed, and says why.
    const none = menu.locator('[data-command="block.body"]');
    await expect(none).toHaveAttribute('aria-disabled', 'true');
    await none.hover();
    await expect(j.page.locator('.rl-toolbar-tip')).toContainText('not a list');
    await j.shot('list-menu');
    await menu.locator('.rl-toolbar-item', { hasText: 'Checkboxes' }).click();
    await j.settle();
    expect(await j.text()).toContain('- [ ] First paragraph.\n\n- [ ] Second paragraph.');
    await j.shot('checkboxes');
    await select(j, 'First paragraph.', 'Second paragraph.');
    await convert(j, 'Numbers');
    expect(await j.text()).toContain('1. First paragraph.\n\n1. Second paragraph.');
    await select(j, 'First paragraph.', 'Second paragraph.');
    await convert(j, 'Bullets');
    expect(await j.text()).toContain('- First paragraph.\n\n- Second paragraph.');
    // No List is open now that there is a list.
    await select(j, 'First paragraph.', 'Second paragraph.');
    await top(j, 'List').click();
    await expect(
      toolbar(j).locator('.rl-toolbar-menu:not([hidden]) [data-command="block.body"]'),
    ).toHaveAttribute('aria-disabled', 'false');
    await j.shot('no-list-open');
  });

  test('converts with Track Changes on, as changes that can be accepted or rejected', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: true, view: 'redlines' });
    await j.dockToolbar();
    await select(j, 'First paragraph.', 'Second paragraph.');
    await convert(j, 'Bullets');
    // Two tracked changes, one for each paragraph that became an item.
    expect((await j.text()).match(/<!--fmt \w+ was=p-->/g)).toHaveLength(2);
    await j.shot('bullets-tracked');
    // Undo restores the paragraphs.
    await j.press('Meta+z');
    await expect.poll(() => j.text()).not.toContain('was=p');
  });
});
