// The end of the document, after a block that has no line below it (#514): ↓ reaches a new line,
// a paragraph of its own below the block, written as the file needs it (a blank line above, and
// outside the quote), with Track Changes on and off.

import { expect, test } from '../src/journey.ts';

const BLOCKS: Record<string, { doc: string; last: string; downs: number }> = {
  table: { doc: 'Intro\n\n| A | B |\n| - | - |\n| 1 | 2 |\n', last: '2', downs: 1 },
  // The first ↓ in code goes to the closing fence, the second leaves the block.
  code: { doc: 'Intro\n\n```ts\nconst a = 1;\n```\n', last: 'const a = 1;', downs: 2 },
  quote: { doc: 'Intro\n\n> quoted words\n', last: 'quoted words', downs: 1 },
  'quote without a final line break': {
    doc: 'Intro\n\n> quoted words',
    last: 'quoted words',
    downs: 1,
  },
  alert: { doc: 'Intro\n\n> [!NOTE]\n> the note\n', last: 'the note', downs: 1 },
  image: { doc: 'Intro\n\n![a picture](picture.png)\n', last: 'a picture', downs: 1 },
  rule: { doc: 'Intro\n\n---\n', last: '---', downs: 1 },
};

const body = (text: string) => text.split('\n<!-- redlines')[0]!;

test.describe('the end of the document @blocks', () => {
  for (const [kind, { doc, last, downs }] of Object.entries(BLOCKS)) {
    for (const tracking of [false, true]) {
      test(`↓ after a ${kind} at the end reaches a new line, Track Changes ${tracking ? 'on' : 'off'}`, async ({
        start,
      }) => {
        const j = await start({ doc, tracking, view: 'redlines' });
        await j.caretAfter(last);
        for (let i = 0; i < downs; i++) await j.press('ArrowDown');
        await j.type('x', 'burst');
        await j.shot(`down-after-${kind.replace(/ /g, '-')}-${tracking ? 'tracked' : 'plain'}`);
        const lines = body(await j.cmText()).split('\n');
        const at = lines.findIndex((line) => line.startsWith('x'));
        expect(at, 'the text is on a line of its own below the block').toBeGreaterThan(0);
        // A blank line above it, and the block above that is as it was.
        expect(lines[at - 1], 'a blank line parts it from the block').toBe('');
        const kept = body(doc).trimEnd();
        // (With Track Changes on, a marker line of the new paragraph's insertion is between.)
        const above = lines
          .slice(0, at)
          .join('\n')
          .replace(/<!--ins \w+-->/, '');
        expect(above.trimEnd()).toBe(kept);
        expect((await j.caret()).lineText.startsWith('x')).toBe(true);
      });
    }
  }

  test('↓ again does not add more lines, and Undo takes the new line back', async ({ start }) => {
    const j = await start({ doc: 'Intro\n\n> quoted\n', tracking: false, view: 'clean' });
    await j.caretAfter('quoted');
    await j.press('ArrowDown');
    const once = await j.cmText();
    await j.press('ArrowUp');
    await j.press('ArrowDown');
    expect(await j.cmText(), 'a second trip down adds nothing').toBe(once);
    await j.press('ControlOrMeta+z');
    expect(await j.cmText()).toBe('Intro\n\n> quoted\n');
  });

  test('↓ in the middle of a quote moves as ever', async ({ start }) => {
    const j = await start({ doc: 'Intro\n\n> one\n> two\n', tracking: false, view: 'clean' });
    await j.caretAfter('one');
    await j.press('ArrowDown');
    expect((await j.caret()).lineText).toBe('> two');
    expect(await j.cmText()).toBe('Intro\n\n> one\n> two\n');
  });
});
