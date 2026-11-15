// A tracked change in a list item whose text is drawn up on its bullet's row has its change bar
// (#540): Tab writes the marker on its own line, and the item's text is brought up to the bullet.

import { expect, test } from '../src/journey.ts';

test.describe('the change bar of a joined list item @lists', () => {
  test('Tab, then typing at the end of the item, draw a bar next to the row, Track Changes on', async ({
    start,
  }) => {
    const j = await start({ doc: '- one\n- two\n', tracking: true, view: 'redlines' });
    await j.caretAfter('two');
    await j.press('Tab');
    await expect(j.page.locator('.rl-bar-seg'), 'a bar after the tracked indent').not.toHaveCount(
      0,
    );
    await j.shot('bar-after-tab');
    await j.type('x', 'burst');
    await expect(j.page.locator('.rl-bar-seg'), 'a bar after typing at its end').not.toHaveCount(0);
    await j.shot('bar-after-tab-and-typing');
    // The bar is level with the item's row: its top is no lower than the row's text, its bottom no higher.
    const box = await j.page.locator('.rl-bar-seg').first().boundingBox();
    const row = await j.pointAt((await j.caret()).head);
    expect(box!.y, 'the bar starts at the row').toBeLessThanOrEqual(row.y);
    expect(box!.y + box!.height, 'and ends below it').toBeGreaterThanOrEqual(row.y);
  });
});
