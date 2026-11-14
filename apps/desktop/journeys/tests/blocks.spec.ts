// The end of the document, after a block that has no line below it.

import { expect, known, test, type Journey, type StartOptions } from '../src/journey.ts';

const BLOCKS: Record<string, { doc: string; last: string }> = {
  table: { doc: 'Intro\n\n| A | B |\n| - | - |\n| 1 | 2 |', last: '2' },
  code: { doc: 'Intro\n\n```ts\nconst a = 1;\n```', last: 'const a = 1;' },
  quote: { doc: 'Intro\n\n> quoted words', last: 'quoted words' },
};

test.describe('the end of the document @blocks', () => {
  for (const [kind, { doc, last }] of Object.entries(BLOCKS)) {
    const journey = async ({ start }: { start: (options?: StartOptions) => Promise<Journey> }) => {
      const j = await start({ doc, tracking: false, view: 'clean' });
      await j.caretAfter(last);
      await j.press('ArrowDown');
      await j.type('x', 'burst');
      await j.shot(`down-after-${kind}`);
      // The new text is on a line of its own, after the block.
      expect((await j.cmText()).split('\n').at(-1)).toBe('x');
    };
    const title = `↓ after a ${kind} at the end reaches a line below it`;
    // A table works; after code and a quote the caret lands on the block's own last line.
    if (kind === 'table') test(title, journey);
    else known(514, title, journey);
  }
});
