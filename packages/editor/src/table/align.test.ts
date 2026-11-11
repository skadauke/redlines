// @vitest-environment happy-dom
// An alignment change drawn (design: tables, "How it shows"; format §3.7): the new alignment, a dotted
// underline under the header text of each column changed and a bar on the header row, in Redlines; the
// bars alone in Simple; nothing in Clean. The markers and the blank lines that go with them show nowhere.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import type { ViewMode } from '../api.ts';
import { createEditor, type Editor } from '../index.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const SPEC = '\\|\\x20-\\-\\-\\-\\-\\x20\\|\\x20-\\-\\-\\-\\-\\x20\\|';
const CENTERED = [
  `<!--fmt k3x9 align=${SPEC}-->`,
  '',
  '| Fruit | Count |',
  '| ----- | :---: |',
  '| Apples | 3 |',
  '| Plums | 7 |',
  '',
  '<!--/k3x9-->',
  '',
  '<!-- redlines',
  'version: 1',
  'marks:',
  '  k3x9: {by: bo, at: 2026-11-01T10:00Z}',
  '-->',
  '',
].join('\n');

function load(view: ViewMode, doc = CENTERED): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    view,
    tracking: false,
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}
const dom = (editor: Editor) => editor.view.contentDOM;
const rows = (editor: Editor) => [...dom(editor).querySelectorAll<HTMLElement>('.cm-line.rl-trow')];

describe('an alignment change', () => {
  it('shows the new alignment in every row of the column, with no marker and no blank line', () => {
    const editor = load('redlines');
    expect(rows(editor)).toHaveLength(3);
    for (const row of rows(editor)) {
      const cells = [...row.querySelectorAll<HTMLElement>(':scope > .rl-tc')];
      expect(cells.map((c) => c.dataset['align'])).toEqual(['default', 'center']);
    }
    const text = dom(editor).textContent ?? '';
    expect(text).not.toContain('fmt');
    expect(text).not.toContain('align=');
    expect(text).not.toContain(':---:');
    expect(dom(editor).querySelectorAll('.rl-tbl')).toHaveLength(1);
  });

  it('draws a dotted underline under the header text of the column changed, and a bar on the header', () => {
    const editor = load('redlines');
    const marked = [...dom(editor).querySelectorAll<HTMLElement>('.rl-fmt')];
    expect(marked.map((el) => el.textContent)).toEqual(['Count']);
    expect(rows(editor).map((row) => row.classList.contains('rl-bar'))).toEqual([
      true,
      false,
      false,
    ]);
    expect(rows(editor)[0]?.querySelector('.rl-fmt')).not.toBeNull();
  });

  it('draws the bar alone in Simple, and nothing in Clean', () => {
    const redlines = load('redlines');
    const simple = load('simple');
    const clean = load('clean');
    const bars = (e: Editor) => rows(e).map((row) => row.classList.contains('rl-bar'));
    expect(bars(simple)).toEqual(bars(redlines));
    expect(bars(clean)).toEqual([false, false, false]);
    for (const editor of [simple, clean]) {
      expect(dom(editor).querySelectorAll('.rl-fmt')).toHaveLength(0);
    }
    expect(dom(simple).textContent).toBe(dom(clean).textContent);
    // The alignment is drawn in every view.
    for (const editor of [simple, clean]) {
      const header = [...rows(editor)[0]!.querySelectorAll<HTMLElement>(':scope > .rl-tc')];
      expect(header.map((c) => c.dataset['align'])).toEqual(['default', 'center']);
    }
  });

  it('underlines the header text of every column it changed, and of none it left as it was', () => {
    const both = CENTERED.replace('| ----- | :---: |', '| :---- | :---: |');
    const editor = load('redlines', both);
    expect([...dom(editor).querySelectorAll('.rl-fmt')].map((el) => el.textContent)).toEqual([
      'Fruit',
      'Count',
    ]);
    const left = CENTERED.replace(
      '\\x20\\|\\x20-\\-\\-\\-\\-\\x20\\|',
      '\\x20\\|\\x20:-\\-\\-\\-:\\x20\\|',
    );
    const unchanged = load('redlines', left.replace('| ----- | :---: |', '| ----- | :---: |'));
    expect([...dom(unchanged).querySelectorAll('.rl-fmt')]).toHaveLength(0);
  });
});
