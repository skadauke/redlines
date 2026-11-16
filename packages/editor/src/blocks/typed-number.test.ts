// @vitest-environment happy-dom
// A number and a period typed at the start of an item's text (#666, format §3.2): `- 1.` is, to
// CommonMark, a bullet that holds an empty numbered list, which moved the bullet and which Return
// deleted. The delimiter typed after the digits, with nothing after the caret, is text: it is
// written escaped (`- 1\.`), the line reads as text, and Return makes the next item. Track Changes
// on and off; every script is held to the suite's invariants (micromark's reading, the decisions,
// Undo).
import { describe, expect, it } from 'vitest';
import { runScript, type Script, scriptRows, type Step } from './script.ts';

const typeEach = (text: string): Step[] => [...text].map((type) => ({ type }));

describe('typing a number and a period at the start of an item (#666)', () => {
  const rows: Script[] = [];
  for (const tc of [false, true]) {
    const on = tc ? 'on' : 'off';
    for (const [name, doc, typed, file] of [
      ['1.', '- a⏎- ‸', '1.', '- a⏎- 1\\.'],
      ['10.', '- a⏎- ‸', '10.', '- a⏎- 10\\.'],
      ['1)', '- a⏎- ‸', '1)', '- a⏎- 1\\)'],
      ['1. in a numbered item', '1. a⏎2. ‸', '1.', '1. a⏎2. 1\\.'],
      ['1. in a nested item', '- a⏎  - ‸', '1.', '- a⏎  - 1\\.'],
      ['1. in a quoted item', '> - a⏎> - ‸', '1.', '> - a⏎> - 1\\.'],
      ['1. typed after the digit of a one-item list', '- 1‸', '.', '- 1\\.'],
    ] as const) {
      // Tracked, text typed in a bare nested marker is refused already, whatever it is (lane R).
      if (tc && name.includes('nested')) continue;
      rows.push({
        name: `${name}: the delimiter is escaped, Track Changes ${on}`,
        doc,
        keys: typeEach(typed),
        tc,
        expect: tc ? {} : { file },
      });
    }
    // Text that is no marker stays as it is: a period with text after it, a box, a letter.
    for (const [name, doc, typed, file] of [
      ['a period before more text in the line', '- a⏎- ‸', 'x1.', '- a⏎- x1.'],
      ['a letter and a period', '- a⏎- ‸', 'a.', '- a⏎- a.'],
      ['a number and a period in a box item', '- [ ] a⏎- [ ] ‸', '1.', '- [ ] a⏎- [ ] 1.'],
    ] as const) {
      rows.push({
        name: `${name}: written as typed, Track Changes ${on}`,
        doc,
        keys: typeEach(typed),
        tc,
        expect: tc ? {} : { file },
      });
    }
    // Return after it makes the next item, and the text stays text.
    rows.push({
      name: `Return after 1.: the next item, Track Changes ${on}`,
      doc: '- a⏎- ‸',
      keys: [...typeEach('1.'), 'Enter', ...typeEach('b')],
      tc,
      expect: tc ? {} : { file: '- a⏎- 1\\.⏎- b' },
    });
  }
  scriptRows(rows);

  it('reads the file as the text 1., never as a numbered list in the item', () => {
    for (const tc of [false, true]) {
      const result = runScript({
        name: 'x',
        doc: '- a⏎- ‸',
        keys: typeEach('1.'),
        tc,
        expect: {},
      });
      expect(result.refusals).toEqual([]);
      expect(result.listReadFailures).toEqual([]);
    }
  });
});
