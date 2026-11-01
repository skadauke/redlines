import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from './parse.ts';

/** A marker in the text, used as an example. */
const MARK = '<!--ins k3x9-->x<!--/k3x9-->';
const OTHER_MARK = '<!--ins w8nn-->y<!--/w8nn-->';

const LEDGER_EXAMPLE = [
  '<!-- redlines',
  'version: 1',
  'marks:',
  '  k3x9: {by: ada, at: 2026-10-13T22:30Z}',
  '-->',
];

/** The ids of the marks that `parse` finds in the lines. */
function idsIn(...lines: string[]): string[] {
  return parse(lines.join('\n')).marks.map((mark) => mark.id);
}

describe('fenced code blocks', () => {
  it('hold no marker and no ledger', () => {
    const text = [
      '# Syntax',
      '',
      'A marker looks like this:',
      '',
      '```markdown',
      `We ship ${MARK} importer.`,
      '',
      ...LEDGER_EXAMPLE,
      '```',
      '',
      'That is all.',
      '',
    ].join('\n');
    const parsed = parse(text);
    expect(parsed.marks).toEqual([]);
    expect(parsed.ledgerRange).toBeNull();
    expect(parsed.warnings).toEqual([]);
    expect(parsed.text).toBe(text);
  });

  it('do not hide the ledger that follows an example of one', () => {
    const real = [`Real ${MARK}.`, '', ...LEDGER_EXAMPLE.map((l) => l.replace('22:30', '22:31'))];
    const text = ['Example:', '', '```', ...LEDGER_EXAMPLE, '```', '', ...real, ''].join('\n');
    const parsed = parse(text);
    expect(parsed.marks.map((mark) => mark.entry.at)).toEqual(['2026-10-13T22:31Z']);
    expect(parsed.ledgerRange?.from).toBeGreaterThan(text.indexOf('Real'));
    expect(parsed.warnings).toEqual([]);
  });

  it('end where CommonMark ends them', () => {
    const inside = `in ${MARK}`;
    const after = `after ${OTHER_MARK}`;
    // A fence closes with the same character, at least as many, and nothing after it.
    expect(idsIn('```', inside, '```', after)).toEqual(['w8nn']);
    expect(idsIn('~~~', inside, '~~~', after)).toEqual(['w8nn']);
    expect(idsIn('````', inside, '```', inside, '````', after)).toEqual(['w8nn']);
    expect(idsIn('```', inside, '~~~', inside, '```', after)).toEqual(['w8nn']);
    expect(idsIn('```', inside, '``` not a closing fence', after, '```')).toEqual([]);
    expect(idsIn('```js', inside, '  ```  ', after)).toEqual(['w8nn']);
    // An unclosed fence runs to the end of the file.
    expect(idsIn('```', inside, after)).toEqual([]);
    // Inside a list item or a block quote.
    expect(idsIn('- item', '', '    ```', `    ${inside}`, '    ```', after)).toEqual(['w8nn']);
    expect(idsIn('> ```', `> ${inside}`, '> ```', after)).toEqual(['w8nn']);
    expect(idsIn('1. ```', `   ${inside}`, '   ```', after)).toEqual(['w8nn']);
    // Three backticks closed on the same line are a code span, not a fence.
    expect(idsIn('``` code ```', MARK, after)).toEqual(['k3x9', 'w8nn']);
    // CRLF.
    expect(idsIn(...['```', inside, '```', after].map((line) => `${line}\r`))).toEqual(['w8nn']);
  });
});

describe('code spans', () => {
  it('hold no marker, even over several lines', () => {
    expect(idsIn(`Use \`${MARK}\` for that.`)).toEqual([]);
    expect(idsIn(`Use \`\`a \` ${MARK} b\`\` for that.`)).toEqual([]);
    expect(idsIn('A span `over', `two ${MARK} lines\` and more.`)).toEqual([]);
  });

  it('leave a marker after them, or between two of them', () => {
    expect(idsIn(`\`code\` ${MARK} \`more\``)).toEqual(['k3x9']);
  });

  it('do not let an unmatched backtick hide a marker', () => {
    // Nothing closes it, or it ends with its paragraph, its list item or its heading.
    expect(idsIn(`It is 5\` tall ${MARK}.`)).toEqual(['k3x9']);
    expect(idsIn('An odd `backtick', '', `then ${MARK}`, '', 'and `a span`')).toEqual(['k3x9']);
    expect(idsIn('- one `', `- two ${MARK} \``)).toEqual(['k3x9']);
    expect(idsIn('# A heading `', `${MARK} \``)).toEqual(['k3x9']);
    // A span closes with a run of the same length, not a longer or a shorter one.
    expect(idsIn(`\`\`a\` ${MARK} b`)).toEqual(['k3x9']);
    expect(idsIn(`\`a\`\` ${MARK} b\`\`\` c`)).toEqual(['k3x9']);
  });

  it('are not opened by an escaped backtick', () => {
    expect(idsIn(`\\\`${MARK}\\\``)).toEqual(['k3x9']);
    // The first backtick of a run is escaped, the rest opens a span.
    expect(idsIn(`\\\`\`${MARK}\``)).toEqual([]);
    // An escaped backslash escapes nothing.
    expect(idsIn(`\\\\\`${MARK}\``)).toEqual([]);
  });
});

describe('the format specification', () => {
  it('parses as a document with no marks and no ledger', () => {
    const spec = readFileSync(new URL('../../../docs/format.md', import.meta.url), 'utf8');
    const parsed = parse(spec);
    expect(parsed.marks).toEqual([]);
    expect(parsed.ledgerRange).toBeNull();
    expect(parsed.warnings).toEqual([]);
  });
});
