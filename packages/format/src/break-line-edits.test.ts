// An edit inside one line of the break between two blocks that takes no line break away, such as a
// space typed after the `>` of the blank line between two paragraphs of a quote (#358). The break is
// text: the change is a substitution of all of it, and the new text is the break as it is with the
// change made, line breaks and all (format §3.4). It came out as the typed text alone, so that both
// line breaks were lost, and nothing noticed where the lines that were left held no letters (the
// last check compares the letters of the views, and how the line breaks fall among them).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import {
  REFUSALS,
  TIME,
  ada,
  bo,
  bodyOf,
  expectEveryOrderAlike,
  file,
  squash,
} from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import type { Person } from './types.ts';
import { newestView, originalView } from './views.ts';

/** The body of a file without the line breaks that end it. */
const bodyText = (text: string) => bodyOf(text).replace(/\n+$/, '');

/** A text with its white space as one space: the views compare as the same Markdown. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

/** A text with each run of blank lines of a quote as one: the format takes a blank line out of such
 * a run as it was put in, and the original text loses one (format §3.4), which renders the same. */
const runs = (text: string) => text.replace(/(?:\n[ \t]*(?:>[ \t]*)+(?=\n)){2,}/g, '\n>');

/** The bytes that the ids of an edit are made of, the same again at every draw: an edit that writes
 * one mark has the id `ffff`. */
const constant = (n: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 19);

/** A source of such bytes that goes on, so that an edit that writes several marks gets ids that
 * differ, and so does each edit that is made after another's. */
function counting(start = 0): (n: number) => Uint8Array {
  let at = start;
  return (n) => Uint8Array.from({ length: n }, () => (at++ * 7 + 3) % 19);
}

/**
 * The file after `person` replaces `from` to `to` of the newest view by `insert` with Track Changes
 * on, the text that the plain edit of the view makes, and the marks the edit wrote (`fresh`) or
 * changed in place (`extended`: the author's own, which a change inside them leaves as one mark).
 * Throws what the edit throws.
 */
function edited(
  text: string,
  from: number,
  to: number,
  insert: string,
  person: Person = ada,
  random: (n: number) => Uint8Array = constant,
) {
  const view = newestView(text);
  const typed = applyChanges(view.text, [{ from, to, insert }]);
  const edit = { from: view.map.toSource(from, 1), to: view.map.toSource(to, -1), insert };
  const result = trackedEdits(text, [edit], { author: person, time: TIME, random });
  return {
    after: applyChanges(text, result.changes),
    typed,
    fresh: result.markIds,
    extended: result.extendedIds,
  };
}

/** The file with the changes that the edit wrote (`ids`) all decided, accepted or rejected;
 * undefined where a decision has no form. */
function decidedFresh(
  after: string,
  ids: readonly string[],
  how: typeof accept,
): string | undefined {
  let now = after;
  for (const id of ids) {
    try {
      now = applyChanges(now, how(now, id));
    } catch (error) {
      if (error instanceof EditError) return undefined;
      throw error;
    }
  }
  return now;
}

/** What each mark of a file holds: its payload and its new text, segment by segment, by id. */
function contents(text: string): Map<string, string> {
  return new Map(
    parse(text).marks.map((mark) => [
      mark.id,
      JSON.stringify(
        mark.segments.map((s) => [
          s.payload ?? '',
          s.close ? text.slice(s.content.from, s.content.to) : '',
        ]),
      ),
    ]),
  );
}

/**
 * What an edit must leave, where it was written: the newest text is the text that was typed (up to
 * the white space that Markdown ignores); accepting its changes leaves that text; rejecting them
 * leaves the text that was there before the edit. That last is looked at only where the edit left
 * every change that was there as it was, and wrote changes of its own. An edit that folds the text
 * of a change of the author's own into its new text (a deletion over their own insertion takes it
 * with it, and the new text holds it again) goes with it when its changes are rejected. A decision
 * that has no form is no failure here.
 */
