// Two more atoms of pandoc's dialect that the random Quarto suite found (`pandoc-random.test.ts`,
// format §3.1 rule 9): the author-in-text citation `@smith2020` is a key like `@fig-x`, and a span's
// text and its attributes (`[x]{.mark}`) stay together. A marker from a comment or a highlight never
// stands inside either, in a `.qmd`.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { addHighlight } from './highlights.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import { newestView } from './views.ts';

const QMD = { dialect: 'pandoc' } as const;
const source = file('As @smith2020 showed, a [word]{.mark} here.');
const view = newestView(source).text;
const at = (find: string, offset = 0) => view.indexOf(find) + offset;

// [name, from, to] in offsets of the view.
const ranges: [string, number, number][] = [
  ['ends inside a citation key', at('As'), at('@smith', 6)],
  ['starts inside a citation key', at('@smith', 6), at('showed')],
  ['ends right after the text of a span', at('a [word'), at('[word]', 6)],
  ['starts right after the text of a span', at('[word]', 6), at('here')],
  ['starts inside a span', at('[word]', 3), at('here')],
];

describe('a citation in the text and a span are whole in a .qmd', () => {
  for (const [name, from, to] of ranges) {
    for (const kind of ['comment', 'highlight']) {
      it(`a ${kind} that ${name}: no marker inside`, () => {
        const ctx = context(ada, ['k3x9'], QMD);
        const range = { from, to };
        const done =
          kind === 'comment'
            ? addComment(source, range, 'Why?', ctx)
            : addHighlight(source, range, ctx);
        const after = applyChanges(source, done.changes);
        const body = bodyOf(after);
        expect(body).toContain('@smith2020');
        expect(body).toMatch(/\[[^\]]*\]\{\.mark\}/);
        expectEveryOrderRead(name, after);
      });
    }
  }
});

describe('fence and include lines take no marker (#1087, #1088)', () => {
  it('a partial edit of an include line puts the closer on the line after it', () => {
    const start = file('{{< include _part.qmd >}}\n\nText here.');
    const done = trackedEdits(
      start,
      [{ from: 16, to: 21, insert: '' }],
      context(ada, ['k3x9'], QMD),
    );
    const after = applyChanges(start, done.changes);
    expect(bodyOf(after)).toContain('{{< include _par >}}\n<!--/k3x9-->');
    expectEveryOrderRead('include', after);
  });

  it('a div closed in typed text in a quote has no marker on its closing fence', () => {
    const start = file('> A line of text here.\n\nAfter.');
    const at = newestView(start).text.indexOf('here.') + 5;
    const done = trackedEdits(
      start,
      [{ from: at, to: at, insert: ' ::: {.callout-tip}\nText\n:::' }],
      context(ada, ['k3x9', 'm4yz', 'p5qr', 'w8nn'], QMD),
    );
    const after = applyChanges(start, done.changes);
    expect(bodyOf(after)).not.toMatch(/:::[ \t]*<!--/);
    expectEveryOrderRead('div in a quote', after);
  });
});

describe('typed text that joins a key (#1074)', () => {
  it('tracked: the change takes the rest of the key in, so no marker stands in it', () => {
    const start = file('alpha 42 beta');
    const done = trackedEdits(
      start,
      [{ from: 6, to: 6, insert: '@fig-x' }],
      context(ada, ['k3x9'], QMD),
    );
    const after = applyChanges(start, done.changes);
    expect(bodyOf(after)).not.toMatch(/@fig-x<!--/);
    expect(newestView(after).text).toContain('@fig-x42');
    expectEveryOrderRead('joined key', after);
  });

  it('untracked: next to another change, the edit says it can not be made', () => {
    const start = file('Some <!--ins w8nn-->new<!--/w8nn-->text', { w8nn: 'bo' });
    expect(() => untrackedEdit(start, { from: 5, to: 5, insert: '@fig-x' }, QMD)).toThrow(
      /Track Changes/,
    );
    // In a .md the same text is plain.
    expect(untrackedEdit(start, { from: 5, to: 5, insert: '@fig-x' }, {}).length).toBeGreaterThan(
      0,
    );
  });
});
