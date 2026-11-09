// The first block of the body, right under front matter (format §3.8, #141). The body is read as a
// file of its own: every edit, comment and format change after front matter, and every decision of
// it in every order, gives the front matter and then what the same gives in the body alone. A mark
// that starts the first block has its opener on a line of its own between the closing line and the
// block (format §3.3), and no state has a marker on or before the closing line, which Pandoc,
// Quarto, Jekyll and Hugo would then no longer read as the end of the front matter.

import { describe, expect, it } from 'vitest';
import { commentOnQuote, suggestReplace } from './agent.ts';
import { bodyStart, frontMatterEnd } from './blocks.ts';
import { applyChanges } from './changes.ts';
import { addComment, deleteThread } from './comments.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import type { FormatOp } from './format-ops.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { ada, bo, bodyOf, context } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import type { MarkRange, Person, TextChange } from './types.ts';
import { untrackedEdit } from './untracked.ts';
import { newestView, originalView } from './views.ts';

const IDS = ['k3x9', 'm2bd', 'q2hw', 'n8fx', 'w2rf', 'p7qd'];

const BOLD: FormatOp = { kind: 'inline', format: 'bold', on: true };

/** Front matter closed by `close`, in `eol` line breaks, with the line break after its closing
 * line. */
const frontOf = (close: string, eol: string) => `---${eol}title: Notes${eol}${close}${eol}`;

/** The first blocks of the body that the tests put right under front matter. */
const FIRSTS = {
  paragraph: 'First words of the text.',
  heading: '# First words',
  list: '- First words\n- second item',
  quote: '> First words\n> of a quote.',
} as const;

type First = keyof typeof FIRSTS;

/** A body: the first block, and a last paragraph unless `alone`. */
function bodyFor(eol: string, first: First, alone = false): string {
  const block = FIRSTS[first].replaceAll('\n', eol);
  return `${block}${alone ? '' : `${eol}${eol}Last paragraph.`}${eol}`;
}

const VARIANTS = ['---', '...'].flatMap((close) =>
  ['\n', '\r\n'].map((eol) => ({
    close,
    eol,
    front: frontOf(close, eol),
    name: `${close} ${eol === '\n' ? 'LF' : 'CRLF'}`,
  })),
);

/** Where the first word of a body starts, where the text of its first line ends, and where the
 * line of the first word starts. */
function places(body: string): { word: number; lineEnd: number; line: number } {
  const word = body.indexOf('First');
  const lineEnd = body.indexOf(body.includes('\r\n') ? '\r\n' : '\n', word);
  const line = body.lastIndexOf('\n', word) + 1;
  return { word, lineEnd, line };
}

/**
 * A step of a test: an edit, a comment or a format change, at offsets of the newest view of the
 * body. `shift` is where the body starts, so that the step is the same in the body alone (0) and
 * after front matter (its length).
 */
type Step = (text: string, shift: number) => string;

/** Where an offset of the body's newest view is in the file, on `side` of hidden markers. */
const source = (text: string, shift: number, at: number, side: -1 | 1) =>
  newestView(text).map.toSource(at + shift, side);

/** Typing `insert` at offset `at`, with Track Changes on. */
const typing =
  (at: number, insert: string, author: Person = ada, side: -1 | 1 = -1): Step =>
  (text, shift) => {
    const p = source(text, shift, at, side);
    return applyChanges(text, trackedEdit(text, { from: p, to: p, insert }, context(author, IDS)));
  };

/** Replacing `[from, to)` with `insert` (deleting it when empty), with Track Changes on. */
const replacing =
  (from: number, to: number, insert: string, author: Person = ada): Step =>
  (text, shift) => {
    const edit = { from: source(text, shift, from, 1), to: source(text, shift, to, -1), insert };
    return applyChanges(text, trackedEdit(text, edit, context(author, IDS)));
  };

