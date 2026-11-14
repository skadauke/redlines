// Where an empty list item is no item in Markdown (`empty-item.ts`), against micromark's reading:
// an empty bullet right under text is the text's setext underline, and an empty numbered item is
// more of the text. A top-level item is so only under a paragraph.
import { Text } from '@codemirror/state';
import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { unsoundEmptyLine } from './empty-item.ts';

/** Whether micromark reads the last line of `text` as an empty list item. */
const readsAsItem = (text: string): boolean => micromark(text).includes('<li></li>');

const unsound = (text: string) => {
  const doc = Text.of(text.split('\n'));
  return unsoundEmptyLine(doc, doc.lines);
};

describe('the first item of a list, right under text', () => {
  it('is no item under a paragraph that starts at the margin, as micromark reads it', () => {
    for (const text of [
      'Para.\n- ',
      'Para.\n* ',
      'Para.\n1. ',
      'Para.\n2. ',
      'Para.\n  more\n- ',
      'Para.\n    more\n- ',
      'One\ntwo\n- ',
      '> Para.\n> - ',
      '- a\n\ntext\n- ',
      'Para.\n===\ntext\n- ',
    ]) {
      expect(readsAsItem(text), `micromark: ${JSON.stringify(text)}`).toBe(false);
      expect(unsound(text), JSON.stringify(text)).toBe(true);
    }
  });

  it('is an item where something else is above it, as micromark reads it', () => {
    for (const text of [
      'Para.\n\n- ',
      '- a\n- ',
      '1. a\n- ',
      '- a\n1. ',
      '- a\n  b\n- ',
      '- a\nb\n- ',
      '- a\n\n  b\n- ',
      '# H\n- ',
      '***\n- ',
      'Title\n===\n- ',
      'Para.\n===\n- ',
      '> q\ntext\n- ',
      '> q\nPara.\n1. ',
      '1. a\n===\nPara.\n1) ',
      '   - a\n===\ntext\n* ',
      '```\ncode\n```\n- ',
      '<!-- c -->\n- ',
      '> q\n- ',
      '- ',
    ]) {
      expect(readsAsItem(text), `micromark: ${JSON.stringify(text)}`).toBe(true);
      expect(unsound(text), JSON.stringify(text)).toBe(false);
    }
  });
});

describe('a nested item', () => {
  it('is as it was: no item under the text of its parent, an item after a blank line or a sibling', () => {
    expect(unsound('- one\n  - ')).toBe(true);
    expect(unsound('1. one\n   1. ')).toBe(true);
    expect(unsound('- one\n\n  - ')).toBe(false);
    expect(unsound('- one\n  - a\n  - ')).toBe(false);
  });
});

describe('random documents', () => {
  it('never reads an empty item as no item where micromark reads one, and finds the ones it reads none for', () => {
    // Lines of paragraphs, items, headings, rules, quotes, blocks and indentation, and then an empty
    // top-level item. A false "no item" would hide an empty item from the file; the other way is the
    // old behavior, which an indented first line or code above it leaves.
    const pool = [
      'Para.',
      '  Para.',
      '    code',
      '- a',
      '* a',
      '1. a',
      '2. a',
      '  - a',
      '   - a',
      '    - a',
      '# H',
      '***',
      '---',
      '===',
      '',
      '> q',
      '>',
      '<!-- c -->',
      'text',
      '  more',
      '   b',
      '1) a',
    ];
    const last = ['- ', '* ', '1. ', '2. ', '1) '];
    let seed = 7;
    const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    let found = 0;
    for (let i = 0; i < 4000; i++) {
      const lines: string[] = [];
      for (let k = 1 + Math.floor(rand() * 4); k > 0; k--) {
        lines.push(pool[Math.floor(rand() * pool.length)]!);
      }
      lines.push(last[Math.floor(rand() * last.length)]!);
      const text = lines.join('\n');
      const says = unsound(text);
      if (says) found++;
      expect(says && readsAsItem(text), JSON.stringify(text)).toBe(false);
    }
    expect(found).toBeGreaterThan(200);
  });
});
