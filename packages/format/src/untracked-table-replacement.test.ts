import { describe, expect, it } from 'vitest';
import { accept, reject } from './decide.ts';
import { applyChanges } from './changes.ts';
import { parse } from './parse.ts';
import { newestView, originalView } from './views.ts';
import { encodePayload } from './payload.ts';
import { untrackedEdit } from './untracked.ts';

// Bo's pending alignment change is one replacement over the whole table; plain typing in a cell of it is in
// both views, so it is written in the new rows and in the same cell of the old rows (#955).
const file = (
  cell: string,
) => String.raw`<!--sub b7cd  alpha \| alpha \| x y \|\n -\-\- \| :-\- \| -\-\- \|\n 11 \|  \|  \|\n x y \| alpha \| b \|-->

 alpha | alpha | ${cell} |
 --- | :-- | --: |
 11 |  |  |
 x y | alpha | b |
<!--/b7cd-->

<!-- redlines
# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.
version: 1
people:
  bo: {name: Bo Chen}
marks:
  b7cd: {by: bo, at: 2026-10-31T09:00Z}
-->
`;

describe('plain typing in a table with a pending alignment change', () => {
  for (const [cell, typed, insertAt] of [
    ['x y', 'q', 'x'],
    ['**x y**', '_', 'x y'],
    ['**x y**', 'q', ' y'],
  ] as const) {
    it(`puts ${JSON.stringify(typed)} in both views of ${cell}`, () => {
      const text = file(cell);
      const place = text.indexOf(cell) + cell.indexOf(insertAt);
      const after = applyChanges(
        text,
        untrackedEdit(text, { from: place, to: place, insert: typed }),
      );
      const nOld = originalView(text).text;
      const was = nOld.split('\n')[0] ?? '';
      expect(newestView(after).text).toContain(typed);
      const orig = originalView(after).text.split('\n')[0] ?? '';
      expect(orig).toContain(typed);
      expect(orig.replace(typed, '')).toBe(was);
      // Every order of decisions reads alike: the typing is in the result of each.
      expect(parse(after).marks).toHaveLength(1);
      const accepted = applyChanges(after, accept(after, 'b7cd'));
      const rejected = applyChanges(after, reject(after, 'b7cd'));
      expect(newestView(accepted).text).toContain(typed);
      expect(newestView(rejected).text.split('\n')[0]).toContain(typed);
      expect(newestView(rejected).text.split('\n')[0]).toBe(orig);
    });
  }
});

// A table replacement built from the rows of the new and of the old copy.
const replacement = (now: string[], old: string[]) => {
  const payload = encodePayload(old.join('\n'));
  return `<!--sub b7cd ${payload}-->\n\n${now.join('\n')}\n<!--/b7cd-->\n\n<!-- redlines
# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.
version: 1
people:
  bo: {name: Bo Chen}
marks:
  b7cd: {by: bo, at: 2026-10-31T09:00Z}
-->
`;
};
const rowsOf = (head: string) => [`| ${head} |`, '| --- |', '| z |'];
const typeAt = (text: string, marker: string, delta: number, insert: string) => {
  const at = text.indexOf(marker, text.indexOf('-->')) + delta;
  return applyChanges(text, untrackedEdit(text, { from: at, to: at, insert }));
};
const headOf = (view: string) => view.split('\n')[0] ?? '';

describe('an edit in a table replacement lands in the same place of both copies', () => {
  it('puts text typed after a closing run of syntax after the old copy’s run', () => {
    const text = replacement(rowsOf('**x y**'), rowsOf('**x y**'));
    const after = typeAt(text, '**x y**', '**x y**'.length, 'q');
    expect(headOf(newestView(after).text)).toBe('| **x y**q |');
    expect(headOf(originalView(after).text)).toBe('| **x y**q |');
    const front = typeAt(replacement(rowsOf('a**b**'), rowsOf('a**b**')), 'a**', 1, 'q');
    expect(headOf(newestView(front).text)).toBe('| aq**b** |');
    expect(headOf(originalView(front).text)).toBe('| aq**b** |');
  });

  it('writes nothing in a replacement that is not a table, as before', () => {
    const prose = `<!--sub b7cd x \\| y-->x | y z<!--/b7cd-->\n\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\nmarks:\n  b7cd: {by: bo, at: 2026-10-31T09:00Z}\n-->\n`;
    const at = prose.indexOf('y z');
    const after = applyChanges(prose, untrackedEdit(prose, { from: at, to: at, insert: 'q' }));
    expect(after).toContain('<!--sub b7cd x \\| y-->x | <!--/b7cd-->q');
  });

  it('turns an edit in the delimiter row to the alert', () => {
    const text = replacement(rowsOf('x'), rowsOf('x'));
    const rule = text.indexOf('---', text.indexOf('-->')) + 1;
    expect(() => untrackedEdit(text, { from: rule, to: rule, insert: '-' })).toThrow(
      /can't be typed/,
    );
  });

  it('places by the text in cells that are padded differently', () => {
    const text = replacement(['|   x y   |', '| --- |', '| z |'], rowsOf('x y'));
    const after = typeAt(text, 'x y', 1, 'q');
    expect(headOf(newestView(after).text)).toContain('xq y');
    expect(headOf(originalView(after).text)).toContain('xq y');
  });

  it('takes a deletion out of both copies, and takes the alert where it would unbalance the old', () => {
    const text = replacement(rowsOf('**x y**'), rowsOf('**x y**'));
    const at = text.indexOf('x y', text.indexOf('-->'));
    const after = applyChanges(text, untrackedEdit(text, { from: at, to: at + 1, insert: '' }));
    expect(headOf(newestView(after).text)).toBe('| ** y** |');
    expect(headOf(originalView(after).text)).toBe('| ** y** |');
    const plain = replacement(rowsOf('**x y**'), rowsOf('x y'));
    const from = plain.indexOf('**x y**', plain.indexOf('-->'));
    expect(() => untrackedEdit(plain, { from, to: from + 3, insert: '' })).toThrow(
      /can't be typed/,
    );
  });
});
