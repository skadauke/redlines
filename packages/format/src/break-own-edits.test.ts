// Edits next to the line break of a split (#119, #120): a bare Enter typed at the end of the line
// above the author's own paragraph break in a list, text after her own split that follows two
// spaces, text typed on the blank line of her own split, and another person's deletion of the line
// break in front of a line that she splits. Each reads as typed, and every order of decisions
// agrees.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { ada, bo, expectEveryOrderAlike, file, TIME } from './test-helpers.ts';
import { fineEdits as trackedEdits } from './track.ts';
import type { Person } from './types.ts';
import { newestView } from './views.ts';

let used = 0;
const counting = () => (n: number) => Uint8Array.from({ length: n }, () => (used++ * 7 + 3) % 19);

/** The file after `person` replaces `len` characters of the newest view at the place that `find`
 * starts at, plus `off`, by `insert`. */
function edit(
  text: string,
  find: string,
  off: number,
  insert: string,
  len = 0,
  person: Person = ada,
): string {
  const view = newestView(text);
  const place = view.text.indexOf(find) + off;
  const from = view.map.toSource(place, len === 0 ? -1 : 1);
  const to = len === 0 ? from : view.map.toSource(place + len, -1);
  const result = trackedEdits(text, [{ from, to, insert }], {
    author: person,
    time: TIME,
    random: counting(),
  });
  return applyChanges(text, result.changes);
}

const own = { k3x9: 'ada' };

describe('edits next to the break of your own split in a list (#120)', () => {
  it('keeps the indentation of the line after a bare Enter at the end of the line above', () => {
    const text = file('- one<!--split k3x9-->\n  \n  two', own);
    const after = edit(text, 'one', 3, '\n');
    // `two` is still in the item: it reads as it was typed, up to white space.
    expect(newestView(after).text.replace(/\s+/g, ' ')).toBe('- one two ');
    expect(newestView(after).text).toMatch(/\n {2}two\n$/);
    expectEveryOrderAlike('bare Enter', after);
  });

  it('writes text on the line after a split that follows two spaces', () => {
    const text = file('- one  <!--split k3x9-->\n  two', own);
    const after = edit(text, 'two', 0, 'x');
    expect(newestView(after).text).toBe('- one  \n  xtwo\n');
    expectEveryOrderAlike('after two spaces', after);
  });

  it('writes text typed on the blank line of the split, and a line break there', () => {
    const text = file('- one<!--split k3x9-->\n  \n  two', own);
    const typed = edit(text, '\n  \n', 3, 'x');
    expect(newestView(typed).text).toBe('- one\n  x\n  two\n');
    expectEveryOrderAlike('x on the blank line', typed);
    const enter = edit(text, '\n  \n', 3, '\n');
    expect(newestView(enter).text.replace(/[ \n]+/g, ' ')).toBe('- one two ');
    expectEveryOrderAlike('Enter on the blank line', enter);
  });
});

describe('another person deletes the line break in front of the line you split (#119)', () => {
  it('reads the same in every order', () => {
    for (const insert of ['\n  ', '\n']) {
      let text = file('- one\nnew two');
      text = edit(text, 'new ', 4, insert);
      text = edit(text, 'one\nnew', 3, '', 1, bo);
      expectEveryOrderAlike(`Enter ${JSON.stringify(insert)} then Bo's deletion`, text);
    }
  });
});
