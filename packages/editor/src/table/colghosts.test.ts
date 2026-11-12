// @vitest-environment happy-dom
// Columns drawn (design: tables, "How it shows"; format §3.7): a deleted column is a ghost cell in every
// row at its place, an inserted one is tinted and underlined with a bar on each row, a moved one has a
// double underline and a ghost with a double strikethrough. Clean and Simple draw no ghost, tint or
// underline; Simple has Redlines' bars.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import type { ViewMode } from '../api.ts';
import { createEditor, type Editor } from '../index.ts';
import { widthsOf } from './widths.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const LEDGER = (ids: string[], extra = '') =>
  `\n<!-- redlines\nversion: 1\nmarks:\n${ids.map((id) => `  ${id}: {by: bo, at: 2026-11-01T10:00Z${extra}}\n`).join('')}-->\n`;
const DELETED = [
  '| Fruit | Price |',
  '| ----- | ----- |',
  '| Apples | 1.20 |',
  '| Plums | 2.50 |',
  '',
  '<!--del g5nb col=2 Count\\n-\\-\\-\\n3\\n7-->',
  '',
].join('\n');
const INSERTED = [
  '| Fruit | <!--ins k3x9 col--> Count | Price |',
  '| ----- | ----- | ----- |',
  '| Apples |  | 1.20 |',
  '| Plums |  | 2.50 |',
  '',
].join('\n');
const MOVED = [
  '| Price | <!--ins h6nb col--> Fruit |',
  '| ----- | ----- |',
  '| 1.20 | Apples |',
  '| 2.50 | Plums |',
  '',
  '<!--del j7nb col=1 Fruit\\n-\\-\\-\\nApples\\nPlums-->',
  '',
].join('\n');
const LEDGERS: Record<string, string> = {
  [DELETED]: LEDGER(['g5nb']),
  [INSERTED]: LEDGER(['k3x9']),
  [MOVED]: `\n<!-- redlines\nversion: 1\nmarks:\n  h6nb: {by: bo, at: 2026-11-01T10:00Z, move: j7nb}\n  j7nb: {by: bo, at: 2026-11-01T10:00Z, move: h6nb}\n-->\n`,
};

function load(view: ViewMode, doc: string): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: `${doc}${LEDGERS[doc]}`,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    view,
    tracking: false,
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}
const dom = (editor: Editor) => editor.view.contentDOM;
const ghosts = (editor: Editor) => [...dom(editor).querySelectorAll<HTMLElement>('.rl-ghost-col')];
const lines = (editor: Editor) => [
  ...dom(editor).querySelectorAll<HTMLElement>('.cm-line.rl-trow'),
];
const cellsOf = (line: HTMLElement) => [...line.querySelectorAll<HTMLElement>(':scope > .rl-tc')];

