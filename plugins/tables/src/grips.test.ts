// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor, touchedCols, touchedRows } from '@redlines/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTables } from './index.ts';

const DOC = `Intro.\n\n| a | b |\n| - | - |\n| 11 | 12 |\n| 21 | 22 |\n| 31 | 32 |\n\nAfter.\n`;

/** Where the table is drawn: its left edge, and the top of its first row; rows are 40 px high. */
const LEFT = 100;
const TOP = 100;
let tableLeft = LEFT;

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('cm-editor')) return rect(0, 0, 800, 600);
    if (this.classList.contains('rl-tbl')) return rect(tableLeft, TOP, 400, 160);
    const line = this.closest('.rl-trow');
    // The cells are 200 px wide, side by side: the columns' boxes.
    if (this.classList.contains('rl-tc') && line && !this.classList.contains('rl-ghost-col')) {
      const index = Number(line.getAttribute('aria-rowindex')) - 1;
      return rect(tableLeft + Number(this.dataset['col']) * 200, TOP + index * 40, 200, 40);
    }
    if (this.classList.contains('rl-trow') && line) {
      const index = Number(this.getAttribute('aria-rowindex')) - 1;
      return rect(tableLeft, TOP + index * 40, 400, 40);
    }
    return rect(0, 0, 0, 0);
  });
});

const mounted: { editor: Editor; remove: () => void }[] = [];
function mount(doc = DOC, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
  });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  mounted.push({ editor, remove: createTables(editor) });
  return editor;
}
afterEach(() => {
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  tableLeft = LEFT;
});

const layer = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-grips');
const grip = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-grip');
const move = (editor: Editor, x: number, y: number) =>
  editor.view.dom.dispatchEvent(
    new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }),
  );
const mouse = (target: EventTarget, type: string, init: MouseEventInit = {}) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
/** The middle of row `n` (the header is 0). */
const rowY = (n: number) => TOP + n * 40 + 20;
const menuItems = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('.rl-grip-item')].map((el) => el.textContent);

describe('row grips', () => {
  it('draws the grip beside the hovered row, left of the change bars, in a layer hidden from assistive technology', () => {
    const editor = mount();
    expect(layer(editor)?.getAttribute('aria-hidden')).toBe('true');
    expect(grip(editor)).toBeNull();
    move(editor, LEFT + 50, rowY(2));
    expect(grip(editor)?.dataset['row']).toBe('2');
    const left = parseFloat(grip(editor)?.style.left ?? '');
    expect(left).toBeLessThan(LEFT - 24);
    // Over the strip beside the table too.
    move(editor, LEFT - 30, rowY(3));
    expect(grip(editor)?.dataset['row']).toBe('3');
    // Not over the table or its strips: none.
    move(editor, 700, rowY(1));
    expect(grip(editor)).toBeNull();
  });

  it('never leaves the window', () => {
    tableLeft = 20;
    const editor = mount();
    move(editor, 60, rowY(1));
    expect(parseFloat(grip(editor)?.style.left ?? '')).toBeGreaterThanOrEqual(4);
  });

  it('hides at the next keystroke', () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    expect(grip(editor)).not.toBeNull();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(grip(editor)).toBeNull();
  });

  it('selects the row on a press and opens its menu, with counted titles', () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    mouse(grip(editor)!, 'mousedown', { clientX: 60, clientY: rowY(2) });
    expect(touchedRows(editor.view.state)).toMatchObject({ first: 2, last: 2, rectangle: true });
    mouse(window, 'mouseup', { clientX: 60, clientY: rowY(2) });
    expect(menuItems(editor)).toEqual([
      'Insert Row Above',
      'Insert Row Below',
      'Delete Row',
      'Move Row Up',
      'Move Row Down',
      'Clear Contents',
    ]);
    // ⇧-press extends: two rows.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    move(editor, LEFT + 50, rowY(3));
    mouse(grip(editor)!, 'mousedown', { clientX: 60, clientY: rowY(3), shiftKey: true });
    mouse(window, 'mouseup', { clientX: 60, clientY: rowY(3) });
    expect(menuItems(editor)).toContain('Delete 2 Rows');
    expect(menuItems(editor)).toContain('Insert 2 Rows Above');
  });

  it('runs a menu item as its command does', () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    mouse(grip(editor)!, 'mousedown', { clientX: 60, clientY: rowY(2) });
    mouse(window, 'mouseup', { clientX: 60, clientY: rowY(2) });
    const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
      (el) => el.textContent === 'Delete Row',
    );
    mouse(item!, 'mousedown');
    expect(editor.getDoc()).not.toContain('| 21 |');
    expect(editor.getDoc()).toContain('| 11 | 12 |');
    expect(menuItems(editor)).toEqual([]);
  });

  it('clears the contents of the row with Clear Contents', () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    mouse(grip(editor)!, 'mousedown', { clientX: 60, clientY: rowY(2) });
    mouse(window, 'mouseup', { clientX: 60, clientY: rowY(2) });
    const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
      (el) => el.textContent === 'Clear Contents',
    );
    mouse(item!, 'mousedown');
    expect(editor.getDoc()).not.toContain('21');
    expect(editor.getDoc()).toContain('11');
  });

  it('closes the menu on Esc and keeps the selection', () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    mouse(grip(editor)!, 'mousedown', { clientX: 60, clientY: rowY(2) });
    mouse(window, 'mouseup', { clientX: 60, clientY: rowY(2) });
    expect(menuItems(editor)).not.toEqual([]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menuItems(editor)).toEqual([]);
    expect(touchedRows(editor.view.state)).toMatchObject({ first: 2, last: 2, rectangle: true });
  });
});

