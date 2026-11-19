// A key in indented code that stands right before an item that doesn't start at 1 (#601). The code's
// write is the whole block with its closer on a line of its own, and micromark reads the item under
// that closer as a list (`<ol start="2">`), where the newest view, with no closer, has the item as
// text after the code (`<p>2. …</p>`): the file and the view read alike only if the item goes into
// the replacement with the code. An item that starts at 1 reads as a list in both, and stays out.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectEveryOrderRead, expectSound } from './oracle.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView } from './views.ts';

const IDS = ['k3x9', 'w8nn', 'p5qm', 'q6rs'];

function typed(body: string, find: string, offset: number, insert: string, length = 0): string {
  const start = file(body);
  const at = newestView(start).text.indexOf(find) + offset;
  const changes = trackedEdits(
    start,
    [{ from: at, to: at + length, insert }],
    context(ada, IDS),
  ).changes;
  return applyChanges(start, changes);
}

describe('indented code above an item that starts at a number other than 1', () => {
  const cases: [string, string, string, number, string, number][] = [
    ['typing in the code, above 2.', '     a a\n2. review a', 'a a', 1, 'x', 0],
    ['deleting in the code, above 2.', '     a a\n2. review a', 'a a', 1, '', 1],
    ['typing in the code, above 10.', '     a a\n10. review a', 'a a', 1, 'x', 0],
    [
      'typing in the code, above 3) and a text',
      '     a a\n3) review a\n\nAfter.',
      'a a',
      1,
      'x',
      0,
    ],
  ];
  for (const [name, body, find, offset, insert, length] of cases) {
    it(
      name,
      () => {
        const after = typed(body, find, offset, insert, length);
        const text = bodyOf(after);
        // The item is in the substitution, not alone under its closer.
        expect(text, after).not.toMatch(/-->\n\d{1,9}[.)] /);
        // micromark reads the file as it reads the newest view, in every order of decisions.
        expectEveryOrderRead(name, after);
        expectSound(name, after);
      },
      60_000,
    );
  }

  it('an item that starts at 1 stays out of the replacement', () => {
    const after = typed('     a a\n1. review a', 'a a', 1, 'x');
    expect(bodyOf(after)).toMatch(/-->\n1\. review a/);
    expectSound('1.', after);
  });
});