describe('ghost columns', () => {
  it('draws a deleted column as a cell in every row at its place, in line with the others', () => {
    const editor = load('redlines', DELETED);
    expect(ghosts(editor).map((g) => g.textContent)).toEqual(['Count', '3', '7']);
    for (const [i, line] of lines(editor).entries()) {
      const cells = cellsOf(line);
      expect(cells.map((c) => c.textContent?.trim())).toEqual(
        [
          ['Fruit', 'Count', 'Price'],
          ['Apples', '3', '1.20'],
          ['Plums', '7', '2.50'],
        ][i],
      );
      // Each is a direct child of its row, the ghost between its neighbors, and the columns are numbered as drawn.
      expect(cells.map((c) => c.dataset['vcol'])).toEqual(['0', '1', '2']);
      expect(cells[1]?.classList.contains('rl-ghost-col')).toBe(true);
      expect(cells[1]?.getAttribute('role')).toBe(i === 0 ? 'columnheader' : 'cell');
      expect(cells[1]?.getAttribute('aria-label')).toBe('Deleted column');
      expect(cells[1]?.dataset['mark']).toBe('g5nb');
      expect(cells[1]?.querySelector('.rl-del')).not.toBeNull();
    }
    // The real cells keep their own numbers, the ghost has none.
    expect(cellsOf(lines(editor)[0]!).map((c) => c.dataset['col'])).toEqual(['0', undefined, '1']);
    expect(dom(editor).querySelectorAll('.rl-tbl')).toHaveLength(1);
    expect(dom(editor).textContent).not.toContain('del g5nb');
  });

  it('draws a ghost after the last column in the place of the closing pipe, the header’s too', () => {
    const doc = DELETED.replace('col=2', 'col=3');
    LEDGERS[doc] = LEDGER(['g5nb']);
    const editor = load('redlines', doc);
    for (const line of lines(editor)) {
      const cells = cellsOf(line);
      expect(cells).toHaveLength(3);
      expect(cells[2]?.classList.contains('rl-ghost-col')).toBe(true);
      expect(cells.map((c) => c.dataset['vcol'])).toEqual(['0', '1', '2']);
    }
    expect(dom(editor).textContent).not.toContain('---');
  });

  // A table with no pipe at an edge of its rows draws the ghost of the column that was there, in
  // every row, as one with the pipes does (#282): the first place has no pipe to stand in for, and
  // the last none after the cell.
  it('draws a ghost at the first, a middle and the last place of a table without outer pipes', () => {
    const rowsOf = (cells: string[][], lead: boolean, trail: boolean) =>
      cells.map((row) => `${lead ? '| ' : ''}${row.join(' | ')}${trail ? ' |' : ''}`);
    for (const [lead, trail] of [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ] as const) {
      for (const at of [0, 1, 2]) {
        const kept = [
          ['Fruit', 'Price'],
          ['-----', '-----'],
          ['Apples', '1.20'],
          ['Plums', '2.50'],
        ];
        const doc = [
          ...rowsOf(kept, lead, trail),
          '',
          `<!--del g5nb col=${at + 1} Count\\n-\\-\\-\\n3\\n7-->`,
          '',
        ].join('\n');
        LEDGERS[doc] = LEDGER(['g5nb']);
        const editor = load('redlines', doc);
        const label = `${lead ? '|' : '.'}${trail ? '|' : '.'} at ${at}`;
        expect(
          ghosts(editor).map((g) => g.textContent),
          label,
        ).toEqual(['Count', '3', '7']);
        const rows = lines(editor);
        expect(rows, label).toHaveLength(3);
        for (const [i, line] of rows.entries()) {
          const cells = cellsOf(line);
          const real = kept[i === 0 ? 0 : i + 1] ?? [];
          const want = [...real];
          want.splice(at, 0, ['Count', '3', '7'][i] ?? '');
          expect(
            cells.map((c) => c.textContent?.trim()),
            label,
          ).toEqual(want);
          expect(cells[at]?.classList.contains('rl-ghost-col'), label).toBe(true);
          expect(
            cells.map((c) => c.dataset['vcol']),
            label,
          ).toEqual(['0', '1', '2']);
          // (nothing of the row is left out of a cell: the pipes are hidden, not drawn)
          expect(line.textContent?.includes('|'), label).toBe(false);
        }
        expect(dom(editor).textContent, label).not.toContain('---');
        // The columns of Clean and Simple are the real ones, as before.
        for (const view of ['clean', 'simple'] as const) {
          const plain = load(view, doc);
          expect(ghosts(plain), label).toHaveLength(0);
          for (const line of lines(plain)) expect(cellsOf(line), label).toHaveLength(2);
        }
      }
    }
  });

  it('draws none in Clean or Simple', () => {
    for (const view of ['clean', 'simple'] as const) {
      const editor = load(view, DELETED);
      expect(ghosts(editor)).toHaveLength(0);
      for (const line of lines(editor)) expect(cellsOf(line)).toHaveLength(2);
      expect(dom(editor).textContent).not.toContain('Count');
      expect(dom(editor).querySelectorAll('.rl-del, .rl-ins-col, .rl-ghost')).toHaveLength(0);
    }
    const simple = load('simple', DELETED);
    const clean = load('clean', DELETED);
    expect(dom(simple).textContent).toBe(dom(clean).textContent);
    const redlines = load('redlines', DELETED);
    const bars = (e: Editor) => lines(e).map((row) => row.classList.contains('rl-bar'));
    expect(bars(simple)).toEqual(bars(redlines));
    expect(bars(simple)).toEqual([true, true, true]);
  });

  it('counts the ghost among the columns when it measures the widths', () => {
    const editor = load('redlines', DELETED);
    const measured = widthsOf(editor.view.state);
    const withGhost = measured[0]?.columns.length ?? 0;
    const none = load('clean', DELETED);
    expect(withGhost === 0 || withGhost === 3).toBe(true);
    expect((widthsOf(none.view.state)[0]?.columns.length ?? 2) <= 2).toBe(true);
  });

  it('is no stop of the caret: the arrow keys step from Fruit to Price', () => {
    const editor = load('redlines', DELETED);
    const { view } = editor;
    const text = view.state.doc.toString();
    view.dispatch({ selection: { anchor: text.indexOf('Fruit') + 5 } });
    const press = (key: string) =>
      runScopeHandlers(view, new KeyboardEvent('keydown', { key, bubbles: true }), 'editor');
    press('ArrowRight');
    expect(view.state.selection.main.head).toBe(text.indexOf('Price'));
    press('ArrowLeft');
    expect(view.state.selection.main.head).toBe(text.indexOf('Fruit') + 5);
  });

  it('puts no caret in a ghost when it is pressed, and its card is its deletion’s', () => {
    const editor = load('redlines', DELETED);
    const { view } = editor;
    view.dispatch({ selection: { anchor: 3 } });
    const [ghost] = ghosts(editor);
    ghost!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }),
    );
    expect(view.state.selection.main.head).toBe(3);
    expect(ghost!.closest('[data-mark]')?.getAttribute('data-mark')).toBe('g5nb');
  });

  it('draws a moved column at its new place and a ghost with a double strikethrough at the old', () => {
    const editor = load('redlines', MOVED);
    const [first] = ghosts(editor);
    expect(ghosts(editor)).toHaveLength(3);
    expect(first?.classList.contains('rl-ghost-moved')).toBe(true);
    expect(first?.getAttribute('aria-label')).toBe('Moved column');
    // Its card is the moved column's: the one at the new place.
    expect(first?.dataset['mark']).toBe('h6nb');
    const header = cellsOf(lines(editor)[0]!);
    expect(header.map((c) => c.textContent?.trim())).toEqual(['Fruit', 'Price', 'Fruit']);
    expect(header[0]?.classList.contains('rl-ghost-col')).toBe(true);
    expect(dom(editor).querySelectorAll('.rl-tc.rl-ins-col.rl-moved-col').length).toBe(3);
  });
});

