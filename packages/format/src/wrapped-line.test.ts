// Deleting all the text of a wrapped line of a paragraph or an item (#427): a middle or a last line
// of a block that goes on over several lines, which hard-wrapped Markdown is made of. The deletion
// takes the line break in front of the line, as the first line takes the break after it
// (`coverLine`), so that the block does not split, and, with Track Changes on, so that the marker
// stands at the end of the line above, where it starts no line (format §3.2, §3.4). It was refused
// ("A marker here would start a line."), and with Track Changes off it left an empty line, which
// is a paragraph break.

import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { bodyStart, lineStartKind, prefixLength } from './blocks.ts';
import { markerRanges } from './edit-support.ts';
import { suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, listDocument, randomDocument, seeded } from './random-docs.ts';
import {
  REFUSALS,
  ada,
  blockLeaves,
  claudeAda,
  bo,
  bodyOf,
  expectEveryOrderAlike,
  file,
  TIME,
} from './test-helpers.ts';
import { fineEdits as trackedEdits } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import { atWrappedLine, wrappedLineStart } from './wrapped-line.ts';
import { newestView, originalView } from './views.ts';

/** The body of a file without the line breaks that end it. */
const bodyText = (text: string) => bodyOf(text).replace(/\n+$/, '');

/** The text of a view without the line breaks that end it. */
const viewText = (text: string) => newestView(text).text.replace(/(?:\r?\n)+$/, '');

/** The leaf blocks of a text as CommonMark reads them, as a string. */
const leaves = (text: string) => JSON.stringify(blockLeaves(text));

/** The structure of a text: the kind of each leaf block and what it is in, without its text. */
const shape = (text: string) =>
  blockLeaves(text)
    .map((leaf) => `${leaf.chain.join('>')}:${leaf.kind}`)
    .join('|');

/** What other readers see: micromark reads the file, its markers HTML comments, as it reads the
 * newest view (no marker shows). A hard break shows. */
const reads = (html: string) =>
  html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ ?(<[^>]*>) ?/g, '$1')
    .trim();
const readsAsNewest = (text: string) =>
  reads(micromark(bodyOf(text), { allowDangerousHtml: true })) ===
  reads(micromark(newestView(text).text, { allowDangerousHtml: true }));

/** The bytes that the ids of an edit are made of, the same again at every draw: an edit that writes
 * one mark has the id `ffff`. */
const constant = (n: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 19);

/** A source of such bytes that goes on, so that an edit that writes several marks gets ids that
 * differ. */
function counting(): (n: number) => Uint8Array {
  let at = 0;
  return (n) => Uint8Array.from({ length: n }, () => (at++ * 7 + 3) % 19);
}

/** Ada deletes `from` to `to` of the file's text with Track Changes on: the file after. */
function tracked(text: string, from: number, to: number): string {
  const result = trackedEdits(text, [{ from, to, insert: '' }], {
    author: ada,
    time: TIME,
    random: constant,
  });
  return applyChanges(text, result.changes);
}

/** The file after the deletion with Track Changes off. */
const plain = (text: string, from: number, to: number): string =>
  applyChanges(text, untrackedEdit(text, { from, to, insert: '' }));

/** A text with the line breaks that end it as one: blank lines at the end are no block. White space
 * on the last line is kept, a line of spaces that a deletion left is what tells it. */
const trimmed = (text: string) => text.replace(/\n+$/, '\n');

