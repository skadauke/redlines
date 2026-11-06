import { readFileSync } from 'node:fs';
import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { parse } from './parse.ts';
import { scan } from './scan.ts';

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

  it('end where CommonMark ends them, in their container', () => {
    // Each case: the lines, and whether the mark on the last line is read. CommonMark (micromark)
    // reads it as a comment, not as code, exactly then.
    const after = `after ${OTHER_MARK}`;
    const inside = `in ${MARK}`;
    const cases: [string[], boolean][] = [
      // Up to three columns past where the content of the fence's container starts, and a tab is
      // four. At the top level that is the left edge, however the opening fence is indented.
      [['```', inside, '   ```', after], true],
      [['```', inside, '    ```', after], false],
      [['```', inside, '\t```', after], false],
      [['  ```', inside, '```', after], true],
      [['  ```', `    ${inside}`, '     ```', after], false],
      [[' ```', inside, '    ```', after], false],
      // In a list item, from where its content starts: the marker's, or that of the item above.
      [['- ```', `  ${inside}`, '     ```', after], true],
      [['- a', '', '  ```', `  ${inside}`, '     ```', after], true],
      [['- ```', `  ${inside}`, '  ```', after], true],
      // Out of the quote or the item, a line ends the block with its container, a blank one in a
      // quote too; a fence there opens a block of its own.
      [['> ```', `> ${inside}`, '>     ```', after], true],
      [['> ```', `> ${inside}`, '', after], true],
      [['> ```', `> ${inside}`, '```', after], false],
      [['> > ```', `> > ${inside}`, '> ```', after], true],
      [['>```', `>${inside}`, '> ```', after], true],
      [['- ```', `  ${inside}`, '', after], true],
      [['- ```', `  ${inside}`, '```', after], false],
      [['1. ```', `   ${inside}`, '  ```', after], false],
      [['- a', '', '  ```', `  ${inside}`, '      ```', after], true],
      // An ordered item numbered other than 1 can't interrupt a paragraph: after a line of text it
      // is text, and the fence after it opens a block. After a blank line, a heading or an item of
      // the same list it opens one.
      [['Text', '2. ```', inside, '```', after], false],
      [['Text', '3) ```', 'in', '```', after], false],
      [['Text', '', '2. ```', `   ${inside}`, '   ```', after], true],
      [['# H', '2. ```', `   ${inside}`, '   ```', after], true],
      [['1. a', '2. ```', `   ${inside}`, '   ```', after], true],
      [['Text', '1. ```', `   ${inside}`, '   ```', after], true],
    ];
    for (const [lines, read] of cases) {
      const html = micromark(lines.join('\n'), { allowDangerousHtml: true });
      expect(html.includes(OTHER_MARK), `CommonMark: ${JSON.stringify(lines)}`).toBe(read);
      expect(idsIn(...lines).includes('w8nn'), JSON.stringify(lines)).toBe(read);
    }
    // `2. ```` after text is no fence: the mark on the line after it is read.
    expect(idsIn('Text', '2. ```', inside, 'more')).toEqual(['k3x9']);
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

describe('where a blank line is content', () => {
  /** The stretches of `text` that `scan` reports, as the text they cover. */
  const verbatim = (text: string) =>
    scan(text).verbatim.map((range) => text.slice(range.from, range.to));

  it('is a fenced code block, from the start of its first line to the end of its last', () => {
    expect(verbatim('Intro.\n\n```js\none\n\ntwo\n```\n\nAfter.')).toEqual([
      '```js\none\n\ntwo\n```',
    ]);
    expect(verbatim('~~~\none\n~~~\n')).toEqual(['~~~\none\n~~~']);
    // In a quote or a list item, with the prefix of the lines, and never closed.
    expect(verbatim('> ```\n> one\n> ```\n')).toEqual(['> ```\n> one\n> ```']);
    expect(verbatim('- item\n\n  ```\n  one\n')).toEqual(['  ```\n  one\n']);
  });

  it('is an HTML comment that is not a marker, and not the ledger', () => {
    expect(verbatim('A <!-- note\n\nmore --> b.')).toEqual(['<!-- note\n\nmore -->']);
    expect(verbatim(`${MARK}\n\n${LEDGER_EXAMPLE.join('\n')}\n`)).toEqual([]);
  });

  it('is a block of raw text, up to the line of its closing tag', () => {
    expect(verbatim('Intro.\n\n<pre>\none\n\ntwo\n</pre>\n\nAfter.')).toEqual([
      '<pre>\none\n\ntwo\n</pre>',
    ]);
    expect(verbatim('<SCRIPT type="x">\na\n\nb\n</script>\n')).toEqual([
      '<SCRIPT type="x">\na\n\nb\n</script>',
    ]);
    expect(verbatim('<style>\na {}\n')).toEqual(['<style>\na {}\n']);
    // A tag whose name only starts with one of them is another element.
    expect(verbatim('<prefix>\n\nx\n')).toEqual([]);
  });

  it('is nothing in text with none of these', () => {
    expect(verbatim('One.\n\nTwo `code` and <b>bold</b>.\n')).toEqual([]);
  });
});
