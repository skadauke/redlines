// Text and block changes typed right after another person's pending line break (#107, #276 M1).
// A block opener (`## x`, `- x`, `> x`, `1. x`) or any text at the start of the line after a split's
// break can't stand in an insertion of its own there: accepting the insertion would take its
// opener's carrier line away, and the break would then reach the `## ` and read it as a prefix. So
// the change is written as the substitution of the block that holds the split whole (format §3.12),
// and every order of decisions reads alike. The fine writer, which makes no replacement, keeps its
// words for the same edits.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { trackedFormat } from './formatting.ts';
import { ada, bo, expectEveryOrderAlike, file, TIME } from './test-helpers.ts';
import { fineEdits, trackedEdits } from './track.ts';
import type { FormatOp } from './format-ops.ts';
import type { Person } from './types.ts';
import { newestView } from './views.ts';

let used = 0;
const random = (n: number) => Uint8Array.from({ length: n }, () => (used++ * 7 + 3) % 19);
const OPENERS = ['## x', '- x', '> x', '1. x'];

/** Bodies with a split of `splitter`'s, and the word whose start the other person types at. */
const BODIES: [string, string][] = [
  ['a paragraph', 'alpha<!--split k3x9-->\nbeta'],
  ['a paragraph after a blank line', 'alpha<!--split k3x9-->\n\nbeta'],
  ['a paragraph with a space before the break', 'alpha <!--split k3x9-->\n\nbeta'],
  ['a list item', '- alpha<!--split k3x9-->\n  beta'],
  ['a numbered item', '1. alpha<!--split k3x9-->\n   beta'],
  ['a quote', '> alpha<!--split k3x9-->\n>\n> beta'],
  ['a quote, one line', '> alpha<!--split k3x9-->\n> beta'],
  ['a quote in a list item', '- > alpha<!--split k3x9-->\n  >\n  > beta'],
];

function typed(body: string, insert: string, by: Person, splitter: string) {
  const text = file(body, { k3x9: splitter });
  const view = newestView(text);
  const at = view.text.indexOf('beta');
  const from = view.map.toSource(at, -1);
  const ctx = { author: by, time: TIME, random };
  const result = trackedEdits(text, [{ from, to: from, insert }], ctx);
  const after = applyChanges(text, result.changes);
  const intended = `${view.text.slice(0, at)}${insert}${view.text.slice(at)}`;
  return { text, after, intended, at, from, ctx };
}

describe("text typed at the start of the line after another person's split (#107, #276)", () => {
  for (const [name, body] of BODIES) {
    it(`reads alike in every order, in ${name}`, () => {
      for (const [by, splitter] of [
        [bo, 'ada'],
        [ada, 'bo'],
      ] as const) {
        for (const insert of ['x', ' ', ...OPENERS]) {
          const { after, intended } = typed(body, insert, by, splitter);
          const label = `${name}, ${JSON.stringify(insert)} by ${by.handle}`;
          expect(newestView(after).text, label).toBe(intended);
          expectEveryOrderAlike(label, after);
        }
      }
    }, 60_000);
  }

  it('keeps the split pending, inside the replacement or beside the insertion', () => {
    const { after } = typed('alpha<!--split k3x9-->\n\nbeta', '## x', bo, 'ada');
    expect(after).toContain('k3x9: {by: ada');
    expect(after).toContain('<!-\\-split k3x9-\\->');
  });

  it("says what to do where only the fine writer is asked, and the replacement is the editor's", () => {
    const text = file('- alpha<!--split k3x9-->\n  beta', { k3x9: 'ada' });
    const view = newestView(text);
    const from = view.map.toSource(view.text.indexOf('beta'), -1);
    const edit = { from, to: from, insert: ' ' };
    expect(() => fineEdits(text, [edit], { author: bo, time: TIME, random })).toThrow(
      'Text can not start the line after a line break that someone inserted yet.',
    );
    // The same author's continuation writes as it did.
    const own = file('- alpha<!--split k3x9-->\n  beta', { k3x9: 'bo' });
    const mine = fineEdits(own, [edit], { author: bo, time: TIME, random });
    expect(newestView(applyChanges(own, mine.changes)).text).toBe('- alpha\n   beta\n');
  });
});

describe("a block change of the line after another person's split (#107)", () => {
  const OPS: [string, FormatOp][] = [
    ['a heading', { kind: 'block', to: 'h2' }],
    ['a bullet', { kind: 'block', to: 'ul' }],
    ['a quote', { kind: 'block', to: 'quote' }],
    ['a number', { kind: 'block', to: 'ol' }],
  ];
  it.each(OPS)(
    'makes the paragraph %s, and every order reads alike',
    (_name, op) => {
      for (const body of ['alpha<!--split k3x9-->\n\nbeta', 'alpha <!--split k3x9-->\n\nbeta']) {
        const text = file(body, { k3x9: 'ada' });
        const from = text.indexOf('beta');
        const { changes } = trackedFormat(text, { from, to: from + 4 }, op, {
          author: bo,
          time: TIME,
          random,
        });
        const after = applyChanges(text, changes);
        expect(newestView(after).text).not.toBe(newestView(text).text);
        expectEveryOrderAlike(`${_name} after ${JSON.stringify(body)}`, after);
      }
    },
    60_000,
  );
});
