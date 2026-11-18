// Text typed, pasted or suggested right after a bare list marker (`-`, `*`, `+`, `1.` or `1)` alone
// on its line, an empty item to Markdown; format §3.2, #580). A tracked insertion never stands
// between a marker and the space after it: `-<!--ins x--> a<!--/x-->` is a paragraph to a reader
// that doesn't know the markers, though the newest view has an item. The space is written as it
// is, and the insertion opens after it. Every file is judged by micromark 4.0.2 with GFM, in every
// order of decisions; the random suite draws the shape with other people's marks around it.

import { describe, expect, it } from 'vitest';
import { suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { expectEveryOrderRead, expectSound, readAs } from './oracle.ts';
import { parse } from './parse.ts';
import { bareMarkerDocument, fuzzCount, seeded } from './random-docs.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { BARE_MARKER, trackedEdits } from './track.ts';
import type { Person } from './types.ts';
import { newestView, originalView } from './views.ts';

/** The five markers, and the next one of the same list. */
const MARKERS: [string, string][] = [
  ['-', '-'],
  ['*', '*'],
  ['+', '+'],
  ['1.', '2.'],
  ['1)', '2)'],
];

/** The marker of the second item: `-`, `*`, `+`, `2.` or `2)`. */
const second = (marker: string) => (/^\d/.test(marker) ? `2${marker.slice(1)}` : marker);
const first = (marker: string, text: string) => `${marker} ${text}`;

/** `body` with Ada's edit at the caret `‸`, written as a file: the body, and the edit's changes. */
function typeIn(body: string, insert: string, author: Person = ada, ids = ['k3x9']) {
  const at = body.indexOf('‸');
  const clean = body.replace('‸', '');
  const text = file(clean);
  const { changes } = trackedEdits(text, [{ from: at, to: at, insert }], context(author, ids));
  return applyChanges(text, changes);
}

describe('typing after a bare marker', () => {
  for (const [marker] of MARKERS) {
    const one = first(marker, 'one');
    const bare = second(marker);
    const step = /^\d/.test(marker) ? `3${marker.slice(1)}` : marker;
    for (const [where, doc, open] of [
      ['as the last line', `${one}\n${bare}‸`, `${one}\n${bare} `],
      [
        'with a line after it',
        `${one}\n${bare}‸\n${step} three`,
        `${one}\n${bare} \n${step} three`,
      ],
    ] as const) {
      it(`${marker} ${where}: a space and a letter`, () => {
        const written = typeIn(doc, ' a');
        const ins = parse(written).marks[0]?.id ?? '';
        // The space as it is, the insertion after it, on the line before its text (format §3.3).
        const pad = ' '.repeat(bare.length + 1);
        expect(bodyOf(written).split('\n').slice(0, 3).join('\n')).toBe(
          `${one}\n${bare} <!--ins ${ins}-->\n${pad}a<!--/${ins}-->`,
        );
        expect(newestView(written).text.startsWith(`${one}\n${bare} a`)).toBe(true);
        expect(originalView(written).text.startsWith(open.trimEnd())).toBe(true);
        // Rejected, an empty item as the bare marker was; accepted, the item with its text.
        expect(readAs(bodyOf(applyChanges(written, reject(written, ins))))).toBe(readAs(open));
        expectSound(`${marker} ${where}`, written);
      });
      it(`${marker} ${where}: a lone space is the space alone, with no mark`, () => {
        const written = typeIn(doc, ' ');
        expect(parse(written).marks).toEqual([]);
        expect(bodyOf(written).startsWith(open)).toBe(true);
        // As the bare marker: the same empty item.
        expect(readAs(bodyOf(written))).toBe(readAs(doc.replace('‸', '')));
      });
      it(`${marker} ${where}: a letter with no space first is as it was typed`, () => {
        const written = typeIn(doc, 'a');
        const ins = parse(written).marks[0]?.id ?? '';
        expect(bodyOf(written).split('\n')[1]).toBe(`${bare}<!--ins ${ins}-->a<!--/${ins}-->`);
        expectSound(`${marker} ${where}`, written);
      });
    }
  }

  it('two spaces and a word: the first space as it is, the second in the insertion', () => {
    const written = typeIn('- one\n-‸', '  two words');
    expect(readAs(bodyOf(written))).toBe(readAs(newestView(written).text));
    expect(bodyOf(written).startsWith('- one\n- <!--ins k3x9-->')).toBe(true);
    expectSound('two spaces', written);
  });

  it("a tab is the marker's separator, kept as typed, with the text lined up at column 4", () => {
    const written = typeIn('- one\n-‸', '\ta');
    expect(bodyOf(written).startsWith('- one\n-\t<!--ins k3x9-->\n    a<!--/k3x9-->')).toBe(true);
    expectSound('a tab', written);
    const written2 = typeIn('1. one\n2.‸', '\ta');
    expect(bodyOf(written2).startsWith('1. one\n2.\t<!--ins k3x9-->\n    a<!--/k3x9-->')).toBe(
      true,
    );
    expectSound('a numbered tab', written2);
  });

  // A judge that the writer can't fool: the text accepted must read in micromark exactly as the text
  // the author meant to write (the marker, the separator as typed, the text, and what follows),
  // with a nested list and a continuation paragraph after it, which line up with the content column.
  it('accepted, the text reads as the author meant it, with a space and with a tab', () => {
    const cases: [string, string, string][] = [
      // [the file's body, what is typed at the caret, the text meant]
      ['- one\n-‸\n  - x', ' a', '- one\n- a\n  - x'],
      ['- one\n-‸\n  - x', '\ta', '- one\n-\ta\n  - x'],
      ['- one\n-‸\n\n  para', ' a', '- one\n- a\n\n  para'],
      ['- one\n-‸\n\n    para', '\ta', '- one\n-\ta\n\n    para'],
      ['1. one\n2.‸\n\n   b', ' a', '1. one\n2. a\n\n   b'],
      ['1. one\n2.‸\n\n    b', '\ta', '1. one\n2.\ta\n\n    b'],
      ['1) one\n2)‸\n   - x', ' a', '1) one\n2) a\n   - x'],
      ['* one\n*‸\n    - x', '\ta', '* one\n*\ta\n    - x'],
    ];
    for (const [doc, typed, meant] of cases) {
      const written = typeIn(doc, typed);
      let accepted = written;
      for (const mark of parse(written).marks) {
        accepted = applyChanges(accepted, accept(accepted, mark.id));
      }
      const label = `${JSON.stringify(doc)} + ${JSON.stringify(typed)}`;
      expect(readAs(bodyOf(accepted)), label).toBe(readAs(meant));
      expect(readAs(newestView(written).text), label).toBe(readAs(meant));
      expect(bodyOf(accepted).replace(/\n+$/, ''), label).toBe(meant);
    }
  });

  it('inline markup after the space: bold, code, emphasis, a link, a tag', () => {
    for (const marker of ['-', '*', '+', '1.', '1)']) {
      for (const typed of [' **b**', ' `c`', ' *a*', ' [a](b)', ' <b>x</b>']) {
        const doc = `${marker} one\n${second(marker)}‸`;
        const written = typeIn(doc, typed);
        expect(parse(written).marks, `${marker} ${typed}`).toHaveLength(1);
        expect(bodyOf(written), `${marker} ${typed}`).not.toMatch(
          /(?:^|\n)(?:[-+*]|\d[.)])<!--ins/,
        );
        expect(readAs(bodyOf(written)), `${marker} ${typed}`).toBe(
          readAs(newestView(written).text),
        );
        expectSound(`${marker} ${typed}`, written);
      }
    }
  });

  it('in a quote, nested in an item, in a numbered item inside a bullet', () => {
    for (const doc of [
      '> - one\n> -‸',
      '- one\n  - two\n  -‸',
      '- one\n  1. two\n  2.‸',
      '> 1. a\n> 2.‸',
      // A quote inside an item, an item inside a quote, and the two together.
      '- > -‸',
      '> - -‸',
      '1. > 2.‸',
      '- one\n\n  > -‸',
      '> 1. a\n>\n>    - -‸',
    ]) {
      const written = typeIn(doc, ' a');
      expect(readAs(bodyOf(written)), doc).toBe(readAs(newestView(written).text));
      expect(parse(written).marks, doc).toHaveLength(1);
      expectSound(doc, written);
    }
  });

  it("with another person's marks around it", () => {
    const body = '- one <!--ins b3k9-->more<!--/b3k9-->\n-‸\n- three <!--ins b4k9-->x<!--/b4k9-->';
    const at = body.indexOf('‸');
    const text = file(body.replace('‸', ''), { b3k9: 'bo', b4k9: 'bo' });
    const { changes } = trackedEdits(
      text,
      [{ from: at, to: at, insert: ' a' }],
      context(ada, ['k3x9']),
    );
    const written = applyChanges(text, changes);
    expect(readAs(bodyOf(written))).toBe(readAs(newestView(written).text));
    expectSound('others', written);
  });

  it('does not touch a marker with text after it', () => {
    const body = '- one\n-x‸';
    const at = body.indexOf('‸');
    const text = file(body.replace('‸', ''));
    const { changes } = trackedEdits(
      text,
      [{ from: at, to: at, insert: ' a' }],
      context(ada, ['k3x9']),
    );
    expect(bodyOf(applyChanges(text, changes)).split('\n')[1]).toBe(
      '-x<!--ins k3x9--> a<!--/k3x9-->',
    );
  });

  it('does not touch a marker in the middle of a word', () => {
    const text = file('a-‸'.replace('‸', ''));
    const { changes } = trackedEdits(
      text,
      [{ from: 2, to: 2, insert: ' b' }],
      context(ada, ['k3x9']),
    );
    expect(bodyOf(applyChanges(text, changes))).toBe('a-<!--ins k3x9--> b<!--/k3x9-->');
  });
});

