// @vitest-environment happy-dom
// Deleted rows drawn where they were (design: tables, "How it shows"; format §3.7).
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import type { ViewMode } from '../api.ts';
import { createEditor, type Editor } from '../index.ts';
import { runScopeHandlers } from '@codemirror/view';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const LEDGER =
  '\n<!-- redlines\nversion: 1\nmarks:\n  g5nb: {by: bo, at: 2026-11-01T10:00Z}\n  h6nb: {by: bo, at: 2026-11-01T10:00Z, move: j7nb}\n  j7nb: {by: bo, at: 2026-11-01T10:00Z, move: h6nb}\n-->\n';
const DELETED = [
  '| Fruit | Count |',
  '| ----- | ----- |',
  '| Apples | 3 |',
  '| Plums | 7 |',
  '',
  '<!--del g5nb row=2 \\| Pears \\| 5 \\|-->',
  '',
].join('\n');
const MOVED = [
  '| Fruit | Count |',
  '| ----- | ----- |',
  '| <!--ins h6nb row--> Plums | 7 |',
  '| Apples | 3 |',
  '| Pears | 5 |',
  '',
  '<!--del j7nb row=4 \\| Plums \\| 7 \\|-->',
  '',
].join('\n');

function load(view: ViewMode, doc: string): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: `${doc}${LEDGER}`,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    view,
    tracking: false,
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}
const dom = (editor: Editor) => editor.view.contentDOM;
const ghosts = (editor: Editor) => [...dom(editor).querySelectorAll<HTMLElement>('.rl-ghost')];
const text = (el: Element) => [...el.querySelectorAll('.rl-tc')].map((c) => c.textContent);
// (The struck text is a `.rl-del` span in each cell, as a deleted block's is.)

describe('ghost rows', () => {
  it('draws a deleted row at its place in Redlines, inside the table, as a row of cells', () => {
    const editor = load('redlines', DELETED);
    const [ghost] = ghosts(editor);
    expect(ghosts(editor)).toHaveLength(1);
    expect(text(ghost!)).toEqual(['Pears', '5']);
    expect(ghost!.getAttribute('role')).toBe('row');
    expect(ghost!.getAttribute('aria-label')).toBe('Deleted row');
    expect(ghost!.closest('.rl-tbl')).not.toBeNull();
    // At its place: between Apples and Plums.
    const rows = [...dom(editor).querySelectorAll('.rl-tbl > *')].map((el) =>
      el.classList.contains('rl-ghost') ? 'ghost' : el.textContent?.trim().slice(0, 6),
    );
    expect(rows.slice(-3)).toEqual(['Apples', 'ghost', 'Plums7']);
    expect(ghost!.matches('.rl-bar')).toBe(true);
    expect(ghost!.dataset['mark']).toBe('g5nb');
  });

  it('draws a ghost after the last row inside the wrapper', () => {
    const doc = DELETED.replace('row=2', 'row=3');
    const editor = load('redlines', doc);
    const children = [...dom(editor).querySelectorAll('.rl-tbl > *')];
    expect(children.at(-1)?.classList.contains('rl-ghost')).toBe(true);
    expect(children.at(-2)?.textContent?.trim()).toContain('Plums');
  });

  it('draws none in Clean or Simple, and hides the deletion line and the blank line before it', () => {
    for (const view of ['clean', 'simple'] as const) {
      const editor = load(view, DELETED);
      expect(ghosts(editor)).toHaveLength(0);
      expect(dom(editor).textContent).not.toContain('Pears');
      expect(dom(editor).textContent).not.toContain('del g5nb');
      expect([...dom(editor).querySelectorAll('.cm-line')].length).toBeLessThanOrEqual(4);
    }
    const redlines = load('redlines', DELETED);
    expect(dom(redlines).textContent).not.toContain('del g5nb');
    // The wrapper holds the table's rows and the ghost, no more: the blank line is in none.
    expect(dom(redlines).querySelectorAll('.rl-tbl > .cm-line')).toHaveLength(3);
  });

  it('draws a moved row at its new place and a ghost with a double strikethrough at the old', () => {
    const editor = load('redlines', MOVED);
    const [ghost] = ghosts(editor);
    expect(ghost!.classList.contains('rl-ghost-moved')).toBe(true);
    expect(ghost!.getAttribute('aria-label')).toBe('Moved row');
    // Its card is the moved row's.
    expect(ghost!.dataset['mark']).toBe('h6nb');
    const lines = [...dom(editor).querySelectorAll<HTMLElement>('.cm-line.rl-trow')];
    expect(lines[1]!.classList.contains('rl-moved-row')).toBe(true);
    expect(lines[1]!.classList.contains('rl-ins-row')).toBe(true);
    // The ghost is after the last row, where Plums was.
    const children = [...dom(editor).querySelectorAll('.rl-tbl > *')];
    expect(children.at(-1)).toBe(ghost);
  });

  it('is no row of the document: the text has no more lines and no caret stops there', () => {
    const editor = load('redlines', DELETED);
    const lines = editor.view.state.doc.lines;
    expect(lines).toBeGreaterThan(5);
    expect(dom(editor).querySelectorAll('.rl-tbl > .cm-line')).toHaveLength(3);
  });
});

describe('the caret and the pointer around ghosts', () => {
  it('moves ↓ from the row above a ghost to the row below it, and ↑ back', () => {
    const editor = load('redlines', DELETED);
    const { view } = editor;
    const apples = view.state.doc.toString().indexOf('Apples');
    view.dispatch({ selection: { anchor: apples + 2 } });
    const press = (key: string) =>
      runScopeHandlers(view, new KeyboardEvent('keydown', { key, bubbles: true }), 'editor');
    expect(press('ArrowDown')).toBe(true);
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    expect(line.text).toContain('Plums');
    expect(press('ArrowUp')).toBe(true);
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toContain('Apples');
  });

  it('puts no caret in a ghost when it is pressed', () => {
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
});

describe('Simple', () => {
  it('draws no tint, underline or ghost for rows inserted, moved or deleted, with Redlines’ bars', () => {
    const simple = load('simple', MOVED);
    const clean = load('clean', MOVED);
    const redlines = load('redlines', MOVED);
    const rows = (e: Editor) => [...dom(e).querySelectorAll<HTMLElement>('.cm-line.rl-trow')];
    const bars = (e: Editor) => rows(e).map((row) => row.classList.contains('rl-bar'));
    expect(bars(simple)).toEqual(bars(redlines));
    expect(bars(simple)).toContain(true);
    for (const row of rows(simple)) {
      expect(row.classList.contains('rl-ins-row')).toBe(false);
      expect(row.classList.contains('rl-moved-row')).toBe(false);
    }
    expect(ghosts(simple)).toHaveLength(0);
    expect(dom(simple).querySelectorAll('.rl-del, .rl-ins')).toHaveLength(0);
    expect(dom(simple).textContent).toBe(dom(clean).textContent);
    const deleted = load('simple', DELETED);
    expect(dom(deleted).textContent).toBe(dom(load('clean', DELETED)).textContent);
    expect(dom(deleted).textContent).not.toContain('Pears');
  });
});
