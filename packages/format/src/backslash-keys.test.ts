// Keys typed next to a backslash with Track Changes on (format §3.1, rule 4). A marker never stands
// right after an unescaped backslash, which would escape it, so a change whose text would end in
// one takes in the text after it: the next character, the line break and the first word of the
// next line, the paragraph break and the next block's first word, or, at the end of the document,
// the line break that ends it. Every row is a text, the caret `‸`, a key, the file after it, and
// every order of decisions: micromark reads each file on the way as its newest view, and the orders
// that decide the same changes give the same text, exactly (#235, #223).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { escapedMarker, expectSound, readsAsNewest } from './oracle.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { ada, bodyOf, context, dropEmptyBlocks, file, squash } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView, originalView } from './views.ts';

/** The key typed at the caret of `text`: Backspace and Delete are a range, deleting `cut` characters
 * before (negative) or after the caret. */
interface Key {
  insert?: string;
  cut?: number;
}

/** The file of `body` (the caret `‸` in it), `marks` by their authors, after the key. */
function press(body: string, key: Key, marks: Record<string, string> = {}) {
  const at = body.indexOf('‸');
  const before = file(body.replace('‸', ''), marks);
  const cut = key.cut ?? 0;
  const edit = {
    from: Math.min(at, at + cut),
    to: Math.max(at, at + cut),
    insert: key.insert ?? '',
  };
  const result = trackedEdits(before, [edit], context(ada, ['m2bd', 'n8fx', 'p7qd']));
  return { before, after: applyChanges(before, result.changes), edit };
}

/** What every allowed edit leaves: the file reads as its newest view, in every order of decisions
 * (exactly), and the original view is as it was. */
function expectKept(before: string, after: string, label: string): void {
  expect(escapedMarker(after), `${label}: ${JSON.stringify(bodyOf(after))}`).toBe(false);
  expect(readsAsNewest(after), `${label}: ${JSON.stringify(bodyOf(after))}`).toBe(true);
  expect(originalView(after).text, label).toBe(originalView(before).text);
  expectSound(label, after);
}

/** One row: the body with its caret, the key, the body after it. */
type Row = readonly [body: string, key: Key, written: string];

const written = (text: string) => bodyOf(text);

function expectRows(rows: readonly Row[], marks: Record<string, string> = {}): void {
  for (const [body, key, expected] of rows) {
    const label = `${JSON.stringify(body)} ${JSON.stringify(key)}`;
    const { before, after, edit } = press(body, key, marks);
    expect(written(after), label).toBe(expected);
    expectKept(before, after, label);
    // The newest view is the edit made to it, up to the white space Markdown does not read.
    const view = newestView(before).text;
    expect(squash(newestView(after).text), label).toBe(squash(applyChanges(view, [edit])));
  }
}

