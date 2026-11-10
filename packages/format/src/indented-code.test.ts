import { describe, expect, it } from 'vitest';
import { suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { addComment, deleteThread } from './comments.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import type { FormatOp } from './format-ops.ts';
import { trackedFormat } from './formatting.ts';
import { indentedCodeBlocks, markersInIndentedCode as markersInCode } from './indented-code.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import {
  REFUSALS,
  TIME,
  ada,
  bo,
  bodyOf,
  claudeAda,
  file,
  markersInIndentedCode,
  micromarkIndentedCode,
  problemsOf,
  randomEdit,
  thread,
} from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import type { EditContext, Person, Range, TextChange } from './types.ts';
import { untrackedEdit } from './untracked.ts';
import { newestView } from './views.ts';

/** The code blocks of a text, as the text each holds. */
const codeIn = (text: string) =>
  indentedCodeBlocks(text).map((block) => text.slice(block.from, block.to));

describe('indentedCodeBlocks', () => {
  it('reads indented code at the top level, in list items and in quotes, from where its indentation starts', () => {
    expect(codeIn('Para.\n\n    code line\n    more code\n\nAfter.\n')).toEqual([
      '    code line\n    more code',
    ]);
    // Four columns past the text of an item, whatever its marker.
    expect(codeIn('- Item.\n\n      code\n\n  After.\n')).toEqual(['    code']);
    expect(codeIn('-   Item.\n\n        code\n')).toEqual(['    code']);
    expect(codeIn('1. Item.\n\n       code\n')).toEqual(['    code']);
    expect(codeIn('10. Item.\n\n        code\n')).toEqual(['    code']);
    expect(codeIn('- One\n  - Two\n\n        code\n')).toEqual(['    code']);
    expect(codeIn('> Para.\n>\n>     code\n>     more\n')).toEqual(['    code\n>     more']);
    expect(codeIn('- > Para.\n  >\n  >     code\n')).toEqual(['    code']);
    // An item whose text starts with five spaces or more starts with code, one column past its marker.
    expect(codeIn('-     code\n')).toEqual(['    code']);
    expect(codeIn('-\n      code\n')).toEqual(['    code']);
  });

  it('takes the blank lines between its lines, but not those after it, and a tab for four columns', () => {
    expect(codeIn('    a\n\n\n    b\n\n\nc\n')).toEqual(['    a\n\n\n    b']);
    expect(codeIn('\tcode\n')).toEqual(['\tcode']);
    expect(codeIn(' \tcode\n')).toEqual([' \tcode']);
    expect(codeIn('- a\n\n\tcode\n')).toEqual([]);
  });

  it('reads no code where a line goes on a paragraph, lazily too, or is in a fence or an HTML block', () => {
    for (const text of [
      'Para.\n    more of it\n',
      '- Item.\n      more of it\n',
      '- Item.\n\n    a paragraph of it\n',
      '> Para.\n    more of it\n',
      '```\n    code of the fence\n```\n',
      '<div>\n    html\n</div>\n',
      '<!-- a\n    comment\n-->\n',
      'Para.\n===\n',
      '[a]: /url\n    more of it\n',
    ]) {
      expect(codeIn(text), JSON.stringify(text)).toEqual([]);
    }
  });

  it('reads code after a heading, a rule, a fence and an underline, which no paragraph goes on', () => {
    for (const text of [
      '# Head\n    code\n',
      '***\n    code\n',
      '```\nx\n```\n    code\n',
      'Para.\n---\n    code\n',
    ]) {
      expect(codeIn(text), JSON.stringify(text)).toEqual(['    code']);
    }
  });

  it('reads code where renderers part ways: after a table, and where micromark reads otherwise', () => {
    // markdown-it ends a table at an indented line, which is code then; GitHub reads a row.
    expect(codeIn('| a | b |\n| - | - |\n    x\n')).toEqual(['    x']);
    // micromark reads `2.` after code as text, and the lazy line of a quote as HTML in it.
    expect(codeIn('    code\n2. a\n\n    b\n')).toEqual(['    code', '    b']);
    expect(codeIn('> a\n<b>\n    c\n')).toEqual(['    c']);
    // A blank line after an empty item ends it, however far it is indented (commonmark.js).
    expect(codeIn('+ \n  \n \tx\n')).toEqual([' \tx']);
  });

  it('reads every line that micromark reads as indented code as code', () => {
    const PREFIXES = [
      '',
      '',
      ' ',
      '  ',
      '   ',
      '    ',
      '      ',
      '\t',
      ' \t',
      '> ',
      '>',
      '>     ',
      '> > ',
      '- ',
      '-   ',
      '-     ',
      '* ',
      '1. ',
      '2. ',
      '10. ',
      '-\t',
      '> - ',
      '- > ',
    ];
    const TEXTS = [
      'text',
      '',
      '',
      '```',
      '~~~',
      '# head',
      '---',
      '***',
      '===',
      '<div>',
      '</div>',
      '<!-- c',
      '-->',
      '<b>',
      '<pre>',
      '</pre>',
      '|a|b|',
      '|-|-|',
      '[a]: /u',
      '>',
      '-',
      '1.',
      '2.',
    ];
    for (let seed = 1; seed <= fuzzCount(3000); seed++) {
      const random = seeded(seed * 7907);
      const below = (n: number) => Math.floor(random() * n);
      const lines = Array.from(
        { length: 2 + below(6) },
        () => `${PREFIXES[below(PREFIXES.length)] ?? ''}${TEXTS[below(TEXTS.length)] ?? ''}`,
      );
      const text = `${lines.join('\n')}\n`;
      const ours = indentedCodeBlocks(text);
      const inside = (blocks: readonly Range[], at: number) =>
        blocks.some((block) => block.from < at && at <= block.to);
      for (const block of micromarkIndentedCode(text)) {
        // Past the first column of its indentation, where no marker goes anyway.
        for (let at = block.from + 2; at <= block.to; at++) {
          expect(inside(ours, at), `${JSON.stringify(text)} at ${at}`).toBe(true);
        }
      }
    }
  });
});