function expectAsTyped(label: string, text: string, done: ReturnType<typeof edited>): void {
  const { after, typed, fresh, extended } = done;
  expect(squash(newestView(after).text), `${label}: as typed`).toBe(squash(typed));
  expect(parse(after).warnings, label).toEqual([]);
  if (fresh.length === 0 || extended.length > 0) return;
  const accepted = decidedFresh(after, fresh, accept);
  if (accepted !== undefined) {
    expect(flat(newestView(accepted).text), `${label}: accepting`).toBe(flat(typed));
  }
  const now = contents(after);
  const folded = [...contents(text)].some(([id, held]) => now.get(id) !== held);
  const rejected = folded ? undefined : decidedFresh(after, fresh, reject);
  if (rejected !== undefined) {
    expect(flat(runs(newestView(rejected).text)), `${label}: rejecting`).toBe(
      flat(runs(newestView(text).text)),
    );
  }
}

describe('an edit of the blank line of a quote, between two paragraphs (#358)', () => {
  const body =
    '> Folded <!--del xqm3 42-->\n>\n> 42 <!--ins hf3q--><!--del w443 café--><!--/hf3q-->';
  const marks = { xqm3: 'bo', hf3q: 'bo', w443: 'ada' };

  it('writes a space typed after its `>` as it was typed, with both line breaks', () => {
    const text = file(body, marks);
    const at = newestView(text).text.indexOf('\n>\n') + 1;
    const { after, typed } = edited(text, at, at + 1, '> ');
    expect(typed).toBe('> Folded \n> \n> 42 \n');
    expect(newestView(after).text).toBe(typed);
    // The break and the prefix of the next block, with the word that the closer stands after.
    expect(bodyText(after)).toBe(
      '> Folded <!--del xqm3 42--><!--sub ffff \\n>\\n> 42-->\n> \n> 42<!--/ffff--> ' +
        '<!--ins hf3q--><!--del w443 café--><!--/hf3q-->',
    );
    // The original is as it was; accepting the change leaves the text that was typed, and
    // rejecting it gives every byte back.
    expect(originalView(after).text).toBe(originalView(text).text);
    expect(newestView(applyChanges(after, accept(after, 'ffff'))).text).toBe(typed);
    expect(bodyText(applyChanges(after, reject(after, 'ffff')))).toBe(body);
    expect(parse(after).warnings).toEqual([]);
    expectEveryOrderAlike('the issue', after);
  });

  it('is written as typed on the same quote without the changes', () => {
    const text = file('> Folded 42\n>\n> café', {});
    const at = newestView(text).text.indexOf('\n>\n') + 1;
    const { after, typed } = edited(text, at, at + 1, '> ');
    expect(newestView(after).text).toBe(typed);
    expect(bodyText(after)).toBe(
      '> Folded 42<!--sub ffff \\n>\\n> café-->\n> \n> café<!--/ffff-->',
    );
    expect(bodyText(applyChanges(after, reject(after, 'ffff')))).toBe('> Folded 42\n>\n> café');
    expectEveryOrderAlike('plain', after);
  });
});

describe('a change inside the underline of a setext heading, which is a line of the break', () => {
  it('writes all of it replaced as typed, the heading staying one', () => {
    for (const [body, underline, insert] of [
      ['Title\n---\n\nLast', '---', '==='],
      ['Title\n===\n\nLast', '===', '---'],
      ['Title\n---\n\nLast', '---', 'x'],
    ] as const) {
      const text = file(body);
      const at = newestView(text).text.indexOf(underline);
      const result = edited(text, at, at + underline.length, insert);
      expect(newestView(result.after).text, body).toBe(result.typed);
      expect(bodyText(applyChanges(result.after, reject(result.after, 'ffff'))), body).toBe(body);
      expect(
        flat(newestView(applyChanges(result.after, accept(result.after, 'ffff'))).text),
        body,
      ).toBe(flat(result.typed));
      expect(parse(result.after).warnings, body).toEqual([]);
      expectEveryOrderAlike(body, result.after);
    }
  });

  it('refuses a change of a part of it, as a change in a line that is only syntax', () => {
    // In a quote the underline's text starts after the `> `: a range that starts there is a part
    // of the line, as the rule for a setext underline reads it.
    const words = 'A line that is only Markdown syntax takes no change.';
    for (const [body, at, length, insert] of [
      ['Title\n---\n\nLast', '--', 1, 'x'],
      ['Title\n---\n\nLast', '-\n', 1, '=\n'],
      ['Title\n---\n\nLast', '---', 3, ''],
      ['> Title\n> ---\n>\n> Last', '---', 3, '==='],
    ] as const) {
      const from = body.indexOf(at) + (at === '---' && insert === '' ? 1 : 0);
      const to = at === '---' && insert === '' ? from + 2 : from + length;
      expect(() => edited(file(body), from, to, insert), `${body} ${from}-${to}`).toThrow(words);
    }
  });
});

