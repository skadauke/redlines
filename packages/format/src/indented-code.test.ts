import { describe, expect, it } from 'vitest';
import { commentOnQuote, suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { addComment, deleteThread } from './comments.ts';
import { accept, reject } from './decide.ts';
import { keepsIndentedCode } from './edit-support.ts';
import { EditError } from './errors.ts';
import type { FormatOp } from './format-ops.ts';
import { trackedFormat } from './formatting.ts';
import {
  htmlOpenAt,
  indentedCodeBlocks,
  lineOutOfCode,
  markersInIndentedCode as markersInCode,
  neverCode,
  readsAlike,
} from './indented-code.ts';
import { parse } from './parse.ts';
import { fuzzCount, listDocument, randomDocument, seeded } from './random-docs.ts';
import {
  REFUSALS,
  TIME,
  ada,
  bo,
  bodyOf,
  claudeAda,
  context,
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
import { newestView, originalView, viewsOnce } from './views.ts';

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

  it('reads an item after one that ends with code as an item, as micromark does', () => {
    // Numbered steps as Python-Markdown writes them: an item's text four columns in, code eight.
    const steps =
      '1. Install:\n\n        npm install\n\n2. Configure the server:\n\n    Set the port in the config file.\n\n3. Run it.\n';
    expect(codeIn(steps)).toEqual(['     npm install']);
    expect(
      codeIn('1. Step one:\n\n       make all\n\n2. Step two\n\n    - nested a\n    - nested b\n'),
    ).toEqual(['    make all']);
    expect(codeIn('1. a\n\n       code\n2. b\n\n       c\n')).toEqual(['    code', '    c']);
    expect(codeIn('- a\n\n      code\n\n2. b\n\n    c\n')).toEqual(['    code']);
    // Code on a line that goes on only some of the containers above it is a lazy line to micromark,
    // which no item after it interrupts.
    expect(codeIn('- a\n    1. b\n\n      + c\n\n    2. d\n\n       e\n')).toEqual(['    + c']);
    // Nor is an item text behind a container that the line starts, when the line goes on none of
    // the containers of the paragraph above.
    expect(codeIn('> para\n- 2. x\n\n      y\n')).toEqual([]);
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

  it(
    'reads the code that micromark reads in lists and in random documents, and no other but after a table',
    { timeout: 3_600_000 },
    () => {
      const inside = (blocks: readonly Range[], at: number) =>
        blocks.some((block) => block.from < at && at <= block.to);
      const DELIMITER = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
      /** Whether the line that holds `at` comes right after the rows of a table, with no blank line
       * between: an indented line there is code to markdown-it, and a row to GitHub and micromark. */
      const afterTable = (text: string, at: number) => {
        const above = text
          .slice(0, text.lastIndexOf('\n', at - 1) + 1)
          .split('\n')
          .slice(0, -1);
        for (let i = above.length - 1; i > 0; i--) {
          const line = above[i] ?? '';
          if (line.trim() === '') return false;
          if (line.includes('|') && DELIMITER.test(line) && above[i - 1]?.includes('|'))
            return true;
        }
        return false;
      };
      /** Where the readings differ, past the first column of a block's indentation (where a tab that
       * a quote's marker takes part of starts the block one column early) and after a letter or a
       * mark, where a marker could go. */
      const differences = (text: string) => {
        const ours = indentedCodeBlocks(text);
        const theirs = micromarkIndentedCode(text);
        const found: string[] = [];
        const compare = (blocks: readonly Range[], other: readonly Range[], what: string) => {
          for (const block of blocks) {
            if (what === 'extra' && afterTable(text, block.from)) continue;
            for (let at = block.from + 2; at <= block.to; at++) {
              if (/\S/.test(text[at - 1] ?? '') && !inside(other, at)) {
                found.push(
                  `${what} code at ${at}: ${JSON.stringify(text.slice(block.from, block.to))}`,
                );
                break;
              }
            }
          }
        };
        compare(theirs, ours, 'missed');
        compare(ours, theirs, 'extra');
        return found;
      };
      for (let seed = 1; seed <= fuzzCount(300); seed++) {
        const list = listDocument(seeded(seed));
        expect(differences(list), `${seed}: ${JSON.stringify(list)}`).toEqual([]);
        const text = randomDocument(seeded(seed), { indentedCode: true });
        for (const read of [text, newestView(text).text, originalView(text).text]) {
          expect(differences(read), `${seed}: ${JSON.stringify(read)}`).toEqual([]);
        }
      }
    },
  );
});

describe('a change of one line', { timeout: 3_600_000 }, () => {
  /** Lines of every kind, for the lines around the one that changes: those of the reader's random
   * check, with words. */
  const PREFIXES = [
    '',
    '',
    ' ',
    '   ',
    '    ',
    '\t',
    ' \t',
    '> ',
    '>',
    '>     ',
    '- ',
    '-   ',
    '1. ',
    '2. ',
    '-\t',
    '> - ',
    '- > ',
  ];
  const TEXTS = [
    'text',
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
    '<!DOCTYPE x',
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
  /** What an edit types into the line, or takes out of it. */
  const TYPED = [
    'x',
    'two words',
    ' ',
    '  ',
    '\t',
    '<!--ins k3x9-->y<!--/k3x9-->',
    '<!--cmt c9qf-->',
    '<!--/c9qf-->',
    '-->',
    '>',
    '|',
    '`',
    '```',
    '-',
    '*',
    '#',
    '<b>',
    '</pre>',
    '?>',
    ']]>',
    '1. ',
    '- ',
    '=',
  ];
  const LEAD = /^(?:[ \t>]|(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$))*/;

  it('is read as it was, and out of code, where readsAlike and neverCode say so', () => {
    let alike = 0;
    for (let seed = 1; seed <= fuzzCount(4000); seed++) {
      const random = seeded(seed * 104729);
      const below = (n: number) => Math.floor(random() * n);
      const pick = <T>(items: readonly T[]) => items[below(items.length)] as T;
      const lines = (count: number) =>
        Array.from(
          { length: count },
          () => `${pick(PREFIXES)}${below(2) ? pick(TEXTS) : 'some words'}`,
        );
      // Now and then the rows of a table around it, or a fence it may close, and an indented line
      // after them.
      const around = below(4);
      const table = around === 0;
      const fence = around === 1 ? pick(['```', '~~~', '- ```', '> ```']) : undefined;
      const above = [
        ...lines(below(6)),
        ...(table && below(2) ? ['| a | b |'] : []),
        ...(fence ? [fence] : []),
      ].join('\n');
      const below_ = [
        ...(table ? ['|-|-|', '    x'].slice(below(2)) : []),
        ...(fence ? ['    x'] : []),
        ...lines(below(4)),
      ].join('\n');
      const texts = [...TEXTS, 'some words here', 'a <!--ins k3x9-->b<!--/k3x9--> c'];
      const rows = ['| a | b |', '|-|-|', '| - | - |', 'a | b', 'a b'];
      const text = table
        ? pick(rows)
        : fence
          ? fence.replace(/^- /, '  ')
          : `${pick(PREFIXES)}${pick(texts)}`;
      const line = `${text}${!fence && below(2) ? ' and more' : ''}`;
      const at = below(line.length + 1);
      const to = below(3) === 0 ? Math.min(line.length, at + below(4)) : at;
      const changed = line.slice(0, at) + (below(4) === 0 ? '' : pick(TYPED)) + line.slice(to);
      const start = above === '' ? 0 : above.length + 1;
      const join = (middle: string) =>
        [above, middle, below_].filter((part, i) => i === 1 || part !== '').join('\n');
      const before = join(line);
      const after = join(changed);
      const label = JSON.stringify({ before, after });
      if (readsAlike(line, changed, htmlOpenAt(before, start))) {
        alike++;
        const lead = LEAD.exec(line)?.[0].length ?? 0;
        const delta = changed.length - line.length;
        const shift = (position: number) =>
          position <= start + lead ? position : position + delta;
        const moved = indentedCodeBlocks(before).map((b) => ({
          from: shift(b.from),
          to: shift(b.to),
        }));
        expect(indentedCodeBlocks(after), label).toEqual(moved);
      }
      const blocks = indentedCodeBlocks(after);
      for (let position = start; position <= start + changed.length; position++) {
        const covered = blocks.some((block) => block.from < position && position <= block.to);
        if (neverCode(changed) && position > start) expect(covered, label).toBe(false);
        if (lineOutOfCode(after, position) && position > start) expect(covered, label).toBe(false);
      }
    }
    expect(alike).toBeGreaterThan(fuzzCount(4000) / 10);
  });
});

describe('keepsIndentedCode', { timeout: 3_600_000 }, () => {
  /** What a change of one line types, or puts in place of what it takes out. */
  const TYPED = [
    'x',
    'two words',
    ' ',
    '    ',
    '\t',
    '<!--ins k3x9-->y<!--/k3x9-->',
    '<!--del k3x9 gone-->',
    '<!--/k3x9-->',
    '-->',
    '>',
    '> ',
    '|',
    '`',
    '```',
    '- ',
    '1. ',
    '2. ',
    '#',
    '<b>',
    '<!--',
    '=',
    '---',
  ];

  it('tells an edit of one line that keeps its markers out of code, without reading the file', () => {
    const text = file(
      'Para with words.\n\n    code line\n    more code\n\n- Item\n    lazy line\n\nAfter.',
      { m2bd: 'bo' },
    );
    const limit = parse(text).ledgerRange?.from ?? text.length;
    const at = (needle: string) => text.indexOf(needle);
    const keeps = (from: number, to: number, insert: string) =>
      keepsIndentedCode(
        text,
        limit,
        applyChanges(text, [{ from, to, insert }]),
        [{ from, to, insert }],
        viewsOnce(),
      );
    const typed = '<!--ins k3x9-->x<!--/k3x9-->';
    // Typed in a paragraph or an item: no line comes to be read otherwise, and theirs is no code.
    expect(keeps(at('words'), at('words'), typed)).toBe(true);
    expect(keeps(at('Item') + 2, at('Item') + 2, typed)).toBe(true);
    expect(keeps(at('After') + 2, at('After') + 3, '<!--del k3x9 t-->')).toBe(true);
    // Text with no marker typed in code brings no marker into it.
    expect(keeps(at('more') + 2, at('more') + 2, 'x')).toBe(true);
    // A marker in code, or on a line four columns in that could be code; a line break; a line
    // that starts otherwise: the file is read.
    expect(keeps(at('more') + 2, at('more') + 2, typed)).toBe(false);
    expect(keeps(at('lazy') + 2, at('lazy') + 2, typed)).toBe(false);
    expect(keeps(at('words'), at('words'), '\n\n')).toBe(false);
    expect(keeps(at('After'), at('After'), '    ')).toBe(false);
    expect(keeps(at('- Item'), at('Item'), '')).toBe(false);
  });

  it('says so only of changes after which no mark has more markers in code than before', () => {
    let kept = 0;
    let tried = 0;
    for (let seed = 1; seed <= fuzzCount(600); seed++) {
      const random = seeded(seed * 7919);
      const below = (n: number) => Math.floor(random() * n);
      const text =
        below(2) === 0
          ? randomDocument(seeded(seed), { indentedCode: true })
          : file(
              listDocument(seeded(seed)).replace(
                /\b(beta|plan)\b/g,
                (word) => `<!--ins k3x9-->${word}<!--/k3x9-->`,
              ),
              { k3x9: 'bo' },
            );
      const limit = parse(text).ledgerRange?.from ?? text.length;
      const views = viewsOnce();
      const was = markersInCode(text, limit, views);
      for (let step = 0; step < 8; step++) {
        // A change in one line of the body: typing, or taking out a little, or both.
        const at = below(limit);
        const end = Math.min(text.indexOf('\n', at) === -1 ? limit : text.indexOf('\n', at), limit);
        const to = below(3) === 0 ? Math.min(end, at + 1 + below(6)) : at;
        const change = {
          from: at,
          to,
          insert: below(4) === 0 ? '' : (TYPED[below(TYPED.length)] ?? ''),
        };
        const full = applyChanges(text, [change]);
        tried++;
        if (!keepsIndentedCode(text, limit, full, [change], views)) continue;
        kept++;
        const now = markersInCode(full, parse(full).ledgerRange?.from ?? full.length, views);
        const grown = [...now].filter(([id, count]) => count > (was.get(id) ?? 0));
        expect(grown, JSON.stringify({ text: bodyOf(text), change })).toEqual([]);
      }
    }
    // Most changes of one line keep the code as it was, and are told so.
    expect(kept).toBeGreaterThan(tried / 3);
  });
});

describe('the cost of a keystroke (#153)', () => {
  it('is what it is in a file without four columns of indentation, with Track Changes on or off', () => {
    // Four hundred paragraphs whose wrapped lines are indented four spaces, which go on their
    // paragraph and are no code, with Bo's insertions pending in ten of them; and the same file
    // with two spaces. Reading all of the first for indented code at every keystroke would cost
    // about half as much again with Track Changes on, and several times as much with it off.
    const ids = [...'bcdfghjkmn'].map((c) => `k${c}x9`);
    const make = (indent: string) => {
      const paragraphs = Array.from({ length: 400 }, (_, i) => {
        const id = i % 40 === 0 ? ids[i / 40] : undefined;
        const pending = id ? `<!--ins ${id}-->new <!--/${id}-->` : '';
        return `Paragraph ${i} has ${pending}words in it,\n${indent}and a wrapped line of more words.`;
      });
      return file(paragraphs.join('\n\n'), Object.fromEntries(ids.map((id) => [id, 'bo'])));
    };
    const best = (text: string, edit: (text: string, at: number) => unknown) => {
      const at = text.indexOf('Paragraph 201') + 3;
      let fastest = Infinity;
      for (let run = 0; run < 9; run++) {
        const start = performance.now();
        edit(text, at);
        fastest = Math.min(fastest, performance.now() - start);
      }
      return fastest;
    };
    const tracked = (text: string, at: number) =>
      trackedEdit(text, { from: at, to: at, insert: 'x' }, context(ada, ['w8nn']));
    const untracked = (text: string, at: number) =>
      untrackedEdit(text, { from: at, to: at, insert: 'x' }, { author: ada });
    const four = make('    ');
    const two = make('  ');
    best(four, tracked);
    best(two, tracked);
    // About 1.0 for both here.
    expect(best(four, tracked) / best(two, tracked)).toBeLessThan(1.3);
    expect(best(four, untracked) / best(two, untracked)).toBeLessThan(1.5);
  });
});

describe('the item after one that ends with code (#153)', () => {
  // Numbered steps as Python-Markdown writes them: micromark and CommonMark read `npm install` as
  // code, and nothing else.
  const STEPS = file(
    '1. Install:\n\n        npm install\n\n2. Configure the server:\n\n    Set the port in the config file.\n\n3. Run it.',
  );
  const ctx = () => context(ada, ['b953', 'w8nn', 'p3qz', 'k3x9', 'm2bd']);
  const at = (needle: string) => STEPS.indexOf(needle);
  const line = { start: at('Set'), middle: at('port'), end: at(' file.') + ' file.'.length };

  /** The edit's outcome: what code it was refused with, or the markers it put in code. */
  function outcome(run: () => TextChange[]): string | string[] {
    try {
      return markersInIndentedCode(applyChanges(STEPS, run()));
    } catch (error) {
      if (error instanceof EditError) return error.code ?? '';
      throw error;
    }
  }

  it('takes typing, Enter, Backspace and Delete at the start, the middle and the end of its text', () => {
    for (const [where, position] of Object.entries(line)) {
      // Backspace at the start of the text joins it to the text above.
      const back = where === 'start' ? at('server:') + 'server:'.length : position - 1;
      for (const [name, edit] of [
        ['typing', { from: position, to: position, insert: 'x' }],
        ['Enter', { from: position, to: position, insert: '\n' }],
        ['Enter twice', { from: position, to: position, insert: '\n\n' }],
        ['Backspace', { from: back, to: position, insert: '' }],
        ['Delete', { from: position, to: position + 1, insert: '' }],
      ] as const) {
        expect(
          outcome(() => trackedEdit(STEPS, edit, ctx())),
          `${name} at the ${where}`,
        ).toEqual([]);
      }
    }
    // Enter in the line of the item, and Backspace at the start of the next one.
    for (const edit of [
      { from: at('the server'), to: at('the server'), insert: '\n' },
      { from: at('Configure'), to: at('Configure'), insert: '\n' },
      { from: at('Run') - 1, to: at('Run'), insert: '' },
    ]) {
      expect(
        outcome(() => trackedEdit(STEPS, edit, ctx())),
        JSON.stringify(edit),
      ).toEqual([]);
    }
  });

  it('takes a comment, a format change and the agents’ edits in its text', () => {
    const port = { from: line.middle, to: line.middle + 'port'.length };
    expect(outcome(() => addComment(STEPS, port, 'Which one?', ctx()).changes)).toEqual([]);
    const bold: FormatOp = { kind: 'inline', format: 'bold', on: true };
    expect(outcome(() => trackedFormat(STEPS, port, bold, ctx()).changes)).toEqual([]);
    expect(
      outcome(() => suggestReplace(STEPS, 'the port', 'the port number', ctx()).changes),
    ).toEqual([]);
    expect(outcome(() => commentOnQuote(STEPS, 'Set the port', 'Which?', ctx()).changes)).toEqual(
      [],
    );
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
        // Nor did the edit leave more of a mark's markers in code, as the reader reads it, than
        // there were: what the check refuses, also where it reads one line only.
        const was = markersInCode(text, stop);
        const now = markersInCode(after, parse(after).ledgerRange?.from ?? after.length);
        expect(
          [...now].filter(([id, count]) => count > (was.get(id) ?? 0)),
          shown,
        ).toEqual([]);
        text = after;
        operations++;
      }
    }
    // About a quarter of the documents have code (a little less at some counts), and some edits
    // in it are refused for it.
    expect(withCode).toBeGreaterThan(documents / 5);
    expect(inCode).toBeGreaterThan(0);
    expect(operations).toBeGreaterThan(refused / 2);
  });
});