describe('deleting all the text of a wrapped line (#427)', () => {
  // [the text, what is deleted, the file with the deletion pending, the text that stays]
  const CASES: [string, string, string, string][] = [
    // A middle line, the last line, and a line of one character.
    [
      'line one\nline two\nline three',
      'line two',
      'line one<!--del ffff \\nline two-->\nline three',
      'line one\nline three',
    ],
    ['line one\nline two', 'line two', 'line one<!--del ffff \\nline two-->', 'line one'],
    ['one\ny\nz', 'y', 'one<!--del ffff \\ny-->\nz', 'one\nz'],
    // The last line of a paragraph that a block follows.
    [
      'line one\nline two\n\nNext.',
      'line two',
      'line one<!--del ffff \\nline two-->\n\nNext.',
      'line one\n\nNext.',
    ],
    // More lines than one, in one range.
    [
      'line one\nline two\nline three\nline four',
      'line two\nline three',
      'line one<!--del ffff \\nline two\\nline three-->\nline four',
      'line one\nline four',
    ],
    // In a quote, in an item, and in a quote in an item: the prefix of the line goes with it.
    [
      '> line one\n> line two\n> line three',
      'line two',
      '> line one<!--del ffff \\n> line two-->\n> line three',
      '> line one\n> line three',
    ],
    [
      '- line one\n  line two\n  line three',
      'line two',
      '- line one<!--del ffff \\n  line two-->\n  line three',
      '- line one\n  line three',
    ],
    [
      '1. line one\n   line two\n   line three\n2. next',
      'line two',
      '1. line one<!--del ffff \\n   line two-->\n   line three\n2. next',
      '1. line one\n   line three\n2. next',
    ],
    // A line of the lazy kind, with no prefix, under a quote's first line.
    [
      '> line one\nline two\nline three',
      'line two',
      '> line one<!--del ffff \\nline two-->\nline three',
      '> line one\nline three',
    ],
    // The spaces or the backslash of a hard break go with the break they belong to; those that end
    // the deleted line stay, and end the line above.
    [
      'line one  \nline two\nline three',
      'line two',
      'line one<!--del ffff   \\nline two-->\nline three',
      'line one\nline three',
    ],
    [
      'line one\\\nline two\nline three',
      'line two',
      'line one<!--del ffff \\\\\\nline two-->\nline three',
      'line one\nline three',
    ],
    [
      'line one\nline two  \nline three',
      'line two',
      'line one<!--del ffff \\nline two-->  \nline three',
      'line one  \nline three',
    ],
    [
      'line one  \nline two  \nline three',
      'line two',
      'line one<!--del ffff   \\nline two-->  \nline three',
      'line one  \nline three',
    ],
    // An escaped backslash is no hard break: the break stays as it is.
    [
      'line one\\\\\nline two\nline three',
      'line two',
      'line one\\\\<!--del ffff \\nline two-->\nline three',
      'line one\\\\\nline three',
    ],
    // Windows line breaks.
    [
      'line one\r\nline two\r\nline three',
      'line two',
      'line one<!--del ffff \\nline two-->\r\nline three',
      'line one\r\nline three',
    ],
  ];

  /** The file's offsets of the text `target` (its first occurrence) in the body. */
  const at = (body: string, target: string) => {
    const from = body.indexOf(target);
    return { from, to: from + target.length };
  };

  it('takes the line break in front of the line, tracked: the marker stands at the end of the line above', () => {
    for (const [body, target, written, kept] of CASES) {
      const text = file(body);
      const { from, to } = at(body, target);
      const label = JSON.stringify(body);
      const after = tracked(text, from, to);
      expect(bodyText(after), label).toBe(written);
      // The newest view is the text without the line, the original is the text, and other readers
      // read the file as the newest view.
      expect(viewText(after), label).toBe(kept);
      expect(bodyText(originalView(after).text), label).toBe(body);
      expect(readsAsNewest(after), `${label}: other readers`).toBe(true);
      expect(parse(after).warnings, label).toEqual([]);
      // Accepting leaves the text without the line, rejecting gives every byte back.
      expect(bodyText(applyChanges(after, accept(after, 'ffff'))), label).toBe(kept);
      expect(bodyText(applyChanges(after, reject(after, 'ffff'))), label).toBe(body);
      expectEveryOrderAlike(label, after);
    }
  });

  it('takes the same range with Track Changes off: the block does not split', () => {
    for (const [body, target, , kept] of CASES) {
      const { from, to } = at(body, target);
      const after = plain(file(body), from, to);
      expect(bodyText(after), JSON.stringify(body)).toBe(kept);
      expect(leaves(after), JSON.stringify(body)).toBe(leaves(file(kept)));
    }
  });

  it('takes the first line as it did, with the line break after it', () => {
    const body = 'line one\nline two\nline three';
    const text = file(body);
    const after = tracked(text, 0, 'line one'.length);
    expect(viewText(after)).toBe('line two\nline three');
    expect(readsAsNewest(after)).toBe(true);
    expect(bodyText(plain(text, 0, 'line one'.length))).toBe('\nline two\nline three');
  });

  it('takes the break with a line that an agent deletes, as with one that a person deletes', () => {
    // [the text, `old_str`, `new_str`, the file with the changes pending, the text that stays]
    const cases: [string, string, string, string, string][] = [
      [
        'line one\nline two\nline three',
        'line two',
        '',
        'line one<!--del ffff \\nline two-->\nline three',
        'line one\nline three',
      ],
      [
        'line one\nline two\nline three',
        'one\nline two',
        'one',
        'line one<!--del ffff \\nline two-->\nline three',
        'line one\nline three',
      ],
      [
        '> line one\n> line two\n> line three',
        'line two',
        '',
        '> line one<!--del ffff \\n> line two-->\n> line three',
        '> line one\n> line three',
      ],
      [
        '- line one\n  line two\n  line three\n- next',
        'line three',
        '',
        '- line one\n  line two<!--del ffff \\n  line three-->\n- next',
        '- line one\n  line two\n- next',
      ],
      [
        'line one\nline two  \nline three',
        'line two',
        '',
        'line one<!--del ffff \\nline two-->  \nline three',
        'line one  \nline three',
      ],
    ];
    for (const [body, old, now, written, kept] of cases) {
      const text = file(body);
      const edits = suggestReplace(text, old, now, {
        author: claudeAda,
        time: TIME,
        random: constant,
      });
      const after = applyChanges(text, edits.changes);
      const label = JSON.stringify([body, old, now]);
      expect(bodyText(after), label).toBe(written);
      expect(viewText(after), label).toBe(kept);
      expect(readsAsNewest(after), label).toBe(true);
      expectEveryOrderAlike(label, after);
    }
    // A replacement that hunks its words into deletions of the middle of a line is as it was.
    const hunked = file('line one\nline two\nline three');
    const edits = suggestReplace(hunked, 'line two\nline three', 'line three', {
      author: claudeAda,
      time: TIME,
      random: constant,
    });
    expect(viewText(applyChanges(hunked, edits.changes))).toBe('line one\nline three');
  });

  it('leaves what is not all the text of a line as it was', () => {
    const body = 'line one\nline two\nline three';
    const text = file(body);
    // A word of the line is a deletion of the word.
    const word = at(body, 'two');
    expect(bodyText(tracked(text, word.from, word.to))).toBe(
      'line one\nline <!--del ffff two-->\nline three',
    );
    expect(bodyText(plain(text, word.from, word.to))).toBe('line one\nline \nline three');
    // The start of the line, up to inside it: the line break is written again, as before.
    const part = at(body, 'line tw');
    const after = tracked(text, part.from, part.to);
    expect(viewText(after)).toBe('line one\no\nline three');
    expect(readsAsNewest(after)).toBe(true);
    expectEveryOrderAlike('part', after);
    // Text of the line from its middle to its end: no break goes either.
    const tail = at(body, 'o\nline');
    const rest = tracked(text, tail.from, tail.from + 1);
    expect(bodyText(rest)).toBe('line one\nline tw<!--del ffff o-->\nline three');
  });

  it('leaves a deletion that starts in front of the line break as it was', () => {
    // Taken from the end of the line above, the break is the range's own already.
    const body = 'line one\nline two\n\nNext.\n\nThird.';
    const text = file(body);
    const { from, to } = at(body, '\nline two\n\nNext.');
    expect(bodyText(tracked(text, from, to))).toBe(
      'line one<!--del ffff \\nline two\\n\\nNext.-->\n\nThird.',
    );
    expect(bodyText(plain(text, from, to))).toBe('line one\n\nThird.');
  });

  it('is refused, in words, when it starts at a wrapped line and goes on into another block', () => {
    const body = 'line one\nline two\n\nNext.\n\nThird.';
    const text = file(body);
    const { from, to } = at(body, 'line two\n\nNext.');
    let refusal: unknown;
    try {
      tracked(text, from, to);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(EditError);
    expect((refusal as EditError).code).toBe('no-legal-placement');
    expect((refusal as EditError).message).toMatch(/end of the line above/);
    // Track Changes off: the text goes, with the blank lines it was between.
    expect(bodyText(plain(text, from, to))).toBe('line one\n\n\nThird.');
  });

  it('leaves the lines of code, HTML and a table, and a line under a heading, as they were', () => {
    // Indented code and a fenced block take the line's text out and keep the line (a blank line of
    // code is code); an HTML block and a line under an underline are refused as before.
    for (const [body, target] of [
      ['```\ncode one\ncode two\ncode three\n```', 'code two'],
      ['    code one\n    code two\n    code three', 'code two'],
      ['<div>\nfoo\nbar\n</div>', 'bar'],
      ['| a | b |\n|---|---|\n| c | d |\n| e | f |', 'e'],
    ] as const) {
      const { from, to } = at(body, target);
      const label = JSON.stringify(body);
      expect(plain(file(body), from, to), label).toBe(file(body.slice(0, from) + body.slice(to)));
    }
    // A line under a setext heading's underline is a wrapped line like any other (#469).
    const under = 'Title\n=====\nline two\nline three';
    const { from, to } = at(under, 'line three');
    expect(plain(file(under), from, to)).toBe(file('Title\n=====\nline two'));
  });

  it('writes a deletion of a line that holds the changes of other people', () => {
    // Bo's insertion and his deletion inside the line: the line goes, his changes with it.
    const bodies: [string, Record<string, string>][] = [
      ['line one\nline <!--ins k3x9-->new <!--/k3x9-->two\nline three', { k3x9: 'bo' }],
      ['line one\nline <!--del k3x9 old -->two\nline three', { k3x9: 'bo' }],
      ['line one\nline <!--del k3x9 old -->two\nline three', { k3x9: 'ada' }],
      ['line one<!--ins k3x9-->\nline two<!--/k3x9-->\nline three', { k3x9: 'bo' }],
      ['line one <!--cmt k3x9-->line<!--/k3x9--> two\nline three', {}],
    ];
    for (const [body, marks] of bodies) {
      const text = file(body, marks);
      const view = newestView(text);
      const row = view.text.indexOf('\n') + 1;
      const end =
        view.text.indexOf('\n', row) < 0 ? view.text.length : view.text.indexOf('\n', row);
      const edit = {
        from: view.map.toSource(row, 1),
        to: view.map.toSource(end, -1),
        insert: '',
      };
      let after: string;
      try {
        after = applyChanges(
          text,
          trackedEdits(text, [edit], {
            author: ada,
            time: TIME,
            random: counting(),
          }).changes,
        );
      } catch (error) {
        if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) continue;
        throw error;
      }
      const label = JSON.stringify(body);
      expect(trimmed(newestView(after).text), label).toBe(
        trimmed(view.text.slice(0, row - 1) + view.text.slice(end)),
      );
      expect(parse(after).warnings, label).toEqual([]);
      expect(readsAsNewest(after), label).toBe(true);
      expectEveryOrderAlike(label, after);
    }
  });
});

