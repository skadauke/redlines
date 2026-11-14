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
