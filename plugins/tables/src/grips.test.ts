// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import {
  createEditor,
  type Editor,
  moveRows,
  rectOf,
  touchedCols,
  touchedRows,
  wholeRect,
} from '@redlines/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTables } from './index.ts';

const DOC = `Intro.\n\n| a | b |\n| - | - |\n| 11 | 12 |\n| 21 | 22 |\n| 31 | 32 |\n\nAfter.\n`;

/** Where the table is drawn: its left edge, and the top of its first row; rows are 40 px high. */
const LEFT = 100;
const TOP = 100;
let tableLeft = LEFT;
/** Where a second table in the document is drawn (its top), when a test has one. */
let secondTop: number | null = null;
/** Where the paragraph after the table is drawn (its top), when a test has it near. */
let nextTop: number | null = null;

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
    if (this.classList.contains('rl-tbl')) {
      const second = secondTop !== null && this !== document.querySelector('.rl-tbl');
      return rect(tableLeft, second ? (secondTop ?? TOP) : TOP, 400, 160);
    }
    if (nextTop !== null && this.classList.contains('cm-line') && !this.closest('.rl-trow')) {
      return rect(LEFT, nextTop, 400, 24);
    }
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
  secondTop = null;
  nextTop = null;
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
  it('draws the handle beside the hovered row, close to the table edge, in a layer hidden from assistive technology', () => {
    const editor = mount();
    expect(layer(editor)?.getAttribute('aria-hidden')).toBe('true');
    expect(grip(editor)).toBeNull();
    move(editor, LEFT + 50, rowY(2));
    expect(grip(editor)?.dataset['row']).toBe('2');
    const left = parseFloat(grip(editor)?.style.left ?? '');
    // 14 px of reach, ending a hair before the table: its pill is close to the table, not floating off.
    expect(left + 14).toBeLessThanOrEqual(LEFT);
    expect(LEFT - (left + 14)).toBeLessThanOrEqual(4);
    // Over the strip beside the table too.
    move(editor, LEFT - 30, rowY(3));
    expect(grip(editor)?.dataset['row']).toBe('3');
    // Not over the table or its strips: none.
    move(editor, 700, rowY(1));
    expect(grip(editor)).toBeNull();
  });

  it('shows a hint on the grip after the title bar delay, and not before', () => {
    vi.useFakeTimers();
    try {
      const editor = mount();
      move(editor, LEFT + 50, rowY(2));
      const el = grip(editor);
      expect(el?.getAttribute('aria-label')).toMatch(/move the row/);
      const tip = () => editor.view.dom.querySelector<HTMLElement>('.rl-grip-hint');
      el?.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(399);
      expect(tip()?.hidden).toBe(true);
      vi.advanceTimersByTime(1);
      expect(tip()?.hidden).toBe(false);
      expect(tip()?.textContent).toMatch(/move the row/);
      el?.dispatchEvent(new MouseEvent('mouseleave'));
      expect(tip()?.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never leaves the window', () => {
    tableLeft = 20;
    const editor = mount();
    move(editor, 60, rowY(1));
    expect(parseFloat(grip(editor)?.style.left ?? '')).toBeGreaterThanOrEqual(4);
  });

  it('moves up to the table when the margin is narrow, and stays 4 px inside the window', () => {
    for (const [table, near] of [
      [48, 4],
      [30, 4],
    ] as const) {
      tableLeft = table;
      const editor = mount();
      move(editor, table + 50, rowY(1));
      const left = parseFloat(grip(editor)?.style.left ?? '');
      // 14 px of reach: its right edge is close to the table's, never over it.
      expect(left + 14).toBeLessThanOrEqual(table);
      expect(table - (left + 14)).toBeLessThanOrEqual(near);
      expect(left).toBeGreaterThanOrEqual(4);
    }
  });

  it('hides at the next keystroke', () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    expect(grip(editor)).not.toBeNull();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(grip(editor)).toBeNull();
  });

  it('selects the row when a click is released, and opens no menu', () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    mouse(grip(editor)!, 'mousedown', { clientX: 60, clientY: rowY(2) });
    // Nothing is highlighted before the release.
    expect(rectOf(editor.view.state)).toBeNull();
    mouse(window, 'mouseup', { clientX: 60, clientY: rowY(2) });
    expect(touchedRows(editor.view.state)).toMatchObject({ first: 2, last: 2, rectangle: true });
    expect(menuItems(editor)).toEqual([]);
  });

  it('selects the row on a right-click and opens its menu, with counted titles', () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    mouse(grip(editor)!, 'contextmenu', { clientX: 60, clientY: rowY(2) });
    expect(touchedRows(editor.view.state)).toMatchObject({ first: 2, last: 2, rectangle: true });
    expect(menuItems(editor)).toEqual([
      'Insert Row Above',
      'Insert Row Below',
      'Delete Row',
      'Delete Table',
      'Move Row Up',
      'Move Row Down',
      'Clear Contents',
    ]);
    // ⇧-press extends: two rows.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    move(editor, LEFT + 50, rowY(3));
    mouse(grip(editor)!, 'contextmenu', { clientX: 60, clientY: rowY(3), shiftKey: true });
    expect(menuItems(editor)).toContain('Delete 2 Rows');
    expect(menuItems(editor)).toContain('Insert 2 Rows Above');
  });

  it('runs a menu item as its command does', () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    mouse(grip(editor)!, 'contextmenu', { clientX: 60, clientY: rowY(2) });
    const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
      (el) => el.textContent === 'Delete Row',
    );
    mouse(item!, 'mousedown');
    expect(editor.getDoc()).not.toContain('| 21 |');
    expect(editor.getDoc()).toContain('| 11 | 12 |');
    expect(menuItems(editor)).toEqual([]);
  });

  it('is used from the keyboard: arrows choose, Return runs, Escape closes (#1248)', async () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    mouse(grip(editor)!, 'contextmenu', { clientX: 60, clientY: rowY(2) });
    const key = (k: string, init: KeyboardEventInit = {}) =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
    const chosen = () => document.activeElement?.textContent;
    expect(menuItems(editor).length).toBeGreaterThan(0);
    expect(chosen(), 'nothing is chosen until a key').not.toBe('Insert Row Above');
    key('ArrowDown');
    expect(chosen()).toBe('Insert Row Above');
    key('ArrowDown');
    expect(chosen()).toBe('Insert Row Below');
    key('ArrowUp');
    expect(chosen()).toBe('Insert Row Above');
    key('ArrowUp');
    expect(chosen(), 'it wraps').toBe('Clear Contents');
    key('Home');
    expect(chosen()).toBe('Insert Row Above');
    key('Tab');
    expect(chosen(), 'Tab goes on, inside the menu').toBe('Insert Row Below');
    key('Tab', { shiftKey: true });
    expect(chosen()).toBe('Insert Row Above');
    key('ArrowDown');
    key('ArrowDown');
    expect(chosen()).toBe('Delete Row');
    key('Enter');
    expect(editor.getDoc(), 'Return runs the chosen item').not.toContain('| 21 |');
    expect(menuItems(editor)).toEqual([]);
    // Escape closes it, and the document has the keys again.
    move(editor, LEFT + 50, rowY(1));
    mouse(grip(editor)!, 'contextmenu', { clientX: 60, clientY: rowY(1) });
    key('ArrowDown');
    key('Escape');
    expect(menuItems(editor)).toEqual([]);
    await Promise.resolve();
    expect(document.activeElement, 'the document has the keys again').toBe(editor.view.contentDOM);
  });

  it('disables Move Row Up at the first row and Move Row Down at the last, with the reason', () => {
    const editor = mount();
    const items = () => [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-grip-item')];
    const named = (name: string) => items().find((el) => el.textContent === name);
    const lastRow = (DOC.match(/^\| /gm) ?? []).length - 2;
    move(editor, LEFT + 50, rowY(0));
    mouse(grip(editor)!, 'contextmenu', { clientX: 60, clientY: rowY(0) });
    expect(named('Move Row Up')?.getAttribute('aria-disabled')).toBe('true');
    expect(named('Move Row Up')?.title).toBe('The row is at the top.');
    expect(named('Move Row Down')?.hasAttribute('aria-disabled')).toBe(false);
    // A click on a disabled item does nothing and leaves the menu open.
    const before = editor.getDoc();
    mouse(named('Move Row Up')!, 'mousedown');
    expect(editor.getDoc()).toBe(before);
    expect(items().length).toBeGreaterThan(0);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    move(editor, LEFT + 50, rowY(lastRow));
    mouse(grip(editor)!, 'contextmenu', { clientX: 60, clientY: rowY(lastRow) });
    expect(named('Move Row Down')?.getAttribute('aria-disabled')).toBe('true');
    expect(named('Move Row Down')?.title).toBe('The row is at the bottom.');
    expect(named('Move Row Up')?.hasAttribute('aria-disabled')).toBe(false);
  });

  it('clears the contents of the row with Clear Contents', () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    mouse(grip(editor)!, 'contextmenu', { clientX: 60, clientY: rowY(2) });
    const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
      (el) => el.textContent === 'Clear Contents',
    );
    mouse(item!, 'mousedown');
    expect(editor.getDoc()).not.toContain('21');
    expect(editor.getDoc()).toContain('11');
  });

  it('deletes the table from the menu, as the command does', () => {
    for (const tracking of [false, true]) {
      const editor = mount(DOC, tracking);
      move(editor, LEFT + 50, rowY(2));
      mouse(grip(editor)!, 'contextmenu', { clientX: 60, clientY: rowY(2) });
      const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
        (el) => el.textContent === 'Delete Table',
      );
      mouse(item!, 'mousedown');
      expect(menuItems(editor)).toEqual([]);
      if (tracking) expect(editor.getDoc()).toMatch(/<!--del \w{4} /);
      else expect(editor.getDoc()).toBe('Intro.\n\nAfter.\n');
    }
  });

  it('closes the menu on Esc and keeps the selection', () => {
    const editor = mount();
    move(editor, LEFT + 50, rowY(2));
    mouse(grip(editor)!, 'contextmenu', { clientX: 60, clientY: rowY(2) });
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
    // Close to the table's top edge: its pill is not floating above it.
    expect(top + 14).toBeLessThanOrEqual(TOP);
    expect(TOP - (top + 14)).toBeLessThanOrEqual(4);
    // Over the table too, and not away from it.
    move(editor, colX(0), rowY(2));
    expect(colGrip(editor)?.dataset['col']).toBe('0');
    move(editor, colX(0), TOP - 60);
    expect(colGrip(editor)).toBeNull();
    move(editor, 700, rowY(1));
    expect(colGrip(editor)).toBeNull();
    expect(layer(editor)?.getAttribute('aria-hidden')).toBe('true');
  });

  it('measures the columns again when the table has been scrolled sideways in its box', () => {
    const editor = mount();
    move(editor, colX(0), TOP - 10);
    expect(colGrip(editor)?.dataset['col']).toBe('0');
    // The box scrolls the table 200 px left: what was column 1 is where column 0 was. The page, the
    // text and the table's top are as they were; only its left edge has moved.
    tableLeft = LEFT - 200;
    move(editor, colX(0), TOP - 10);
    expect(colGrip(editor)?.dataset['col']).toBe('1');
  });

  it('puts the grips away when the table scrolls in its box, which no event of the editor tells', () => {
    const editor = mount();
    move(editor, colX(0), TOP - 10);
    expect(colGrip(editor)).not.toBeNull();
    // A scroll event does not bubble: it is heard by its capture, from whatever scrolls in the page.
    editor.view.dom
      .querySelector('.rl-tbl-scroll')!
      .dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(colGrip(editor)).toBeNull();
    move(editor, LEFT + 50, rowY(2));
    expect(grip(editor)).not.toBeNull();
    editor.view.dom
      .querySelector('.rl-tbl-scroll')!
      .dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(grip(editor)).toBeNull();
  });

  it('selects the column when a click is released, and opens no menu', () => {
    const editor = mount();
    move(editor, colX(0), TOP - 10);
    mouse(colGrip(editor)!, 'mousedown', { clientX: colX(0), clientY: TOP - 10 });
    expect(rectOf(editor.view.state)).toBeNull();
    mouse(window, 'mouseup', { clientX: colX(0), clientY: TOP - 10 });
    expect(touchedCols(editor.view.state)).toMatchObject({ first: 0, last: 0, rectangle: true });
    expect(menuItems(editor)).toEqual([]);
  });

  it('selects the column on a right-click and opens its menu, with counted titles', () => {
    const editor = mount();
    move(editor, colX(0), TOP - 10);
    mouse(colGrip(editor)!, 'contextmenu', { clientX: colX(0), clientY: TOP - 10 });
    expect(touchedCols(editor.view.state)).toMatchObject({ first: 0, last: 0, rectangle: true });
    expect(menuItems(editor)).toEqual([
      'Insert Column Left',
      'Insert Column Right',
      'Delete Column',
      'Delete Table',
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
    mouse(colGrip(editor)!, 'contextmenu', { clientX: colX(1), clientY: TOP - 10, shiftKey: true });
    expect(menuItems(editor)).toContain('Delete 2 Columns');
    expect(menuItems(editor)).toContain('Insert 2 Columns Left');
  });

  it('runs a menu item as its command does, and Esc keeps the selection', () => {
    const editor = mount();
    move(editor, colX(1), TOP - 10);
    mouse(colGrip(editor)!, 'contextmenu', { clientX: colX(1), clientY: TOP - 10 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menuItems(editor)).toEqual([]);
    expect(touchedCols(editor.view.state)).toMatchObject({ first: 1, last: 1, rectangle: true });
    mouse(window, 'mouseup', { clientX: colX(1), clientY: TOP - 10 });
    move(editor, colX(1), TOP - 10);
    mouse(colGrip(editor)!, 'contextmenu', { clientX: colX(1), clientY: TOP - 10 });
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
    mouse(colGrip(editor)!, 'contextmenu', { clientX: colX(1), clientY: TOP - 10 });
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
    mouse(colGrip(editor)!, 'contextmenu', { clientX: colX(1), clientY: TOP - 10 });
    expect(checked()).toEqual(['Align Center']);
  });

  it('aligns the column from its menu with Track Changes on: a point mark in the header, the column still selected and checked', () => {
    // The mark ends the header's last cell whichever column is aligned: it is the table's, not the column's.
    for (const [col, title, written] of [
      [1, 'Align Center', /\| a \| b<!--fmt \w{4} align=[^>]*--> \|\n\| - \| :-: \|\n/],
      [0, 'Align Right', /\| a \| b<!--fmt \w{4} align=[^>]*--> \|\n\| -: \| - \|\n/],
    ] as const) {
      const editor = mount(DOC, true);
      const open = () => {
        move(editor, colX(col), TOP - 10);
        mouse(colGrip(editor)!, 'contextmenu', { clientX: colX(col), clientY: TOP - 10 });
      };
      const checked = () =>
        [...editor.view.dom.querySelectorAll('.rl-grip-item[aria-checked="true"]')].map(
          (el) => el.textContent,
        );
      open();
      expect(checked(), title).toEqual(['Default Alignment']);
      const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
        (el) => el.textContent === title,
      );
      mouse(item!, 'mousedown');
      expect(editor.getDoc(), title).toMatch(written);
      expect(editor.getDoc().match(/<!--fmt /g), title).toHaveLength(1);
      // The column is still selected, and the menu says what it has now.
      expect(touchedCols(editor.view.state), title).toMatchObject({ first: col, last: col });
      open();
      expect(checked(), title).toEqual([title]);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
  });

  it('clears the contents of the column with Clear Contents', () => {
    const editor = mount();
    move(editor, colX(1), TOP - 10);
    mouse(colGrip(editor)!, 'contextmenu', { clientX: colX(1), clientY: TOP - 10 });
    const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
      (el) => el.textContent === 'Clear Contents',
    );
    mouse(item!, 'mousedown');
    expect(editor.getDoc()).not.toContain('22');
    expect(editor.getDoc()).toContain('21');
  });

  for (const tracking of [false, true]) {
    it(`clears the cell of a column that is one cell, with Clear Contents, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      // A table of a header alone: the column is the header's cell, and one cell is no rectangle.
      const doc = 'Intro.\n\n| a | b |\n| - | - |\n\nAfter.\n';
      const editor = mount(doc, tracking);
      move(editor, colX(1), TOP - 10);
      mouse(colGrip(editor)!, 'contextmenu', { clientX: colX(1), clientY: TOP - 10 });
      expect(rectOf(editor.view.state)).toBeNull();
      const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
        (el) => el.textContent === 'Clear Contents',
      );
      mouse(item!, 'mousedown');
      // The cell of the column goes, and the other is as it was.
      if (tracking) {
        expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['del']);
        expect(editor.getDoc()).toContain('| a | <!--del ');
        expect(editor.getDoc()).toContain('| a |');
      } else {
        expect(editor.getDoc()).toBe('Intro.\n\n| a |  |\n| - | - |\n\nAfter.\n');
      }
      expect(editor.getDoc()).toContain('| - | - |');
    });

    it(`clears the cell of a row that is one cell, with Clear Contents, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      // A table of one column and a header alone: the row is that one cell.
      const doc = 'Intro.\n\n| a |\n| - |\n\nAfter.\n';
      const editor = mount(doc, tracking);
      move(editor, LEFT + 30, rowY(0));
      mouse(grip(editor)!, 'contextmenu', { clientX: LEFT - 20, clientY: rowY(0) });
      expect(rectOf(editor.view.state)).toBeNull();
      const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
        (el) => el.textContent === 'Clear Contents',
      );
      mouse(item!, 'mousedown');
      if (tracking) {
        expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['del']);
      } else {
        expect(editor.getDoc()).toBe('Intro.\n\n|  |\n| - |\n\nAfter.\n');
      }
    });

    it(`deletes the table from the column menu, as the command does, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      const editor = mount(DOC, tracking);
      move(editor, colX(1), TOP - 10);
      mouse(colGrip(editor)!, 'contextmenu', { clientX: colX(1), clientY: TOP - 10 });
      const item = [...editor.view.dom.querySelectorAll('.rl-grip-item')].find(
        (el) => el.textContent === 'Delete Table',
      );
      mouse(item!, 'mousedown');
      expect(menuItems(editor)).toEqual([]);
      if (tracking) {
        // One deletion of the table, kept in the file where it was, and nothing else written.
        expect(editor.getParsed().marks.map((mark) => mark.kind)).toEqual(['del']);
        expect(editor.getDoc().startsWith('Intro.\n\n<!--del ')).toBe(true);
        expect(editor.getDoc()).toContain('-->\n\nAfter.\n');
        expect(editor.getDoc()).not.toContain('\n| a | b |');
      } else {
        expect(editor.getDoc()).toBe('Intro.\n\nAfter.\n');
      }
    });
  }

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

describe('edge widgets', () => {
  const q = (editor: Editor, selector: string) =>
    editor.view.dom.querySelector<HTMLElement>(selector);
  /** The table: 400 px wide from LEFT, 160 tall from TOP (four rows). */
  const RIGHT = LEFT + 400;
  const BOTTOM = TOP + 160;

  it('shows Add column right of the table over its rightmost column, and not over the first', () => {
    const editor = mount();
    move(editor, LEFT + 100, TOP + 60);
    expect(q(editor, '.rl-edge-col')).toBeNull();
    move(editor, LEFT + 300, TOP + 60);
    const widget = q(editor, '.rl-edge-col');
    expect(widget).not.toBeNull();
    // 4 px right of the table, as tall as it.
    expect(parseFloat(widget?.style.left ?? '')).toBe(RIGHT + 4);
    expect(parseFloat(widget?.style.height ?? '')).toBe(160);
    // Reached from the table: it stays while the pointer is over it.
    move(editor, RIGHT + 12, TOP + 60);
    expect(q(editor, '.rl-edge-col')).not.toBeNull();
    move(editor, RIGHT + 60, TOP + 60);
    expect(q(editor, '.rl-edge-col')).toBeNull();
  });

  it('shows Add row below the table over its bottom row, and not over the first row', () => {
    const editor = mount();
    move(editor, LEFT + 100, TOP + 60);
    expect(q(editor, '.rl-edge-row')).toBeNull();
    move(editor, LEFT + 100, BOTTOM - 10);
    const widget = q(editor, '.rl-edge-row');
    expect(widget).not.toBeNull();
    expect(parseFloat(widget?.style.top ?? '')).toBe(BOTTOM + 4);
    expect(parseFloat(widget?.style.width ?? '')).toBe(400);
  });

  it('makes Add row shorter where the next paragraph is near, so it never covers its first line (#631)', () => {
    nextTop = BOTTOM + 14;
    const editor = mount();
    move(editor, LEFT + 100, BOTTOM - 10);
    const widget = q(editor, '.rl-edge-row');
    expect(widget).not.toBeNull();
    const height = parseFloat(widget?.style.height ?? '');
    // 4 px under the table, ending 2 px above the paragraph.
    expect(BOTTOM + 4 + height).toBeLessThanOrEqual(BOTTOM + 14);
    expect(height).toBeGreaterThanOrEqual(8);
    // With the paragraph far, the strip is its full 20 px.
    nextTop = BOTTOM + 80;
    move(editor, LEFT + 300, BOTTOM - 10);
    move(editor, LEFT + 100, BOTTOM - 10);
    expect(parseFloat(q(editor, '.rl-edge-row')?.style.height ?? '')).toBe(20);
  });

  it('adds a column at the end, and a row at the end, on a click', () => {
    const editor = mount();
    move(editor, LEFT + 300, TOP + 60);
    mouse(q(editor, '.rl-edge-col')!, 'mousedown');
    expect((editor.getDoc().split('\n')[2] ?? '').split('|').length).toBe(5);
    move(editor, LEFT + 100, BOTTOM - 10);
    mouse(q(editor, '.rl-edge-row')!, 'mousedown');
    expect(
      editor
        .getDoc()
        .split('\n')
        .filter((l) => l.startsWith('|')).length,
    ).toBe(6);
  });

  it('writes tracked insertions with Track Changes on', () => {
    const editor = mount(DOC, true);
    move(editor, LEFT + 300, TOP + 60);
    mouse(q(editor, '.rl-edge-col')!, 'mousedown');
    expect(editor.getDoc().match(/<!--ins \w+ col-->/g)).toHaveLength(1);
    move(editor, LEFT + 100, BOTTOM - 10);
    mouse(q(editor, '.rl-edge-row')!, 'mousedown');
    expect(editor.getDoc()).toMatch(/<!--ins \w+ row-->/);
  });

  it('selects the whole table from the corner widget', () => {
    const editor = mount();
    move(editor, LEFT + 100, TOP + 60);
    const corner = q(editor, '.rl-table-select');
    expect(corner).not.toBeNull();
    // Close to the table's corner, not over it.
    expect(parseFloat(corner?.style.left ?? '') + 16).toBeLessThanOrEqual(LEFT);
    expect(parseFloat(corner?.style.top ?? '') + 16).toBeLessThanOrEqual(TOP);
    mouse(corner!, 'mousedown');
    const rect = rectOf(editor.view.state);
    expect(rect?.table.rows.length).toBe(4);
    expect(touchedRows(editor.view.state)?.first).toBe(0);
    expect(touchedRows(editor.view.state)?.last).toBe(3);
    expect(touchedCols(editor.view.state)?.last).toBe(1);
  });

  it('go at the next keystroke', () => {
    const editor = mount();
    move(editor, LEFT + 300, BOTTOM - 10);
    expect(q(editor, '.rl-edge-col')).not.toBeNull();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(q(editor, '.rl-edge-col')).toBeNull();
    expect(q(editor, '.rl-edge-row')).toBeNull();
    expect(q(editor, '.rl-table-select')).toBeNull();
  });
});

describe('edge widgets, the corner and crowding', () => {
  const q = (editor: Editor, selector: string) =>
    editor.view.dom.querySelector<HTMLElement>(selector);

  it('keeps the corner square while the pointer moves along the strips, and over it no + takes it', () => {
    const editor = mount();
    // Over the corner's lower half, where the + at the first row boundary would be: the square stays.
    move(editor, LEFT - 8, TOP - 6);
    expect(q(editor, '.rl-table-select')).not.toBeNull();
    expect(q(editor, '.rl-plus')).toBeNull();
    // Along the left strip at the boundary between two rows: the + shows and the square stays.
    move(editor, LEFT - 8, TOP + 40);
    expect(q(editor, '.rl-plus')).not.toBeNull();
    expect(q(editor, '.rl-table-select')).not.toBeNull();
  });

  it('shows no Add row where another table is within the reach of its own strip', () => {
    const editor = mount(`${DOC}\n| x | y |\n| - | - |\n| 1 | 2 |\n\nEnd.\n`);
    // Alone, the bottom row has its Add row.
    secondTop = TOP + 1000;
    move(editor, LEFT + 100, TOP + 160 - 10);
    expect(q(editor, '.rl-edge-row')).not.toBeNull();
    move(editor, 700, 700);
    // The second table is 20 px below the first: its strip above it is where Add row would be.
    secondTop = TOP + 160 + 20;
    move(editor, LEFT + 100, TOP + 160 - 10);
    expect(q(editor, '.rl-edge-row')).toBeNull();
  });
});

describe('whole rows through the grip when the last selected row is shorter (#455)', () => {
  const SHORT = `Intro.\n\n| a | b | c |\n| - | - | - |\n| 11 | 12 | 13 |\n| 21 |\n| 31 | 32 | 33 |\n\nAfter.\n`;
  it('keeps moved rows selected whole when the last of them is shorter (rowsSelected)', () => {
    const editor = mount(SHORT);
    move(editor, LEFT + 50, rowY(1));
    mouse(grip(editor)!, 'mousedown', { clientX: 60, clientY: rowY(1), button: 0 });
    mouse(window, 'mouseup', { clientX: 60, clientY: rowY(1) });
    move(editor, LEFT + 50, rowY(2));
    mouse(grip(editor)!, 'mousedown', {
      clientX: 60,
      clientY: rowY(2),
      button: 0,
      shiftKey: true,
    });
    mouse(window, 'mouseup', { clientX: 60, clientY: rowY(2) });
    // Rows 1 and 2 move down one place, after the row 31: they stay selected as whole rows.
    expect(moveRows(editor.view, false)).toBe(true);
    const rect = rectOf(editor.view.state);
    expect(rect?.rows).toEqual([2, 3]);
    expect(rect?.cols, 'all three columns').toEqual([0, 2]);
    expect(rect && wholeRect(rect)).toBe('row');
  });

  for (const tracking of [false, true]) {
    it(`selects the rows whole, and ⌫⌫ deletes them, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      const editor = mount(SHORT, tracking);
      // The grip over row 1, then ⇧ over row 2 (the short one): a click and its release each.
      move(editor, LEFT + 50, rowY(1));
      mouse(grip(editor)!, 'mousedown', { clientX: 60, clientY: rowY(1), button: 0 });
      mouse(window, 'mouseup', { clientX: 60, clientY: rowY(1) });
      move(editor, LEFT + 50, rowY(2));
      mouse(grip(editor)!, 'mousedown', {
        clientX: 60,
        clientY: rowY(2),
        button: 0,
        shiftKey: true,
      });
      mouse(window, 'mouseup', { clientX: 60, clientY: rowY(2) });
      const rect = rectOf(editor.view.state);
      expect(rect?.rows, 'rows 1 and 2').toEqual([1, 2]);
      expect(rect?.cols, 'all three columns').toEqual([0, 2]);
      expect(rect && wholeRect(rect), 'whole rows').toBe('row');
      // ⌫ clears the cells, ⌫ again deletes the rows.
      const back = () =>
        runScopeHandlers(
          editor.view,
          new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }),
          'editor',
        );
      expect(back()).toBe(true);
      expect(back()).toBe(true);
      const doc = editor.getDoc();
      if (tracking) {
        // The rows are tracked deletions, not gone: their text stays in the file for the decision.
        expect(editor.getParsed().marks.some((mark) => mark.kind === 'del')).toBe(true);
      } else {
        expect(doc).not.toContain('| 11 |');
        expect(doc).not.toContain('| 21 |');
      }
      expect(doc).toContain('| 31 | 32 | 33 |');
    });
  }
});