describe('column grips', () => {
  const colGrip = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-col-grip');
  const colPlus = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-col-plus');
  /** The middle of column `n`. */
  const colX = (n: number) => LEFT + n * 200 + 100;

  it('draws the grip above the hovered column, in the strip above the table', () => {
    const editor = mount();
    expect(colGrip(editor)).toBeNull();
    move(editor, colX(1), TOP - 10);
    expect(colGrip(editor)?.dataset['col']).toBe('1');
    const top = parseFloat(colGrip(editor)?.style.top ?? '');
    // In the strip above the table, which is 28 px, and in the window.
    expect(top).toBeGreaterThanOrEqual(TOP - 28);
    expect(top + 18).toBeLessThanOrEqual(TOP);
    // Over the table too, and not away from it.
    move(editor, colX(0), rowY(2));
    expect(colGrip(editor)?.dataset['col']).toBe('0');
    move(editor, colX(0), TOP - 60);
    expect(colGrip(editor)).toBeNull();
    move(editor, 700, rowY(1));
    expect(colGrip(editor)).toBeNull();
    expect(layer(editor)?.getAttribute('aria-hidden')).toBe('true');
  });

  it('selects the column on a press and opens its menu, with counted titles', () => {
    const editor = mount();
    move(editor, colX(0), TOP - 10);
    mouse(colGrip(editor)!, 'mousedown', { clientX: colX(0), clientY: TOP - 10 });
    expect(touchedCols(editor.view.state)).toMatchObject({ first: 0, last: 0, rectangle: true });
    mouse(window, 'mouseup', { clientX: colX(0), clientY: TOP - 10 });
    expect(menuItems(editor)).toEqual([
      'Insert Column Left',
      'Insert Column Right',
      'Delete Column',
      'Move Column Left',
      'Move Column Right',
      'Align Left',
      'Align Center',
      'Align Right',
      'Default Alignment',
      'Clear Contents',
    ]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    move(editor, colX(1), TOP - 10);
    mouse(colGrip(editor)!, 'mousedown', { clientX: colX(1), clientY: TOP - 10, shiftKey: true });
    mouse(window, 'mouseup', { clientX: colX(1), clientY: TOP - 10 });
    expect(menuItems(editor)).toContain('Delete 2 Columns');
    expect(menuItems(editor)).toContain('Insert 2 Columns Left');
  });

  it('runs a menu item as its command does, and Esc keeps the selection', () => {
    const editor = mount();
    move(editor, colX(1), TOP - 10);
    mouse(colGrip(editor)!, 'mousedown', { clientX: colX(1), clientY: TOP - 10 });
    mouse(window, 'mouseup', { clientX: colX(1), clientY: TOP - 10 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menuItems(editor)).toEqual([]);
    expect(touchedCols(editor.view.state)).toMatchObject({ first: 1, last: 1, rectangle: true });
    mouse(window, 'mouseup', { clientX: colX(1), clientY: TOP - 10 });
    move(editor, colX(1), TOP - 10);
    mouse(colGrip(editor)!, 'mousedown', { clientX: colX(1), clientY: TOP - 10 });
    mouse(window, 'mouseup', { clientX: colX(1), clientY: TOP - 10 });
    const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
      (el) => el.textContent === 'Delete Column',
    );
    mouse(item!, 'mousedown');
    expect(editor.getDoc()).not.toContain('| b |');
    expect(editor.getDoc()).toContain('| 11 |');
  });

  it('aligns the column from its menu, the caret’s alignment checked', () => {
    const editor = mount();
    move(editor, colX(1), TOP - 10);
    mouse(colGrip(editor)!, 'mousedown', { clientX: colX(1), clientY: TOP - 10 });
    mouse(window, 'mouseup', { clientX: colX(1), clientY: TOP - 10 });
    const checked = () =>
      [...editor.view.dom.querySelectorAll('.rl-grip-item[aria-checked="true"]')].map(
        (el) => el.textContent,
      );
    expect(checked()).toEqual(['Default Alignment']);
    const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
      (el) => el.textContent === 'Align Center',
    );
    mouse(item!, 'mousedown');
    expect(editor.getDoc()).toMatch(/\| -+ \| :-+: \|/);
    // The column is still selected, and the menu says what it has now.
    expect(touchedCols(editor.view.state)).toMatchObject({ first: 1, last: 1 });
    move(editor, colX(1), TOP - 10);
    mouse(colGrip(editor)!, 'mousedown', { clientX: colX(1), clientY: TOP - 10 });
    mouse(window, 'mouseup', { clientX: colX(1), clientY: TOP - 10 });
    expect(checked()).toEqual(['Align Center']);
  });

  it('clears the contents of the column with Clear Contents', () => {
    const editor = mount();
    move(editor, colX(1), TOP - 10);
    mouse(colGrip(editor)!, 'mousedown', { clientX: colX(1), clientY: TOP - 10 });
    mouse(window, 'mouseup', { clientX: colX(1), clientY: TOP - 10 });
    const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
      (el) => el.textContent === 'Clear Contents',
    );
    mouse(item!, 'mousedown');
    expect(editor.getDoc()).not.toContain('22');
    expect(editor.getDoc()).toContain('21');
  });

  it('shows a + within 8 px of a column boundary in the top strip, and not at 9', () => {
    const editor = mount();
    move(editor, LEFT + 200 + 9, TOP - 10);
    expect(colPlus(editor)).toBeNull();
    move(editor, LEFT + 200 + 8, TOP - 10);
    expect(colPlus(editor)?.dataset['boundary']).toBe('1');
    expect(editor.view.dom.querySelector('.rl-col-plus-line')).not.toBeNull();
    mouse(colPlus(editor)!, 'mousedown');
    const header = editor.getDoc().split('\n')[2] ?? '';
    expect(header.split('|').length).toBe(5);
    expect(editor.getDoc()).toContain('| a ');
  });

  it('writes a tracked column there when Track Changes is on', () => {
    const editor = mount(DOC, true);
    move(editor, LEFT + 400 - 4, TOP - 10);
    mouse(colPlus(editor)!, 'mousedown');
    expect(editor.getDoc().match(/<!--ins \w+ col-->/g)).toHaveLength(1);
  });
});