describe('an agent suggests text after a bare marker', () => {
  for (const [marker] of MARKERS) {
    const one = first(marker, 'one');
    const bare = second(marker);
    it(`${marker}: as the last line, and with a line after it`, () => {
      for (const tail of ['', `\n${/^\d/.test(marker) ? `3${marker.slice(1)}` : marker} three`]) {
        const text = file(`${one}\n${bare}${tail}`);
        const written = applyChanges(
          text,
          suggestReplace(
            text,
            `${one}\n${bare}${tail}`,
            `${one}\n${bare} a${tail}`,
            context(ada, ['k3x9']),
          ).changes,
        );
        expect(readAs(bodyOf(written))).toBe(readAs(newestView(written).text));
        expect(newestView(written).text.startsWith(`${one}\n${bare} a`)).toBe(true);
        expectSound(`agent ${marker}`, written);
        expect(
          readAs(bodyOf(applyChanges(written, reject(written, parse(written).marks[0]?.id ?? '')))),
        ).toBe(readAs(`${one}\n${bare} ${tail}`));
        expect(accept(written, parse(written).marks[0]?.id ?? '')).toBeTruthy();
      }
    });
  }
});

describe("random bare markers with other people's marks around them", () => {
  // A block's start (` - a`, ` 1. a`, ` ---`, a table) typed into a bare item is written as a
  // replacement of the item (#583). Inline markup after the space is drawn.
  const TYPED = [
    ' ---',
    ' - a',
    ' 1. a',
    ' - - -',
    ' | a |\n|---|',
    ' a',
    ' ',
    'a',
    '  a b',
    ' word',
    '\tx',
    ' a\nb',
    ' **b**',
    ' `c`',
    ' *a*',
    ' [a](b)',
    ' <b>x</b>',
  ];
  const LINES = [
    '- one',
    '* two',
    '+ three',
    '1. four',
    '1) five',
    'A paragraph.',
    '> quoted',
    '- **bold** item',
  ];
  const BARE = ['-', '*', '+', '2.', '2)', '  -', '> -', '1.', '- > -', '> - -', '1. > 2.'];

  it('every file reads as its newest view in every order of decisions', () => {
    const stats = { written: 0, refused: 0 };
    const draws = fuzzCount(150);
    for (let seed = 1; seed <= draws; seed++) {
      const random = seeded(seed * 104729);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]) => items[below(items.length)] as T;
      const lines = Array.from({ length: 1 + below(3) }, () => pick(LINES));
      const bare = pick(BARE);
      const after = Array.from({ length: below(3) }, () => pick(LINES));
      const marks: Record<string, string> = {};
      // Bo's pending insertion in one of the other lines.
      const all = [...lines, bare, ...after];
      const target = below(all.length);
      const body = all
        .map((line, i) => {
          if (i !== target || line === bare || line.includes('<!--')) return line;
          marks.b3k9 = 'bo';
          return `${line} <!--ins b3k9-->bo's<!--/b3k9-->`;
        })
        .join('\n');
      const text = file(body, marks);
      const offsets = [...bodyOf(text).matchAll(/^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-+*]|\d[.)])$/gm)];
      const place = offsets[Math.min(...[offsets.length - 1, below(Math.max(offsets.length, 1))])];
      if (!place) continue;
      const at = place.index + place[0].length;
      const insert = pick(TYPED);
      const bytes = (n: number) => Uint8Array.from({ length: n }, () => below(256));
      let written: string;
      try {
        const { changes } = trackedEdits(
          text,
          [{ from: at, to: at, insert }],
          context(ada, [], { random: bytes }),
        );
        written = applyChanges(text, changes);
      } catch (error) {
        if ((error as Error).name !== 'EditError') throw error;
        stats.refused++;
        continue;
      }
      stats.written++;
      const label = `seed ${seed}: ${JSON.stringify(body)} + ${JSON.stringify(insert)} at ${at}`;
      // micromark reads the file as it reads the newest view, in every order of decisions.
      expectEveryOrderRead(label, written);
      expectSound(label, written);
      expect(readAs(bodyOf(written)), label).toBe(readAs(newestView(written).text));
      // A bare marker never has a marker's character glued to the insertion's opener: `-<!--ins`.
      if (/^\s/.test(insert)) {
        expect(bodyOf(written), label).not.toMatch(
          /(?:^|\n)[ \t>]*(?:[-+*]|\d{1,9}[.)])<!--(?:ins|sub)/,
        );
      }
    }
    // Most of the edits tried are written, the rest refused as before (a line that is only syntax
    // takes no change, and a thematic break typed there is no block): the share holds at any size.
    expect(stats.written).toBeGreaterThan(stats.refused);
    expect(stats.written).toBeGreaterThan(draws / 3);
  }, 60_000);
});