/** The documents of the enumeration below: a break whose middle lines hold quote markers or white
 * space, with and without pending changes around it. */
const SHAPES: [string, string, Record<string, string>][] = [
  ['quote', '> One\n>\n> Two', {}],
  [
    'quote and the pending changes of the issue',
    '> One <!--del xqm3 two-->\n>\n> 42 <!--ins hf3q--><!--del w443 café--><!--/hf3q-->',
    { xqm3: 'bo', hf3q: 'bo', w443: 'ada' },
  ],
  ['quote, a space on the blank line', '> One\n> \n> Two', {}],
  ['quote, two blank lines', '> One\n>\n>\n> Two', {}],
  ['quote in a quote', '> > One\n> >\n> > Two', {}],
  ['a blank line indented', '- One\n  \n  Two', {}],
  ['a blank line of spaces', 'One\n  \nTwo', {}],
  ['quote in a list item', '- > One\n  >\n  > Two', {}],
  ['quote of a list', '> - One\n>\n> - 42', {}],
  ['quote, a hard break', '> One  \n>\n> Two', {}],
  [
    'quote, a pending insertion after',
    '> One\n>\n> 42 <!--ins hf3q-->x<!--/hf3q-->',
    { hf3q: 'bo' },
  ],
  [
    'quote, a pending deletion at the start of the next paragraph',
    '> One\n>\n> <!--del hf3q two--> 42',
    { hf3q: 'bo' },
  ],
  [
    'quote, her own insertion in front',
    '> One <!--ins k3x9-->new<!--/k3x9-->\n>\n> 42',
    { k3x9: 'ada' },
  ],
  [
    'quote, his insertion around both paragraphs',
    '> <!--ins k3x9-->One\n>\n> Two<!--/k3x9-->',
    { k3x9: 'bo' },
  ],
  ['quote, his split', '> One<!--split k3x9-->\n>\n> Two', { k3x9: 'bo' }],
  ['quote, a comment', '> <!--cmt c1 ada-->One<!--/c1-->\n>\n> Two', {}],
];

/** What an edit inside the blank line of a break is typed as: markers, numbers, text, white space,
 * and line breaks (which are new line breaks, and the break stays). A deletion is another rule. */
const INSERTS = [
  '1',
  '10',
  '*',
  '- ',
  '> ',
  '## ',
  'x',
  ' ',
  '  ',
  '>',
  '> >',
  '\n',
  'x\ny',
  '> \n> ',
];

