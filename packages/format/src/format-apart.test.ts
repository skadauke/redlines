// Format changes with pending changes apart from them in their block (format §2.6, "Marks apart"):
// what is left pending, what is tried, and that leaving them pending allows what trying every mark
// allows and nothing that reads otherwise.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { marksApart } from './format-apart.ts';
import type { FormatOp, InlineFormat } from './format-ops.ts';
import { formatReader } from './format-reader.ts';
import { trackedFormat, tryingEveryMark, untrackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { trackedEdit } from './track.ts';
import type { TrackedEdits } from './track.ts';
import {
  TIME,
  ada,
  bo,
  bodyOf,
  context,
  exactly,
  expectBlocksAs,
  expectEveryDecision,
  expectEveryOrderAlike,
  file,
  naturalOffsets,
  randomIds,
} from './test-helpers.ts';
import type { EditContext, Range, TextChange } from './types.ts';
import { newestView } from './views.ts';

const inline = (format: InlineFormat, on: boolean): FormatOp => ({ kind: 'inline', format, on });
const bold = (on: boolean) => inline('bold', on);
const italic = (on: boolean) => inline('italic', on);
const link = (url: string | null): FormatOp => ({ kind: 'link', url });
const clear: FormatOp = { kind: 'clear' };

const ctx = (...ids: string[]): EditContext => context(ada, ids.length > 0 ? ids : ['m2bd']);

/** The range of `word` in `text`: the first place it stands, or the one after `after`. */
function rangeOf(text: string, word: string, after = 0): Range {
  const from = text.indexOf(word, after);
  if (from === -1) throw new Error(`${word} is not in the text`);
  return { from, to: from + word.length };
}

/** A tracked format change, as the new file. */
function format(text: string, range: Range, op: FormatOp, c: EditContext = ctx()): string {
  return applyChanges(text, trackedFormat(text, range, op, c).changes);
}

/** The body of a file, ending in one line break: a ledger leaves a blank line in front of it. */
const body = (text: string) => `${bodyOf(text).replace(/[\r\n]+$/, '')}\n`;

const rejected = (text: string, id: string) => applyChanges(text, reject(text, id));

describe('pending changes apart from the change (format §2.6)', { timeout: 120_000 }, () => {
  // A co-author's insertions, deletions and substitutions in five items, and a sixth left alone.
  const EDITS = [
    'one <!--ins k3x9-->new <!--/k3x9-->apple',
    'two <!--del n8fx big -->pear',
    'three <!--sub p7qd old-->fresh<!--/p7qd--> plum',
    'four <!--ins d3x9-->ripe <!--/d3x9-->fig',
    'five <!--del g3rp sour -->lime',
  ];
  const BO = { k3x9: 'bo', n8fx: 'bo', p7qd: 'bo', d3x9: 'bo', g3rp: 'bo' };
  const REGIONS: readonly (readonly [string, (items: readonly string[]) => string])[] = [
    ['list', (items) => items.map((item) => `- ${item}`).join('\n')],
    [
      'table',
      (items) => ['| a | b |', '| - | - |', ...items.map((i) => `| ${i} | x |`)].join('\n'),
    ],
    ['quote', (items) => items.map((item) => `> ${item}`).join('\n>\n')],
  ];
  const OPS: readonly (readonly [string, FormatOp])[] = [
    ['bold', bold(true)],
    ['italic', italic(true)],
    ['code', inline('code', true)],
    ['link', link('https://new.example/a')],
  ];

  it('formats a word in an item that pending changes in five other items leave alone', () => {
    for (const [name, region] of REGIONS) {
      const text = file(region([...EDITS, 'six word here']), BO);
      for (const [label, op] of OPS) {
        const after = format(text, rangeOf(text, 'word'), op);
        expect(parse(after).marks.map((mark) => mark.id)).toContain('m2bd');
        expect(rejected(after, 'm2bd'), `${name} ${label}`).toBe(text);
        // Every order of every decision, the co-author's included, reads as the same decisions
        // without it, with the same blocks; rejected, it gives the bytes back.
        expect(
          expectEveryDecision(`${name} ${label}`, text, after, ['m2bd'], { structure: op }),
        ).toBe(3 ** 6);
        // And the same decisions give the same file, in whichever order they are made.
        expectEveryOrderAlike(`${name} ${label}`, after, exactly);
      }
    }
  });

  it('formats with Track Changes off there too', () => {
    for (const [name, region] of REGIONS) {
      const text = file(region([...EDITS, 'six word here']), BO);
      const word = rangeOf(text, 'word');
      const after = applyChanges(text, untrackedFormat(text, word, bold(true), { author: ada }));
      expect(body(after), name).toBe(body(text).replace('word', '**word**'));
      expectEveryDecision(name, text, after, [], { inPlace: true, structure: bold(true) });
    }
  });

  it('tries every mark that a decision could make it read otherwise with', () => {
    // Four changes of Ada's own in the item and the new mark are as many as can be tried: one
    // more mark that has to be tried is too many, and one apart from the change is not.
    const own =
      'six <!--ins b2cd-->one <!--/b2cd-->two <!--ins c3df-->three <!--/c3df-->four <!--ins d4fg-->more <!--/d4fg-->five <!--ins f5gh-->less <!--/f5gh-->and word here';
    const OWN = { b2cd: 'ada', c3df: 'ada', d4fg: 'ada', f5gh: 'ada' };
    const TOO_MANY = 'Accept or reject some of the changes in this';
    const tries = (body: string, marks: Record<string, string>) => {
      const text = file(body, { ...OWN, ...marks });
      return () => trackedFormat(text, rangeOf(text, 'word'), bold(true), ctx());
    };
    // Apart: a word inserted, deleted, replaced or highlighted in another item, row or paragraph.
    const items = (...lines: string[]) => lines.map((line) => `- ${line}`).join('\n');
    for (const [label, body] of [
      ['bullet', items('one <!--ins k3x9-->new <!--/k3x9-->apple', own)],
      ['numbered', `1. one apple\n2. two <!--del k3x9 big -->pear\n3. ${own}`],
      ['nested', `- one apple\n    - two <!--sub k3x9 old-->new<!--/k3x9--> pear\n- ${own}`],
      ['second paragraph', `- one apple\n\n  more <!--ins k3x9-->new <!--/k3x9-->text\n\n- ${own}`],
      ['highlight', items('one <!--hl k3x9-->apple<!--/k3x9--> pie', own)],
      [
        'row',
        `| a | b |\n| - | - |\n| one <!--ins k3x9-->new <!--/k3x9-->apple | x |\n| ${own} | y |`,
      ],
      ['quote', `> one <!--ins k3x9-->new <!--/k3x9-->apple\n>\n> ${own}`],
    ] as const) {
      expect(tries(body, { k3x9: 'bo' }), label).not.toThrow();
    }
    for (const [label, body, marks] of [
      // In the same item: Ada's own, as another person's change there refuses the change.
      [
        'same item',
        items('one apple', own.replace('and', 'and <!--ins k3x9-->so <!--/k3x9-->')),
        { k3x9: 'ada' },
      ],
      // A line break between items deleted, which joins them.
      ['join', items('one apple<!--del k3x9 \\n- -->two pear', own), { k3x9: 'bo' }],
      // A line break inserted in an item, which splits it.
      ['split', items('one<!--split k3x9-->\n-  apple', own), { k3x9: 'bo' }],
      // The bullet of an item deleted.
      [
        'bullet',
        '- one apple<!--sub k3x9 \\n- two-->\ntwo<!--/k3x9--> pear\n' + items(own),
        { k3x9: 'bo' },
      ],
      // A new item.
      [
        'new item',
        items('one apple<!--ins k3x9--><!--split n8fx-->\n- new<!--/k3x9-->', own),
        { k3x9: 'bo', n8fx: 'bo' },
      ],
      // A definition that the item's link uses.
      [
        'definition',
        items(
          '[r]: <!--sub k3x9 https://old.example-->https://new.example<!--/k3x9-->',
          own.replace('and', 'and [r]'),
        ),
        { k3x9: 'bo' },
      ],
      // The delimiter row of a table, and its header row.
      [
        'delimiter row',
        `| a | b |\n| - | -<!--ins k3x9-->-<!--/k3x9--> |\n| ${own} | x |`,
        { k3x9: 'bo' },
      ],
      [
        'header row',
        `| a | <!--sub k3x9 b-->bee<!--/k3x9--> |\n| - | - |\n| ${own} | x |`,
        { k3x9: 'bo' },
      ],
      // A word whose text could end a code span, or start a line of its own.
      ['backtick', items('one <!--ins k3x9-->`new` <!--/k3x9-->apple', own), { k3x9: 'bo' }],
      ['line start', items('<!--del k3x9 old -->\n  one apple', own), { k3x9: 'bo' }],
    ] as const) {
      expect(tries(body, marks), label).toThrow(TOO_MANY);
    }
  });

  /** The ids of the marks apart from a change at `word`, the file taken as its own block. */
  const apartOf = (text: string, word = 'word') => {
    const parsed = parse(text);
    return [...marksApart(formatReader(text, parsed), parsed, [rangeOf(text, word)]).ids];
  };
  /** Ada's tracked edits, one after the other, as the editor makes them. */
  const edited = (start: string, ...edits: ((text: string) => TextChange)[]) => {
    let text = file(start, {});
    const ids = ['k3x9', 'p7qd', 'd3x9', 'f4gh', 'n8fx', 'g3rp', 'h5jk', 'q2hw'];
    for (const edit of edits) {
      text = applyChanges(text, trackedEdit(text, edit(text), context(ada, ids.splice(0, 4))));
    }
    return text;
  };
  /** Enter after `here`, in an item, a paragraph and a quote paragraph, and a space typed in front
   * of the `*` in the new block; and the same two blocks with no split between them. */
  const SPLIT = [
    ['item', '- six x*word here one y*z', '\n- ', '- six x*word here\n- one y*z'],
    ['paragraph', 'six x*word here one y*z', '\n\n', 'six x*word here\n\none y*z'],
    ['quote', '> six x*word here one y*z', '\n>\n> ', '> six x*word here\n>\n> one y*z'],
  ] as const;
  const space = (text: string): TextChange => {
    const at = text.indexOf('y*z') + 1;
    return { from: at, to: at, insert: ' ' };
  };
  const split = (start: string, enter: string) =>
    edited(
      start,
      (text) => ({ from: text.indexOf(' one'), to: text.indexOf(' one') + 1, insert: enter }),
      space,
    );

  it('tries a mark in the item or paragraph right after a split', () => {
    // Rejecting the split takes its break, and the blank line and the prefix after it, and joins
    // the block after it to the one before: a mark there is not apart.
    for (const [name, start, enter, apart] of SPLIT) {
      const text = split(start, enter);
      const kinds = parse(text).marks.map((mark) => mark.kind);
      expect(kinds.toSorted(), name).toEqual(['del', 'ins', 'split']);
      expect(apartOf(text), name).toEqual([]);
      // Without the split, the same insertion in the next block is apart.
      const plain = edited(apart, space);
      expect(apartOf(plain), name).toEqual(parse(plain).marks.map((mark) => mark.id));
    }
  });

  it('refuses what a split before the block of a mark apart would make read otherwise', () => {
    // Accepting the deletion of the space, rejecting the split and the space typed before `*z`:
    // `here` and `one` come together, and the new `**` would pair with the `*` of `y*z`.
    const outcome = (run: () => unknown) => {
      try {
        return { result: run() };
      } catch (error) {
        if (error instanceof EditError) return { code: error.code, message: error.message };
        throw error;
      }
    };
    for (const [name, start, enter] of SPLIT) {
      const text = split(start, enter);
      for (const op of [bold(true), inline('code', true), link('https://new.example/a')]) {
        const label = `${name} ${JSON.stringify(op)}`;
        const word = rangeOf(text, 'word');
        // As trying every mark refuses or allows it, as main does.
        expect(
          outcome(() => trackedFormat(text, word, op, ctx())),
          label,
        ).toEqual(outcome(() => tryingEveryMark.trackedFormat(text, word, op, ctx())));
        expect(
          outcome(() => untrackedFormat(text, word, op, { author: ada })),
          label,
        ).toEqual(outcome(() => tryingEveryMark.untrackedFormat(text, word, op, { author: ada })));
      }
    }
    // Bold on `word` is one of them: refused, tracked.
    const [, start, enter] = SPLIT[0];
    const text = split(start, enter);
    expect(() => trackedFormat(text, rangeOf(text, 'word'), bold(true), ctx())).toThrow(
      /stray syntax/,
    );
    // And the two the review found in random files, with code and a link, tracked and untracked.
    for (const [written, marks, op] of [
      [
        '- x* x*word k,<!--del w6v9  --><!--split zpkb-->\n- cut <!--del gk3c y-->*z x',
        { w6v9: 'ada', zpkb: 'ada', gk3c: 'ada' },
        inline('code', true),
      ],
      [
        '> beta six x*word k,<!--del rrhs  --><!--split ckcq-->\n>\n> cut x<!--sub jr65 *-->z<!--/jr65--> alpha',
        { rrhs: 'ada', ckcq: 'ada', jr65: 'ada' },
        link('https://new.example/a'),
      ],
    ] as const) {
      const found = file(written, marks);
      const word = rangeOf(found, 'word');
      expect(() => trackedFormat(found, word, op, ctx()), written).toThrow(/stray syntax/);
      expect(() => untrackedFormat(found, word, op, { author: ada }), written).toThrow(
        /stray syntax/,
      );
    }
  });

  it('tries a mark in a line that CommonMark reads as a line of the paragraph above', () => {
    // A number other than 1 can't interrupt a paragraph, and a bullet four columns past where
    // the paragraph's container starts would be code, which can't either: the editor reads an item
    // there, CommonMark reads more of the paragraph above, so deciding the mark there changes how
    // that paragraph reads.
    for (const [written, word] of [
      ['- six x*word here\n  2. two y<!--ins n8fx--> <!--/n8fx-->*z', 'word'],
      ['- six x*word here\n  2. two <!--del n8fx y-->*z', 'word'],
      ['six x*word here\n    - two <!--del n8fx y-->*z', 'word'],
      ['- six x*word here\n      - two <!--del n8fx y-->*z', 'word'],
      // And below the paragraph of the mark.
      ['- two <!--del n8fx y-->*z\n  2. six x*word here', 'word'],
      ['- two <!--del n8fx y-->*z\n      - six x*word here', 'word'],
      // A bare bullet under it is a setext underline or a line of the paragraph.
      ['1. one apple\n2. two <!--del n8fx y-->*z\n-\n3. six word here', 'word'],
    ] as const) {
      expect(apartOf(file(written, { n8fx: 'bo' }), word), written).toEqual([]);
    }
    // Where CommonMark reads an item, it is apart: a number under an item of its own list at its
    // column, a bullet less than four columns past the content above, or one at the item's column.
    for (const written of [
      '1. six x*word here\n2. two <!--del n8fx y-->*z',
      '- six x*word here\n    - two <!--del n8fx y-->*z',
      '- six x*word here\n  - two <!--del n8fx y-->*z',
      '- six x*word here\n- two <!--del n8fx y-->*z',
      '  - six x*word here\n  - two <!--del n8fx y-->*z',
    ]) {
      expect(apartOf(file(written, { n8fx: 'bo' })), written).toEqual(['n8fx']);
    }
  });

  it('refuses as main does where the editor reads an item that CommonMark reads as text', () => {
    // The issue's workflow with a line under the last item that the editor reads as an item and
    // CommonMark as more of that item's paragraph (#139): with the four items' changes apart, the
    // walk would allow what reads otherwise once Bo's change on that line is rejected. Such a
    // region leaves no mark apart, and is refused as trying every mark refuses it, in main's words.
    const TOO_MANY =
      'There are too many pending changes to check this formatting against. Accept or reject some of the changes in this list first.';
    for (const line of ['  2. two <!--del g3rp y-->*z', '      - two <!--del g3rp y-->*z']) {
      const items = [...EDITS.slice(0, 4).map((item) => `- ${item}`), '- five x*word here', line];
      const text = file(items.join('\n'), { ...BO, g3rp: 'bo' });
      const word = rangeOf(text, 'word');
      expect(apartOf(text), line).toEqual([]);
      expect(() => trackedFormat(text, word, bold(true), ctx()), line).toThrow(TOO_MANY);
      expect(() => untrackedFormat(text, word, bold(true), { author: ada }), line).toThrow(
        TOO_MANY,
      );
      expect(() => tryingEveryMark.trackedFormat(text, word, bold(true), ctx())).toThrow(TOO_MANY);
      expect(() =>
        tryingEveryMark.untrackedFormat(text, word, bold(true), { author: ada }),
      ).toThrow(TOO_MANY);
    }
  });

  it('leaves no mark apart in a region with such a line, wherever it stands', () => {
    // A number other than 1 in the text of the item above, or right under a wrapped line of it; a
    // bullet four columns or more past the text of the item above; in a quote, a bullet four
    // columns past the quote's text. Above the change's item, right under it, or under another.
    const LINES = ['  2. two pear', '      - two pear', '  and more\n  8. eight pear'];
    const items = [...EDITS.map((item) => `- ${item}`), '- six word here', '- seven plum'];
    for (const line of LINES) {
      for (const under of [0, 5, 6]) {
        const lines = items.flatMap((item, i) => (i === under ? [item, line] : [item]));
        const text = file(lines.join('\n'), BO);
        const label = `${JSON.stringify(line)} under item ${under + 1}`;
        expect(apartOf(text), label).toEqual([]);
        const word = rangeOf(text, 'word');
        expect(() => trackedFormat(text, word, bold(true), ctx()), label).toThrow(/too many/);
        expect(() => untrackedFormat(text, word, bold(true), { author: ada }), label).toThrow(
          /too many/,
        );
      }
    }
    const quote = file(
      [...EDITS.map((item) => `> ${item}`), '> six word here\n>     - two pear'].join('\n>\n'),
      BO,
    );
    expect(apartOf(quote)).toEqual([]);
    expect(() => trackedFormat(quote, rangeOf(quote, 'word'), bold(true), ctx())).toThrow(
      /too many/,
    );
    // Where both read an item, the changes stay apart: a number under a wrapped item, an item after
    // a nested list, a bullet at the column of the one above, a number at a new list's column.
    const numbered = (under: string) =>
      [
        `1. ${EDITS[0] ?? ''}`,
        under,
        ...EDITS.slice(1).map((item, i) => `${i + 2}. ${item}`),
        '6. six word here',
      ].join('\n');
    for (const [label, body] of [
      ['wrapped', numbered('   and more')],
      ['nested', numbered('   - sub item')],
      ['nested bullets', `- one apple\n    - ${EDITS.join('\n    - ')}\n- six word here`],
      ['new list', `- ${EDITS.join('\n- ')}\n2. six word here`],
    ] as const) {
      const text = file(body, BO);
      expect(apartOf(text).toSorted(), label).toEqual(['d3x9', 'g3rp', 'k3x9', 'n8fx', 'p7qd']);
      expect(
        () => trackedFormat(text, rangeOf(text, 'word'), bold(true), ctx()),
        label,
      ).not.toThrow();
    }
  });

  it("formats an item's first word, and next to a change at the start of another item's text", () => {
    // A mark that starts an item's text has its opener alone on the bullet's line, the text on the
    // next line (format §3.3), and a deletion of all of it leaves nothing but its marker there: the
    // editor reads the line as an item, and CommonMark does too. Ada's format change on the first
    // word of the sixth item, and on a word further in once Bo has changed the start of the second
    // item's text: allowed, and every order of every decision reads as the same decisions without
    // it, with the same blocks.
    const formatted = (label: string, text: string, word: string, op: FormatOp) => {
      const after = format(text, rangeOf(text, word), op);
      expect(rejected(after, 'm2bd'), label).toBe(text);
      expect(expectEveryDecision(label, text, after, ['m2bd'], { structure: op })).toBeGreaterThan(
        0,
      );
      expectEveryOrderAlike(label, after, exactly);
      const off = applyChanges(
        text,
        untrackedFormat(text, rangeOf(text, word), op, { author: ada }),
      );
      expectEveryDecision(`off: ${label}`, text, off, [], { inPlace: true, structure: op });
    };
    const six = [...EDITS, 'six word here'];
    for (const [name, written] of [
      ['list', six.map((item) => `- ${item}`).join('\n')],
      ['numbered', six.map((item, i) => `${i + 1}. ${item}`).join('\n')],
    ] as const) {
      for (const [label, op] of [
        ['bold', bold(true)],
        ['link', link('https://new.example/a')],
      ] as const) {
        const text = file(written, BO);
        formatted(`${name}, ${label} on the first word`, text, 'six', op);
        expect(body(format(text, rangeOf(text, 'six'), op))).toMatch(/\n(?:- |6\. )<!--fmt m2bd/);
      }
    }
    const base = [
      '- one <!--ins k3x9-->new <!--/k3x9-->apple',
      '- two pear',
      ...EDITS.slice(2).map((item) => `- ${item}`),
      '- six word here',
    ];
    const four = { k3x9: 'bo', p7qd: 'bo', d3x9: 'bo', g3rp: 'bo' };
    for (const [label, edit] of [
      ['a word before its first word', { at: 'two pear', length: 0, insert: 'ripe ' }],
      ['its first word replaced', { at: 'two pear', length: 3, insert: 'Two' }],
      ['its text replaced', { at: 'two pear', length: 8, insert: 'Two pears' }],
      ['its text deleted', { at: 'two pear', length: 8, insert: '' }],
    ] as const) {
      let text = file(base.join('\n'), four);
      const from = text.indexOf(edit.at);
      text = applyChanges(
        text,
        trackedEdit(
          text,
          { from, to: from + edit.length, insert: edit.insert },
          context(bo, ['n8fx', 'b2cd', 'c3df', 'f4gh']),
        ),
      );
      expect(body(text), label).toMatch(/\n- <!--/);
      formatted(`Bo's change: ${label}`, text, 'word', bold(true));
    }
  });

  it('falls back where a bullet line with nothing but markers on it is no item to CommonMark', () => {
    // A number other than 1 in the text of the item above, or a bullet four columns past it, holds
    // no item whatever stands after its marker: CommonMark reads more of the paragraph above.
    for (const line of ['  2. <!--del n9fx gone-->', '      - <!--del n9fx gone-->']) {
      const text = file([...EDITS.map((item) => `- ${item}`), '- six word here', line].join('\n'), {
        ...BO,
        n9fx: 'bo',
      });
      const word = rangeOf(text, 'word');
      expect(apartOf(text), line).toEqual([]);
      expect(() => trackedFormat(text, word, bold(true), ctx()), line).toThrow(/too many/);
      expect(() => untrackedFormat(text, word, bold(true), { author: ada }), line).toThrow(
        /too many/,
      );
    }
  });

  it('tries every mark when a decision makes a line that the editor reads as an item', () => {
    // Ada deleted the first word of the wrapped line of her item, which the editor writes as a
    // substitution of the line break before it: accepted, the line is `  2. y*z`, which the editor
    // reads as an item and CommonMark as more of her paragraph. The region as it is written holds
    // no such line, and Bo's four changes are apart; a state of the walk does, and then every mark
    // is tried, as trying every mark (main) does: refused, as too many or as reading otherwise.
    const outcome = (run: () => unknown) => {
      try {
        run();
        return 'allowed';
      } catch (error) {
        if (error instanceof EditError) return error.message;
        throw error;
      }
    };
    const start = [...EDITS.slice(0, 4).map((item) => `- ${item}`), '- five x*word here'];
    const four = { k3x9: 'bo', n8fx: 'bo', p7qd: 'bo', d3x9: 'bo' };
    for (const tail of ['y*z', 'y z']) {
      let text = file([...start, `  two 2. ${tail}`].join('\n'), four);
      const at = text.indexOf('two 2.');
      text = applyChanges(
        text,
        trackedEdit(text, { from: at, to: at + 4, insert: '' }, context(ada, ['g3rp'])),
      );
      expect(body(applyChanges(text, accept(text, 'g3rp')))).toContain(`here\n  2. ${tail}\n`);
      expect(apartOf(text).toSorted(), tail).toEqual(['d3x9', 'k3x9', 'n8fx', 'p7qd']);
      const word = rangeOf(text, 'word');
      const tracked = outcome(() => trackedFormat(text, word, bold(true), ctx()));
      const untracked = outcome(() => untrackedFormat(text, word, bold(true), { author: ada }));
      expect(tracked, tail).not.toBe('allowed');
      expect(untracked, tail).not.toBe('allowed');
      expect(tracked, tail).toBe(
        outcome(() => tryingEveryMark.trackedFormat(text, word, bold(true), ctx())),
      );
      expect(untracked, tail).toBe(
        outcome(() => tryingEveryMark.untrackedFormat(text, word, bold(true), { author: ada })),
      );
    }
  });

  it('tries every mark when a decision is refused only while a mark apart is pending', () => {
    // Accepting Ada's deletion makes `<!--`, a comment that ends at the next `-->`: the opener of
    // Bo's insertion while it is pending, which refuses it, and once Bo's is decided, the `-->` in
    // the third item. With the change, the comment ends at the new opener and hides it, so that the
    // decision that works without the change doesn't with it.
    const text = file(
      '- one <<!--del d3x9 x-->!-- word here\n- two <!--ins k3x9-->new <!--/k3x9-->pear\n- three --> plum',
      { d3x9: 'ada', k3x9: 'bo' },
    );
    const word = rangeOf(text, 'word');
    expect(() => trackedFormat(text, word, bold(true), ctx())).toThrow(/stray syntax/);
    expect(() => tryingEveryMark.trackedFormat(text, word, bold(true), ctx())).toThrow(
      /stray syntax/,
    );
  });

  it('costs about what it does with the pending changes in paragraphs of their own', () => {
    const ids = [...'bcdfghjkmn'].map((c) => `k${c}x9`);
    const marks = Object.fromEntries(ids.map((id) => [id, 'bo']));
    const edited = (i: number) => `<!--ins ${ids[i] ?? ''}-->new <!--/${ids[i] ?? ''}-->`;
    // Ten of Bo's insertions in the other items of the list, or in paragraphs after it.
    const items = ids.map((_, i) => `- item ${i} ${edited(i)}words here`);
    const inItems = file(`${items.join('\n')}\n- the last word here`, marks);
    const plainItems = ids.map((_, i) => `- item ${i} new words here`);
    const paragraphs = ids.map((_, i) => `Paragraph ${i} ${edited(i)}words here.`);
    const inParagraphs = file(
      `${plainItems.join('\n')}\n- the last word here\n\n${paragraphs.join('\n\n')}`,
      marks,
    );
    const best = (text: string) => {
      const selected = rangeOf(text, 'word', text.indexOf('the last'));
      let fastest = Infinity;
      for (let run = 0; run < 7; run++) {
        const start = performance.now();
        trackedFormat(text, selected, bold(true), ctx());
        fastest = Math.min(fastest, performance.now() - start);
      }
      return fastest;
    };
    best(inItems);
    // About 1.05 here. Every order of the ten marks would be 2·11·3^10 decisions, far past any
    // budget, and walking them is what was refused.
    expect(best(inItems) / best(inParagraphs)).toBeLessThan(3);
  });
});

describe(
  'marks apart from the change, on random lists, tables and quotes',
  { timeout: 3_600_000 },
  () => {
    const WORDS = [
      'alpha',
      'beta',
      'x',
      '42',
      'k,',
      '(b)',
      'a-b',
      '*e*',
      '_f_',
      '**c d**',
      '`g`',
      '[h i](u.md)',
      '[r]',
      'm*n',
    ];
    /** What co-authors type: words mostly, and now and then what reaches past a paragraph. */
    const TYPED = [
      'new ',
      ' new',
      'z',
      ', ',
      'so ',
      'word ',
      '*',
      '_',
      '`',
      '[r]',
      '|',
      '<b>',
      '\\',
      '\n- ',
      '\n',
      '\n\n',
      '\n>\n> ',
    ];
    const INLINE: readonly FormatOp[] = [
      bold(true),
      bold(true),
      italic(true),
      inline('strike', true),
      inline('code', true),
      bold(false),
      italic(false),
      inline('code', false),
      clear,
      link('https://new.example/a'),
      link(null),
    ];

    /** A list, a table or a block quote of a few items, one of them with the word `target`, with
     * highlights, a comment and a definition now and then, Bo's pending changes in the other items,
     * mostly words, and Ada's in that one. */
    function regionDocument(random: () => number): string {
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]) => items[below(items.length)] as T;
      const words = () => Array.from({ length: 2 + below(4) }, () => pick(WORDS)).join(' ');
      const marks: Record<string, string> = {};
      const threads: string[] = [];
      const count = 3 + below(4);
      const target = below(count);
      // A highlight or a comment around the last word of some items.
      const item = (i: number) => {
        const text = `${pick(['one', 'two', 'six'])} ${words()} ${i === target ? 'target ' : ''}${pick(['alpha', 'beta', 'gamma'])}`;
        const around = below(7);
        const id = ['h4kz', 'h5kz', 'h6kz', 'h7kz', 'h8kz', 'h9kz', 'hbkz', 'hckz'][i] ?? 'hdkz';
        if (around === 0) {
          marks[id] = 'bo';
          return text.replace(/(\S+)$/, `<!--hl ${id}-->$1<!--/${id}-->`);
        }
        if (around === 1 && threads.length === 0) {
          threads.push(
            '  c8d2:',
            '    by: bo',
            '    at: 2026-10-13T22:40Z',
            '    text: |-',
            '      A note.',
          );
          return text.replace(/(\S+)$/, '<!--cmt c8d2-->$1<!--/c8d2-->');
        }
        return text;
      };
      const items = Array.from({ length: count }, (_, i) => item(i));
      const kind = below(6);
      const body =
        kind === 0
          ? items.map((text) => `- ${text}`).join('\n')
          : kind === 1
            ? items.map((text, i) => `${i + 1}. ${text}`).join('\n')
            : kind === 2
              ? [
                  '| a | b |',
                  '| - | - |',
                  ...items.map((text) => `| ${text} | ${pick(WORDS)} |`),
                ].join('\n')
              : kind === 3
                ? items.map((text) => `> ${text}`).join('\n>\n')
                : kind === 4
                  ? items.map((text, i) => (i % 2 === 1 ? `    - ${text}` : `- ${text}`)).join('\n')
                  : items.map((text) => `- ${text}`).join('\n\n');
      const definition = below(3) === 0 ? '\n\n[r]: https://r.example' : '';
      let text = file(`${body}${definition}`, marks, threads);
      for (let edit = 2 + below(6); edit > 0; edit--) {
        const stop = parse(text).ledgerRange?.from ?? text.length;
        const lines: Range[] = [];
        for (let at = 0; at < stop; at = text.indexOf('\n', at) + 1 || stop) {
          lines.push({
            from: at,
            to: Math.min(stop, text.indexOf('\n', at) === -1 ? stop : text.indexOf('\n', at)),
          });
        }
        const mine = text.indexOf('target');
        const own = lines.find((line) => line.from <= mine && mine <= line.to);
        // Mostly Bo's words in another item, past its first word; now and then anything anywhere,
        // or Ada's in her item.
        const way = below(6);
        const others = lines.filter((line) => line !== own && line.to - line.from > 4);
        const line = way === 5 ? own : pick(others.length > 0 ? others : lines);
        if (!line) continue;
        const first = line.from + Math.min(line.to - line.from, 4);
        const at = way === 4 ? below(stop) : first + below(Math.max(1, line.to - first));
        // Bo types words in other items; Ada, in hers, words or Enter as well.
        const typed = way >= 4 ? pick(TYPED) : pick(TYPED.slice(0, 11));
        const change = [
          { from: at, to: at, insert: typed },
          { from: at, to: Math.min(stop, at + 1 + below(4)), insert: '' },
          { from: at, to: Math.min(stop, at + 1 + below(4)), insert: typed },
        ][below(3)] as TextChange;
        const author = way === 5 ? ada : bo;
        try {
          const bytes = (n: number) => Uint8Array.from({ length: n }, () => below(256));
          text = applyChanges(
            text,
            trackedEdit(text, change, { author, time: TIME, random: bytes }),
          );
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
        }
      }
      return text;
    }

    /** A range around the word `target`, or from a view offset to another a few words on. */
    function randomRange(below: (n: number) => number, text: string): Range {
      const at = text.indexOf('target');
      if (at !== -1 && below(3) > 0) {
        const from = Math.max(0, at - below(12));
        return { from, to: Math.min(text.length, at + 6 + below(12)) };
      }
      const view = newestView(text);
      const offsets = naturalOffsets(view.text);
      const first = offsets[below(offsets.length)] ?? 0;
      const later = offsets.filter((offset) => offset > first && offset <= first + 20);
      const last = later[below(later.length)] ?? first;
      const stop = parse(text).ledgerRange?.from ?? text.length;
      const one = Math.min(view.map.toSource(first, below(2) === 0 ? -1 : 1), stop);
      const two = Math.min(view.map.toSource(last, below(2) === 0 ? -1 : 1), stop);
      return { from: Math.min(one, two), to: Math.max(one, two) };
    }

    const outcome = <T>(run: () => T): { result?: T; error?: EditError } => {
      try {
        return { result: run() };
      } catch (error) {
        if (error instanceof EditError) return { error };
        throw error;
      }
    };
    /** Whether a refusal is the budget's: every mark could not be tried. */
    const tooMany = (error: EditError | undefined) => error?.message.includes('too many') === true;

    it('allows what trying every mark allows, and nothing else that reads otherwise', () => {
      const documents = fuzzCount(60);
      let alike = 0;
      let more = 0;
      let checked = 0;
      for (let seed = 1; seed <= documents; seed++) {
        const random = seeded(seed * 7919);
        const below = (n: number) => Math.floor(random() * n);
        const plain = regionDocument(random);
        const text = seed % 2 === 0 ? plain.replace(/\r?\n/g, '\r\n') : plain;
        const range = randomRange(below, text);
        const op = INLINE[below(INLINE.length)] as FormatOp;
        const label = `seed ${seed}: ${JSON.stringify(op)} on ${JSON.stringify(range)} in ${JSON.stringify(bodyOf(text))}`;
        const c = () => ({
          author: ada,
          time: TIME,
          random: randomIds('m2bd', 'n8fz', 'p7qz', 'q2hz', 'r3sz', 's4tz'),
        });
        const every = outcome(() => tryingEveryMark.trackedFormat(text, range, op, c()));
        const apart = outcome(() => trackedFormat(text, range, op, c()));
        if (every.result) {
          // What trying every mark allows, leaving some pending allows too, the same way.
          expect(apart.error?.message, label).toBeUndefined();
          expect(apart.result, label).toEqual(every.result);
          alike++;
        } else if (!tooMany(every.error)) {
          // And what it refuses, leaving some pending refuses too.
          expect(apart.result, `${label}\n${every.error?.message ?? ''}`).toBeUndefined();
        } else if (apart.result && apart.result.changes.length > 0) {
          // More than every mark can be tried for: every order of them, exactly.
          const result: TrackedEdits = apart.result;
          const after = applyChanges(text, result.changes);
          const reshaped = parse(text).marks.filter(
            (mark) =>
              parse(after).marks.find((other) => other.id === mark.id)?.segments.length !==
              mark.segments.length,
          ).length;
          const states = expectEveryDecision(label, text, after, result.markIds, {
            structure: op,
            inPlace: result.extendedIds.length > 0 || reshaped > 0,
            alsoChanged: result.extendedIds.length + reshaped,
            limit: 7,
          });
          if (states > 0) expectEveryOrderAlike(label, after, exactly);
          if (states > 0) checked++;
          more++;
        }
        // With Track Changes off too.
        const everyOff = outcome(() =>
          tryingEveryMark.untrackedFormat(text, range, op, { author: ada }),
        );
        const apartOff = outcome(() => untrackedFormat(text, range, op, { author: ada }));
        if (everyOff.result) {
          expect(apartOff.error?.message, `off: ${label}`).toBeUndefined();
          expect(apartOff.result, `off: ${label}`).toEqual(everyOff.result);
        } else if (!tooMany(everyOff.error)) {
          expect(
            apartOff.result,
            `off: ${label}\n${everyOff.error?.message ?? ''}`,
          ).toBeUndefined();
        } else if (apartOff.result && apartOff.result.length > 0) {
          const after = applyChanges(text, apartOff.result);
          expectEveryDecision(`off: ${label}`, text, after, [], { inPlace: true, limit: 7 });
          expectBlocksAs(`off: ${label}`, after, text, op, Infinity);
        }
      }
      // Most documents can be tried both ways, and some are allowed only with marks left pending.
      expect(alike, `${more} more`).toBeGreaterThan(documents / 4);
      if (documents >= 100) expect(checked, JSON.stringify({ alike, more })).toBeGreaterThan(0);
    });
  },
);