describe('what the rule takes more of, and what it leaves alone (the review of #460)', () => {
  /** `wrappedLineStart` for the first `target` in `body`, with or without a marker. */
  function startOf(body: string, target: string, marker = true, last = false): number | undefined {
    const text = file(body);
    const from = last ? body.lastIndexOf(target) : body.indexOf(target);
    const parsed = parse(text);
    return wrappedLineStart(text, parsed, markerRanges(parsed), from, from + target.length, {
      marker,
    });
  }

  it('takes the one space that ends the line above too, so that two do not meet', () => {
    // A single trailing space is white space, two are a hard break: the space of the line above
    // and the one that ends the deleted line stay one.
    for (const [body, written, kept] of [
      [
        'alpha one \nbeta two \ngamma three \ndelta four',
        'alpha one<!--del ffff  \\nbeta two--> \ngamma three \ndelta four',
        'alpha one \ngamma three \ndelta four',
      ],
      [
        'alpha one \nbeta two\ngamma three',
        'alpha one<!--del ffff  \\nbeta two-->\ngamma three',
        'alpha one\ngamma three',
      ],
    ] as const) {
      const text = file(body);
      const from = body.indexOf('beta two');
      const after = tracked(text, from, from + 'beta two'.length);
      expect(bodyText(after), body).toBe(written);
      expect(viewText(after), body).toBe(kept);
      expect(readsAsNewest(after), body).toBe(true);
      expect(bodyText(plain(text, from, from + 'beta two'.length)), body).toBe(kept);
    }
  });

  it('takes a line whose hard break is a backslash, and keeps that break', () => {
    const body = 'line one\nline two\\\nline three';
    const text = file(body);
    const from = body.indexOf('line two');
    const after = tracked(text, from, from + 'line two'.length);
    expect(bodyText(after)).toBe('line one<!--del ffff \\nline two-->\\\nline three');
    expect(viewText(after)).toBe('line one\\\nline three');
    expect(readsAsNewest(after)).toBe(true);
    expectEveryOrderAlike('backslash', after);
    // A deleted text that ends in a backslash of its own, in front of the line's one, is another
    // reading: the escaped pair is cut in two, and the one left would be a hard break.
    expect(startOf('one\ntwo\\\\\nthree', 'two\\')).toBeUndefined();
  });

  it('takes a line after a line that holds an HTML comment of its own', () => {
    const body = 'see <!-- c --> here\ntwo\nthree';
    const text = file(body);
    const from = body.indexOf('two');
    const after = tracked(text, from, from + 3);
    expect(bodyText(after)).toBe('see <!-- c --> here<!--del ffff \\ntwo-->\nthree');
    expect(readsAsNewest(after)).toBe(true);
    expect(bodyText(plain(text, from, from + 3))).toBe('see <!-- c --> here\nthree');
  });

  it('takes a range that starts in front of the line’s prefix, with Track Changes off too', () => {
    for (const [body, line, kept] of [
      ['> a\n> b\n> c', '> b', '> a\n> c'],
      ['- a\n  b\n  c', '  b', '- a\n  c'],
      ['1. a\n   b\n   c', '   b', '1. a\n   c'],
    ] as const) {
      const text = file(body);
      const from = body.indexOf(line);
      expect(bodyText(plain(text, from, from + line.length)), body).toBe(kept);
      const after = tracked(text, from, from + line.length);
      expect(viewText(after), body).toBe(kept);
    }
  });

  it('leaves the lines of link definitions and of footnotes as they were', () => {
    const defs =
      'See [bar] and [baz].\n\n[foo]: http://x.org\n[bar]: http://y.org\n[baz]: http://z.org';
    expect(startOf(defs, '[bar]: http://y.org')).toBeUndefined();
    expect(startOf(defs, '[baz]: http://z.org')).toBeUndefined();
    expect(startOf('Text.[^1]\n\n[^1]: one\n    two\n    three', 'two')).toBeUndefined();
    // No marker stands on a definition's line: the deletion is refused, as it was.
    const text = file(defs);
    const from = defs.indexOf('[bar]: http://y.org');
    expect(() => tracked(text, from, from + '[bar]: http://y.org'.length)).toThrow(EditError);
    // With Track Changes off, a line of a definition is a line, as it was.
    expect(bodyText(plain(text, from, from + '[bar]: http://y.org'.length))).toBe(
      'See [bar] and [baz].\n\n[foo]: http://x.org\n\n[baz]: http://z.org',
    );
  });

  it('leaves a line behind a delimiter run alone where a marker would change the emphasis', () => {
    // `*` at the end of the line above is not an opener (white space follows it); with a marker
    // after it, it is, and the `*` on the line below closes it.
    const body = 'a *\nmiddle\nx* b\nend';
    const text = file(body);
    const from = body.indexOf('middle');
    expect(startOf(body, 'middle')).toBeUndefined();
    expect(() => tracked(text, from, from + 6)).toThrow(/emphasi/);
    // Without a marker there is nothing to read otherwise: the rule takes the line.
    expect(startOf(body, 'middle', false)).toBe(body.indexOf('\nmiddle'));
    expect(bodyText(plain(text, from, from + 6))).toBe('a *\nx* b\nend');
    for (const delimiter of ['**', '_', '__', '~~']) {
      expect(
        startOf(`a ${delimiter}\nmiddle\nx${delimiter} b`, 'middle'),
        delimiter,
      ).toBeUndefined();
    }
  });

  it('leaves raw paragraphs, comments, fences, pipeless tables and alerts as they were', () => {
    const cases: [string, string][] = [
      ['<!-- one\ntwo\nthree -->', 'two'],
      ['- a\n  ```\n  x\n  ```\n  b\n  c', 'b'],
      ['a | b\n--|--\nc | d\ntext one\ntext two', 'text one'],
      ['<div>\nfoo\nbar\n</div>', 'bar'],
      ['    code one\n    code two\n    code three', 'code two'],
    ];
    for (const [body, target] of cases) {
      expect(startOf(body, target, true), JSON.stringify(body)).toBeUndefined();
      expect(startOf(body, target, false), JSON.stringify(body)).toBeUndefined();
    }
    // And no words that send the person to the end of the line above, where that doesn't help.
    for (const [body, target] of [
      ['<!-- one\ntwo\nthree -->', 'two'],
      ['- a\n  ```\n  x\n  ```\n  b\n  c', 'b'],
    ] as const) {
      const text = file(body);
      const from = body.indexOf(target);
      let words = '';
      try {
        tracked(text, from, from + target.length);
      } catch (error) {
        words = (error as Error).message;
      }
      expect(words, body).not.toBe('');
      expect(words, body).not.toMatch(/end of the line above/);
    }
  });

  it('takes the second line of a paragraph that starts right under a fence in an item', () => {
    // `b` starts a paragraph under the closing fence; `c` is its wrapped line.
    const body = '- a\n  ```\n  x\n  ```\n  b\n  c';
    const text = file(body);
    const from = body.indexOf('c');
    const after = tracked(text, from, from + 1);
    expect(bodyText(after)).toBe('- a\n  ```\n  x\n  ```\n  b<!--del ffff \\n  c-->');
    expect(readsAsNewest(after)).toBe(true);
  });

  it('leaves the line under the type of an alert alone where a marker would follow the type', () => {
    // `> [!NOTE]` takes nothing after it: a marker there would read as text to GitHub.
    for (const body of ['> [!NOTE]\n> one\n> two', '> [!NOTE]- Folded\n> one\n> two']) {
      expect(startOf(body, 'one', true), body).toBeUndefined();
      // Without a marker the line may go, and the alert stays.
      expect(startOf(body, 'one', false), body).toBe(body.indexOf('\n> one'));
      // The second line of the alert's body is a wrapped line like any other.
      expect(startOf(body, 'two', true), body).toBe(body.indexOf('\n> two'));
    }
    const body = '> [!NOTE]\n> one\n> two';
    const text = file(body);
    const from = body.indexOf('one');
    expect(bodyText(plain(text, from, from + 3))).toBe('> [!NOTE]\n> two');
  });

  it('says what a line is: a wrapped line of a paragraph of text, and only that', () => {
    const body = 'line one\nline two\nline three';
    const text = file(body);
    const parsed = parse(text);
    const markers = markerRanges(parsed);
    const at = (target: string) => body.indexOf(target);
    expect(atWrappedLine(text, parsed, markers, at('line two'))).toBe(true);
    expect(atWrappedLine(text, parsed, markers, at('line three'))).toBe(true);
    expect(atWrappedLine(text, parsed, markers, at('line one'))).toBe(false);
    expect(atWrappedLine(text, parsed, markers, at('two'))).toBe(false);
  });

  it('leaves a backslash that is text, at the end of the document, and a comment that spans lines', () => {
    // A backslash at the end of the last line is no hard break: it is text of the line, which the
    // range does not take.
    for (const marker of [true, false]) {
      expect(startOf('line one\nline two\\', 'line two', marker), String(marker)).toBeUndefined();
      expect(startOf('line one\nline two\\\nline three', 'line two', marker), String(marker)).toBe(
        'line one'.length,
      );
    }
    // The lines in a comment that starts and ends in the lines of the paragraph: a marker in it
    // would end the comment early for other readers.
    expect(startOf('text <!-- start\ntwo\nend --> more', 'two', true)).toBeUndefined();
    expect(startOf('text <!-- start\ntwo\nend --> more', 'two', false)).toBeUndefined();
  });

  it('reaches only a range that is all the text of its lines, and only inside the text', () => {
    const body = 'line one\nline two\nline three';
    // The text of two lines in a row; a part of the line, or of two; white space only.
    expect(startOf(body, 'line two\nline three')).toBe(body.indexOf('\nline two'));
    expect(startOf(body, 'line tw')).toBeUndefined();
    expect(startOf(body, 'ine two')).toBeUndefined();
    expect(startOf(body, 'two')).toBeUndefined();
    expect(startOf('line one\n   \nline three', '   ')).toBeUndefined();
    // Into the line breaks that end the text: the range stops at the text's end, so the rule leaves
    // it to the edit that clamps it.
    const text = file(body);
    const parsed = parse(text);
    const from = body.indexOf('line three');
    const to = from + 'line three'.length;
    expect(
      wrappedLineStart(text, parsed, markerRanges(parsed), from, to + 1, { marker: false }),
    ).toBe(undefined);
    // A last line of the text, with Track Changes on and off, and the same range just inside it.
    expect(wrappedLineStart(text, parsed, markerRanges(parsed), from, to, { marker: true })).toBe(
      body.indexOf('\nline three'),
    );
  });

  it('leaves a replacement that keeps a line break asking for the line to stay', () => {
    // `line two⏎` by `⏎`: the line is to stay, with nothing on it but white space, which the
    // format can't write as asked: it is refused, not written as a deletion of the line.
    const body = 'line one\nline two\nline three';
    const text = file(body);
    const from = body.indexOf('line two');
    let outcome: string;
    try {
      const result = trackedEdits(text, [{ from, to: from + 'line two\n'.length, insert: '\n' }], {
        author: ada,
        time: TIME,
        random: constant,
      });
      outcome = `written: ${bodyText(applyChanges(text, result.changes))}`;
    } catch (error) {
      outcome = (error as Error).message;
    }
    expect(outcome).not.toMatch(/^written:/);
    expect(outcome).not.toBe('');
  });
});

