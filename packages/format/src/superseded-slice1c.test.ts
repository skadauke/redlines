// Regression tests for format issues that the widening (lane R2 to R5, format §3.12) superseded, or
// that already read soundly (Epic #537, lane FX1c): each is the reproduction the issue gave, written
// by the format's own edit functions, and held to the properties of docs/hardening.md: every order
// of decisions reads alike, each file on the way reads as its newest view, and rejecting what was
// written gives the text before it back.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { rejectAll } from './decide.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { emphasisReadsAlike } from './emphasis-orders.ts';
import { ada, bo, bodyOf, context, exactly, expectEveryOrderAlike, file } from './test-helpers.ts';
import type { Person } from './types.ts';
import { trackedEdits } from './track.ts';

const IDS = ['m2bd', 'n8fx', 'p5qm', 'q6rs', 'r7st'];

/** A tracked edit of `text` by `who`, as the editor writes it; the new file. */
function press(text: string, from: number, to: number, insert: string, who: Person = ada): string {
  const done = trackedEdits(text, [{ from, to, insert }], context(who, [...IDS]));
  return applyChanges(text, done.changes);
}

const at = (text: string, find: string, offset = 0): number => {
  const index = text.indexOf(find);
  if (index < 0) throw new Error(`no ${JSON.stringify(find)} in ${JSON.stringify(text)}`);
  return index + offset;
};

/** Every order of decisions reads alike, exactly, each file on the way reads as its newest view,
 * and rejecting all gives the text before the edit (with the changes it had rejected too). */
function held(label: string, before: string, after: string): void {
  expectEveryOrderAlike(label, after, exactly);
  expectEveryOrderRead(label, after);
  const rejected = applyChanges(after, rejectAll(after));
  expect(bodyOf(rejected).trimEnd(), `${label}: rejects back`).toBe(
    bodyOf(applyChanges(before, rejectAll(before))).trimEnd(),
  );
}

describe('#103: rare list layouts above a numbered item, next to another person’s block change', () => {
  // Bo turned an item that was `2.` into a bullet; Ada edits the lines above it.
  const item = '- <!--fmt tnv3 was=ol=2.\\x20-->\n  delta<!--/tnv3-->';
  const layouts: [string, string][] = [
    ['a fenced block over a blank line', 'para\n\n```\ncode\n\nmore\n```\n8. alpha\n'],
    ['a numbered line from 8 after a paragraph', 'para\n8. alpha\n'],
    ['indented code in an item, then a lazy line', '1. a\n\n       code\nlazy\n8. c\n'],
    ['a nested numbered item', '1. a\n   1. b\n   8. c\n'],
    ['a raw block over a blank line', '<pre>\nx\n\ny\n</pre>\n8. alpha\n'],
  ];
  for (const [name, above] of layouts) {
    it(`${name}: text typed in the numbered line is written and reads alike in every order`, () => {
      const before = file(`${above}${item}\n\nEnd`, { tnv3: 'bo' });
      const spot = at(before, '8. ', 3);
      held(name, before, press(before, spot, spot, 'x', ada));
    });
  }

  it('Enter in a numbered line after a paragraph is widened to the paragraph and its line', () => {
    const before = file(`para\n8. alpha\n${item}\n\nEnd`, { tnv3: 'bo' });
    const spot = at(before, '8. ', 3);
    held('enter', before, press(before, spot, spot, '\n', ada));
  });

  it('three splits of a collaborator in front do not stop an edit from being checked', () => {
    const before = file(
      '7. a<!--split m2bd-->\n8. b<!--split n8fx-->\n9. c<!--split p5qm-->\n10. d',
      { m2bd: 'bo', n8fx: 'bo', p5qm: 'bo' },
    );
    const end = at(before, '10. d', 5);
    expectEveryOrderAlike('three splits', press(before, end, end, 'x', ada), exactly);
  });
});

describe('#276: next to chains of another person’s marks', () => {
  it('N2: a paste two marks away from a delimiter run reads alike in every order', () => {
    const before = file(
      'a<!--ins k3x9--> <!--/k3x9--><!--del q4w7 *x--><!--del r5t8  -->middle** End',
      { k3x9: 'bo', q4w7: 'bo', r5t8: 'bo' },
    );
    held('N2', before, press(before, 1, 1, 'a', bo));
  });

  it('M3: an ordinary key next to a chain of four of Bo’s insertions is written', () => {
    const before = file(
      'one <!--ins q4w7-->a<!--/q4w7--><!--ins r5t8-->b<!--/r5t8--><!--ins s6vw-->c<!--/s6vw--><!--ins t7wx-->d<!--/t7wx--> two',
      { q4w7: 'bo', r5t8: 'bo', s6vw: 'bo', t7wx: 'bo' },
    );
    held('M3 letter', before, press(before, 1, 1, 'z', ada));
    const two = at(before, 'two');
    held('M3 star', before, press(before, two, two, '*', ada));
  }, 60_000);
});

describe('#276 M2: a cluster of four or more adjacent marks is read to the end', () => {
  it('judges a chain of 4 or 5 of Bo’s insertions after a plain *, from a mark in the middle', () => {
    for (const n of [4, 5]) {
      const ids = IDS.slice(0, n);
      const chain = ids.map((id, i) => `<!--ins ${id}-->${'abcdef'[i]}<!--/${id}-->`).join('');
      const before = file(`one *${chain} two`, Object.fromEntries(ids.map((id) => [id, 'bo'])));
      expect(emphasisReadsAlike(before, new Set([ids[Math.floor(n / 2)] ?? '']))).toBe(true);
    }
  });
});

describe('#142: a line break typed after a file’s final line break, in a file with mixed endings', () => {
  it('is written as a substitution of the break and reads alike in every order', () => {
    const before = file('Hello world.\r\n\r\nSecond line here.\n');
    const spot = at(before, 'here.\n', 6);
    const after = press(before, spot, spot, 'Z', ada);
    expect(bodyOf(after)).toContain('<!--sub m2bd \\x0a-->\nZ<!--/m2bd-->');
    expectEveryOrderAlike('142', after, exactly);
    expectEveryOrderRead('142', after);
  });
});

describe('#17: edits its first comment listed as refused or different', () => {
  it('retyping deleted text writes a deletion and an insertion that reject alike', () => {
    const before = file('one two three');
    const deleted = press(before, 4, 7, '', ada);
    held('retype', deleted, press(deleted, at(deleted, '<!--del'), at(deleted, '<!--del'), 'two'));
  });

  it('writes code as a replacement of its block, not a refusal', () => {
    const before = file('para\n\n```\ncode\n```\n');
    held('code', before, press(before, at(before, 'code', 2), at(before, 'code', 2), 'x'));
  });

  it('writes the deletion of the text of a parent item that has a nested list', () => {
    const before = file('- parent\n  - child\n');
    held('parent', before, press(before, 2, 8, '', ada));
  });

  it('writes the deletion of another person’s insertion at the start of a paragraph', () => {
    const before = file('<!--ins a1b2-->ab<!--/a1b2--> tail', { a1b2: 'bo' });
    held('insertion', before, press(before, at(before, 'ab'), at(before, 'ab', 2), '', ada));
  });

  it('writes Enter in front of spaces and a marker, and inside a heading’s #', () => {
    const marker = file('one  <!--cmt c7g3--> two');
    held('marker', marker, press(marker, 4, 4, '\n', ada));
    const heading = file('# Title\n');
    held('heading', heading, press(heading, 1, 1, '\n', ada));
  });
});