describe('inserted columns', () => {
  it('tint and underline the cells of the column in Redlines, with a bar on every row', () => {
    const editor = load('redlines', INSERTED);
    const marked = [...dom(editor).querySelectorAll<HTMLElement>('.rl-tc.rl-ins-col')];
    expect(marked.length).toBe(3);
    expect(marked.every((el) => el.dataset['mark'] === 'k3x9')).toBe(true);
    for (const line of lines(editor)) {
      expect(line.classList.contains('rl-bar')).toBe(true);
      expect(cellsOf(line)[1]?.classList.contains('rl-ins-col')).toBe(true);
      expect(cellsOf(line)[0]?.classList.contains('rl-ins-col')).toBe(false);
    }
    expect(dom(editor).textContent).not.toContain('ins k3x9');
  });

  it('draw no tint or underline in Clean and Simple, with Redlines’ bars in Simple', () => {
    const redlines = load('redlines', INSERTED);
    const simple = load('simple', INSERTED);
    const clean = load('clean', INSERTED);
    const bars = (e: Editor) => lines(e).map((row) => row.classList.contains('rl-bar'));
    expect(bars(simple)).toEqual(bars(redlines));
    expect(bars(clean)).toEqual([false, false, false]);
    for (const editor of [simple, clean]) {
      expect(dom(editor).querySelectorAll('.rl-ins-col')).toHaveLength(0);
    }
    expect(dom(simple).textContent).toBe(dom(clean).textContent);
  });
});