/**
 * The wrapped lines of a view that a deletion of their text takes with the break in front: each
 * line after the first of a block that goes on, as `lineStartKind` sees it (more than that, code
 * and the lines of an HTML block, which the test then finds out), with the range of its text, and
 * where the break in front starts: the end of the line above, before the syntax of a hard break.
 */
function wrappedLines(view: string): { start: number; from: number; to: number; front: number }[] {
  const found: { start: number; from: number; to: number; front: number }[] = [];
  const floor = bodyStart(view);
  let start = 0;
  for (const row of view.split('\n')) {
    const from = start + prefixLength(row);
    if (start > floor && row.slice(prefixLength(row)).trim() !== '') {
      if (lineStartKind(view, from, []) === 'continuation') {
        const above = view.slice(0, start - 1);
        const spaces = / +$/.exec(above)?.[0].length ?? 0;
        const slashes = /(\\+)$/.exec(above)?.[0].length ?? 0;
        const hard = spaces || (slashes % 2 === 1 ? 1 : 0);
        found.push({ start, from, to: start + row.trimEnd().length, front: start - 1 - hard });
      }
    }
    start += row.length + 1;
  }
  return found;
}

/**
 * Whether `after` is the structure of `before` with the words of paragraphs changed: the same leaf
 * blocks of the same kinds in the same containers, and only a paragraph's text differs (`p` is how
 * the HTML names it). A line of code, or of an HTML block or a table, that was taken with its
 * break would show here.
 */