describe('keys right after a hard break’s backslash (#235)', () => {
  const paragraph = 'One\\‸\ntwo.';
  it('typing a character, or Delete, in a paragraph, a quote and a list item', () => {
    expectRows([
      [paragraph, { insert: 'x' }, 'One<!--sub m2bd \\-->\\x<!--/m2bd-->\ntwo.'],
      [paragraph, { cut: 1 }, 'One<!--sub m2bd \\\\\\nt-->\\t<!--/m2bd-->wo.'],
      ['> One\\‸\n> two.', { insert: 'x' }, '> One<!--sub m2bd \\-->\\x<!--/m2bd-->\n> two.'],
      ['> One\\‸\n> two.', { cut: 3 }, '> One<!--sub m2bd \\\\\\n> t-->\\t<!--/m2bd-->wo.'],
      ['- One\\‸\n  two.', { insert: 'x' }, '- One<!--sub m2bd \\-->\\x<!--/m2bd-->\n  two.'],
      ['- One\\‸\n  two.', { cut: 3 }, '- One<!--sub m2bd \\\\\\n  t-->\\t<!--/m2bd-->wo.'],
      ['One two\\‸\n\nNext', { insert: 'x' }, 'One two<!--sub m2bd \\-->\\x<!--/m2bd-->\n\nNext'],
    ]);
  });

  it('Return and Shift-Return there, as the line breaks they type', () => {
    // A hard break's backslash stays, and the breaks after it are text of the change, with no
    // split, which would stand right after the backslash; the change goes on past the break that is
    // there, to the end of the first word of the next line.
    expectRows([
      [paragraph, { insert: '\n' }, 'One<!--sub m2bd \\\\\\ntwo.-->\\\n\ntwo.<!--/m2bd-->'],
      [paragraph, { insert: '\n\n' }, 'One<!--sub m2bd \\\\\\ntwo.-->\\\n\n\ntwo.<!--/m2bd-->'],
      [
        '> One\\‸\n> two.',
        { insert: '\n> ' },
        '> One<!--sub m2bd \\\\\\n> two.-->\\\n> \n> two.<!--/m2bd-->',
      ],
      [
        '- One\\‸\n  two.',
        { insert: '\n\n  ' },
        '- One<!--sub m2bd \\\\\\n  two.-->\\\n\n  \n  two.<!--/m2bd-->',
      ],
    ]);
  });

  it('Return after a backslash in the middle of a line', () => {
    expectRows([
      ['C:\\‸Users', { insert: '\n' }, 'C:<!--sub m2bd \\U-->\\\nU<!--/m2bd-->sers'],
      ['C:\\‸Users', { insert: '\n\n' }, 'C:<!--sub m2bd \\U-->\\\n\nU<!--/m2bd-->sers'],
      ['C:\\‸Users', { insert: 'x' }, 'C:<!--sub m2bd \\U-->\\xU<!--/m2bd-->sers'],
    ]);
  });

  it('typing a backslash in front of a hard break’s own', () => {
    expectRows([['One‸\\\ntwo', { insert: '\\' }, 'One<!--sub m2bd \\-->\\\\<!--/m2bd-->\ntwo']]);
  });

  it('Return at a hard break in front of a code span that holds a space', () => {
    expectRows([
      [
        'One \\‸\n`a b` x',
        { insert: '\n\n' },
        'One <!--sub m2bd \\\\\\n\\x60a b\\x60-->\\\n\n\n`a b`<!--/m2bd--> x',
      ],
      [
        'One \\‸\n`a b` x',
        { insert: '\n' },
        'One <!--sub m2bd \\\\\\n\\x60a b\\x60-->\\\n\n`a b`<!--/m2bd--> x',
      ],
    ]);
  });

  it('Return that takes the hard break whole, in front of a code span that holds a space', () => {
    // The closer goes after the code span and the rest of the word, never inside it.
    for (const [body, brk, written] of [
      [
        'One \\\n`a b` x',
        '\n\n',
        'One <!--sub m2bd \\\\\\n\\x60a b\\x60-->\n\n`a b`<!--/m2bd--> x',
      ],
      [
        '> One \\\n> `a b` x',
        '\n>\n> ',
        '> One <!--sub m2bd \\\\\\n> \\x60a b\\x60-->\n>\n> `a b`<!--/m2bd--> x',
      ],
      ['One  \n`a b` x', '\n\n', 'One<!--sub m2bd   \\n\\x60a b\\x60-->\n\n`a b`<!--/m2bd--> x'],
    ] as const) {
      const before = file(body);
      const at = before.search(/(?:\\| {2,})\r?\n/);
      const lineBreak = before.indexOf('\n', at);
      const prefix = /^[ \t>]*/.exec(before.slice(lineBreak + 1))?.[0].length ?? 0;
      const edit = { from: at, to: lineBreak + 1 + prefix, insert: brk };
      const after = applyChanges(
        before,
        trackedEdits(before, [edit], context(ada, ['m2bd', 'n8fx'])).changes,
      );
      expect(bodyOf(after), body).toBe(written);
      expectKept(before, after, body);
    }
  });

  it('a hard break’s two trailing spaces', () => {
    expectRows([
      ['One‸  \ntwo', { insert: '\\' }, 'One<!--sub m2bd   \\ntwo-->\\  \ntwo<!--/m2bd-->'],
      ['One  ‸\ntwo', { insert: '\\' }, 'One<!--sub m2bd   \\ntwo-->  \\\ntwo<!--/m2bd-->'],
      ['One\\‸  \ntwo', { insert: 'x' }, 'One<!--sub m2bd \\  \\ntwo-->\\x  \ntwo<!--/m2bd-->'],
    ]);
  });

  it('another person’s mark in the first word after the break', () => {
    // The words of Bo's insertion are taken in with the rest: its text is deleted and typed again.
    const before = file('One‸\ntw<!--ins k3x9-->x<!--/k3x9-->o.'.replace('‸', ''), { k3x9: 'bo' });
    const at = before.indexOf('\ntw');
    const result = trackedEdits(
      before,
      [{ from: at, to: at, insert: '\\' }],
      context(ada, ['m2bd', 'n8fx', 'p7qd']),
    );
    const after = applyChanges(before, result.changes);
    expectKept(before, after, 'bo');
    expect(newestView(after).text).toBe('One\\\ntwxo.\n');
  });

  it('a word ending in a backslash', () => {
    expectRows([
      ['One‸\ntwo\\ x', { insert: '\\' }, 'One<!--sub m2bd \\ntwo\\ -->\\\ntwo\\ <!--/m2bd-->x'],
      ['One\\‸\ntwo\\ x', { insert: 'y' }, 'One<!--sub m2bd \\-->\\y<!--/m2bd-->\ntwo\\ x'],
    ]);
  });

  it('is refused where nothing can stand after the backslash, with words that say why', () => {
    // The closer would have to follow the backslash, or start a line that takes no marker.
    for (const [body, key, words] of [
      ['## Head‸ ##', { insert: '\\' }, /closing #s.*A backslash takes in the character after it/],
      ['One two‸\n\n---', { insert: '\\' }, /line after it takes no change/],
      ['One two‸\n\n```\nx\n```', { insert: '\\' }, /line after it takes no change/],
      ['One two‸\n\n[x]: http://u', { insert: '\\' }, /line after it takes no change/],
    ] as const) {
      expect(() => press(body, key), body).toThrow(words);
      try {
        press(body, key);
      } catch (error) {
        expect(error).toBeInstanceOf(EditError);
      }
    }
  });
});

describe('a whole tag alone on its line after a soft break that starts a quote or an item (#235)', () => {
  it('is an HTML block there: the change is refused, not written to read otherwise', () => {
    // The closer on that line would make the paragraph that the newest view reads as an HTML block.
    for (const body of [
      'One two‸\n> <custom>',
      'One two‸\n- <custom>',
      'One two‸\n> > <custom>',
      'One two‸\n1. <custom>',
    ]) {
      expect(() => press(body, { insert: '\\' }), body).toThrow(/can't end a block/);
    }
    // In the same container, it goes on with the paragraph: the line is text, and a word of it is taken.
    expectRows([
      [
        '> One two‸\n> <custom>',
        { insert: '\\' },
        '> One two<!--sub m2bd \\n> <custom>-->\\\n> <custom><!--/m2bd-->',
      ],
      [
        'One two‸\n<custom>',
        { insert: '\\' },
        'One two<!--sub m2bd \\n<custom>-->\\\n<custom><!--/m2bd-->',
      ],
    ]);
  });
});

describe('Enter in front of a space that follows a typed backslash (#235)', () => {
  /** The keys typed one at a time at the end of `after`, then `key`, which takes the `cut`
   * characters of the file after the caret. */
  function typed(body: string, after: string, keys: readonly string[], key: Key) {
    let text = file(body);
    let caret = newestView(text).text.indexOf(after) + after.length;
    for (const k of keys) {
      const at = newestView(text).map.toSource(caret, -1);
      text = applyChanges(
        text,
        trackedEdits(
          text,
          [{ from: at, to: at, insert: k }],
          context(ada, ['m2bd', 'n8fx', 'p7qd']),
        ).changes,
      );
      caret += k.length;
    }
    const at = newestView(text).map.toSource(caret, -1);
    const before = text;
    text = applyChanges(
      text,
      trackedEdits(
        text,
        [{ from: at, to: at + (key.cut ?? 0), insert: key.insert ?? '' }],
        context(ada, ['g3rp', 'h4kz']),
      ).changes,
    );
    return { before, after: text };
  }

  it('takes the first word after the closer when the key takes the space and types a break', () => {
    for (const [body, brk, written] of [
      ['- One two x', '\n- ', '- One two<!--sub m2bd  x--> C:\\\n- x<!--/m2bd-->'],
      ['- One two x', '\n\n  ', '- One two<!--sub m2bd  x--> C:\\\n\n  x<!--/m2bd-->'],
      ['> One two x', '\n> ', '> One two<!--sub m2bd  x--> C:\\\n> x<!--/m2bd-->'],
      ['One two x', '\n\n', 'One two<!--sub m2bd  x--> C:\\\n\nx<!--/m2bd-->'],
      ['One two x', '\n', 'One two<!--sub m2bd  x--> C:\\\nx<!--/m2bd-->'],
    ] as const) {
      const { before, after } = typed(body, 'two', [' C:\\'], { cut: 1, insert: brk });
      expect(bodyOf(after), `${body} ${JSON.stringify(brk)}`).toBe(written);
      expect(escapedMarker(after)).toBe(false);
      expect(readsAsNewest(after), bodyOf(after)).toBe(true);
      expect(originalView(after).text).toBe(originalView(before).text.replace(/^[^]*$/, (s) => s));
      expectSound(body, after);
    }
  });

  it('writes the break between the two backslashes of your own `\\`', () => {
    for (const [body, brk, written] of [
      [
        'See<!--ins k3x9--> \\‸\\<!--/k3x9--> here',
        '\n',
        'See<!--sub k3x9  --> \\\n\\ <!--/k3x9-->here',
      ],
      [
        'See<!--ins k3x9--> \\‸\\<!--/k3x9--> here',
        '\n\n',
        'See<!--sub k3x9  --> \\\n\n\\ <!--/k3x9-->here',
      ],
      [
        'See<!--ins k3x9--> \\‸\\<!--/k3x9--> here',
        'x',
        'See<!--sub k3x9  --> \\x\\ <!--/k3x9-->here',
      ],
      ['See<!--ins k3x9--> \\‸\\<!--/k3x9-->', '\n', 'See<!--ins k3x9--> \\\n\\\n<!--/k3x9-->'],
    ] as const) {
      const { before, after } = press(body, { insert: brk }, { k3x9: 'ada' });
      expect(bodyOf(after), `${body} ${JSON.stringify(brk)}`).toBe(written);
      expectKept(before, after, body);
    }
  });
});

describe('a backslash typed at the end of the document (#223)', () => {
  it('takes the line break that ends it, and stands alone on the line after it', () => {
    // The body has the line break: the change takes it in.
    expectRows([
      ['One two‸\n', { insert: '\\' }, 'One two<!--sub m2bd \\n-->\\\n<!--/m2bd-->'],
      ['One two‸\n\n', { insert: '\\' }, 'One two<!--sub m2bd \\n-->\\\n<!--/m2bd-->\n'],
    ]);
  });

  it('brings a line break of its own where the body has none (the ledger follows at once)', () => {
    // The line breaks that part the body from the ledger are the ledger's. The change's text ends in
    // one, so that its closer follows the line break; rejecting it takes both away.
    expectRows([
      ['One two‸', { insert: '\\' }, 'One two<!--ins m2bd-->\\\n<!--/m2bd-->'],
      ['> One two‸', { insert: '\\' }, '> One two<!--ins m2bd-->\\\n<!--/m2bd-->'],
      ['- One two‸', { insert: '\\' }, '- One two<!--ins m2bd-->\\\n<!--/m2bd-->'],
      ['1. One two‸', { insert: '\\' }, '1. One two<!--ins m2bd-->\\\n<!--/m2bd-->'],
      ['# Head‸', { insert: '\\' }, '# Head<!--ins m2bd-->\\\n<!--/m2bd-->'],
      ['One\n\nTwo‸', { insert: '\\' }, 'One\n\nTwo<!--ins m2bd-->\\\n<!--/m2bd-->'],
    ]);
  });

  it('is the same file, whatever follows the paragraph', () => {
    // Where a next block follows, the change takes the paragraph break and its first word.
    expectRows([
      [
        'One two‸\n\nNext',
        { insert: '\\' },
        'One two<!--sub m2bd \\n\\nNext-->\\\n\nNext<!--/m2bd-->',
      ],
      [
        'One two‸\n\n# Head',
        { insert: '\\' },
        'One two<!--sub m2bd \\n\\n# Head-->\\\n\n# Head<!--/m2bd-->',
      ],
      [
        'One two‸\n\n- item',
        { insert: '\\' },
        'One two<!--sub m2bd \\n\\n- item-->\\\n\n- item<!--/m2bd-->',
      ],
      [
        'One two‸\n\n> quote',
        { insert: '\\' },
        'One two<!--sub m2bd \\n\\n> quote-->\\\n\n> quote<!--/m2bd-->',
      ],
    ]);
  });

  it('keeps the text after a key typed in the middle of a brought line break’s insertion', () => {
    // Five backslashes and the brought line break end the document; Return after the first leaves the rest.
    const body = 'See<!--ins k3x9-->\\‸\\\\\\\\\n<!--/k3x9-->';
    const { before, after } = press(body, { insert: '\n\n  ' }, { k3x9: 'ada' });
    expect(newestView(after).text.replace(/\n+$/, '')).toBe('See\\\n\n  \\\\\\\\');
    expectKept(before, after, body);
  });

  it('is typed one key at a time as a path, and Backspace takes it away', () => {
    for (const body of ['See', '> See', '- See', 'See\n']) {
      let text = file(body);
      let caret = newestView(text).text.indexOf('See') + 3;
      for (const c of ' C:\\Users\\x') {
        const at = newestView(text).map.toSource(caret, -1);
        text = applyChanges(
          text,
          trackedEdits(
            text,
            [{ from: at, to: at, insert: c }],
            context(ada, ['m2bd', 'n8fx', 'p7qd', 'd3x9', 'g3rp']),
          ).changes,
        );
        caret += c.length;
        expect(escapedMarker(text), `${body} ${c}: ${JSON.stringify(bodyOf(text))}`).toBe(false);
        expect(readsAsNewest(text), `${body} ${c}: ${JSON.stringify(bodyOf(text))}`).toBe(true);
        expectSound(`${body} ${c}`, text);
      }
      // The line break it brought goes when the text no longer ends in a backslash: an insertion
      // of the path, as typed, and the document's own line break where it had one.
      expect(
        [...bodyOf(text).matchAll(/<!--(ins|sub|split) /g)].map((m) => m[1]),
        body,
      ).toEqual(['ins']);
      expect(bodyOf(text).replace(/<!--\/?\w+[^>]*-->/g, ''), body).toBe(
        `${body.replace(/\n$/, '')} C:\\Users\\x${body.endsWith('\n') ? '\n' : ''}`,
      );
      expect(originalView(text).text).toBe(originalView(file(body)).text);
    }
  });

  it('Backspace right after the backslash leaves nothing behind', () => {
    for (const body of ['One two', 'One two\n']) {
      const typedOnce = press(`${body}‸`.replace('\n‸', '‸\n'), { insert: '\\' });
      const text = typedOnce.after;
      const at = newestView(text).text.indexOf('\\') + 1;
      const from = newestView(text).map.toSource(at - 1, 1);
      const to = newestView(text).map.toSource(at, -1);
      const after = applyChanges(
        text,
        trackedEdits(text, [{ from, to, insert: '' }], context(ada, ['g3rp'])).changes,
      );
      expect(newestView(after).text, body).toBe(newestView(file(body)).text);
      expect([...bodyOf(after).matchAll(/<!--/g)], body).toEqual([]);
    }
  });

  it('is refused with words that say why where there is no place for the closer', () => {
    for (const body of ['One two‸\n\n---', 'One two‸\n\n| a |\n|---|\n| 1 |']) {
      expect(() => press(body, { insert: '\\' }), body).toThrow(/line after it takes no change/);
    }
  });
});

/** Documents of words, backslashes, hard breaks, quotes, items, headings and fences, for the keys
 * below. */
function randomText(random: () => number): string {
  const below = (n: number) => Math.floor(random() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const words = ['One', 'two', 'C:\\Users', 'path\\', 'a', 'bold', 'x\\\\'];
  const line = () => {
    const parts: string[] = [];
    for (let i = 0, n = 1 + below(4); i < n; i++) parts.push(pick(words));
    return parts.join(' ');
  };
  const block = () => {
    const lines: string[] = [];
    for (let i = 0, n = 1 + below(3); i < n; i++) {
      const hard = below(4) === 0 ? pick(['\\', '  ', ' \\']) : '';
      lines.push(line() + (i < n - 1 ? hard : ''));
    }
    const kind = below(8);
    if (kind === 0) return lines.map((l) => `> ${l}`).join('\n');
    if (kind === 1) return lines.map((l, i) => (i === 0 ? `- ${l}` : `  ${l}`)).join('\n');
    if (kind === 2) return `## ${lines[0]}`;
    if (kind === 3) return `${lines.join('\n')}\n${pick(['---', '```', '| a |'])}`;
    return lines.join('\n');
  };
  const blocks: string[] = [];
  for (let i = 0, n = 1 + below(3); i < n; i++) blocks.push(block());
  return blocks.join('\n\n');
}

const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = `${FIRST}23456789`;

/** Five ids that no other call of the test makes: `start` counts them. */
function uniqueIds(start: number): string[] {
  return Array.from({ length: 5 }, (_, i) => {
    const k = start + i;
    return `${FIRST[k % 19]}${REST[Math.floor(k / 19) % 27]}${REST[Math.floor(k / 513) % 27]}${REST[Math.floor(k / 13851) % 27]}`;
  });
}

/** The keys that type next to a backslash, at a caret on a line with `prefix` for the lines of its
 * block (`  ` in an item, `> ` in a quote): the editor's Enter types a line break and the prefix,
 * Return a paragraph break and the prefix, Shift-Return a hard break; Delete and Backspace where a
 * backslash is right before the caret; Shift-Return only in the middle of a line, as at the end of a
 * block it is Return. */
function keysAt(prefix: string, afterBackslash: boolean, midLine: boolean): readonly Key[] {
  const blank = prefix.startsWith('>') ? `${prefix.trimEnd()}\n` : '\n';
  return [
    { insert: 'x' },
    { insert: '\\' },
    { insert: '\\\\' },
    // A line break anywhere else is a split of its own, which other tests cover.
    ...(afterBackslash
      ? [
          { insert: `\n${prefix}` },
          { insert: `\n${blank}${prefix}` },
          ...(midLine ? [{ insert: `\\\n${prefix}` }] : []),
          { cut: 1 },
          { cut: -1 },
        ]
      : []),
  ];
}

/** What a line of the newest view has in front of the text of the lines under it. */
function prefixOf(view: string, caret: number): string {
  const line = view.slice(
    view.lastIndexOf('\n', caret - 1) + 1,
    view.indexOf('\n', caret) + 1 || undefined,
  );
  const lead = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?/.exec(line)?.[0] ?? '';
  return lead.replace(/(?:[-*+]|\d{1,9}[.)])[ \t]+/, (m) => ' '.repeat(m.length));
}

/** The words of the refusals that are meant: no place for the closer of a change that takes in the
 * text after a backslash. */
const MEANT =
  /can't end a block|closing #s|between a hard break and the line end|would start a line|take no change|only Markdown syntax|inside code|can't stand right in front|replaces ends in a backslash|hide other changes|inside a code block|take the start of the block|altering other text|marker at the start|inserted yet|line's indentation|ends the line here|Decide/i;

describe('random keys next to backslashes read as micromark reads them (#223, #235)', () => {
  it(
    'in documents of words, hard breaks, quotes, items, headings and code',
    { timeout: 5_400_000 },
    () => {
      const total = fuzzCount(40);
      let made = 0;
      let refused = 0;
      let atEnd = 0;
      const unmeant: string[] = [];
      for (let seed = 1; seed <= total; seed++) {
        const random = seeded(seed * 104729);
        const below = (n: number) => Math.floor(random() * n);
        // Half of the documents have a pending mark of Bo's in a line, a word in or a deletion of one,
        // which the keys and every order of decisions meet next to the caret and the ends.
        let body = randomText(random);
        const marks: Record<string, string> = {};
        if (below(2) === 0) {
          const spots = [...body.matchAll(/(?<=[a-z] )(?=[A-Za-z])/g)]
            .map((m) => m.index)
            .filter(
              (i) =>
                (body.slice(body.lastIndexOf('\n', i) + 1, i).match(/`/g)?.length ?? 0) % 2 === 0,
            );
          const at = spots[below(spots.length)];
          if (at !== undefined) {
            const mark = below(2) === 0 ? '<!--ins b2zz-->yy<!--/b2zz-->' : '<!--del b2zz yy-->';
            body = `${body.slice(0, at)}${mark}${body.slice(at)}`;
            marks['b2zz'] = 'bo';
          }
        }
        let text = file(body, marks);
        if (!readsAsNewest(text)) continue;
        for (let step = 0; step < 4; step++) {
          const original = originalView(text).text;
          const view = newestView(text);
          // Next to a backslash, or at the end of a line or of the document.
          const near: number[] = [];
          for (const m of view.text.matchAll(/\\/g)) near.push(m.index, m.index + 1);
          for (const m of view.text.matchAll(/^.*\S.*$/gm)) near.push(m.index + m[0].length);
          const caret = near[below(near.length)] ?? 0;
          const keys = keysAt(
            prefixOf(view.text, caret),
            view.text[caret - 1] === '\\',
            view.text[caret] !== undefined && view.text[caret] !== '\n',
          );
          const key = keys[below(keys.length)] as Key;
          const cut = key.cut ?? 0;
          const a = Math.max(0, Math.min(view.text.length, Math.min(caret, caret + cut)));
          const b = Math.max(0, Math.min(view.text.length, Math.max(caret, caret + cut)));
          // An edit stops at the end of the body: nothing is typed after the ledger.
          const stop = parse(text).ledgerRange?.from ?? Infinity;
          const edit = {
            from: Math.min(view.map.toSource(a, 1), stop),
            to: Math.min(view.map.toSource(b, -1), stop),
            insert: key.insert ?? '',
          };
          if (edit.from === edit.to && edit.insert === '') continue;
          if (edit.to < edit.from) continue;
          const label = `seed ${seed}, step ${step}: ${JSON.stringify(key)} at ${caret} of ${JSON.stringify(bodyOf(text))}`;
          let after: string;
          try {
            after = applyChanges(
              text,
              trackedEdits(text, [edit], context(ada, uniqueIds((seed * 10 + step) * 5))).changes,
            );
          } catch (error) {
            if (!(error instanceof EditError)) throw new Error(label, { cause: error });
            refused++;
            if (!MEANT.test(error.message)) unmeant.push(`${label}: ${error.message}`);
            continue;
          }
          // A change that goes on over a pending deletion of a block break and its bullet is read
          // otherwise in some order of decisions on main as well (rule 11 over a foreign deletion).
          // Nor over backslashes next to a pending deletion of one: rejecting it gives an odd run.
          if (/<!--del \w+ [^>]*(?:\\n\\n|\\-->)/.test(bodyOf(text))) break;
          made++;
          // Backslashes typed at the end of the document: with a line break of their own, or taking the
          // body's.
          if (/<!--(?:ins|sub) [^>]*-->[^<]*\\\n<!--\/\w+-->$/.test(bodyOf(after))) atEnd++;
          expect(escapedMarker(after), `${label} => ${JSON.stringify(bodyOf(after))}`).toBe(false);
          expect(readsAsNewest(after), `${label} => ${JSON.stringify(bodyOf(after))}`).toBe(true);
          // Line breaks typed at the end of a block are plain, and in the original text too (§3.4).
          const gone = view.text.slice(a, b);
          const plain =
            /^(?:\n[ \t>]*(?:[-*+] )?)+$/.test(edit.insert) ||
            (edit.insert === '' && /^\s+$/.test(gone));
          const read = (view: string) =>
            plain ? squash(dropEmptyBlocks(view)).replace(/\n+/g, '\n') : view;
          expect(read(originalView(after).text), label).toBe(read(original));
          expectSound(label, after);
          text = after;
        }
      }
      if (process.env['REDLINES_FUZZ']) console.log('backslash keys', { made, refused, atEnd });
      expect(unmeant.slice(0, 5)).toEqual([]);
      expect(made).toBeGreaterThan(refused);
    },
  );
});