/** A comment on `[from, to)`, a point where they are the same. */
const commenting =
  (from: number, to: number, author: Person = ada): Step =>
  (text, shift) => {
    const range = { from: source(text, shift, from, 1), to: source(text, shift, to, -1) };
    if (from === to) range.to = range.from;
    return applyChanges(text, addComment(text, range, 'Why?', context(author, ['c8d2'])).changes);
  };

/** A format change of `[from, to)`, with Track Changes on. */
const formatting =
  (from: number, to: number, op: FormatOp): Step =>
  (text, shift) => {
    const range = { from: source(text, shift, from, 1), to: source(text, shift, to, -1) };
    return applyChanges(text, trackedFormat(text, range, op, context(ada, IDS)).changes);
  };

/** The same edits with Track Changes off. */
const plainly =
  (from: number, to: number, insert: string): Step =>
  (text, shift) => {
    const edit = { from: source(text, shift, from, 1), to: source(text, shift, to, -1), insert };
    if (from === to) edit.to = edit.from;
    return applyChanges(text, untrackedEdit(text, edit));
  };

const plainFormatting =
  (from: number, to: number, op: FormatOp): Step =>
  (text, shift) => {
    const range = { from: source(text, shift, from, 1), to: source(text, shift, to, -1) };
    return applyChanges(text, untrackedFormat(text, range, op));
  };

/** The new file, or the code of the error that refused the step or the decision. */
function outcome(run: () => string): string | { refused: string } {
  try {
    return run();
  } catch (error) {
    if (error instanceof EditError) return { refused: error.code ?? error.message };
    throw error;
  }
}

/** The front matter, untouched: the same bytes up to the line break after its closing line, which
 * still closes it there. */
function expectFrontMatter(label: string, front: string, text: string): void {
  expect(text.startsWith(front), `${label}: front matter ${JSON.stringify(text)}`).toBe(true);
  expect(frontMatterEnd(text), `${label}: front matter ends`).toBe(frontMatterEnd(front));
}

/** `withFront` is the front matter and then `alone`: the same body and marks, the same ledger,
 * and the same warnings. */
function expectSameAfter(label: string, front: string, withFront: string, alone: string): void {
  expectFrontMatter(label, front, withFront);
  expect(bodyOf(withFront), `${label}: the body`).toBe(front + bodyOf(alone));
  expect(parse(withFront).ledger, `${label}: the ledger`).toEqual(parse(alone).ledger);
  const codes = (text: string) => parse(text).warnings.map((warning) => warning.code);
  expect(codes(withFront), `${label}: warnings`).toEqual(codes(alone));
}

/** A text as Markdown reads its blank lines: a run of line breaks with only spaces or tabs between
 * them is one paragraph break, and those at the start of the body and at its end are none. */
function asBlankLinesRead(text: string): string {
  const start = bodyStart(text);
  return (
    text.slice(0, start) +
    text
      .slice(start)
      .replace(/^(?:[ \t]*\r?\n)+/, '')
      .replace(/(?:\r?\n[ \t]*)+$/, '')
      .replace(/\r?\n(?:[ \t]*\r?\n)+/g, '\n\n')
  );
}

/** The file with one decision made: a mark accepted or rejected, or a thread deleted. */
function decide(text: string, id: string, how: 'a' | 'r' | 'd'): string {
  const changes =
    how === 'd' ? deleteThread(text, id) : how === 'a' ? accept(text, id) : reject(text, id);
  return applyChanges(text, changes);
}

const waysOf = (mark: MarkRange) =>
  mark.kind === 'cmt' ? (['d'] as const) : (['a', 'r'] as const);

