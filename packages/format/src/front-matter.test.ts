// The first block of the body, right under front matter (format §3.8, #141). The line after the
// closing line is read as the first line of a file: a mark that starts the block there has its
// opener on a line of its own between the closing line and the block (format §3.3), a change takes
// no break from in front of the block, and no decision puts a marker on or before the closing line,
// which Pandoc, Quarto, Jekyll and Hugo would then no longer read as the end of the front matter.

import { describe, expect, it } from 'vitest';
import { commentOnQuote, suggestReplace } from './agent.ts';
import { frontMatterEnd } from './blocks.ts';
import { applyChanges } from './changes.ts';
import { addComment, deleteThread } from './comments.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import type { FormatOp } from './format-ops.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { ada, bo, bodyOf, context } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import type { Person, Range, TextChange } from './types.ts';
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

/** A file of front matter, the first block right under it, and a last paragraph unless `alone`. */
function documentOf(close: string, eol: string, first: First, alone = false): string {
  const block = FIRSTS[first].replaceAll('\n', eol);
  return `${frontOf(close, eol)}${block}${alone ? '' : `${eol}${eol}Last paragraph.`}${eol}`;
}

const VARIANTS = ['---', '...'].flatMap((close) =>
  ['\n', '\r\n'].map((eol) => ({ close, eol, name: `${close} ${eol === '\n' ? 'LF' : 'CRLF'}` })),
);

/** Where the first word of the body starts, and where the text of the first block's first line
 * ends. */
function places(text: string): { word: number; lineEnd: number; line: number } {
  const word = text.indexOf('First');
  const lineEnd = text.indexOf(text.includes('\r\n') ? '\r\n' : '\n', word);
  const line = text.lastIndexOf('\n', word) + 1;
  return { word, lineEnd, line };
}

/** The front matter, untouched: the same bytes up to the line break after its closing line, which
 * still closes it there. */
function expectFrontMatter(label: string, front: string, text: string): void {
  expect(text.startsWith(front), `${label}: front matter ${JSON.stringify(text)}`).toBe(true);
  expect(frontMatterEnd(text), `${label}: front matter ends`).toBe(frontMatterEnd(front));
}

/** The file with one decision made: a mark accepted or rejected, or a thread deleted. */
function decide(text: string, id: string, how: 'a' | 'r' | 'd'): string {
  const changes =
    how === 'd' ? deleteThread(text, id) : how === 'a' ? accept(text, id) : reject(text, id);
  return applyChanges(text, changes);
}

/**
 * Every order of deciding every mark of `after` both ways, comments by deleting their threads, with
 * marks left pending on the way. In every state the front matter is untouched, the file reads with
 * no warning, and, while nothing is accepted, its original view is that of `before`. Once every
 * mark is rejected and every thread deleted the file has the bytes of `before` again; once every
 * mark is accepted and every thread deleted it is `newest`. Returns how many states were looked at.
 */