function onlyParagraphChanged(before: string, after: string): boolean {
  const a = blockLeaves(before);
  const b = blockLeaves(after);
  return (
    a.length === b.length &&
    a.every((leaf, i) => {
      const other = b[i];
      return (
        other !== undefined &&
        leaf.kind === other.kind &&
        leaf.chain.join('>') === other.chain.join('>') &&
        (leaf.kind === 'p' || leaf.text === other.text)
      );
    })
  );
}

/**
 * A document of paragraphs whose lines end and begin with what Markdown reads across a line break:
 * one space, two, a backslash, emphasis delimiters, a comment, a footnote reference, code, an
 * entity, an HTML tag, a link, an emoji; in a quote, an item or at the top; no marks. Every line
 * that is wrapped is the line of a paragraph of text.
 */
function trickyDocument(random: () => number): string {
  const below = (n: number) => Math.floor(random() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const words = ['alpha', 'beta', 'gamma', 'delta', 'one', 'two', 'x'];
  const ends = [
    '',
    '',
    '',
    ' ',
    '  ',
    '   ',
    '\\',
    '\\\\',
    '*',
    '_',
    '~',
    '**',
    '__',
    ' *',
    ' _',
    ' ~~',
    '<!-- c -->',
    '[^1]',
    '`code`',
    '😀',
    ':smile:',
    '&amp;',
    '[a](b)',
    ' <b>',
    '</b>',
    '.',
  ];
  const starts = [
    '',
    '',
    '',
    '*x* ',
    '_x_ ',
    '**b** ',
    '`c` ',
    '[l](u) ',
    '<i>',
    '&amp; ',
    '😀 ',
    '</b>',
    ':+1: ',
  ];
  const [first, other, blank] = pick([
    ['', '', ''],
    ['> ', '> ', '>'],
    ['- ', '  ', ''],
    ['1. ', '   ', ''],
  ] as const);
  const paragraph = () =>
    Array.from({ length: 3 + below(3) }, (_, i) => {
      const text = Array.from({ length: 1 + below(2) }, () => pick(words)).join(' ');
      return `${i === 0 ? first : other}${pick(starts)}${text}${pick(ends)}`;
    }).join('\n');
  const lines = [paragraph()];
  // A second paragraph, which the first must not run into: a blank line of the container.
  if (below(2) === 0)
    lines.push(blank, paragraph().replace(/^[-1]\.? /, first === '- ' ? '- ' : '1. '));
  return `${lines.join('\n')}\n`;
}

describe('all the body of an alert, deleted with Track Changes off (#1112, deep seeds 206, 254)', () => {
  it('leaves an empty quote line, which the random walk below does not count as a bare line', () => {
    const text = '> [!note]\n> x 42\\\\ \n';
    const from = text.indexOf('x 42');
    const to = from + 'x 42\\\\'.length;
    expect(plain(text, from, to)).toBe('> [!note]\n>  \n');
    expect(aloneInAlert(text, from, to)).toBe(true);
    const folded = '> [!NOTE]- Folded\n> gamma\n>\n> beta\n';
    expect(aloneInAlert(folded, 20, 25)).toBe(true);
    const longer = '> [!note]\n> one\n> two\n';
    expect(aloneInAlert(longer, longer.indexOf('two'), longer.indexOf('two') + 3)).toBe(false);
  });
});

/** Whether the line `from` to `to` of a text is all the body of an alert: the line above it is the
 * alert's `[!TYPE]` line, and nothing under it goes on the paragraph. */
function aloneInAlert(text: string, from: number, to: number): boolean {
  const above =
    text
      .slice(0, text.lastIndexOf('\n', from - 1))
      .split('\n')
      .pop() ?? '';
  const below = text.slice(to + 1).split('\n')[0] ?? '';
  return /^(?:> ?)+\[![A-Za-z]+\]/.test(above) && (below === '' || !/^(?:> ?)+[^> ]/.test(below));
}

describe('deleting the text of each wrapped line of random documents', () => {
  it('takes the break with a line of a paragraph, tracked and plain, and reads the same', () => {
    // `taken`: the text of a line that was taken with its break, the paragraph is not parted;
    // `bare`: the text goes and the line stays (as it did, and still does for lines of code and of
    // the shapes that `listDocument` makes of indentation, which the format keeps apart by their
    // columns); `refused`; the lines are those that `lineStartKind` sees as wrapped.
    const counts = {
      lines: 0,
      taken: 0,
      refused: 0,
      bare: 0,
      plainTaken: 0,
      plainBare: 0,
      realLines: 0,
      realTaken: 0,
      realRefused: 0,
      realPlainTaken: 0,
    };
    const reasons = new Map<string, number>();
    // `REDLINES_SEED=206` runs that one seed alone, the repro of a deep run's failure.
    const only = Number(process.env.REDLINES_SEED) || undefined;
    for (let seed = 1; seed <= fuzzCount(50); seed++) {
      if (only !== undefined && seed !== only) continue;
      // Documents of paragraphs, quotes, items and alerts (`realistic`: every wrapped line is a
      // line of a paragraph), with code in them, and of every shape of indentation.
      const kind = seed % 4;
      const realistic = kind >= 2;
      const random = seeded(seed * 9973);
      const text =
        kind === 0
          ? listDocument(random)
          : kind === 3
            ? trickyDocument(random)
            : randomDocument(random, { indentedCode: kind === 1 });
      const view = newestView(text);
      for (const line of wrappedLines(view.text)) {
        counts.lines++;
        if (realistic) counts.realLines++;
        const shown = JSON.stringify(view.text.slice(line.from, line.to));
        let label = `seed ${seed}, ${shown} of ${JSON.stringify(view.text).slice(0, 400)}`;
        // The range starts at the text of the line, or in front of its prefix, and its ends are
        // on either side of the markers there.
        const origin = counts.lines % 3 === 0 ? line.start : line.from;
        const [sideFrom, sideTo] = [
          [1, -1],
          [-1, -1],
          [1, 1],
          [-1, 1],
        ][counts.lines % 4] as [1 | -1, 1 | -1];
        const bare = trimmed(view.text.slice(0, origin) + view.text.slice(line.to));
        const taken = trimmed(view.text.slice(0, line.front) + view.text.slice(line.to));
        const keeps = shape(taken) === shape(view.text);
        // An edit stops at the end of the body, as the editor's do: nothing is deleted after it.
        const stop = parse(text).ledgerRange?.from ?? text.length;
        const edit = {
          from: Math.min(view.map.toSource(origin, sideFrom), stop),
          to: Math.min(view.map.toSource(line.to, sideTo), stop),
          insert: '',
        };
        label += `\nthe file ${JSON.stringify(bodyOf(text)).slice(0, 700)}\nthe edit ${JSON.stringify(edit)} sides ${sideFrom} ${sideTo} from the ${origin === line.start ? 'prefix' : 'text'}`;
        // With Track Changes on.
        let after: string | undefined;
        let fresh: string[] = [];
        try {
          const result = trackedEdits(text, [edit], {
            author: ada,
            time: TIME,
            random: counting(),
          });
          after = applyChanges(text, result.changes);
          fresh = result.markIds;
        } catch (error) {
          // Any refusal: the documents of `listDocument` hold code that a file's end is in.
          if (!(error instanceof EditError)) {
            throw new Error(`${label}: ${String(error)}`, { cause: error });
          }
          counts.refused++;
          if (realistic) counts.realRefused++;
          if (realistic) reasons.set(error.message, (reasons.get(error.message) ?? 0) + 1);
        }
        if (after !== undefined) {
          const now = trimmed(newestView(after).text);
          if (now === taken) {
            counts.taken++;
            if (realistic) counts.realTaken++;
            // Taking a line of code, which leaves the structure as it is, would show here (in the
            // documents of paragraphs, quotes and items, where each line that is wrapped is a
            // paragraph's: the shapes of `listDocument`, and the code that a blank line of a quote
            // leaves at the top level, are read by their columns and may be read otherwise).
            if (keeps && realistic) {
              expect(onlyParagraphChanged(view.text, now), `${label}: a paragraph's line`).toBe(
                true,
              );
            }
            expect(parse(after).warnings, label).toEqual([]);
            expect(readsAsNewest(after), `${label}: other readers`).toBe(true);
            // Rejecting every change leaves the text that was there.
            expect(trimmed(originalView(after).text), `${label}: the original`).toBe(
              trimmed(originalView(text).text),
            );
            if (parse(after).marks.length <= 5) expectEveryOrderAlike(label, after);
            // Each change the edit wrote can be rejected and accepted, whatever else is pending.
            if (realistic) {
              for (const id of fresh) {
                expect(() => reject(after, id), `${label}: reject ${id}`).not.toThrow();
                expect(() => accept(after, id), `${label}: accept ${id}`).not.toThrow();
              }
            }
          } else {
            counts.bare++;
            // What the rule does not take, the deletion writes as it did.
            expect(realistic, `${label}: written as ${JSON.stringify(now)}`).toBe(false);
          }
        }
        // With Track Changes off.
        try {
          const now = trimmed(newestView(applyChanges(text, untrackedEdit(text, edit))).text);
          if (now === taken) {
            counts.plainTaken++;
            if (realistic) counts.realPlainTaken++;
            if (keeps && realistic) {
              expect(
                onlyParagraphChanged(view.text, now),
                `${label}: plain, a paragraph's line`,
              ).toBe(true);
            }
          } else {
            counts.plainBare++;
            // The one exception (format §3.10, #1112): all of an alert's body, deleted from the
            // start of its text, leaves an empty quote line, where the break would take the body
            // line from the callout.
            expect(
              realistic && !aloneInAlert(view.text, line.from, line.to),
              `${label}: plain, left as ${JSON.stringify(now)}`,
            ).toBe(false);
            expect(now, `${label}: plain`).toBe(bare);
          }
        } catch (error) {
          if (!(error instanceof EditError)) {
            throw new Error(`${label}: ${String(error)}`, { cause: error });
          }
        }
      }
    }
    if (only !== undefined) return;
    expect(counts.taken, 'lines taken with their breaks').toBeGreaterThan(50);
    expect(counts.taken).toBeGreaterThan(counts.refused);
  }, 120_000);
});

describe('a wrapped line inside the new text of another person’s substitution (#988)', () => {
  // Bo deletes the one-letter line `x`, in the new text of Ada's substitution (seed 1497 of the
  // random suite of `track.test.ts`): the break in front of the line goes with it, so that no
  // empty line parts the paragraph.
  it('takes the break in front of the line, as in plain text', () => {
    const text = file('beta <!--sub k3x9 old text-->42\nx\ncafé gamma<!--/k3x9-->', {
      k3x9: 'ada',
    });
    const view = newestView(text);
    const at = view.text.indexOf('x');
    const result = trackedEdits(
      text,
      [{ from: view.map.toSource(at, 1), to: view.map.toSource(at + 1, -1), insert: '' }],
      { author: bo, time: TIME, random: counting() },
    );
    const after = applyChanges(text, result.changes);
    expect(viewText(after)).toBe('beta 42\ncafé gamma');
    expect(originalView(after).text.replace(/\n+$/, '')).toBe('beta old text');
    expectEveryOrderAlike('a line in a substitution', after);
  });
});
