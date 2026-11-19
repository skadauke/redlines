// Two more atoms of pandoc's dialect that the random Quarto suite found (`pandoc-random.test.ts`,
// format §3.1 rule 9): the author-in-text citation `@smith2020` is a key like `@fig-x`, and a span's
// text and its attributes (`[x]{.mark}`) stay together. A marker from a comment or a highlight never
// stands inside either, in a `.qmd`.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { addHighlight } from './highlights.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { parse } from './parse.ts';
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

describe('a div typed whole in a quote is one insertion (§9.4, #1234)', () => {
  const DIV = '::: {.callout-tip}\n> A.\n> :::';
  const cases: [string, string, number, string][] = [
    ['on an empty line of the quote', '> A line.\n>\n> \n\nAfter.', '> A line.\n>\n> '.length, DIV],
    ['after a line of the quote', '> A line.\n\nAfter.', '> A line.'.length, `\n>\n> ${DIV}`],
    [
      'in a quote in a list item',
      '- > A.\n\nAfter.',
      '- > A.'.length,
      '\n>\n  > ::: {.callout-tip}\n  > B.\n  > :::',
    ],
    [
      'in a quote in a quote',
      '> > A.\n\nAfter.',
      '> > A.'.length,
      '\n> >\n> > ::: {.callout-tip}\n> > B.\n> > :::',
    ],
  ];
  for (const [name, doc, at, typed] of cases) {
    it(`${name}: no marker on a fence line, every order reads alike`, () => {
      const start = file(doc);
      const done = trackedEdits(
        start,
        [{ from: at, to: at, insert: typed }],
        context(ada, ['k3x9', 'm4yz', 'p5qr', 'w8nn'], QMD),
      );
      const after = applyChanges(start, done.changes);
      const fences = bodyOf(after)
        .split('\n')
        .filter((line) => /^[ \t>]*:{3,}/.test(line));
      expect(fences.length).toBeGreaterThanOrEqual(2);
      expect(fences.filter((line) => line.includes('<!--'))).toEqual([]);
      expectEveryOrderRead(name, after);
      // Reject gives the document back, accept leaves no marks.
      expect(bodyOf(applyChanges(after, rejectAll(after))).trimEnd()).toBe(bodyOf(start).trimEnd());
      expect(parse(applyChanges(after, acceptAll(after))).marks).toEqual([]);
    });
  }
});