describe('markersInIndentedCode', () => {
  it('counts the markers in code, in the file and where they go in either view', () => {
    const threads = [...thread('c8d2'), ...thread('c9qf', 'bo')];
    // In the code of the file; on its own line in front of the block, and after it, which is none.
    const written = file(
      'Para.\n\n<!--cmt c9qf-->\n\n    code <!--cmt c8d2-->line<!--/c8d2-->\n<!--/c9qf-->',
      {},
      threads,
    );
    expect(markersInCode(written, written.indexOf('\n\n<!-- redlines'))).toEqual(
      new Map([['c8d2', 2]]),
    );
    // A line that only the newest view has as code, once Bo's line break is accepted.
    const broken = file(
      'Para.<!--split w8nn-->\n\n    text <!--cmt c8d2-->more<!--/c8d2-->',
      { w8nn: 'bo' },
      thread('c8d2'),
    );
    expect(markersInCode(broken)).toEqual(new Map([['c8d2', 2]]));
    // A file with no four columns of indentation is not read at all.
    expect(markersInCode(file('Para <!--cmt c8d2-->one<!--/c8d2-->.', {}, thread('c8d2')))).toEqual(
      new Map(),
    );
  });
});

describe('on random documents with indented code (#153)', { timeout: 3_600_000 }, () => {
  const AUTHORS: readonly Person[] = [ada, bo, claudeAda];
  const INSERTS = ['x', 'new words', '\n', '\n\n', ' ', '    ', '**', 'one\n\ntwo', '\n\n    code'];
  const FORMATS: readonly FormatOp[] = [
    { kind: 'inline', format: 'bold', on: true },
    { kind: 'inline', format: 'code', on: true },
    { kind: 'link', url: 'https://x.example' },
    { kind: 'block', to: 'h2' },
    { kind: 'block', to: 'quote' },
    { kind: 'block', to: 'ul' },
    { kind: 'indent', by: 1 },
  ];
  /** The errors other than refusals that an operation picked at random may end in: a comment
   * can't be decided, and an agent's text may match nothing, or more than once. */
  const SKIPPED = ['no-match', 'many-matches', 'not-supported'];

  it('writes no marker into indented code, in the file or in either view', () => {
    const documents = fuzzCount(100);
    let operations = 0;
    let refused = 0;
    let inCode = 0;
    let withCode = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 9973);
      const below = (n: number) => Math.floor(random() * n);
      const bytes = (n: number) => Uint8Array.from({ length: n }, () => below(256));
      let text = randomDocument(seeded(seed), { indentedCode: true });
      expect(markersInIndentedCode(text), `seed ${seed}: ${JSON.stringify(text)}`).toEqual([]);
      if (micromarkIndentedCode(newestView(text).text).length > 0) withCode++;
      for (let step = 0; step < 5; step++) {
        const view = newestView(text);
        const parsed = parse(text);
        const stop = parsed.ledgerRange?.from ?? text.length;
        const author = AUTHORS[below(AUTHORS.length)] as Person;
        const ctx: EditContext = { author, time: TIME, random: bytes };
        // Half the edits start in the code, when there is some: in a line, at its end, or on a
        // blank line between its lines.
        const code = micromarkIndentedCode(view.text);
        const block = code[below(code.length)];
        const inside = (range: Range) => range.from + 1 + below(range.to - range.from);
        const wanted = randomEdit(below, view.text, INSERTS);
        if (block && below(2) === 0) {
          wanted.from = inside(block);
          wanted.to = Math.max(wanted.from, Math.min(view.text.length, wanted.to));
          if (below(2) === 0) wanted.to = wanted.from;
        }
        const from = Math.min(stop, view.map.toSource(wanted.from, 1));
        const to = Math.max(from, Math.min(stop, view.map.toSource(wanted.to, -1)));
        const edit: TextChange = { from, to, insert: wanted.insert };
        const kind = below(8);
        const label = `seed ${seed}, step ${step}, operation ${kind} by ${author.handle} at ${JSON.stringify(edit)} of ${JSON.stringify(bodyOf(text))}`;
        let changes: TextChange[];
        try {
          if (kind === 0) {
            changes = addComment(text, { from, to }, 'A note.', ctx).changes;
          } else if (kind === 1 || kind === 2) {
            changes = trackedEdit(text, edit, ctx);
          } else if (kind === 3) {
            const op = FORMATS[below(FORMATS.length)] as FormatOp;
            const range =
              op.kind === 'block' || op.kind === 'indent' ? { from, to: from } : { from, to };
            changes = trackedFormat(text, range, op, ctx).changes;
          } else if (kind === 4) {
            // An agent's replacement of the words around the place.
            const start = Math.max(0, view.text.lastIndexOf(' ', wanted.from - 1) + 1);
            const end = Math.max(start + 1, wanted.to);
            const old = view.text.slice(start, end);
            changes = suggestReplace(text, old, `${old} ${wanted.insert}`, ctx).changes;
          } else if (kind === 5) {
            changes = untrackedEdit(text, edit, { random: bytes, author });
          } else {
            // A decision, or the deletion of a thread.
            const marks = parsed.marks.filter((mark) => mark.kind !== 'hl');
            const mark = marks[below(marks.length)];
            if (!mark) continue;
            if (mark.kind === 'cmt') changes = deleteThread(text, mark.id);
            else changes = (below(2) === 0 ? accept : reject)(text, mark.id);
          }
        } catch (error) {
          if (error instanceof EditError && REFUSALS.includes(error.code ?? '')) {
            refused++;
            if (error.code === 'inside-code') inCode++;
            continue;
          }
          if (error instanceof EditError && SKIPPED.includes(error.code ?? '')) continue;
          throw new Error(`${label}: ${String(error)}`, { cause: error });
        }
        const after = applyChanges(text, changes);
        const shown = `${label} => ${JSON.stringify(bodyOf(after))}`;
        expect(markersInIndentedCode(after), shown).toEqual([]);
        expect(problemsOf(parse(after)), shown).toEqual([]);
        text = after;
        operations++;
      }
    }
    // Most documents have code, and some edits in it are refused for it.
    expect(withCode).toBeGreaterThan(documents / 4);
    expect(inCode).toBeGreaterThan(0);
    expect(operations).toBeGreaterThan(refused / 2);
  });
});
