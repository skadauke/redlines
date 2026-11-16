// Moving blocks (#516, #623): ⌥↑ and ⌥↓ move the paragraph, item or block the caret is in, and a drag
// of selected blocks shows a line between blocks, in the theme's red, where they will land.
// With Track Changes on a move is one suggestion; Undo puts it back.

import { expect, test } from '../src/journey.ts';

const DOC = [
  'First paragraph of the file.',
  '',
  'Second paragraph, the one that moves.',
  '',
  '- an item',
  '- another item',
  '',
  'Last paragraph.',
  '',
].join('\n');

const body = (text: string) => text.split('\n<!-- redlines')[0]!;
const order = (text: string, needles: string[]) =>
  needles
    .map((needle) => text.lastIndexOf(needle))
    .every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1]!));

test.describe('moving blocks @blocks', () => {
  for (const tracking of [false, true]) {
    test(`⌥↓ and ⌥↑ move a paragraph, Track Changes ${tracking ? 'on' : 'off'}`, async ({
      start,
    }) => {
      const j = await start({ doc: DOC, tracking, view: 'redlines' });
      await j.caretAfter('the one that');
      await j.press('Alt+ArrowDown');
      await j.settle();
      await j.shot(`move-down-${tracking ? 'tracked' : 'plain'}`);
      const down = await j.cmText();
      expect(order(down, ['First paragraph', 'an item', 'another item', 'Second paragraph'])).toBe(
        true,
      );
      // (With Track Changes on the old places keep their text, so the order is read off the plain file.)
      if (!tracking) {
        await j.press('Alt+ArrowUp');
        await j.press('Alt+ArrowUp');
        const up = await j.cmText();
        expect(order(up, ['Second paragraph', 'First paragraph'])).toBe(true);
      }
      await j.shot(`move-up-${tracking ? 'tracked' : 'plain'}`);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`a drag of a selected paragraph shows the drop line and moves it, ${scheme}`, async ({
      start,
    }) => {
      const j = await start({ doc: DOC, tracking: true, view: 'redlines', scheme });
      await j.selectText('Second paragraph, the one that moves.');
      const from = await j.pointOf('the one that');
      const to = await j.pointOf('Last paragraph.');
      const { page } = j;
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 10, from.y + 30, { steps: 6 });
      await page.mouse.move(to.x, to.y - 10, { steps: 10 });
      await j.settle();
      const line = page.locator('.rl-drop-line');
      await expect(line, 'one drop line while dragging').toHaveCount(1);
      const box = (await line.boundingBox())!;
      const last = await j.pointOf('Last paragraph.');
      expect(Math.abs(box.y - last.y), 'the line is by the block it lands above').toBeLessThan(30);
      await j.shot(`drag-line-${scheme}`);
      await page.mouse.up();
      await j.settle();
      await expect(line).toHaveCount(0);
      const moved = body(await j.cmText());
      expect(
        order(moved, ['First paragraph', 'an item', 'Second paragraph', 'Last paragraph']),
      ).toBe(true);
      await j.shot(`drag-dropped-${scheme}`);
      await j.press('Meta+z');
      await j.settle();
      expect(order(body(await j.cmText()), ['First', 'Second paragraph', 'an item'])).toBe(true);
    });
  }

  test('a click in selected blocks puts the caret there, and Escape lets a drag go', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'redlines' });
    await j.selectText('Second paragraph, the one that moves.');
    const at = await j.pointOf('the one that');
    await j.page.mouse.click(at.x, at.y);
    expect((await j.caret()).anchor).toBe((await j.caret()).head);
    await j.selectText('Second paragraph, the one that moves.');
    const to = await j.pointOf('Last paragraph.');
    await j.page.mouse.move(at.x, at.y);
    await j.page.mouse.down();
    await j.page.mouse.move(to.x, to.y - 10, { steps: 8 });
    await j.press('Escape');
    await j.page.mouse.up();
    await expect(j.page.locator('.rl-drop-line')).toHaveCount(0);
    expect(order(body(await j.cmText()), ['First', 'Second paragraph', 'Last'])).toBe(true);
  });
});