describe('the widgets share the look of the app (#672)', () => {
  it('draws them on the card ground with the theme shadow, and the + and the strips in one rule', async () => {
    const { GRIPS_STYLE } = await import('./grips.ts');
    expect(GRIPS_STYLE).not.toContain('--rl-page');
    // Only the handles, drawn as the picture's resize handles are (#1199), have a shadow of their own.
    const own = GRIPS_STYLE.match(/box-shadow:\s*0 [^;]*;/g) ?? [];
    expect(own).toHaveLength(2);
    expect(new Set(own).size).toBe(1);
    expect(GRIPS_STYLE).toMatch(/\.rl-plus, \.rl-col-plus, \.rl-edge-add \{\s*cursor: pointer;/);
  });

  it('draws the grips and the select-table handle as the picture handles: white, hairline, shadow (#1199)', async () => {
    const { GRIPS_STYLE } = await import('./grips.ts');
    const pill =
      /\.rl-grip::before, \.rl-col-grip::before \{[^}]*background: #fff;[^}]*box-shadow: ([^;]*);/.exec(
        GRIPS_STYLE,
      );
    const select =
      /\.rl-table-select \{\s*cursor: grab;[^}]*background: #fff;[^}]*box-shadow: ([^;]*);/.exec(
        GRIPS_STYLE,
      );
    expect(pill?.[1], 'the pill').toBeDefined();
    expect(select?.[1], 'the select-table handle has the pill’s shadow').toBe(pill?.[1]);
  });
});
