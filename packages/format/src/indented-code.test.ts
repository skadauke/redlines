import { describe, expect, it } from 'vitest';
import { indentedCodeBlocks, markersInIndentedCode as markersInCode } from './indented-code.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { file, micromarkIndentedCode, thread } from './test-helpers.ts';
import type { Range } from './types.ts';

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
