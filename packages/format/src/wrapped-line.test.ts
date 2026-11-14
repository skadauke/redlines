// Deleting all the text of a wrapped line of a paragraph or an item (#427): a middle or a last line
// of a block that goes on over several lines, which hard-wrapped Markdown is made of. The deletion
// takes the line break in front of the line, as the first line takes the break after it
// (`coverLine`), so that the block does not split, and, with Track Changes on, so that the marker
// stands at the end of the line above, where it starts no line (format §3.2, §3.4). It was refused
// ("A marker here would start a line."), and with Track Changes off it left an empty line, which
// is a paragraph break.

import { appendFileSync } from 'node:fs';
import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { bodyStart, lineStartKind, prefixLength } from './blocks.ts';
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
  bodyOf,
  expectEveryOrderAlike,
  file,
  TIME,
} from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { untrackedEdit } from './untracked.ts';
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
    const body = 'line one\nline two\nline three';
    const text = file(body);
    for (const [old, now] of [
      ['line two', ''],
      ['one\nline two', 'one'],
    ] as const) {
      const edits = suggestReplace(text, old, now, {
        author: claudeAda,
        time: TIME,
        random: constant,
      });
      const after = applyChanges(text, edits.changes);
      expect(bodyText(after), JSON.stringify([old, now])).toBe(
        'line one<!--del ffff \\nline two-->\nline three',
      );
      expect(viewText(after)).toBe('line one\nline three');
      expect(readsAsNewest(after)).toBe(true);
      expectEveryOrderAlike(JSON.stringify([old, now]), after);
    }
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
    const under = 'Title\n=====\nline two\nline three';
    const { from, to } = at(under, 'line three');
    expect(plain(file(under), from, to)).toBe(file('Title\n=====\nline two\n'));
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

/**
 * The wrapped lines of a view that a deletion of their text takes with the break in front: each
 * line after the first of a block that goes on, as `lineStartKind` sees it (more than that, code
 * and the lines of an HTML block, which the test then finds out), with the range of its text, and
 * where the break in front starts: the end of the line above, before the syntax of a hard break.
 */
function wrappedLines(view: string): { from: number; to: number; front: number }[] {
  const found: { from: number; to: number; front: number }[] = [];
  const floor = bodyStart(view);
  let start = 0;
  for (const row of view.split('\n')) {
    const from = start + prefixLength(row);
    if (start > floor && row.slice(prefixLength(row)).trim() !== '') {
      if (lineStartKind(view, from, []) === 'continuation') {
        const above = view.slice(0, start - 1);
        const spaces = /( {2,})$/.exec(above)?.[0].length ?? 0;
        const slashes = /(\\+)$/.exec(above)?.[0].length ?? 0;
        const hard = spaces || (slashes % 2 === 1 ? 1 : 0);
        found.push({ from, to: start + row.trimEnd().length, front: start - 1 - hard });
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
    for (let seed = 1; seed <= fuzzCount(150); seed++) {
      // Documents of paragraphs, quotes, items and alerts (`realistic`: every wrapped line is a
      // line of a paragraph), with code in them, and of every shape of indentation.
      const kind = seed % 3;
      const realistic = kind === 2;
      const random = seeded(seed * 9973);
      const text =
        kind === 0 ? listDocument(random) : randomDocument(random, { indentedCode: kind === 1 });
      const view = newestView(text);
      for (const line of wrappedLines(view.text)) {
        counts.lines++;
        if (realistic) counts.realLines++;
        const shown = JSON.stringify(view.text.slice(line.from, line.to));
        const label = `seed ${seed}, ${shown} of ${JSON.stringify(view.text).slice(0, 400)}`;
        const bare = trimmed(view.text.slice(0, line.from) + view.text.slice(line.to));
        const taken = trimmed(view.text.slice(0, line.front) + view.text.slice(line.to));
        const keeps = shape(taken) === shape(view.text);
        const edit = {
          from: view.map.toSource(line.from, 1),
          to: view.map.toSource(line.to, -1),
          insert: '',
        };
        // With Track Changes on.
        let after: string | undefined;
        try {
          after = applyChanges(
            text,
            trackedEdits(text, [edit], { author: ada, time: TIME, random: counting() }).changes,
          );
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
            expect(realistic, `${label}: plain, left as ${JSON.stringify(now)}`).toBe(false);
            expect(now, `${label}: plain`).toBe(bare);
          }
        } catch (error) {
          if (!(error instanceof EditError)) {
            throw new Error(`${label}: ${String(error)}`, { cause: error });
          }
        }
      }
    }
    appendFileSync(
      '/private/tmp/claude-501/-Users-skadauke-code-redlines--claude-worktrees-epic-j-blocks-cb9834/434d7622-5066-4efe-8109-aed0041ddbeb/scratchpad/probe/stats.txt',
      `${JSON.stringify(counts)} ${JSON.stringify([...reasons])}\n`,
    );
    expect(counts.taken, 'lines taken with their breaks').toBeGreaterThan(50);
    expect(counts.taken).toBeGreaterThan(counts.refused);
  }, 120_000);
});
