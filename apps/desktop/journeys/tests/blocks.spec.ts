// The end of the document, after a block that has no line below it (#514): ↓ reaches a new line,
// a paragraph of its own below the block, written as the file needs it (a blank line above, and
// outside the quote), with Track Changes on and off. Code with no closing fence is closed by ↓, and
// typed in with Track Changes on (#570).

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

  // Code with no closing fence runs to the end of the file (#570). Typing there with Track Changes
  // on is the whole-block substitution, written with the closing fence the new block needs.
  for (const scheme of ['light', 'dark'] as const) {
    test(`typing at the last line of code with no closing fence is written, Track Changes on, ${scheme}`, async ({
      start,
    }) => {
      const doc = 'Some text.\n\n```js\nlet x = 1';
      const j = await start({ doc, tracking: true, view: 'redlines', scheme });
      await j.caretAfter('let x = 1');
      await j.type(' + 2');
      await j.shot(`open-fence-typed-${scheme}`);
      const file = await j.cmText();
      expect(body(file), 'the new code is in the page, in a closed block').toContain(
        '```js\nlet x = 1 + 2\n```\n',
      );
      expect(body(file), 'the old block is kept as the payload').toContain('<!--sub ');
      expect((await j.caret()).lineText, 'the caret is at the end of what was typed').toBe(
        'let x = 1 + 2',
      );
      expect(await j.page.locator('.cm-content').innerText()).toContain('let x = 1 + 2');
      await j.press('ControlOrMeta+z');
      expect(await j.cmText(), 'Undo takes the typing back').not.toContain('+ 2');
    });
  }

  for (const tracking of [false, true]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`↓ at the end of code with no closing fence closes it and reaches a new line, Track Changes ${tracking ? 'on' : 'off'}, ${scheme}`, async ({
        start,
      }) => {
        const j = await start({
          doc: 'Intro\n\n```ts\nconst a = 1;',
          tracking,
          view: 'redlines',
          scheme,
        });
        await j.caretAfter('const a = 1;');
        await j.press('ArrowDown');
        await j.type('x', 'burst');
        await j.shot(`down-after-open-fence-${tracking ? 'tracked' : 'plain'}-${scheme}`);
        const lines = body(await j.cmText()).split('\n');
        const at = lines.findIndex((line) => line.startsWith('x'));
        expect(at, 'the text is on a line of its own below the block').toBeGreaterThan(0);
        expect(lines[at - 1], 'a blank line parts it from the block').toBe('');
        expect(lines[at - 2], 'the block is closed above it').toBe('```');
        expect((await j.caret()).lineText.startsWith('x')).toBe(true);
      });
    }

    test(`one Undo takes ↓'s fence and line back, Track Changes ${tracking ? 'on' : 'off'}`, async ({
      start,
    }) => {
      const doc = 'Intro\n\n```ts\nconst a = 1;';
      const j = await start({ doc, tracking, view: 'redlines' });
      await j.caretAfter('const a = 1;');
      await j.press('ArrowDown');
      expect(await j.cmText()).toContain('```\n');
      await j.press('ControlOrMeta+z');
      expect(body(await j.cmText())).toBe(doc);
    });
  }

  test('↓ in the middle of a quote moves as ever', async ({ start }) => {
    const j = await start({ doc: 'Intro\n\n> one\n> two\n', tracking: false, view: 'clean' });
    await j.caretAfter('one');
    await j.press('ArrowDown');
    expect((await j.caret()).lineText).toBe('> two');
    expect(await j.cmText()).toBe('Intro\n\n> one\n> two\n');
  });
});
