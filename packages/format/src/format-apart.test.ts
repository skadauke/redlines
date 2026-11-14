// Format changes with pending changes apart from them in their block (format §2.6, "Marks apart"):
// what is left pending, what is tried, and that leaving them pending allows what trying every mark
// allows and nothing that reads otherwise.

import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { holdsMisreadItem, itemLines, marksApart } from './format-apart.ts';
import type { FormatOp, InlineFormat } from './format-ops.ts';
import { formatReader } from './format-reader.ts';
import { trackedFormat, tryingEveryMark, untrackedFormat } from './formatting.ts';
import { markerRanges } from './markers.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { trackedEdit } from './track.ts';
import type { TrackedEdits } from './track.ts';
import {
  TIME,
  ada,
  blockLeaves,
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
  reading,
} from './test-helpers.ts';
import type { EditContext, Range, TextChange } from './types.ts';
import { newestView } from './views.ts';

const inline = (format: InlineFormat, on: boolean): FormatOp => ({ kind: 'inline', format, on });
const bold = (on: boolean) => inline('bold', on);
const italic = (on: boolean) => inline('italic', on);
const link = (url: string | null): FormatOp => ({ kind: 'link', url });
const clear: FormatOp = { kind: 'clear' };
const indent = (by: 1 | -1): FormatOp => ({ kind: 'indent', by });
const check = (checked: boolean): FormatOp => ({ kind: 'check', checked });
const block = (to: Extract<FormatOp, { kind: 'block' }>['to']): FormatOp => ({ kind: 'block', to });

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
const accepted = (text: string, id: string) => applyChanges(text, accept(text, id));

/** micromark's HTML of a file's body, with strong emphasis left out: what is left once an inline
 * bold is decided either way. */
const micromarkWords = (text: string) =>
  micromark(bodyOf(text), { allowDangerousHtml: true })
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?strong>/g, '');

/** Every way of deciding every mark of `after`, each accepted or rejected in turn, reads to
 * micromark as the same decisions of `before`, a bold left out: the words of an inline bold's
 * walk judged by micromark too, not only by the editor's reading. Returns how many were compared. */
function expectMicromarkAlike(label: string, before: string, after: string): number {
  const ids = [
    ...new Set(
      parse(after)
        .marks.filter((m) => m.kind !== 'cmt')
        .map((m) => m.id),
    ),
  ];
  const tried = (run: () => string) => {
    try {
      return run();
    } catch (error) {
      if (error instanceof EditError) return undefined;
      throw error;
    }
  };
  let compared = 0;
  const walk = (a: string, b: string, i: number, path: string) => {
    const id = ids[i];
    if (id === undefined) {
      compared++;
      expect(micromarkWords(a), `${label}:${path}`).toBe(micromarkWords(b));
      return;
    }
    const inB = parse(b).marks.some((mark) => mark.id === id);
    for (const [how, decide] of [
      ['a', accepted],
      ['r', rejected],
    ] as const) {
      const nextA = tried(() => decide(a, id));
      const nextB = inB ? tried(() => decide(b, id)) : b;
      if (nextA !== undefined && nextB !== undefined)
        walk(nextA, nextB, i + 1, `${path} ${how}${id}`);
    }
  };
  walk(after, before, 0, '');
  return compared;
}

/** micromark's text of a file's body: the words of its blocks, without their tags, markers and
 * entities, which a block change and the decisions that follow it leave as they were. */
const micromarkText = (text: string) =>
  micromark(bodyOf(text), { allowDangerousHtml: true })
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, '?')
    .replace(/\s+/g, ' ')
    .replace(/\[[ xX]\] /g, '')
    .trim();

/**
 * Random orders of deciding the marks of `after`, the new ones `fresh` and the others, each state
 * compared with the same decisions of `before`: the same words, by the editor's reading and by
 * micromark's, the same blocks but for those the change made, the same bytes once none of `fresh`
 * is left or accepted, and a decision that works in one works in the other. For the regions with
 * more marks than every order can be tried for.
 */
function expectSampledDecisions(
  label: string,
  before: string,
  after: string,
  fresh: readonly string[],
  op: FormatOp,
  random: () => number,
  walks = 24,
  alsoChanged = 0,
  inPlace = false,
  structure = true,
): number {
  const below = (n: number) => Math.floor(random() * n);
  const isFresh = new Set(fresh);
  const decide = (text: string, id: string, how: 'a' | 'r') => {
    try {
      return applyChanges(text, how === 'a' ? accept(text, id) : reject(text, id));
    } catch (error) {
      if (error instanceof EditError) return undefined;
      throw error;
    }
  };
  let states = 0;
  for (let walk = 0; walk < walks; walk++) {
    let a = after;
    let b = before;
    let accepted = false;
    const rejected = new Set<string>();
    for (let step = 0; ; step++) {
      const state = `${label}: walk ${walk} step ${step} => ${JSON.stringify(bodyOf(a))}`;
      states++;
      expect(reading(a), state).toEqual(reading(b));
      expect(micromarkText(a), state).toBe(micromarkText(b));
      if (structure) expectBlocksAs(state, a, b, op, fresh.length - rejected.size + alsoChanged);
      const marks = parse(a).marks.filter((mark) => mark.kind !== 'cmt');
      const freshLeft = marks.some((mark) => isFresh.has(mark.id));
      if (!inPlace && !freshLeft && !accepted) {
        expect(`${bodyOf(a).replace(/[\r\n]+$/, '')}\n`, state).toBe(
          `${bodyOf(b).replace(/[\r\n]+$/, '')}\n`,
        );
      }
      if (marks.length === 0) break;
      const mark = marks[below(marks.length)];
      if (!mark) break;
      const how = below(2) === 0 ? 'a' : 'r';
      const nextA = decide(a, mark.id, how);
      if (isFresh.has(mark.id)) {
        expect(nextA, `${state} ${how}${mark.id} refused`).toBeDefined();
        if (nextA === undefined) break;
        if (how === 'a') accepted = true;
        else rejected.add(mark.id);
        a = nextA;
        continue;
      }
      const nextB = decide(b, mark.id, how);
      expect(nextA === undefined, `${state} ${how}${mark.id} works in one only`).toBe(
        nextB === undefined,
      );
      if (nextA === undefined || nextB === undefined) continue;
      a = nextA;
      b = nextB;
    }
  }
  return states;
}