describe('a div typed in a list item (§9.4, #1234)', () => {
  const D = '::: {.callout-tip}\n  A.\n  :::';
  const deeper = (text: string, by: string) => text.replaceAll('\n  ', `\n${by}`);
  const IDS = ['k3x9', 'm4yz', 'p5qr', 'w8nn', 'b3dn', 'c4fr', 'd5gs', 'f6hj', 'g7km', 'h8nq'];
  // [name, document, where the typing starts (after this text of it), what is typed, the body written]
  const cases: [string, string, string, string, string][] = [
    [
      'right under the text of the only item: the closer stands outside the list',
      '- one\n\nAfter.',
      '- one',
      `\n  ${D}`,
      '- one<!--ins k3x9--><!--split m4zp-->\n  ::: {.callout-tip}\n  A.\n  :::\n<!--/k3x9-->\n\nAfter.',
    ],
    [
      'first in an empty item',
      '- \n\nAfter.',
      '- ',
      D,
      '- <!--ins k3x9-->\n  ::: {.callout-tip}\n  A.\n  :::\n<!--/k3x9-->\n\nAfter.',
    ],
    [
      'under the last of two items',
      '- one\n- two\n\nAfter.',
      '- one\n- two',
      `\n  ${D}`,
      '- one\n- two<!--ins k3x9--><!--split m4zp-->\n  ::: {.callout-tip}\n  A.\n  :::\n<!--/k3x9-->\n\nAfter.',
    ],
    [
      'under a nested item that ends the list',
      '- one\n  - two\n\nAfter.',
      '- one\n  - two',
      `\n    ${deeper(D, '    ')}`,
      '- one\n  - two<!--ins k3x9--><!--split m4zp-->\n    ::: {.callout-tip}\n    A.\n    :::\n<!--/k3x9-->\n\nAfter.',
    ],
    [
      'in an item of a list in a quote that ends the list',
      '> - one\n\nAfter.',
      '> - one',
      `\n>   ${deeper(D, '>   ')}`,
      '> - one<!--ins k3x9--><!--split m4zp-->\n>   ::: {.callout-tip}\n>   A.\n>   :::\n> <!--/k3x9-->\n\nAfter.',
    ],
    [
      'under the first of two items: the list is replaced, the closer after it',
      '- one\n- two\n\nAfter.',
      '- one',
      `\n  ${D}`,
      '<!--sub k3x9 - one\\n- two-->\n- one\n  ::: {.callout-tip}\n  A.\n  :::\n- two<!--/k3x9-->\n\nAfter.',
    ],
    [
      'in an item of a list in a quote with another item after it',
      '> - one\n> - two\n\nAfter.',
      '> - one',
      `\n>   ${deeper(D, '>   ')}`,
      '> <!--sub k3x9 - one\\n> - two-->\n>\n> - one\n>   ::: {.callout-tip}\n>   A.\n>   :::\n> - two<!--/k3x9-->\n\nAfter.',
    ],
    [
      'under a nested item with another after it',
      '- one\n  - two\n  - three\n\nAfter.',
      '- one\n  - two',
      `\n    ${deeper(D, '    ')}`,
      '- one\n  <!--sub k3x9 - two\\n  - three-->\n  - two\n    ::: {.callout-tip}\n    A.\n    :::\n  - three<!--/k3x9-->\n\nAfter.',
    ],
    [
      'after a blank line: a second paragraph, the closer in the item',
      '- one\n\nAfter.',
      '- one',
      `\n\n  ${D}`,
      '- one<!--ins k3x9-->\n\n  ::: {.callout-tip}\n  A.\n  :::\n  <!--/k3x9-->\n\nAfter.',
    ],
    [
      'after typed text and a blank line',
      '- one\n\nAfter.',
      '- one',
      `\n\n  Intro.\n\n  ${D}`,
      '- one<!--ins k3x9-->\n\n  Intro.\n\n  ::: {.callout-tip}\n  A.\n  :::\n  <!--/k3x9-->\n\nAfter.',
    ],
    [
      'the same in a nested item',
      '- one\n  - two\n\nAfter.',
      '- one\n  - two',
      `\n\n    Intro.\n\n    ${deeper(D, '    ')}`,
      '- one\n  - two<!--ins k3x9-->\n\n    Intro.\n\n    ::: {.callout-tip}\n    A.\n    :::\n    <!--/k3x9-->\n\nAfter.',
    ],
    [
      'after a blank line in an item of a list in a quote: the closer at the item prefix',
      '> - one\n> - two\n\nAfter.',
      '> - one',
      `\n>\n>   ${deeper(D, '>   ')}`,
      '> - one<!--ins k3x9-->\n>\n>   ::: {.callout-tip}\n>   A.\n>   :::\n>   <!--/k3x9-->\n> - two\n\nAfter.',
    ],
    [
      'the same with typed text before the callout',
      '> - one\n> - two\n\nAfter.',
      '> - one',
      `\n>\n>   Intro.\n>\n>   ${deeper(D, '>   ')}`,
      '> - one<!--ins k3x9-->\n>\n>   Intro.\n>\n>   ::: {.callout-tip}\n>   A.\n>   :::\n>   <!--/k3x9-->\n> - two\n\nAfter.',
    ],
    [
      'the same in a list in a quote in a quote',
      '> > - one\n> > - two\n\nAfter.',
      '> > - one',
      `\n> >\n> >   ${deeper(D, '> >   ')}`,
      '> > - one<!--ins k3x9-->\n> >\n> >   ::: {.callout-tip}\n> >   A.\n> >   :::\n> >   <!--/k3x9-->\n> > - two\n\nAfter.',
    ],
    [
      'the same under the last item of a list in a quote',
      '> - one\n> - two\n\nAfter.',
      '> - one\n> - two',
      `\n>\n>   ${deeper(D, '>   ')}`,
      '> - one\n> - two<!--ins k3x9-->\n>\n>   ::: {.callout-tip}\n>   A.\n>   :::\n>   <!--/k3x9-->\n\nAfter.',
    ],
  ];
  for (const [name, doc, before, typed, expected] of cases) {
    it(`${name}: no marker on a fence line, every order reads alike`, () => {
      const start = file(doc);
      const at = before.length;
      const done = trackedEdits(
        start,
        [{ from: at, to: at, insert: typed }],
        context(ada, IDS, QMD),
      );
      const after = applyChanges(start, done.changes);
      expect(after.split('<!-- redlines')[0]!.trimEnd()).toBe(expected);
      const fences = bodyOf(after)
        .split('\n')
        .filter((line) => /^[ \t>]*:{3,}/.test(line));
      expect(fences.length).toBeGreaterThanOrEqual(2);
      expect(fences.filter((line) => line.includes('<!--'))).toEqual([]);
      expectEveryOrderRead(name, after);
      expect(bodyOf(applyChanges(after, rejectAll(after))).trimEnd()).toBe(bodyOf(start).trimEnd());
      expect(parse(applyChanges(after, acceptAll(after))).marks).toEqual([]);
    });
  }

  it('a lone fence line has no line to read the container from: written as before, never asked about', () => {
    for (const [doc, before, typed] of [
      ['- one\n\nAfter.', '- one', '\n  :::'],
      ['- \n\nAfter.', '- ', '::: {.callout-tip}'],
      ['- one\n- two\n\nAfter.', '- one', '\n  ::: {.callout-tip}'],
    ] as const) {
      const start = file(doc);
      const at = before.length;
      const done = trackedEdits(
        start,
        [{ from: at, to: at, insert: typed }],
        context(ada, IDS, QMD),
      );
      expect(applyChanges(start, done.changes)).toContain('<!--ins');
    }
  });
});