describe('the random lists with bare markers', () => {
  it('typing at each bare marker reads as the newest view, in every order of decisions', () => {
    const draws = fuzzCount(60);
    let written = 0;
    for (let seed = 1; seed <= draws; seed++) {
      const random = seeded(seed * 7907);
      const below = (n: number) => Math.floor(random() * n);
      const body = bareMarkerDocument(random).replace(/\n+$/, '');
      const text = file(body);
      const bytes = (n: number) => Uint8Array.from({ length: n }, () => below(256));
      const bares = bodyOf(text).matchAll(/^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-+*]|\d{1,9}[.)])$/gm);
      for (const m of bares) {
        const at = m.index + m[0].length;
        for (const insert of [' a', ' ', 'a', ' two words']) {
          const label = `seed ${seed}: ${JSON.stringify(body)} + ${JSON.stringify(insert)} at ${at}`;
          try {
            const edit = { from: at, to: at, insert };
            const { changes } = trackedEdits(text, [edit], context(ada, [], { random: bytes }));
            const after = applyChanges(text, changes);
            expectEveryOrderRead(label, after);
            expectSound(label, after);
            written++;
          } catch (error) {
            if ((error as Error).name !== 'EditError') throw error;
          }
        }
      }
    }
    expect(written).toBeGreaterThan(draws);
  }, 120_000);
});