function expectEveryDecision(
  label: string,
  front: string,
  before: string,
  after: string,
  newest: string,
): number {
  const seen = new Set<string>();
  const original = originalView(before).text;
  const visit = (text: string, path: string) => {
    const accepted = / a/.test(path);
    const rejected = / r/.test(path);
    const key = `${String(accepted)} ${String(rejected)} ${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    const state = `${label}:${path}`;
    expectFrontMatter(state, front, text);
    expect(parse(text).warnings, `${state} ${JSON.stringify(bodyOf(text))}`).toEqual([]);
    expect(newestView(text).text.startsWith(front), `${state}: newest view`).toBe(true);
    if (!accepted) expect(originalView(text).text, `${state}: original view`).toBe(original);
    const marks = parse(text).marks;
    if (marks.length === 0) {
      if (!accepted) expect(text, `${state}: the bytes`).toBe(before);
      if (!rejected) expect(text, `${state}: the newest text`).toBe(newest);
      return;
    }
    for (const mark of marks) {
      const ways = mark.kind === 'cmt' ? (['d'] as const) : (['a', 'r'] as const);
      for (const how of ways) {
        const step = `${path} ${how}${mark.id}`;
        let next: string;
        try {
          next = decide(text, mark.id, how);
        } catch (error) {
          throw new Error(`${label}:${step} refused: ${String(error)}`, { cause: error });
        }
        visit(next, step);
      }
    }
  };
  visit(after, '');
  return seen.size;
}

/** The plain edit of a file. */
const plainEdit = (text: string, edit: TextChange) => applyChanges(text, [edit]);

/** A tracked edit by `author`: the new file. */
function tracked(text: string, edit: TextChange, author: Person = ada): string {
  return applyChanges(text, trackedEdit(text, edit, context(author, IDS)));
}

/** A comment by `author` on a range: the new file. */
function commented(text: string, range: Range, author: Person = ada): string {
  return applyChanges(text, addComment(text, range, 'Why?', context(author, ['c8d2'])).changes);
}

/** A tracked format change by Ada: the new file. */
function formatted(text: string, range: Range, op: FormatOp): string {
  return applyChanges(text, trackedFormat(text, range, op, context(ada, IDS)).changes);
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
    const text = '---\r\ntitle: Notes\r\n...\r\nFirst words of the text.\r\n';
    const after = commented(text, { from: 24, to: 29 });
    expect(bodyOf(after)).toBe(
      '---\r\ntitle: Notes\r\n...\r\n<!--cmt c8d2-->\r\n\r\nFirst<!--/c8d2--> words of the text.',
    );
    const replaced = tracked(text, { from: 24, to: 29, insert: 'The first' });
    expect(bodyOf(replaced)).toBe(
      '---\r\ntitle: Notes\r\n...\r\n<!--sub k3x9 First-->\r\n\r\nThe first<!--/k3x9--> words of the text.',
    );
    expect(applyChanges(replaced, reject(replaced, 'k3x9'))).toBe(text);
  });
});

describe('every kind of edit on the first block right under front matter (format §3.8)', () => {
  for (const { close, eol, name } of VARIANTS) {
    const front = frontOf(close, eol);
    for (const first of Object.keys(FIRSTS) as First[]) {
      const text = documentOf(close, eol, first);
      const { word, lineEnd, line } = places(text);
      const wordEnd = word + 'First'.length;
      const label = `${name}, ${first}`;

      it(`comments on it: ${label}`, () => {
        // The first word, a point at its start, and the whole first line from its first column.
        for (const [what, range] of [
          ['word', { from: word, to: wordEnd }],
          ['point', { from: word, to: word }],
          ['line', { from: line, to: lineEnd }],
        ] as const) {
          const after = commented(text, range);
          expectEveryDecision(`${label} comment ${what}`, front, text, after, text);
        }
      });

      it(`takes tracked typing, deletions and replacements: ${label}`, () => {
        const edits: [string, TextChange][] = [
          ['typing', { from: word, to: word, insert: 'New ' }],
          ['deleting a word', { from: word, to: wordEnd + 1, insert: '' }],
          ['replacing a word', { from: word, to: wordEnd, insert: 'The first' }],
          ['replacing a line', { from: word, to: lineEnd, insert: 'Other words' }],
        ];
        for (const [what, edit] of edits) {
          const after = tracked(text, edit);
          expectEveryDecision(`${label} ${what}`, front, text, after, plainEdit(text, edit));
        }
        // A line break in front of it is a blank line more in front of the body, as at the start
        // of a file: plain, with no mark. Not in front of a list item's text or a quote's, where it
        // is a split of the item or the quote.
        if (first === 'paragraph') {
          const enter = { from: word, to: word, insert: eol };
          expect(tracked(text, enter), label).toBe(plainEdit(text, enter));
        }
      });

      it(`takes the deletion of all of it, with no break from in front of it: ${label}`, () => {
        // From the first column of its line, or from the start of its text, to the start of the
        // block after it, which then starts the body; or, alone, to the end of its text.
        for (const alone of [false, true]) {
          const file = documentOf(close, eol, first, alone);
          const at = places(file);
          const to = alone ? file.length - eol.length : file.indexOf('Last');
          for (const from of [at.line, at.word]) {
            const after = tracked(file, { from, to, insert: '' });
            const what = `${label} deleting all${alone ? ', alone' : ''} from ${from}`;
            const newest = newestView(after).text;
            if (!alone) expect(newest, what).toBe(`${front}Last paragraph.${eol}`);
            expectEveryDecision(what, front, file, after, newest);
          }
        }
      });

      it(`takes format changes: ${label}`, () => {
        for (const [what, range] of [
          ['the word', { from: word, to: wordEnd }],
          ['the line', { from: word, to: lineEnd }],
        ] as const) {
          const after = formatted(text, range, BOLD);
          expectEveryDecision(`${label} bold ${what}`, front, text, after, newestView(after).text);
        }
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
          const after = formatted(text, { from: word, to: wordEnd }, op);
          expectEveryDecision(`${label} to ${to}`, front, text, after, newestView(after).text);
          // With Track Changes off, the same syntax, typed.
          const typed = applyChanges(text, untrackedFormat(text, { from: word, to: wordEnd }, op));
          expect(typed, `${label} to ${to}, Track Changes off`).toBe(newestView(after).text);
        }
      });

      it(`takes edits with Track Changes off: ${label}`, () => {
        const edits: [string, TextChange][] = [
          ['typing', { from: word, to: word, insert: 'New ' }],
          ['replacing a word', { from: word, to: wordEnd, insert: 'The first' }],
        ];
        for (const [what, edit] of edits) {
          const after = applyChanges(text, untrackedEdit(text, edit));
          expect(after, `${label} ${what}`).toBe(plainEdit(text, edit));
        }
        const bold = untrackedFormat(text, { from: word, to: wordEnd }, BOLD);
        expect(applyChanges(text, bold), `${label} bold`).toBe(
          `${text.slice(0, word)}**First**${text.slice(wordEnd)}`,
        );
      });
    }
  }
});

describe('a blank line between front matter and the first block (format §3.8)', () => {
  it('starts a comment that starts on it at the text of the block, and keeps it', () => {
    // An opener alone on the blank line would take its line break for its carrier, and the blank
    // line would go from the views (format §3.3). The same at the start of a file, and on the
    // second of two blank lines between blocks.
    for (const { close, eol, name } of VARIANTS) {
      const front = frontOf(close, eol);
      const text = `${front}${eol}First words.${eol}`;
      for (const range of [
        { from: front.length, to: front.length + eol.length + 5 },
        { from: front.length, to: front.length },
      ]) {
        const after = commented(text, range);
        expect(bodyOf(after), name).toBe(
          `${front}${eol}<!--cmt c8d2-->${eol}${eol}First${range.to > range.from ? '<!--/c8d2-->' : ''} words.`,
        );
        expectEveryDecision(`${name} ${JSON.stringify(range)}`, front, text, after, text);
      }
    }
    for (const text of ['\nFirst words.\n', 'One.\n\n\nFirst words.\n']) {
      const blank = text.indexOf('\nFirst');
      const after = commented(text, { from: blank, to: blank + 6 });
      expect(newestView(after).text, JSON.stringify(text)).toBe(text);
      expect(bodyOf(after), JSON.stringify(text)).toBe(
        `${text.slice(0, blank + 1)}<!--cmt c8d2-->\n\nFirst<!--/c8d2--> words.`,
      );
    }
  });

  it('takes typing and deletions after it as at the start of a file', () => {
    for (const { close, eol, name } of VARIANTS) {
      const front = frontOf(close, eol);
      for (const first of Object.keys(FIRSTS) as First[]) {
        const text = documentOf(close, eol, first).replace(front, `${front}${eol}`);
        const { word } = places(text);
        const label = `${name}, ${first}`;
        const typing = { from: word, to: word, insert: 'New ' };
        const typed = tracked(text, typing);
        expectEveryDecision(`${label} typing`, front, text, typed, plainEdit(text, typing));
        const all = tracked(text, { from: word, to: text.indexOf('Last'), insert: '' });
        expect(newestView(all).text, label).toBe(`${front}${eol}Last paragraph.${eol}`);
        expectEveryDecision(`${label} deleting all`, front, text, all, newestView(all).text);
        const alone = text.slice(0, text.indexOf(`${eol}${eol}Last`)) + eol;
        const gone = tracked(alone, { from: word, to: alone.length - eol.length, insert: '' });
        expectEveryDecision(
          `${label} deleting all, alone`,
          front,
          alone,
          gone,
          newestView(gone).text,
        );
      }
    }
  });
});

describe('marks of several people at the start of the body (format §3.8)', () => {
  for (const { close, eol, name } of VARIANTS) {
    const front = frontOf(close, eol);
    const text = documentOf(close, eol, 'paragraph');
    const { word, lineEnd } = places(text);

    it(`decides a comment and a replacement of the same word in every order: ${name}`, () => {
      const commentedText = commented(text, { from: word, to: lineEnd });
      const at = places(commentedText).word;
      const after = tracked(commentedText, { from: at, to: at + 5, insert: 'The first' }, bo);
      expect(parse(after).marks.map((mark) => mark.kind)).toEqual(['cmt', 'sub']);
      const newest = plainEdit(text, { from: word, to: word + 5, insert: 'The first' });
      expect(expectEveryDecision(name, front, text, after, newest)).toBeGreaterThan(4);
    });

    it(`decides a change of type and a deletion of the first word in every order: ${name}`, () => {
      const typed = formatted(text, { from: word, to: word + 5 }, { kind: 'block', to: 'h2' });
      const at = places(typed).word;
      const after = tracked(typed, { from: at, to: at + 6, insert: '' }, bo);
      expectEveryDecision(name, front, text, after, newestView(after).text);
    });

    it(`keeps text typed with Track Changes off in front of a comment off the closing line: ${name}`, () => {
      const after = commented(text, { from: word, to: word + 5 });
      // At the start of the comment's range, on either side of its hidden opener and carrier.
      for (const position of [front.length, places(after).word]) {
        const edit = { from: position, to: position, insert: 'X ' };
        const typed = applyChanges(after, untrackedEdit(after, edit));
        expectFrontMatter(`${name} at ${position}`, front, typed);
        expect(parse(typed).warnings).toEqual([]);
        const deleted = applyChanges(typed, deleteThread(typed, 'c8d2'));
        expect(deleted).toBe(plainEdit(text, { from: word, to: word, insert: 'X ' }));
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
    for (const { close, eol, name } of VARIANTS) {
      for (const first of ['heading', 'list', 'quote'] as const) {
        const text = documentOf(close, eol, first);
        const { line } = places(text);
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
    for (const { close, eol, name } of VARIANTS) {
      const text = documentOf(close, eol, 'paragraph');
      const { line } = places(text);
      expect(codeOf(text, { from: line - eol.length, to: line, insert: '' }), name).toBe(
        'front-matter',
      );
    }
  });
});