/**
 * The steps, made in the body alone and after front matter, and then every order of deciding every
 * mark both ways (a comment by deleting its thread), marks left pending on the way, in both files at
 * once. Each step and each decision is made in both or refused in both, and every state after front
 * matter is the front matter and the same state of the body alone (`expectSameAfter`), mixed
 * decisions too. While nothing is accepted, the original view is that of the file after the steps.
 * Once every mark is accepted and every thread deleted the file is its newest view from after the
 * steps, and, with `bytes`, once every mark is rejected and every thread deleted it has the bytes
 * of the body from before them (not where a step wrote plain text: Track Changes off, or a line
 * break written plain). Without `exact`, the newest view is compared as the format compares
 * decisions and views, as Markdown reads blank lines (format §2.6). With `decidable`, no decision
 * may be refused. Returns how many states were looked at, or 0 when a step was refused, in both.
 */
function expectAsAFile(
  label: string,
  front: string,
  body: string,
  steps: readonly Step[],
  { decidable = true, bytes = true, exact = true } = {},
): number {
  let withFront = front + body;
  let alone = body;
  for (const [i, step] of steps.entries()) {
    const a = outcome(() => step(withFront, front.length));
    const b = outcome(() => step(alone, 0));
    if (typeof a !== 'string' || typeof b !== 'string') {
      expect(a, `${label}: step ${i}`).toEqual(b);
      return 0;
    }
    expectSameAfter(`${label}: step ${i}`, front, a, b);
    withFront = a;
    alone = b;
  }
  const newest = newestView(alone).text;
  const original = originalView(alone).text;
  const seen = new Set<string>();
  const visit = (a: string, b: string, path: string) => {
    const accepted = / a/.test(path);
    const rejected = / r/.test(path);
    const key = `${String(accepted)} ${String(rejected)} ${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    const state = `${label}:${path}`;
    expectSameAfter(state, front, a, b);
    expect(parse(b).warnings, `${state} ${JSON.stringify(bodyOf(b))}`).toEqual([]);
    if (!accepted) expect(originalView(b).text, `${state}: original view`).toBe(original);
    const marks = parse(b).marks;
    if (marks.length === 0) {
      if (path === '') return;
      if (!accepted && bytes) expect(b, `${state}: the bytes`).toBe(body);
      if (!rejected) {
        const read = exact ? (t: string) => t : asBlankLinesRead;
        expect(read(b), `${state}: the newest text`).toBe(read(newest));
      }
      return;
    }
    for (const mark of marks) {
      for (const how of waysOf(mark)) {
        const step = `${path} ${how}${mark.id}`;
        const nextA = outcome(() => decide(a, mark.id, how));
        const nextB = outcome(() => decide(b, mark.id, how));
        if (typeof nextA !== 'string' || typeof nextB !== 'string') {
          expect(nextA, `${label}:${step}`).toEqual(nextB);
          if (decidable) expect(nextB, `${label}:${step} refused`).toBeTypeOf('string');
          continue;
        }
        visit(nextA, nextB, step);
      }
    }
  };
  visit(withFront, alone, '');
  return seen.size;
}

describe('the issue: the first word right under front matter (#141)', () => {
  it('takes a comment, with its opener on a line of its own under the closing line', () => {
    const text = '---\ntitle: Notes\n---\nFirst words of the text.\n';
    const after = applyChanges(
      text,
      commentOnQuote(text, 'First', 'Why?', context(ada, ['c8d2'])).changes,
    );
    expect(bodyOf(after)).toBe(
      '---\ntitle: Notes\n---\n<!--cmt c8d2-->\n\nFirst<!--/c8d2--> words of the text.',
    );
    expect(newestView(after).text).toBe(text);
    expect(applyChanges(after, deleteThread(after, 'c8d2'))).toBe(text);
  });

  it('takes a tracked replacement, and rejecting it gives back the bytes', () => {
    const text = '---\ntitle: Notes\n---\nFirst words of the text.\n';
    const after = applyChanges(
      text,
      suggestReplace(text, 'First', 'The first', context(ada, ['k3x9'])).changes,
    );
    expect(bodyOf(after)).toBe(
      '---\ntitle: Notes\n---\n<!--sub k3x9 First-->\n\nThe first<!--/k3x9--> words of the text.',
    );
    expect(newestView(after).text).toBe('---\ntitle: Notes\n---\nThe first words of the text.\n');
    expect(applyChanges(after, reject(after, 'k3x9'))).toBe(text);
    expect(applyChanges(after, accept(after, 'k3x9'))).toBe(
      '---\ntitle: Notes\n---\nThe first words of the text.\n',
    );
  });

  it('writes the same for front matter closed by `...`, and in a CRLF file', () => {
    const front = '---\r\ntitle: Notes\r\n...\r\n';
    const text = `${front}First words of the text.\r\n`;
    const after = commenting(0, 5)(text, front.length);
    expect(bodyOf(after)).toBe(
      '---\r\ntitle: Notes\r\n...\r\n<!--cmt c8d2-->\r\n\r\nFirst<!--/c8d2--> words of the text.',
    );
    const replaced = replacing(0, 5, 'The first')(text, front.length);
    expect(bodyOf(replaced)).toBe(
      '---\r\ntitle: Notes\r\n...\r\n<!--sub k3x9 First-->\r\n\r\nThe first<!--/k3x9--> words of the text.',
    );
    expect(applyChanges(replaced, reject(replaced, 'k3x9'))).toBe(text);
  });
});

describe('every kind of edit on the first block right under front matter (format §3.8)', () => {
  for (const { eol, front, name } of VARIANTS) {
    for (const first of Object.keys(FIRSTS) as First[]) {
      const body = bodyFor(eol, first);
      const { word, lineEnd, line } = places(body);
      const wordEnd = word + 'First'.length;
      const label = `${name}, ${first}`;

      it(`comments on it: ${label}`, () => {
        // The first word, a point at its start, and the whole first line from its first column.
        expectAsAFile(`${label} word`, front, body, [commenting(word, wordEnd)]);
        expectAsAFile(`${label} point`, front, body, [commenting(word, word)]);
        expectAsAFile(`${label} line`, front, body, [commenting(line, lineEnd)]);
      });

      it(`takes tracked typing, deletions and replacements: ${label}`, () => {
        expectAsAFile(`${label} typing`, front, body, [typing(word, 'New ')]);
        expectAsAFile(`${label} deleting`, front, body, [replacing(word, wordEnd + 1, '')]);
        expectAsAFile(`${label} replacing`, front, body, [replacing(word, wordEnd, 'The first')]);
        expectAsAFile(`${label} a line`, front, body, [replacing(word, lineEnd, 'Other words')]);
        // A line break in front of it, as Enter types it there: a blank line more in front of a
        // paragraph, which is plain, or a split of the heading, the item or the quote.
        const enter = first === 'list' ? `${eol}- ` : first === 'quote' ? `${eol}> ` : eol;
        expectAsAFile(`${label} Enter`, front, body, [typing(word, enter)], { bytes: false });
        expectAsAFile(`${label} Enter at its end`, front, body, [typing(lineEnd, enter)], {
          bytes: false,
        });
      });

      it(`takes the deletion of all of it, with no break from in front of it: ${label}`, () => {
        // From the first column of its line, or from the start of its text, to the start of the
        // block after it, which then starts the body; or, alone, to the end of its text.
        for (const alone of [false, true]) {
          const text = bodyFor(eol, first, alone);
          const at = places(text);
          const to = alone ? text.length - eol.length : text.indexOf('Last');
          for (const from of [at.line, at.word]) {
            const what = `${label} deleting all${alone ? ', alone' : ''} from ${from}`;
            expect(expectAsAFile(what, front, text, [replacing(from, to, '')])).toBeGreaterThan(0);
          }
        }
      });

      it(`takes format changes: ${label}`, () => {
        expectAsAFile(`${label} bold word`, front, body, [formatting(word, wordEnd, BOLD)]);
        expectAsAFile(`${label} bold line`, front, body, [formatting(word, lineEnd, BOLD)]);
      });

      it(`takes a change of its type: ${label}`, () => {
        const types = {
          paragraph: ['h2', 'ul', 'ol', 'quote'],
          heading: ['p', 'h3', 'quote'],
          list: ['ol', 'task'],
          quote: ['p', 'ul'],
        } as const;
        for (const to of types[first]) {
          const op: FormatOp = { kind: 'block', to };
          const states = expectAsAFile(`${label} to ${to}`, front, body, [
            formatting(word, wordEnd, op),
          ]);
          expect(states, `${label} to ${to}`).toBeGreaterThan(0);
          // With Track Changes off, the same syntax, typed.
          const typed = plainFormatting(word, wordEnd, op)(front + body, front.length);
          const tracked = formatting(word, wordEnd, op)(front + body, front.length);
          expect(typed, `${label} to ${to}, Track Changes off`).toBe(newestView(tracked).text);
        }
      });

      it(`takes edits with Track Changes off: ${label}`, () => {
        const off = { bytes: false };
        expectAsAFile(`${label} typing`, front, body, [plainly(word, word, 'New ')], off);
        expectAsAFile(
          `${label} replacing`,
          front,
          body,
          [plainly(word, wordEnd, 'The first')],
          off,
        );
        expectAsAFile(`${label} bold`, front, body, [plainFormatting(word, wordEnd, BOLD)], off);
        expect(plainFormatting(word, wordEnd, BOLD)(front + body, front.length)).toBe(
          `${front}${body.slice(0, word)}**First**${body.slice(wordEnd)}`,
        );
      });

      it(`takes a second edit at the start of the body, by another person: ${label}`, () => {
        // Typing, replacing the first word, Enter in front of it and Backspace there, after Ada's
        // typing or replacement at the start of its text.
        const firsts: [string, Step][] = [
          ['typing', typing(word, 'New ')],
          ['replacing', replacing(word, word + 1, 'Y')],
        ];
        const enter = first === 'list' ? `${eol}- ` : first === 'quote' ? `${eol}> ` : eol;
        const seconds: [string, Step][] = [
          ['typing at the start', typing(line, 'X ', bo)],
          ['typing at the text', typing(word, 'X ', bo, 1)],
          ['replacing', replacing(word, word + 3, 'Ab', bo)],
          ['Enter', typing(word, enter, bo)],
        ];
        for (const [one, a] of firsts) {
          for (const [two, b] of seconds) {
            expectAsAFile(`${label} ${one}, then ${two}`, front, body, [a, b], {
              decidable: false,
              bytes: false,
            });
          }
        }
      });
    }
  }
});

describe('Enter and typing at the start of a list under front matter (#141, the review)', () => {
  for (const { eol, front, name } of VARIANTS) {
    it(`types on the empty item that Enter in front of the first word left: ${name}`, () => {
      // Enter in front of `First` leaves `- <!--split …-->⏎- First words`; its first line reads as
      // a bullet alone, an empty item, which is no setext underline at the start of the body.
      const body = `- First words${eol}- second item${eol}${eol}Last paragraph.${eol}`;
      for (const side of [-1, 1] as const) {
        for (const author of [ada, bo]) {
          const states = expectAsAFile(`${name} ${side} ${author.handle}`, front, body, [
            typing(2, `${eol}- `),
            typing(2, 'Zero', author, side),
          ]);
          expect(states, `${name} ${side} ${author.handle}`).toBeGreaterThan(0);
        }
      }
    });
  }

  it("decides Bo's replacement of the first letter with Ada's typing at the start of the body", () => {
    // A marker of Bo's change stood where the decisions read front matter as text in front of the
    // body, and neither accepting nor rejecting it could be written.
    for (const { eol, front, name } of VARIANTS) {
      const body = `First words${eol}wrapped line.${eol}${eol}Last.${eol}`;
      for (const typed of [' ', 'X', 'New ']) {
        // As in the body alone: rejecting Bo's change in front of Ada's text is refused there too,
        // and accepting both leaves a blank line at the start of the body.
        const states = expectAsAFile(
          `${name} ${JSON.stringify(typed)}`,
          front,
          body,
          [replacing(0, 1, 'Y', bo), typing(0, typed)],
          { decidable: false, exact: false },
        );
        expect(states, `${name} ${JSON.stringify(typed)}`).toBeGreaterThan(2);
      }
    }
  });
});

describe('a blank line between front matter and the first block (format §3.8)', () => {
  it('starts a comment that starts on it at the text of the block, and keeps it', () => {
    // An opener alone on the blank line would take its line break for its carrier, and the blank
    // line would go from the views (format §3.3). The same at the start of a file, and on the
    // second of two blank lines between blocks.
    for (const { eol, front, name } of VARIANTS) {
      const body = `${eol}First words.${eol}`;
      for (const [from, to] of [
        [0, eol.length + 5],
        [0, 0],
      ] as const) {
        const after = commenting(from, to)(front + body, front.length);
        expect(bodyOf(after), name).toBe(
          `${front}${eol}<!--cmt c8d2-->${eol}${eol}First${to > from ? '<!--/c8d2-->' : ''} words.`,
        );
        expectAsAFile(`${name} ${from}-${to}`, front, body, [commenting(from, to)]);
      }
    }
    for (const text of ['\nFirst words.\n', 'One.\n\n\nFirst words.\n']) {
      const blank = text.indexOf('\nFirst');
      const after = commenting(blank, blank + 6)(text, 0);
      expect(newestView(after).text, JSON.stringify(text)).toBe(text);
      expect(bodyOf(after), JSON.stringify(text)).toBe(
        `${text.slice(0, blank + 1)}<!--cmt c8d2-->\n\nFirst<!--/c8d2--> words.`,
      );
    }
  });

  it('takes typing after it as at the start of a file', () => {
    for (const { eol, front, name } of VARIANTS) {
      for (const first of Object.keys(FIRSTS) as First[]) {
        const body = `${eol}${bodyFor(eol, first)}`;
        const { word, line } = places(body);
        expectAsAFile(`${name}, ${first} typing`, front, body, [typing(word, 'New ')]);
        // In the prefix of the line, which a change takes with the break in front of it: the blank
        // line is the body's, as at the start of a file.
        for (const at of new Set([line, line + 1])) {
          expectAsAFile(`${name}, ${first} typing at ${at}`, front, body, [typing(at, 'x')]);
        }
      }
    }
  });

  it('takes the deletion of all of the first block after it, and no break in front of it', () => {
    // As at the start of a file: the blank lines in front of the first block are no break between
    // blocks that a deletion of the block could take, and it takes the one after it.
    for (const { eol, front, name } of VARIANTS) {
      for (const first of Object.keys(FIRSTS) as First[]) {
        for (const blank of [eol, `${eol}${eol}`]) {
          const body = `${blank}${bodyFor(eol, first)}`;
          const { word, line } = places(body);
          for (const from of new Set([line, word])) {
            const label = `${name}, ${first}, ${blank.length} from ${from}`;
            const steps = [replacing(from, body.indexOf('Last'), '')];
            expect(expectAsAFile(label, front, body, steps), label).toBeGreaterThan(0);
            const all = steps[0]?.(front + body, front.length) ?? '';
            expect(newestView(all).text, label).toBe(`${front}${blank}Last paragraph.${eol}`);
          }
        }
      }
    }
  });

  it('takes a deletion or a replacement that starts on them as the body alone', () => {
    // The blank lines after the closing line are the body's own, which a change takes as it takes
    // a file's leading blank lines.
    for (const { eol, front, name } of VARIANTS) {
      const body = `${eol}${eol}First words after two.${eol}${eol}Last.${eol}`;
      for (const [from, insert] of [
        [0, ''],
        [0, 'Y'],
        [eol.length, ''],
        [eol.length, 'Y'],
      ] as const) {
        const label = `${name}, ${JSON.stringify(insert)} from ${from}`;
        expectAsAFile(label, front, body, [replacing(from, from + eol.length + 4, insert)], {
          exact: false,
        });
      }
    }
  });

  it("gives main's form at the start of a file with blank lines, and of the body after them", () => {
    // The line after a file's leading blank lines has the break in front of it that they are
    // (format §3.4): the change takes it, as on main.
    const text = '\n\nFirst words of the text.\n';
    expect(bodyOf(replacing(1, 6, 'Y')(text, 0))).toBe(
      '<!--sub k3x9 \\n\\nFirs-->\n\nY<!--/k3x9-->t words of the text.',
    );
    for (const { front, name } of VARIANTS.filter((variant) => variant.eol === '\n')) {
      expect(bodyOf(replacing(1, 6, 'Y')(front + text, front.length)), name).toBe(
        `${front}<!--sub k3x9 \\n\\nFirs-->\n\nY<!--/k3x9-->t words of the text.`,
      );
    }
  });
});

describe('marks of several people at the start of the body (format §3.8)', () => {
  for (const { eol, front, name } of VARIANTS) {
    const body = bodyFor(eol, 'paragraph');
    const { word, lineEnd } = places(body);

    it(`decides a comment and a replacement of the same word in every order: ${name}`, () => {
      const states = expectAsAFile(name, front, body, [
        commenting(word, lineEnd),
        replacing(word, word + 5, 'The first', bo),
      ]);
      expect(states).toBeGreaterThan(4);
    });

    it(`decides a change of type and a deletion of the first word in every order: ${name}`, () => {
      expectAsAFile(name, front, body, [
        formatting(word, word + 5, { kind: 'block', to: 'h2' }),
        replacing(word, word + 6, '', bo),
      ]);
    });

    it(`keeps text typed with Track Changes off in front of a comment off the closing line: ${name}`, () => {
      // At the start of the comment's range, on either side of its hidden opener and carrier.
      for (const side of [-1, 1] as const) {
        const steps: Step[] = [
          commenting(word, word + 5),
          (text, shift) => {
            const p = source(text, shift, word, side);
            return applyChanges(text, untrackedEdit(text, { from: p, to: p, insert: 'X ' }));
          },
        ];
        expectAsAFile(`${name} ${side}`, front, body, steps, { bytes: false });
      }
    });
  }
});

describe('what has no place right under front matter is refused (format §3.8)', () => {
  const codeOf = (text: string, edit: TextChange): string | undefined => {
    try {
      trackedEdit(text, edit, context(ada, IDS));
    } catch (error) {
      if (error instanceof EditError) return error.code;
      throw error;
    }
    return undefined;
  };

  it('refuses a change of the prefix of the first line, as on the first line of a file', () => {
    for (const { eol, front, name } of VARIANTS) {
      for (const first of ['heading', 'list', 'quote'] as const) {
        const text = front + bodyFor(eol, first);
        const line = front.length;
        expect(codeOf(text, { from: line, to: line + 1, insert: '7' }), `${name} ${first}`).toBe(
          'no-legal-placement',
        );
        expect(codeOf(text, { from: line, to: line, insert: 'x' }), `${name} ${first}`).toBe(
          'no-legal-placement',
        );
      }
    }
  });

  it('refuses joining the first block to the closing line', () => {
    for (const { eol, front, name } of VARIANTS) {
      const text = front + bodyFor(eol, 'paragraph');
      const line = front.length;
      expect(codeOf(text, { from: line - eol.length, to: line, insert: '' }), name).toBe(
        'front-matter',
      );
    }
  });
});