describe('an edit inside a blank line of a break, in each of its places and as each of its inserts', () => {
  it('is written as typed, or refused: never written with a line break lost', () => {
    let written = 0;
    let refused = 0;
    for (const [name, body, marks] of SHAPES) {
      const text = file(body, marks);
      let start = 0;
      for (const [n, line] of newestView(text).text.split('\n').entries()) {
        // A blank line of the break: not the first line, and one of quote markers or white space.
        const blank = n > 0 && /^[ \t>]+$/.test(line);
        for (let a = 0; blank && a < line.length; a++) {
          for (let b = a + 1; b <= line.length; b++) {
            for (const insert of INSERTS) {
              const label = `${name}: ${JSON.stringify(line)} [${a}, ${b}) -> ${JSON.stringify(insert)}`;
              let result: ReturnType<typeof edited>;
              try {
                result = edited(text, start + a, start + b, insert, ada, counting());
              } catch (error) {
                if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
                  refused++;
                  continue;
                }
                throw new Error(`${label}: ${String(error)}`, { cause: error });
              }
              written++;
              expectAsTyped(label, text, result);
            }
          }
        }
        start += line.length + 1;
      }
    }
    // Most are written: the refusals are where the closer of the change has no place, or a change
    // next to it would read the change otherwise.
    expect(written).toBeGreaterThan(refused);
  }, 60_000);
});

/** The words of a paragraph of the random quotes. */
const WORDS = ['alpha', 'beta', 'café', '42', '7', 'x', '😀'];

describe('an edit inside a blank line of a break, in random quotes of two or three paragraphs', () => {
  it('is written as typed, or refused, with pending changes of both people in the quote', () => {
    let written = 0;
    let refused = 0;
    for (let seed = 1; seed <= fuzzCount(150); seed++) {
      const draw = seeded(seed * 6089);
      const below = (n: number) => Math.floor(draw() * n);
      const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
      // Ids of the form of format §2.3: a letter, then three of letters and digits.
      const ids = ['b', 'c', 'd', 'f'].flatMap((a) =>
        ['2', '3', '4', '5', '6'].map((b) => `m${a}${b}x`),
      );
      const used: Record<string, string> = {};
      const id = (by: string) => {
        const value = ids.shift() ?? 'zz9x';
        used[value] = by;
        return value;
      };
      const unit = (): string => {
        const word = pick(WORDS);
        const by = pick(['ada', 'bo']);
        switch (below(6)) {
          case 0:
            return `<!--del ${id(by)} ${word}-->`;
          case 1: {
            const one = id(by);
            return `<!--ins ${one}-->${word}<!--/${one}-->`;
          }
          case 2: {
            // Another person's insertion with a deletion in it, as in the issue.
            const outer = id('bo');
            const inner = id('ada');
            return `<!--ins ${outer}--><!--del ${inner} ${word}--><!--/${outer}-->`;
          }
          case 3: {
            const one = id(by);
            return `<!--sub ${one} ${pick(WORDS)}-->${word}<!--/${one}-->`;
          }
          default:
            return word;
        }
      };
      const paragraph = () =>
        `${pick(WORDS)} ${Array.from({ length: 1 + below(3) }, unit).join(' ')}`;
      const quote = Array.from({ length: 2 + below(2) }, paragraph).join('\n>\n> ');
      const text = file(`${below(3) === 0 ? 'Intro\n\n' : ''}> ${quote}`, used);
      // One edit inside a blank line of the quote: a range of it, typed over.
      const view = newestView(text).text;
      const blanks: { start: number; line: string }[] = [];
      let start = 0;
      for (const [n, line] of view.split('\n').entries()) {
        if (n > 0 && /^[ \t>]+$/.test(line)) blanks.push({ start, line });
        start += line.length + 1;
      }
      const found = blanks[below(blanks.length)];
      if (!found) continue;
      const a = below(found.line.length);
      const b = a + 1 + below(found.line.length - a);
      const insert = pick(INSERTS);
      const author = pick([ada, bo]);
      const label = `seed ${seed}: ${JSON.stringify(insert)} over [${a}, ${b}) of ${JSON.stringify(found.line)} by ${author.handle} in ${JSON.stringify(bodyOf(text))}`;
      let result: ReturnType<typeof edited>;
      try {
        result = edited(text, found.start + a, found.start + b, insert, author, counting(seed));
      } catch (error) {
        if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
          refused++;
          continue;
        }
        throw new Error(`${label}: ${String(error)}`, { cause: error });
      }
      written++;
      expectAsTyped(label, text, result);
    }
    expect(written).toBeGreaterThan(refused);
  }, 60_000);
});
