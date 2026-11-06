import { parse } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { changeTexts, formatLabel } from './shared.ts';
import { file, PEOPLE } from './test-helpers.ts';

describe('formatLabel', () => {
  it('names inline formats, links and clearing', () => {
    expect(formatLabel([{ kind: 'inline', format: 'bold', on: true }])).toBe('Bold');
    expect(formatLabel([{ kind: 'inline', format: 'italic', on: false }])).toBe('Not italic');
    expect(formatLabel([{ kind: 'inline', format: 'strike', on: true }])).toBe('Strikethrough');
    expect(formatLabel([{ kind: 'inline', format: 'code', on: true }])).toBe('Code');
    expect(formatLabel([{ kind: 'link', url: 'https://a.example' }])).toBe('Link');
    expect(formatLabel([{ kind: 'link', url: null }])).toBe('No link');
    expect(formatLabel([{ kind: 'clear' }])).toBe('Plain text');
  });

  it('names block types, indents and boxes', () => {
    const names = (['p', 'h2', 'ul', 'ol', 'task', 'quote'] as const).map((to) =>
      formatLabel([{ kind: 'block', to }]),
    );
    expect(names).toEqual([
      'Paragraph',
      'Heading 2',
      'Bulleted list',
      'Numbered list',
      'Task list',
      'Quote',
    ]);
    expect(formatLabel([{ kind: 'indent', by: 1 }])).toBe('Indent');
    expect(formatLabel([{ kind: 'indent', by: -1 }])).toBe('Outdent');
    expect(formatLabel([{ kind: 'check', checked: true }])).toBe('Checked');
    expect(formatLabel([{ kind: 'check', checked: false }])).toBe('Unchecked');
  });

  it('joins several operations of one mark', () => {
    expect(
      formatLabel([
        { kind: 'inline', format: 'bold', on: false },
        { kind: 'inline', format: 'italic', on: false },
      ]),
    ).toBe('Not bold, not italic');
    expect(formatLabel([])).toBe('Formatted');
  });

  it('names every operation of a mark, from all its segments', () => {
    // Clearing `a **b** *i* \`c\` z` takes one mark with a segment for each format.
    const parsed = parse(
      file(
        'a <!--fmt m2bd -bold-->b<!--/m2bd--> <!--fmt m2bd -italic-->i<!--/m2bd--> <!--fmt m2bd -code-->c<!--/m2bd--> z',
        [...PEOPLE, 'marks:', '  m2bd: {by: bo, at: 2026-10-31T09:30Z}'],
      ),
    );
    expect(changeTexts(parsed, parsed.marks[0]!).label).toBe('Not bold, not italic, not code');
  });

  it('is what changeTexts gives a format change as its label', () => {
    const parsed = parse(
      file('A <!--fmt m2bd +bold-->**bold**<!--/m2bd--> word.', [
        ...PEOPLE,
        'marks:',
        '  m2bd: {by: bo, at: 2026-10-31T09:30Z}',
      ]),
    );
    expect(changeTexts(parsed, parsed.marks[0]!)).toEqual({ old: '', added: '', label: 'Bold' });
  });
});