describe('the bare marker pattern', () => {
  it('has no exponential backtracking in deep quotes', () => {
    // A space belongs to one quantifier only, so a failing line is read in linear time. The bound is
    // generous (the old pattern took seconds at 26 levels, and years at 200).
    const started = performance.now();
    for (const line of [
      '>  '.repeat(200),
      '> '.repeat(200) + 'x',
      '>  '.repeat(200) + 'x',
      '-   '.repeat(100) + 'x',
    ]) {
      expect(BARE_MARKER.test(line)).toBe(false);
    }
    expect(BARE_MARKER.test('> '.repeat(200) + '-')).toBe(true);
    expect(BARE_MARKER.test('- > 2.')).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('the oracle keeps a line break after <li> that a block follows', () => {
  it('drops it before text and inline tags, keeps it before HTML blocks', () => {
    // Inline: the break shows nowhere.
    expect(readAs('- <!--x-->\n  **b**')).toBe(readAs('- **b**'));
    // An HTML block (a block tag in capitals, a declaration, an instruction, a custom tag alone on
    // its line) is flow content after the break, which an inline reading doesn't have.
    for (const html of ['<DIV>x</DIV>', '<?php x ?>', '<!DOCTYPE html>', '<my-tag>']) {
      expect(readAs(`- <!--x-->\n  ${html}`), html).toMatch(/<li>\n</);
    }
  });
});
