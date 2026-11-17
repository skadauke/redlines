import { describe, expect, it } from 'vitest';
import { accept, reject } from './decide.ts';
import { applyChanges } from './changes.ts';
import { parse } from './parse.ts';
import { newestView, originalView } from './views.ts';
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