describe('the lines that the reading of list items is sure are items (format §2.6)', () => {
  it('are items to micromark too, in random layouts of numbered lists under any line', () => {
    const MARKS = ['1.', '2.', '3.', '9.', '10.', '11.', '1)', '2)', '10)', '-', '*', '+'];
    let sure = 0;
    for (let seed = 1; seed <= fuzzCount(4000); seed++) {
      const random = seeded(seed * 6151);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]) => items[below(items.length)] as T;
      const lines: string[] = [];
      for (let n = 1 + below(12); n > 0; n--) {
        const kind = below(10);
        const tag = `w${lines.length}`;
        if (kind < 6) {
          const pad = pick(['', '', ' ', '  ', '   ', '    ']);
          const mark = pick(MARKS);
          lines.push(`${pad}${mark}${' '.repeat(1 + below(2))}${tag}`);
        } else if (kind === 6) lines.push(tag);
        else if (kind === 7) lines.push('');
        else if (kind === 8) lines.push(pick(['# h', '---', '***', '  ## h']));
        else lines.push(`${pick(['  ', '    ', ' '])}${tag}`);
      }
      const text = lines.join('\n');
      const html = micromark(text);
      const starts = itemLines(text);
      for (const start of starts) {
        const line = text.slice(
          start,
          text.indexOf('\n', start) === -1 ? undefined : text.indexOf('\n', start),
        );
        const tag = /w\d+$/.exec(line)?.[0];
        if (!tag) continue;
        sure++;
        expect(
          new RegExp(`<li>\\s*(?:<p>)?${tag}\\b`).test(html),
          `seed ${seed}: ${JSON.stringify(text)}\nline ${JSON.stringify(line)}\n${html}`,
        ).toBe(true);
      }
    }
    expect(sure).toBeGreaterThan(1000);
  });
});

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
    const TOO_MANY =
      /^There are \d+ pending changes in this \w+, too many to check this change against/;
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
      // The delimiter row of a table. (A mark in another cell, the header's too, is apart from a
      // change in a cell: format §3.7, "Cells apart".)
      [
        'delimiter row',
        `| a | b |\n| - | -<!--ins k3x9-->-<!--/k3x9--> |\n| ${own} | x |`,
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

  it('reads a number or a deep bullet under the last item as more of its paragraph (#139)', () => {
    // The issue's workflow with a line under the last item that CommonMark reads as more of that
    // item's paragraph, and the editor does too (#139): Bo's change on that line is in the
    // paragraph of the word, and decided first, as trying every mark has it.
    for (const line of ['  2. two <!--del g3rp y-->*z', '      - two <!--del g3rp y-->*z']) {
      const items = [...EDITS.slice(0, 4).map((item) => `- ${item}`), '- five x*word here', line];
      const text = file(items.join('\n'), { ...BO, g3rp: 'bo' });
      const word = rangeOf(text, 'word');
      const IN_PARAGRAPH = 'Accept or reject the changes in this paragraph first.';
      expect(() => trackedFormat(text, word, bold(true), ctx()), line).toThrow(IN_PARAGRAPH);
      expect(() => untrackedFormat(text, word, bold(true), { author: ada }), line).toThrow(
        IN_PARAGRAPH,
      );
      expect(() => tryingEveryMark.trackedFormat(text, word, bold(true), ctx())).toThrow(
        IN_PARAGRAPH,
      );
      expect(() =>
        tryingEveryMark.untrackedFormat(text, word, bold(true), { author: ada }),
      ).toThrow(IN_PARAGRAPH);
    }
  });

  it('leaves the marks apart in a region with a line that goes on an item, wherever it stands', () => {
    // A number other than 1 in the text of the item above, or right under a wrapped line of it; a
    // bullet four columns or more past the text of the item above; in a quote, a bullet four
    // columns past the quote's text. Above the change's item, right under it, or under another.
    // The editor reads each as more of the paragraph above, as CommonMark does (#139), so the
    // changes in the other items stay apart, and the change reads alike in every decision.
    const LINES = ['  2. two pear', '      - two pear', '  and more\n  8. eight pear'];
    const items = [...EDITS.map((item) => `- ${item}`), '- six word here', '- seven plum'];
    const alike = (label: string, text: string) => {
      // All but a change in the item that the line goes on.
      expect(apartOf(text).length, label).toBeGreaterThanOrEqual(4);
      const word = rangeOf(text, 'word');
      const after = format(text, word, bold(true));
      expect(expectEveryDecision(label, text, after, ['m2bd'], { structure: bold(true) })).toBe(
        3 ** 6,
      );
      expect(expectMicromarkAlike(label, text, after)).toBe(2 ** 6);
      const off = applyChanges(text, untrackedFormat(text, word, bold(true), { author: ada }));
      expectEveryDecision(`off: ${label}`, text, off, [], { inPlace: true, structure: bold(true) });
      expect(expectMicromarkAlike(`off: ${label}`, text, off)).toBe(2 ** 5);
    };
    for (const line of LINES) {
      for (const under of [0, 5, 6]) {
        const lines = items.flatMap((item, i) => (i === under ? [item, line] : [item]));
        alike(`${JSON.stringify(line)} under item ${under + 1}`, file(lines.join('\n'), BO));
      }
    }
    alike(
      'quote',
      file(
        [...EDITS.map((item) => `> ${item}`), '> six word here\n>     - two pear'].join('\n>\n'),
        BO,
      ),
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

  it('reads a bullet line with nothing but markers on it as more of the paragraph above (#139)', () => {
    // A number other than 1 in the text of the item above, or a bullet four columns past it, holds
    // no item whatever stands after its marker: CommonMark reads more of the paragraph above, and
    // so does the editor, which has Bo's deletion there decided first.
    for (const line of ['  2. <!--del n9fx gone-->', '      - <!--del n9fx gone-->']) {
      const text = file([...EDITS.map((item) => `- ${item}`), '- six word here', line].join('\n'), {
        ...BO,
        n9fx: 'bo',
      });
      const word = rangeOf(text, 'word');
      expect(() => trackedFormat(text, word, bold(true), ctx()), line).toThrow(/in this paragraph/);
      expect(() => untrackedFormat(text, word, bold(true), { author: ada }), line).toThrow(
        /in this paragraph/,
      );
    }
  });

  it('reads the text of an item whose line holds an opener alone after the spaces written there', () => {
    // With one to four spaces after the marker, an item's text starts after all of them, and §3.3
    // writes the opener there, its text on the next line from that column. A bullet four columns in
    // under that text is a nested item while the text is less than five columns in, and once it is
    // five columns in, more of its paragraph, as micromark reads it, and the editor too (#139): the
    // changes in the other items stay apart either way.
    for (const spaces of [1, 2, 3, 4]) {
      const lines = [
        ...EDITS.map((item) => `- ${item}`),
        '- six word here',
        `-${' '.repeat(spaces)}<!--ins k9x9-->`,
        `${' '.repeat(1 + spaces)}new <!--/k9x9-->plum`,
        '    - pear',
      ];
      const text = file(lines.join('\n'), { ...BO, k9x9: 'bo' });
      const label = `${spaces} spaces`;
      const nested = 1 + spaces <= 4;
      const joined = blockLeaves(text).some(({ text: words }) => /plum.*pear/.test(words));
      expect(joined, label).toBe(!nested);
      expect(apartOf(text).toSorted(), label).toEqual(['d3x9', 'g3rp', 'k3x9', 'n8fx', 'p7qd']);
      const after = format(text, rangeOf(text, 'word'), bold(true));
      expectEveryDecision(label, text, after, ['m2bd'], { structure: bold(true) });
      expect(expectMicromarkAlike(label, text, after)).toBe(2 ** 7);
    }
  });

  it('reads the line under an opener alone with the indentation written there', () => {
    // The carrier of an opener alone on its line takes the next line's indentation (§3.3), but
    // CommonMark reads it on that line: here it makes the item above the blank line code, which
    // goes on past the blank line, so that the number after it can't start a list, and the next
    // numbered line, which the editor reads as an item, is more of the paragraph it starts.
    const text = file(
      '      3) <!--ins kbb9-->\n         w0x <!--/kbb9-->w1x\n\n  2. w2x w3x\n  2.  <!--ins kcb9-->\n      w4x <!--/kcb9-->w5x\n  w6x w7x',
      { kbb9: 'bo', kcb9: 'bo' },
    );
    expect(blockLeaves(text).some(({ text: words }) => /w3x 2\. w4x/.test(words))).toBe(true);
    const parsed = parse(text);
    const limit = parsed.ledgerRange?.from ?? text.length;
    expect(holdsMisreadItem(text, markerRanges(parsed), limit)).toBe(true);
  });

  it('reads a line that a decision makes a number under an item as more of its paragraph (#139)', () => {
    // Ada deleted the first word of the wrapped line of her item, which the editor writes as a
    // substitution of the line break before it: accepted, the line is `  2. y*z`, which CommonMark
    // reads as more of her paragraph, and the editor too (#139). Bo's four changes are apart. With
    // the `*`, bold is refused as trying every mark refuses it; without it, where trying every mark
    // has too many to try, or with Track Changes off, it reads alike in every decision.
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
      if (tail === 'y*z') {
        expect(tracked, tail).not.toBe('allowed');
        expect(tracked, tail).toBe(
          outcome(() => tryingEveryMark.trackedFormat(text, word, bold(true), ctx())),
        );
      } else {
        expect(tracked, tail).toBe('allowed');
        const after = format(text, word, bold(true));
        expectEveryDecision(tail, text, after, ['m2bd'], { structure: bold(true) });
        expect(expectMicromarkAlike(tail, text, after)).toBe(2 ** 6);
      }
      const off = applyChanges(text, untrackedFormat(text, word, bold(true), { author: ada }));
      expectEveryDecision(`off: ${tail}`, text, off, [], { inPlace: true, structure: bold(true) });
      expect(expectMicromarkAlike(`off: ${tail}`, text, off)).toBe(2 ** 5);
    }
  });

  it('reads a number or a deep bullet under a line of an item as more of its paragraph (#139)', () => {
    // Bo deleted the `y` of the second line, which CommonMark reads as more of the paragraph above:
    // Bo's deletion is in the paragraph of the word, and Ada's bold there is refused until it is
    // decided. Were it allowed, it would read alike to micromark, with its own tags left out, in
    // every decision.
    const html = micromarkWords;
    for (const second of ['  2. two', '      - two', '   3. two', '      1. two']) {
      const text = file(`- six x*word here\n${second} <!--del g3rp y-->*z`, { g3rp: 'bo' });
      const word = rangeOf(text, 'word');
      expect(() => format(text, word, bold(true)), second).toThrow(/in this paragraph/);
      expect(() => untrackedFormat(text, word, bold(true), { author: ada }), second).toThrow(
        /in this paragraph/,
      );
      const bolded = (t: string) => t.replace('word', '**word**');
      for (const bo of [accepted, rejected]) {
        expect(html(bolded(bo(text, 'g3rp'))), second).toBe(html(bo(text, 'g3rp')));
      }
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

const outcomeOf = <T>(run: () => T): { result?: T; error?: EditError } => {
  try {
    return { result: run() };
  } catch (error) {
    if (error instanceof EditError) return { error };
    throw error;
  }
};

describe('marks apart for block changes (format §2.6, rule 6)', { timeout: 300_000 }, () => {
  const IDS = ['kbx9', 'kcx9', 'kdx9', 'kfx9', 'kgx9', 'khx9', 'kjx9', 'kkx9', 'kmx9', 'knx9'];
  /** A file of `body`, with the ledger entries of the marks in it. */
  const mine = (body: string) =>
    file(
      body,
      Object.fromEntries(
        IDS.filter(
          (id) =>
            body.includes(`<!--ins ${id}`) ||
            body.includes(`<!--del ${id}`) ||
            body.includes(`<!--sub ${id}`) ||
            body.includes(`<!--hl ${id}`),
        ).map((id) => [id, 'bo']),
      ),
    );
  /** Bo's pending words in item `i`, in its text after the first character, or `at` the start. */
  const edited = (i: number, at: 'inside' | 'start' | 'tick' = 'inside') => {
    const id = IDS[i] ?? '';
    if (at === 'start') return `<!--ins ${id}-->new <!--/${id}-->item ${i} words`;
    if (at === 'tick') return `item ${i} <!--ins ${id}-->a\`b <!--/${id}-->words`;
    return [
      `item ${i} <!--ins ${id}-->new <!--/${id}-->words`,
      `item ${i} <!--del ${id} big -->words`,
      `item ${i} <!--sub ${id} old-->fresh<!--/${id}--> words`,
      `item ${i} <!--hl ${id}-->words<!--/${id}--> here`,
    ][i % 4] as string;
  };
  const many = (n: number) =>
    `There are ${n} pending changes in this list, too many to check this change against. Accept or reject some of them first.`;
  const attempt = (text: string, word: string, op: FormatOp, tracked = true, id = 'm2bd') => {
    const at = rangeOf(text, word);
    const range = { from: at.from, to: at.from };
    try {
      return tracked
        ? { changes: trackedFormat(text, range, op, ctx(id)).changes }
        : { changes: untrackedFormat(text, range, op, { author: ada }) };
    } catch (error) {
      if (error instanceof EditError) return { error: error.message };
      throw error;
    }
  };

  it('indents an item in a list with eight other pending changes, and leaves them pending', () => {
    const text = mine(
      ['- one', '- two', ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `- ${edited(i)}`)].join('\n'),
    );
    const got = attempt(text, 'two', indent(1));
    expect(got.error).toBeUndefined();
    const after = applyChanges(text, got.changes ?? []);
    expect(parse(after).marks.map((mark) => mark.id)).toEqual(['m2bd', ...IDS.slice(0, 8)]);
    expect(accepted(after, 'm2bd').split('\n').slice(0, 3)).toEqual([
      '- one',
      '  - two',
      '- item 0 <!--ins kbx9-->new <!--/kbx9-->words',
    ]);
    expect(rejected(after, 'm2bd')).toBe(text);
    expectSampledDecisions('indent', text, after, ['m2bd'], indent(1), seeded(5), 40);
    // With Track Changes off there is no mark to try but theirs, and they stay pending too.
    const off = attempt(text, 'two', indent(1), false);
    expect(off.error).toBeUndefined();
    const typed = applyChanges(text, off.changes ?? []);
    expect(body(typed).split('\n').slice(0, 3)).toEqual([
      '- one',
      '  - two',
      '- item 0 <!--ins kbx9-->new <!--/kbx9-->words',
    ]);
    expect(parse(typed).marks.map((mark) => mark.id)).toEqual(IDS.slice(0, 8));
    expectSampledDecisions('indent off', text, typed, [], indent(1), seeded(6), 40, 1, true);
  });

  it('indents an item of a list numbered in order with eight other pending changes (#264)', () => {
    const below = (first: number, delimiter: string, quote = '') =>
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${quote}${i + first}${delimiter} ${edited(i)}`);
    // Right-aligned numbering, ` 1.` to `10.`, and lists indented one to three columns: micromark reads
    // them as ordinary lists, with the pending changes in ten of the items.
    const ten = (pad: (n: number) => string, first = 3, delimiter = '.') =>
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `${pad(i + first)}${delimiter} ${edited(i)}`);
    const right = (n: number) => String(n).padStart(2, ' ');
    const aligned: [string, string[]][] = [
      ['right-aligned', [' 1. one', ' 2. two', ...ten(right)]],
      ['right-aligned parentheses', [' 1) one', ' 2) two', ...ten(right, 3, ')')]],
      ['one column', [' 1. one', ' 2. two', ...ten((n) => ` ${n}`)]],
      ['two columns', ['  1. one', '  2. two', ...ten((n) => `  ${n}`)]],
      ['three columns', ['   1. one', '   2. two', ...ten((n) => `   ${n}`)]],
      ['under text', ['intro', ' 1. one', ' 2. two', ...ten(right)]],
      ['under text, wrapped', ['intro', 'more', ' 1. one', ' 2. two', ...ten(right)]],
      ['under a heading', ['# Title', ' 1. one', ' 2. two', ...ten(right)]],
      ['under a rule', ['intro', '---', ' 1. one', ' 2. two', ...ten(right)]],
      ['under a list and a blank', ['- a', '', ' 1. one', ' 2. two', ...ten(right)]],
      ['under text and a blank', ['intro', '', ' 3. one', ' 4. two', ...ten(right, 5)]],
      ['indented, under text', ['intro', '  1. one', '  2. two', ...ten((n) => `  ${n}`)]],
      ['wrapped', [' 1. one', ' 2. two', ...ten(right).flatMap((row) => [row, '    more'])]],
      ['loose', [' 1. one', '', ' 2. two', '', ...ten(right).flatMap((row) => [row, ''])]],
    ];
    for (const [name, rows] of aligned) {
      const text = mine(rows.join('\n'));
      for (const tracked of [true, false]) {
        const got = attempt(text, 'two', indent(1), tracked);
        expect(got.error, `${name} ${tracked}`).toBeUndefined();
        const after = applyChanges(text, got.changes ?? []);
        if (tracked) expectSampledDecisions(name, text, after, ['m2bd'], indent(1), seeded(21), 12);
        else
          expectSampledDecisions(`${name} off`, text, after, [], indent(1), seeded(22), 8, 1, true);
      }
    }
    const shapes: [string, string[]][] = [
      ['1, 2, 3', ['1. one', '2. two', ...below(3, '.')]],
      ['parentheses', ['1) one', '2) two', ...below(3, ')')]],
      ['from 3', ['3. one', '4. two', ...below(5, '.')]],
      ['in a quote', ['> 1. one', '> 2. two', ...below(3, '.', '> ')]],
      ['loose', ['1. one', '', '2. two', '', ...below(3, '.').flatMap((row) => [row, ''])]],
      ['nested', ['- a', '  1. one', '  2. two', ...below(3, '.', '  ')]],
      ['wrapped', ['1. one', '2. two', ...below(3, '.').flatMap((row) => [row, '   and more'])]],
      ['with children', ['1. one', '2. two', ...below(3, '.').flatMap((row) => [row, '   - sub'])]],
      [
        'out of order',
        [
          '1. one',
          '2. two',
          ...below(3, '.').map(
            (row, i) => `${[9, 4, 7, 5, 8, 6, 12, 10][i]}${row.slice(row.indexOf('.'))}`,
          ),
        ],
      ],
    ];
    for (const [name, rows] of shapes) {
      const text = mine(rows.join('\n'));
      for (const [op, tracked] of [
        [indent(1), true],
        [indent(1), false],
      ] as const) {
        const got = attempt(text, 'two', op, tracked);
        expect(got.error, `${name} ${tracked}`).toBeUndefined();
        const after = applyChanges(text, got.changes ?? []);
        expect(
          parse(after)
            .marks.map((mark) => mark.id)
            .filter((id) => id !== 'm2bd'),
        ).toEqual(IDS.slice(0, 8));
        if (tracked) {
          expect(rejected(after, 'm2bd'), name).toBe(text);
          expectSampledDecisions(name, text, after, ['m2bd'], op, seeded(11), 30);
        } else {
          expectSampledDecisions(`${name} off`, text, after, [], op, seeded(12), 20, 1, true);
        }
      }
    }
  });

  it('changes the type of an item with lines under it at any column, and reads them as before (#263)', () => {
    const UNDER = [
      ['  > q'],
      ['   > q'],
      ['    > q'],
      ['  ```', '  code', '  ```'],
      ['   ```', '   code', '   ```'],
      ['  <div>', '  x'],
      ['  - sub'],
      ['   - sub', '  lazy'],
      ['  # h'],
      ['', '  later'],
      ['', '  > later'],
      ['  1. sub'],
      ['   - sub', '  > q'],
      ['    - a'],
      ['     - a'],
      ['    ```'],
      ['      - a'],
      ['       - a'],
      ['      > q'],
      ['       > q'],
      ['      ```', '      c', '      ```'],
      ['   - a', '       - b'],
      ['    2. a'],
    ];
    const HEADS = ['1. ', '10. ', '- ', '* ', '- [ ] ', '1) ', ' 1. ', '  1. ', '   1. ', '  10. '];
    const OPS = [block('ul'), block('task'), block('ol'), block('ul'), block('task')];
    let written = 0;
    let refused = 0;
    for (let seed = 1; seed <= fuzzCount(300); seed++) {
      const random = seeded(seed * 104729);
      const below = (n: number) => Math.floor(random() * n);
      const head = HEADS[below(HEADS.length)] ?? '- ';
      const under = UNDER[below(UNDER.length)] ?? [];
      const body = [`${head}target`, ...under, ...(below(2) === 0 ? ['2. next'] : [])].join('\n');
      const text = below(3) === 0 ? file(body).replace(/\n/g, '\r\n') : file(body);
      const op = OPS[below(OPS.length)] as FormatOp;
      const label = `seed ${seed}: ${JSON.stringify(op)} in ${JSON.stringify(bodyOf(text))}`;
      const at = text.indexOf('target');
      const range = { from: at, to: at };
      const off = outcomeOf(() => untrackedFormat(text, range, op, { author: ada }));
      if (off.result && off.result.length > 0) {
        expectBlocksAs(`off: ${label}`, applyChanges(text, off.result), text, op, Infinity);
        written++;
      } else if (off.error) refused++;
      const on = outcomeOf(() => trackedFormat(text, range, op, ctx()));
      if (on.result && on.result.changes.length > 0) {
        const after = applyChanges(text, on.result.changes);
        expectSampledDecisions(label, text, after, on.result.markIds, op, seeded(seed), 6);
      }
    }
    expect(written, `${refused} refused`).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });

  it('costs about what indenting does in a bulleted list, in a numbered one (#264)', () => {
    const rows = (numbered: boolean) =>
      mine(
        [
          numbered ? '1. one' : '- one',
          numbered ? '2. two' : '- two',
          ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${numbered ? `${i + 3}.` : '-'} ${edited(i)}`),
        ].join('\n'),
      );
    const best = (text: string) => {
      let fastest = Infinity;
      for (let run = 0; run < 7; run++) {
        const start = performance.now();
        expect(attempt(text, 'two', indent(1)).error).toBeUndefined();
        fastest = Math.min(fastest, performance.now() - start);
      }
      return fastest;
    };
    best(rows(true));
    // About 1.1 here: both leave the eight pending changes alone.
    expect(best(rows(true)) / best(rows(false))).toBeLessThan(3);
  });

  it('checks twelve boxes one after another, as twelve clicks do, and each reads right (rule 6)', () => {
    const letters = 'abcdefghijkl'.split('');
    let text = file(letters.map((c) => `- [ ] item ${c} words`).join('\n'));
    const made: string[] = [];
    for (const [i, c] of letters.entries()) {
      const id = `b${'cdfghjkmnpqr'[i]}x7`;
      const before = text;
      const got = attempt(before, `item ${c}`, check(true), true, id);
      expect(got.error, c).toBeUndefined();
      text = applyChanges(before, got.changes ?? []);
      made.push(id);
      if (i >= 5) {
        expectSampledDecisions(`box ${c}`, before, text, [id], check(true), seeded(40 + i), 12);
      }
    }
    expect(parse(text).marks.map((mark) => mark.id)).toEqual(made);
    expect(bodyOf(applyChanges(text, acceptAll(text))).trimEnd()).toBe(
      bodyOf(file(letters.map((c) => `- [x] item ${c} words`).join('\n'))).trimEnd(),
    );
  });

  it('checks a box and changes a type in a list with eight other pending changes', () => {
    const tasks = mine(
      ['- [ ] one', '- [ ] two', ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `- [ ] ${edited(i)}`)].join(
        '\n',
      ),
    );
    const box = attempt(tasks, 'two', check(true));
    expect(box.error).toBeUndefined();
    const checked = applyChanges(tasks, box.changes ?? []);
    expect(checked).toContain('- [x] two<!--fmt m2bd +check-->');
    expectSampledDecisions('check', tasks, checked, ['m2bd'], check(true), seeded(7), 40);
    const bullets = mine(
      ['- one', '- two', ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `- ${edited(i)}`)].join('\n'),
    );
    for (const to of ['ol', 'task'] as const) {
      const got = attempt(bullets, 'two', block(to));
      expect(got.error, to).toBeUndefined();
      const after = applyChanges(bullets, got.changes ?? []);
      expectSampledDecisions(to, bullets, after, ['m2bd'], block(to), seeded(8), 30);
    }
    // And a quote's paragraph, a loose list's item.
    const loose = mine(
      ['- one', '- two', ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `- ${edited(i)}`)].join('\n\n'),
    );
    const got = attempt(loose, 'two', indent(1));
    expect(got.error).toBeUndefined();
    expectSampledDecisions(
      'loose',
      loose,
      applyChanges(loose, got.changes ?? []),
      ['m2bd'],
      indent(1),
      seeded(9),
      30,
    );
  });

  it('counts a mark that a decision could make reach a line start or a line break', () => {
    const list = (marks: string[]) =>
      mine(['- one', '- two', ...marks.map((m) => `- ${m}`)].join('\n'));
    const inside = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => edited(from + i));
    // Five at the start of an item's text are tried with the new mark (six, as for any block change)
    // and eight beside them are not.
    const five = list([
      ...Array.from({ length: 5 }, (_, i) => edited(i, 'start')),
      ...inside(5, 5),
    ]);
    expect(attempt(five, 'two', indent(1)).error).toBeUndefined();
    // A sixth is one too many, however many others there are.
    const six = list([...Array.from({ length: 6 }, (_, i) => edited(i, 'start')), ...inside(6, 4)]);
    expect(attempt(six, 'two', indent(1)).error).toBe(many(6));
    // A backtick in what is brought in counts as much.
    const ticks = list([
      ...Array.from({ length: 6 }, (_, i) => edited(i, 'tick')),
      ...inside(6, 4),
    ]);
    expect(attempt(ticks, 'two', indent(1)).error).toBe(many(6));
    // Without Track Changes there is no mark of the change to try: one more works, and not two.
    expect(attempt(six, 'two', indent(1), false).error).toBeUndefined();
    const seven = list([
      ...Array.from({ length: 7 }, (_, i) => edited(i, 'start')),
      ...inside(7, 3),
    ]);
    expect(attempt(seven, 'two', indent(1), false).error).toBe(many(7));
  });

  it('says why the limit applies where the lines below would be read again', () => {
    const again = ' The lines below would be read again.';
    // An empty item under a line of text is none Markdown can hold: its lines are all tried.
    const open = mine(
      [
        'intro',
        '- ',
        '- one',
        '- two',
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `- ${edited(i)}`),
      ].join('\n'),
    );
    expect(attempt(open, 'two', indent(1)).error).toBe(many(8) + again);
    // A numbered item under the item the one above it is nested in, which has a pending change at
    // its first character that leaves a space (seed 4904 of the suite), was the one shape that kept
    // the count: the lists are read as flat lists of items now, and it is written, as with bullets.
    const spaced = (marker: (i: number) => string) =>
      mine(
        [
          `${marker(1)}one`,
          `${marker(2)}<!--del kmx9 new --> beta`,
          `${marker(3)}two`,
          ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${marker(i + 4)}${edited(i)}`),
        ].join('\n'),
      );
    expect(
      attempt(
        spaced((i) => `${i}. `),
        'two',
        indent(1),
      ).error,
    ).toBeUndefined();
    expect(
      attempt(
        spaced(() => '- '),
        'two',
        indent(1),
      ).error,
    ).toBeUndefined();
    // A list numbered from 3, or in any order, is no such case, and nor is a bulleted one.
    const numbered = mine(
      ['3. one', '4. two', ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${i + 5}. ${edited(i)}`)].join(
        '\n',
      ),
    );
    expect(attempt(numbered, 'two', indent(1)).error).toBeUndefined();
    const bullets = mine(
      ['- one', '- two', ...[0, 1, 2, 3, 4, 5].map((i) => `- ${edited(i, 'start')}`)].join('\n'),
    );
    expect(attempt(bullets, 'two', indent(1)).error).toBe(many(6));
    // Marks at the start of numbered items are counted as in any list, with no sentence added.
    const starts = mine(
      [
        '1. one',
        '2. two',
        ...[0, 1, 2, 3, 4, 5].map((i) => `${i + 3}. ${edited(i, 'start')}`),
      ].join('\n'),
    );
    expect(attempt(starts, 'two', indent(1)).error).toBe(many(6));
  });

  it('allows what trying every mark allows, with the marks beside the written lines tried', () => {
    // The item above the one that moves stands against its lines, and the numbered items under it.
    const text = (rows: readonly string[]) => mine(rows.join('\n'));
    for (const [name, rows, word] of [
      ['above', ['- one', `- ${edited(0)}`, '- two', `- ${edited(1)}`, `- ${edited(2)}`], 'two'],
      ['numbered', ['1. one', '2. two', `3. ${edited(0)}`, `4. ${edited(1)}`], 'two'],
      ['first', ['1. one', '1. two', `1. ${edited(0)}`, `1. ${edited(1)}`], 'two'],
      ['loose', ['1. one', '', '2. two', '', `3. ${edited(0)}`, '', `4. ${edited(1)}`], 'two'],
      ['nested', ['- one', '  - two', '  - three', `- ${edited(0)}`, `- ${edited(1)}`], 'three'],
    ] as const) {
      for (const op of [indent(1), indent(-1), block('ol'), block('task'), check(true)]) {
        const t = text(rows);
        const at = rangeOf(t, word);
        const range = { from: at.from, to: at.from };
        const c = () => ({ author: ada, time: TIME, random: randomIds('m2bd', 'n8fz') });
        const every = outcomeOf(() => tryingEveryMark.trackedFormat(t, range, op, c()));
        const apart = outcomeOf(() => trackedFormat(t, range, op, c()));
        const label = `${name} ${JSON.stringify(op)}`;
        if (every.result) expect(apart.result, label).toEqual(every.result);
        else expect(apart.result, `${label}: ${every.error?.message ?? ''}`).toBeUndefined();
      }
    }
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
      '<sub>s</sub>',
      '<sup>t u</sup>',
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
      inline('sub', true),
      inline('sup', true),
      bold(false),
      italic(false),
      inline('code', false),
      inline('sub', false),
      clear,
      link('https://new.example/a'),
      link(null),
    ];

    const BLOCKS: readonly FormatOp[] = [
      indent(1),
      indent(1),
      indent(-1),
      check(true),
      check(false),
      block('h2'),
      block('p'),
      block('ul'),
      block('ol'),
      block('task'),
      block('quote'),
    ];

    /** A list, a table or a block quote of a few items, one of them with the word `target`, with
     * highlights, a comment and a definition now and then, Bo's pending changes in the other items,
     * mostly words, and Ada's in that one. */
    function regionDocument(random: () => number, kinds = 6): string {
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
      const kind = below(kinds);
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
                  : kind === 5
                    ? items.map((text) => `- ${text}`).join('\n\n')
                    : kind === 6
                      ? items.map((text, i) => `- [${i % 3 === 1 ? 'x' : ' '}] ${text}`).join('\n')
                      : kind === 7
                        ? items
                            .map((text, i) => (i % 3 === 1 ? `   1. ${text}` : `${i + 1}. ${text}`))
                            .join('\n')
                        : items
                            .map((text, i) => (i % 2 === 1 ? `  - ${text}` : `- ${text}`))
                            .join('\n');
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

    /** A list of five to twelve items, one with the word `target`, in the others Bo's pending words,
     * each in a place of its own, mostly after the first character of the item's text and now and
     * then not; a bullet, numbered, task or nested list, tight or loose, in a quote now and then. */
    function listDocument(random: () => number): string {
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]) => items[below(items.length)] as T;
      const count = 5 + below(8);
      const target = below(count);
      const kind = below(8);
      const marks: Record<string, string> = {};
      const chaos = Array.from(
        { length: count },
        () =>
          `${' '.repeat(pick([0, 0, 0, 1, 2, 2, 3, 4, 6]))}${pick(['- ', '- ', '* ', '1. ', '1. ', '2. ', '3) ', '10. ', '- [ ] ', '-   ', '+ '])}`,
      );
      const blanks = Array.from({ length: count }, () => (below(4) === 0 ? '\n' : ''));
      const item = (i: number) => {
        const words = Array.from({ length: 2 + below(4) }, () => pick(WORDS.slice(0, 9)));
        if (i === target) words.splice(1 + below(words.length), 0, 'target');
        if (i !== target && below(10) < 8) {
          const id = `k${'bcdfghjkmnpqrstv'[i] ?? 'z'}x9`;
          marks[id] = 'bo';
          const at = below(10) === 0 ? 0 : 1 + below(words.length);
          const word = below(3) === 0 ? pick(['new', 'ripe', 'big', 'so']) : 'new';
          const mark = pick([
            `<!--ins ${id}-->${word} <!--/${id}-->`,
            `<!--del ${id} ${word} -->`,
            `<!--sub ${id} ${word}-->fresh<!--/${id}-->`,
            `<!--hl ${id}-->${word}<!--/${id}-->`,
          ]);
          words.splice(at, 0, mark);
        }
        return words.join(' ');
      };
      const items = Array.from({ length: count }, (_, i) => item(i));
      const prefix = (i: number) =>
        kind === 0
          ? '- '
          : kind === 1 || kind === 7
            ? `${i + 1}. `
            : kind === 2
              ? `- [${i % 3 === 1 ? 'x' : ' '}] `
              : kind === 3
                ? i % 3 === 1
                  ? '  - '
                  : '- '
                : kind === 4
                  ? i % 3 === 1
                    ? '   1. '
                    : `${i + 1}. `
                  : kind === 6
                    ? (chaos[i] ?? '- ')
                    : '- ';
      const quoted = below(5) === 0 ? '> ' : '';
      const loose = kind === 5 || kind === 7 ? `\n${quoted ? '>' : ''}\n` : '\n';
      // Now and then a line or a block under an item, at an indentation of its own: a quote, a
      // fence, a line of HTML, a bullet, a heading, text (#263: they are read at their own column).
      const UNDER = [
        ['  > q'],
        ['   > q'],
        [' > q'],
        ['  ```', '  code', '  ```'],
        ['   ```', '   code', '   ```'],
        ['  <div>', '  x'],
        ['  - sub'],
        ['   - sub', '  lazy'],
        ['  # h'],
        ['', '  later'],
        ['    - deep'],
      ];
      const under = items.map((_, i) => (below(i === target ? 2 : 5) === 0 ? pick(UNDER) : []));
      const body = items
        .map(
          (text, i) =>
            `${i > 0 && kind === 6 ? blanks[i] : ''}${quoted}${prefix(i)}${text}${(under[i] ?? [])
              .map((line) => `\n${quoted}${line}`)
              .join('')}`,
        )
        .join(loose);
      return file(body, marks);
    }

    /** Whether the body of `text` is a list whose items are numbered 1, 2, 3 in order, in a quote or
     * not, tight or loose. */
    function numberedInOrder(text: string): boolean {
      const numbers = bodyOf(text)
        .split(/\r?\n/)
        .flatMap((line) => /^(?:> )?(\d+)\. /.exec(line)?.[1] ?? []);
      return numbers.length > 1 && numbers.every((n, i) => Number(n) === i + 1);
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

    /** `documents` random regions, a change of each of `ops`' kind on a range in it, tried with every
     * mark and with the marks apart left pending: the same, or refused, and exact where every mark
     * can't be tried for. */
    function compare(
      documents: number,
      ops: readonly FormatOp[],
      kinds: number,
      step: number,
      lists = false,
    ) {
      let alike = 0;
      let more = 0;
      let checked = 0;
      let sampled = 0;
      const histogram = new Map<string, number>();
      // REDLINES_SEED starts the run at one seed.
      const first = Number(process.env['REDLINES_SEED'] ?? 1);
      const isBlock = ops.some((op) => op.kind === 'block' || op.kind === 'indent');
      for (let seed = first; seed <= documents; seed++) {
        const random = seeded(seed * step);
        const below = (n: number) => Math.floor(random() * n);
        const made = lists && seed % 3 !== 0 ? listDocument(random) : undefined;
        const plain = made ?? regionDocument(random, kinds);
        const text = seed % 2 === 0 ? plain.replace(/\r?\n/g, '\r\n') : plain;
        const caret = text.indexOf('target') + below(7);
        const range =
          lists && text.includes('target') && below(4) > 0
            ? { from: caret, to: caret + (below(3) === 0 ? 1 : 0) }
            : randomRange(below, text);
        const op = ops[below(ops.length)] as FormatOp;
        const label = `seed ${seed}: ${JSON.stringify(op)} on ${JSON.stringify(range)} in ${JSON.stringify(bodyOf(text))}`;
        const c = () => ({
          author: ada,
          time: TIME,
          random: randomIds('m2bd', 'n8fz', 'p7qz', 'q2hz', 'r3sz', 's4tz'),
        });
        const every = outcome(() => tryingEveryMark.trackedFormat(text, range, op, c()));
        const apart = outcome(() => trackedFormat(text, range, op, c()));
        histogram.set(
          apart.error?.message.slice(0, 40) ?? (apart.result?.changes.length ? 'ok' : 'nothing'),
          1 +
            (histogram.get(
              apart.error?.message.slice(0, 40) ??
                (apart.result?.changes.length ? 'ok' : 'nothing'),
            ) ?? 0),
        );
        // A list numbered in order, 1, 2, 3, is refused for the number of its pending changes only
        // where the same list with bullets is (#264, rule 6), or with the reason given: a state of
        // the walk in which the lines below read otherwise. The numbers below are no reason.
        const reasoned = apart.error?.message.endsWith('would be read again.') === true;
        if (
          made &&
          op.kind === 'indent' &&
          tooMany(apart.error) &&
          numberedInOrder(text) &&
          !reasoned
        ) {
          const twin = text.replace(/^(> )?\d+\. /gm, '$1- ');
          const by = twin.indexOf('target') - text.indexOf('target');
          const bulleted = outcome(() =>
            trackedFormat(twin, { from: range.from + by, to: range.to + by }, op, c()),
          );
          expect(tooMany(bulleted.error), `${label}\nas bullets: ${bulleted.error?.message}`).toBe(
            true,
          );
        }
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
          // Past what every order can be tried for, random orders instead.
          if (states === 0 && isBlock) {
            expectSampledDecisions(
              label,
              text,
              after,
              result.markIds,
              op,
              seeded(seed * 31),
              12,
              result.extendedIds.length + reshaped,
              false,
            );
            sampled++;
          }
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
      if (process.env['REDLINES_FUZZ'])
        console.log(
          `apart: ${JSON.stringify({ documents, alike, more, checked, sampled })}`,
          histogram,
        );
      // Most documents can be tried both ways, and some are allowed only with marks left pending.
      const ran = documents - first + 1;
      expect(alike, `${more} more`).toBeGreaterThan(ran / 4);
      if (ran >= 100) expect(checked, JSON.stringify({ alike, more })).toBeGreaterThan(0);
    }

    it('allows what trying every mark allows, and nothing else that reads otherwise', () => {
      compare(fuzzCount(60), INLINE, 6, 7919);
    });

    it('does so for block changes, whose edits are in the lines of their block (rule 6)', () => {
      compare(fuzzCount(60), BLOCKS, 9, 6007, true);
    });
  },
);
