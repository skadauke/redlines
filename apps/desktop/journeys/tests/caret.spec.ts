// The caret around hidden closers (#491, #494): where it rests when a key or the mouse puts it at
// the end of a line whose last characters are a hidden closer and the hidden break after it. They
// are one range that the caret steps over, so a caret that lands in it goes on to the start of the
// next block; it rests at the end of the text, in front of the closers, as typing leaves it.

import { expect, test, type Journey, type ViewName } from '../src/journey.ts';

const LONG = 'A much longer first line of text here.';
const PARA = 'Para one.';

/** A document with a paragraph typed under Track Changes, so that its closer is hidden. */
async function typed(
  start: (options: { doc: string; tracking: boolean; view: ViewName }) => Promise<Journey>,
  view: ViewName,
): Promise<{ j: Journey; end: number; next: number }> {
  const j = await start({ doc: `${LONG}\n\nNext.\n`, tracking: true, view });
  await j.caretAfter(LONG);
  await j.press('Enter');
  await j.type(PARA, 'burst');
  const doc = await j.cmText();
  const end = doc.indexOf(PARA) + PARA.length;
  return { j, end, next: doc.indexOf('Next.') };
}

/** The page point a little past the end of the text at `pos`, where a click is past the line. */
async function pastEnd(j: Journey, pos: number): Promise<{ x: number; y: number }> {
  const { x, y } = await j.pointAt(pos);
  return { x: x + 120, y };
}

test.describe('the caret by the hidden closers @blocks', () => {
  for (const view of ['clean', 'redlines'] as const) {
    test(`↓ onto a line that ends in a hidden closer rests at the end of its text, ${view} (#491)`, async ({
      start,
    }) => {
      const { j, end } = await typed(start, view);
      await j.place(30);
      await j.press('ArrowDown');
      await j.shotWithCaret(`down-onto-closer-${view}`);
      expect((await j.caret()).head, 'at the end of "Para one."').toBe(end);
      // Again: the next block, at the end of its line (the column is the goal's).
      await j.press('ArrowDown');
      const doc = await j.cmText();
      expect((await j.caret()).head, 'then in "Next."').toBe(doc.indexOf('Next.') + 'Next.'.length);
      // ↑ comes back to the end of "Para one.", in front of the closer.
      await j.press('ArrowUp');
      expect((await j.caret()).head, '↑ rests in front of the closer').toBe(end);
    });
  }

  test('↓ from the start of the line above goes to the start of the line, not past it (#491)', async ({
    start,
  }) => {
    const { j, end, next } = await typed(start, 'clean');
    await j.place(0);
    await j.press('ArrowDown');
    expect((await j.caret()).head, 'column 0 of "Para one."').toBe(end - PARA.length);
    // From the start of "Para one." the next row is "Next.", at its start.
    await j.press('ArrowDown');
    expect((await j.caret()).head, 'column 0 of "Next."').toBe(next);
  });

  test('⇧↓ selects to the end of the text, and ⇟ ends there too (#491)', async ({ start }) => {
    const { j, end } = await typed(start, 'clean');
    await j.place(30);
    await j.press('Shift+ArrowDown');
    expect(await j.caret()).toMatchObject({ anchor: 30, head: end });
    await j.place(30);
    await j.press('PageDown');
    // The page goes as far down as there is: the end of the document's text, in "Next.".
    const doc = await j.cmText();
    expect((await j.caret()).head, 'a page down').toBe(doc.indexOf('Next.') + 'Next.'.length);
  });

  test('a drag from inside the paragraph to past its end rests in front of the closer (#494)', async ({
    start,
  }) => {
    const { j, end } = await typed(start, 'clean');
    await j.drag(await j.pointAt(end - PARA.length), await pastEnd(j, end), { steps: 8 });
    expect(await j.caret()).toMatchObject({ anchor: end - PARA.length, head: end });
    await j.shotWithCaret('drag-past-the-closer');
    // Typing replaces the text only: the paragraph is not joined to the one below.
    await j.type('X', 'burst');
    expect(await j.cmText()).toContain('\n\nNext.');
  });

  test('a drag backward from past the end, and from past the end up, rests in front of it (#494)', async ({
    start,
  }) => {
    const { j, end } = await typed(start, 'clean');
    await j.drag(await pastEnd(j, end), await j.pointAt(end - PARA.length), { steps: 8 });
    expect(await j.caret()).toMatchObject({ anchor: end, head: end - PARA.length });
  });

  test('a shift-click past the end rests in front of the closer (#494)', async ({ start }) => {
    const { j, end } = await typed(start, 'clean');
    await j.place(end - PARA.length);
    const { x, y } = await pastEnd(j, end);
    await j.page.keyboard.down('Shift');
    await j.page.mouse.click(x, y);
    await j.page.keyboard.up('Shift');
    expect(await j.caret()).toMatchObject({ anchor: end - PARA.length, head: end });
  });

  test('a double-click past the end puts the caret in front of the closer (#494)', async ({
    start,
  }) => {
    const { j, end } = await typed(start, 'clean');
    const { x, y } = await pastEnd(j, end);
    await j.page.mouse.dblclick(x, y);
    const { anchor, head } = await j.caret();
    const doc = await j.cmText();
    expect(
      doc.slice(Math.min(anchor, head), Math.max(anchor, head)),
      'no hidden text',
    ).not.toContain('-->');
    expect(Math.max(anchor, head), 'not beyond the text').toBeLessThanOrEqual(end);
  });

  test('a click past the end still rests in front of the closer (#434)', async ({ start }) => {
    const { j, end } = await typed(start, 'clean');
    const { x, y } = await pastEnd(j, end);
    await j.page.mouse.click(x, y);
    expect((await j.caret()).head).toBe(end);
  });
});
