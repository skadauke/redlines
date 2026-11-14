// @vitest-environment happy-dom
// An alignment change drawn (design: tables, "How it shows"; format §3.7): the new alignment, a dotted
// underline under the header text of each column changed and a bar on the header row, in Redlines; the
// bars alone in Simple; nothing in Clean. The markers and the blank lines that go with them show nowhere.
// Two forms are drawn alike: the point mark that ends the text of the header's last cell, which is what
// Redlines writes, and the span form around the table, which another tool may have written.
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
const LEDGER = [
  '<!-- redlines',
  'version: 1',
  'marks:',
  '  k3x9: {by: bo, at: 2026-11-01T10:00Z}',
  '-->',
  '',
];
/** The point form: the mark ends the text of the header's last cell, and has no closer. */
const POINT_TABLE = [
  `| Fruit | Count<!--fmt k3x9 align=${SPEC}--> |`,
  '| ----- | :---: |',
  '| Apples | 3 |',
  '| Plums | 7 |',
].join('\n');
const POINT = [POINT_TABLE, '', ...LEDGER].join('\n');
/** The span form that another tool wrote: the opener above the table, the closer below it. */
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
  ...LEDGER,
].join('\n');

function load(view: ViewMode, doc = POINT): Editor {
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
const bars = (editor: Editor) => rows(editor).map((row) => row.classList.contains('rl-bar'));
const underlined = (editor: Editor) =>
  [...dom(editor).querySelectorAll('.rl-fmt')].map((el) => el.textContent);

describe.each([
  ['the point mark that ends the header’s last cell', POINT],
  ['the span around the table', CENTERED],
] as const)('an alignment change as %s', (_form, doc) => {
  it('shows the new alignment in every row of the column, with no marker and no blank line', () => {
    const editor = load('redlines', doc);
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
    const editor = load('redlines', doc);
    expect(underlined(editor)).toEqual(['Count']);
    expect(bars(editor)).toEqual([true, false, false]);
    expect(rows(editor)[0]?.querySelector('.rl-fmt')).not.toBeNull();
  });

  it('draws the bar alone in Simple, and nothing in Clean', () => {
    const redlines = load('redlines', doc);
    const simple = load('simple', doc);
    const clean = load('clean', doc);
    expect(bars(redlines)).toEqual([true, false, false]);
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
    const both = doc.replace('| ----- | :---: |', '| :---- | :---: |');
    expect(underlined(load('redlines', both))).toEqual(['Fruit', 'Count']);
    // The old row has the second column centered, as the delimiter row has it: nothing changed there.
    const left = doc.replace(
      '\\x20\\|\\x20-\\-\\-\\-\\-\\x20\\|',
      '\\x20\\|\\x20:-\\-\\-\\-:\\x20\\|',
    );
    expect(underlined(load('redlines', left))).toEqual([]);
  });

  it('leaves the text of the header’s last cell as it is, in every view', () => {
    for (const view of ['redlines', 'simple', 'clean'] as const) {
      const header = [
        ...rows(load(view, doc))[0]!.querySelectorAll<HTMLElement>(':scope > .rl-tc'),
      ];
      expect(
        header.map((c) => c.textContent),
        view,
      ).toEqual(['Fruit', 'Count']);
    }
  });
});

describe('the point mark of an alignment change, among other tables', () => {
  const OTHER_TABLE = ['| Name | Age |', '| ---- | --- |', '| Bo | 41 |'].join('\n');
  const file = (...tables: string[]) => [tables.join('\n\n'), '', ...LEDGER].join('\n');

  it('is drawn on the table that holds it, when another table follows', () => {
    const editor = load('redlines', file(POINT_TABLE, OTHER_TABLE));
    expect(rows(editor)).toHaveLength(5);
    expect(bars(editor)).toEqual([true, false, false, false, false]);
    expect(underlined(editor)).toEqual(['Count']);
  });

  it('is drawn on the table that holds it, when another table comes before', () => {
    const editor = load('redlines', file(OTHER_TABLE, POINT_TABLE));
    expect(rows(editor)).toHaveLength(5);
    expect(bars(editor)).toEqual([false, false, true, false, false]);
    expect(underlined(editor)).toEqual(['Count']);
  });

  it('draws nothing of its own where no table holds it, and shows no marker', () => {
    // The opener of the span form, whose closer is missing, is a point that no table holds.
    const lost = CENTERED.replace('<!--/k3x9-->\n\n', '');
    const editor = load('redlines', lost);
    expect(bars(editor)).toEqual([false, false, false]);
    expect(underlined(editor)).toEqual([]);
    expect(dom(editor).textContent).not.toContain('fmt');
  });
});
