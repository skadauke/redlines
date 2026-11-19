// #650: ⇟ onto a list item's row, after a row that ends in hidden closers. `settleVertical` takes a
// page move that lands at the start of the next block, with the goal at or right of the end of the
// row above the closers, as aimed at that row, and takes the caret back to it; when the page really
// lands on the item's own row, with the goal in the item's indent, that is a row too far up. The
// same document with no closers (the inserted text plain) gives the rows the page lands on, and
// from every row above, a ⇟ must land on the same row in both. The case was not found in WebKit (a
// nested, top-level, numbered and task item, two goal columns inside the indent, ⇟ from each of 40
// rows above, which puts the page's end at every height of the item's row): this holds it.

import { expect, test, type Journey } from '../src/journey.ts';

const FILLER = (n: number) =>
  Array.from({ length: n }, (_, i) => `Filler line ${i + 1} with some words in it.`).join('\n\n');

const SHAPES: Record<string, (tail: string) => string> = {
  'a nested item': (tail) =>
    `${FILLER(40)}\n\n- plan\n\nb${tail}\n\n  - item after the short row\n\nAfter.\n`,
  'a top-level item': (tail) =>
    `${FILLER(40)}\n\nb${tail}\n\n- item after the short row\n\nAfter.\n`,
  'a numbered item': (tail) =>
    `${FILLER(40)}\n\nb${tail}\n\n1. item after the short row\n\nAfter.\n`,
  'a task item': (tail) =>
    `${FILLER(40)}\n\nb${tail}\n\n- [ ] item after the short row\n\nAfter.\n`,
};

/** The line and column each ⇟ from the start of each filler line lands on. */
async function landings(j: Journey, column: number): Promise<string[]> {
  const text = await j.cmText();
  const out: string[] = [];
  for (let i = 1; i <= 40; i++) {
    const at = text.indexOf(`Filler line ${i} `) + column;
    await j.place(at);
    await j.press('PageDown');
    const caret = await j.caret();
    // The short row is the one whose hidden closers the move may be taken back to.
    out.push(
      caret.lineText.startsWith('b')
        ? 'the short row'
        : caret.lineText.startsWith('Filler')
          ? 'filler'
          : `${caret.lineText.slice(0, 24)}|${caret.column}`,
    );
  }
  return out;
}

for (const [name, shape] of Object.entries(SHAPES)) {
  for (const column of [2, 6]) {
    test(`⇟ lands on the same row with and without closers before ${name}, goal column ${column} (#650)`, async ({
      start,
    }) => {
      const plain = await start({ doc: shape('x'), tracking: false, view: 'clean' });
      const reference = await landings(plain, column);
      expect(
        reference.some((row) => row.includes('item after')),
        'some page ends on the item row',
      ).toBe(true);
      const tracked = await start({
        doc: shape('<!--ins k3x9-->x<!--/k3x9-->').replace(/^/, ''),
        tracking: false,
        view: 'clean',
      });
      const rows = await landings(tracked, column);
      expect(rows, 'the rows ⇟ lands on, from each line above').toEqual(reference);
    });
  }
}
