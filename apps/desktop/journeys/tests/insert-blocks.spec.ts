// Where an inserted block goes, and Quote, Callout and Code Block with text selected (#555), through
// the toolbar's Insert menu: in an empty paragraph the block takes its place, with the caret at the
// start of a block it goes above, anywhere else below the block; selected blocks are wrapped.

import { expect, test, type Journey } from '../src/journey.ts';

const DOC = 'First paragraph of text.\n\nSecond paragraph of text.\n\nThird.\n';

const toolbar = (j: Journey) => j.page.locator('.rl-toolbar');

/** Opens the Insert menu from the docked toolbar and chooses an item by its command. */
async function insert(j: Journey, command: string) {
  // An edit fades the docked toolbar; the pointer's move brings it back.
  await j.page.mouse.move(300, 300);
  await j.page.mouse.move(310, 305);
  await toolbar(j).locator('.rl-toolbar-top', { hasText: 'Insert' }).click();
  await toolbar(j).locator(`.rl-toolbar-item[data-command="${command}"]`).click();
}

test.describe('inserting blocks @blocks', () => {
  test('goes below the block, above at the start of one, and in place of an empty paragraph', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.page.locator('.rl-wrench-button').click();

    // Below: the caret in the middle of a sentence leaves the sentence whole.
    await j.caretAfter('Second paragraph');
    await insert(j, 'insert.quote');
    expect(await j.text()).toBe(
      'First paragraph of text.\n\nSecond paragraph of text.\n\n> Text\n\nThird.\n',
    );
    await j.shot('below');

    // Above: the caret at the very start of a block.
    await j.caretBefore('Third.');
    await insert(j, 'block.alert');
    expect(await j.text()).toContain('> Text\n\n> [!NOTE]\n> Text\n\nThird.');
    await j.shot('above');

    // In place: an empty paragraph is taken over.
    await j.caretAtEnd();
    await j.press('Enter');
    await insert(j, 'block.code');
    expect(await j.text()).toContain('Third.\n\n```\n\n```');
    await j.shot('in-place');
  });

  test('wraps two selected paragraphs in a quote, and Undo takes it back', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.page.locator('.rl-wrench-button').click();
    await j.selectText('paragraph of text.\n\nSecond paragraph');
    await j.shot('selected');
    await insert(j, 'insert.quote');
    expect(await j.text()).toBe(
      '> First paragraph of text.\n>\n> Second paragraph of text.\n\nThird.\n',
    );
    await j.shot('wrapped');
    await j.press('ControlOrMeta+z');
    expect(await j.text()).toBe(DOC);
  });
});
