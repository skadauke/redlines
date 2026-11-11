// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropBoundary, scrollSpeed } from './drag.ts';
import { createTables } from './index.ts';
import { boundariesOf, plusBoundary } from './plus.ts';

describe('dropBoundary', () => {
  const tops = [100, 140, 180, 220, 260];
  it('is the boundary nearest the pointer, the last included', () => {
    expect(dropBoundary(90, tops)).toBe(0);
    expect(dropBoundary(118, tops)).toBe(0);
    expect(dropBoundary(122, tops)).toBe(1);
    expect(dropBoundary(250, tops)).toBe(4);
    expect(dropBoundary(900, tops)).toBe(4);
  });

  it('scrolls the page near its edges only', () => {
    expect(scrollSpeed(300, 0, 600)).toBe(0);
    expect(scrollSpeed(5, 0, 600)).toBeLessThan(0);
    expect(scrollSpeed(595, 0, 600)).toBeGreaterThan(0);
  });
});

describe('plusBoundary', () => {
  const edges = boundariesOf([
    { top: 100, bottom: 140 },
    { top: 140, bottom: 180 },
  ]);
  it('is near a boundary at 8 px and not at 9', () => {
    expect(edges).toEqual([100, 140, 180]);
    expect(plusBoundary(148, edges)).toBe(1);
    expect(plusBoundary(149, edges)).toBeNull();
    expect(plusBoundary(92, edges)).toBe(0);
    expect(plusBoundary(91, edges)).toBeNull();
    expect(plusBoundary(188, edges)).toBe(2);
  });
});

const DOC = `Intro.\n\n| a | b |\n| - | - |\n| 11 | 12 |\n| 21 | 22 |\n| 31 | 32 |\n\nAfter.\n`;
const LEFT = 100;
const TOP = 100;
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
    if (this.classList.contains('rl-tbl')) return rect(LEFT, TOP, 400, 160);
    if (this.classList.contains('rl-trow')) {
      return rect(LEFT, TOP + (Number(this.getAttribute('aria-rowindex')) - 1) * 40, 400, 40);
    }
    return rect(0, 0, 0, 0);
  });
});

const mounted: { editor: Editor; remove: () => void }[] = [];
function mount(tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: DOC,
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
});

const rowY = (n: number) => TOP + n * 40 + 20;
const move = (editor: Editor, x: number, y: number) =>
  editor.view.dom.dispatchEvent(
    new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }),
  );
const fire = (target: EventTarget, type: string, init: MouseEventInit = {}) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
const grip = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-grip')!;
const rows = (editor: Editor) =>
  editor
    .getDoc()
    .split('\n')
    .filter((line) => /^\| (?:<!--ins \w+ row--> )?\d+ \|/.test(line))
    .map((line) =>
      line
        .replace(/<!--ins \w+ row--> /, '')
        .split('|')[1]
        ?.trim(),
    );

/** Presses the grip of row `n` and drags to `y`, then releases. */
function drag(editor: Editor, n: number, y: number, release = true): void {
  move(editor, LEFT + 50, rowY(n));
  fire(grip(editor), 'mousedown', { clientX: 60, clientY: rowY(n) });
  move(editor, 60, rowY(n) + 10);
  move(editor, 60, y);
  if (release) fire(window, 'mouseup', { clientX: 60, clientY: y });
}

describe('the + between rows', () => {
  it('shows within 8 px of a boundary in the left strip and not at 9, and a press inserts a row there', () => {
    const editor = mount();
    move(editor, LEFT - 20, TOP + 40 + 9);
    expect(editor.view.dom.querySelector('.rl-plus')).toBeNull();
    move(editor, LEFT - 20, TOP + 40 + 8);
    const plus = editor.view.dom.querySelector<HTMLElement>('.rl-plus');
    expect(plus?.dataset['boundary']).toBe('1');
    expect(editor.view.dom.querySelector('.rl-plus-line')).not.toBeNull();
    fire(plus!, 'mousedown');
    expect(editor.getDoc()).toContain('| 11 | 12 |');
    const lines = editor.getDoc().split('\n');
    const header = lines.findIndex((line) => line.startsWith('| a'));
    expect(lines[header + 2]).toMatch(/^\|\s+\|\s+\|$/);
  });

  it('writes a tracked row there when Track Changes is on', () => {
    const editor = mount(true);
    move(editor, LEFT - 20, TOP + 120);
    fire(editor.view.dom.querySelector('.rl-plus')!, 'mousedown');
    expect(editor.getDoc().match(/<!--ins \w+ row-->/g)).toHaveLength(1);
  });
});

describe('dragging a grip', () => {
  it('moves the row to the end when dropped after the last row', () => {
    const editor = mount();
    drag(editor, 1, TOP + 4 * 40 + 20);
    expect(rows(editor)).toEqual(['21', '31', '11']);
  });

  it('draws the drop line and dims the rows while dragging, and the line goes with Esc', () => {
    const editor = mount();
    drag(editor, 1, TOP + 100, false);
    expect(editor.view.dom.querySelector('.rl-drop-line')).not.toBeNull();
    expect(editor.view.dom.querySelector('.rl-drag-copy')).not.toBeNull();
    expect(editor.view.dom.querySelectorAll('.rl-row-dim')).toHaveLength(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(editor.view.dom.querySelector('.rl-drop-line')).toBeNull();
    expect(editor.view.dom.querySelectorAll('.rl-row-dim')).toHaveLength(0);
    fire(window, 'mouseup');
    expect(rows(editor)).toEqual(['11', '21', '31']);
  });

  it('moves all the rows selected with the one dragged', () => {
    const editor = mount();
    // Select rows 1 to 2 with the grips, then drag one of them to the end.
    move(editor, LEFT + 50, rowY(1));
    fire(grip(editor), 'mousedown', { clientX: 60, clientY: rowY(1) });
    fire(window, 'mouseup', { clientX: 60, clientY: rowY(1) });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    move(editor, LEFT + 50, rowY(2));
    fire(grip(editor), 'mousedown', { clientX: 60, clientY: rowY(2), shiftKey: true });
    fire(window, 'mouseup', { clientX: 60, clientY: rowY(2) });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    drag(editor, 2, TOP + 4 * 40 + 20);
    expect(rows(editor)).toEqual(['31', '11', '21']);
  });

  it('writes nothing for a drop where the row is, and tracked, writes a move', () => {
    const editor = mount();
    drag(editor, 2, rowY(2) - 20);
    expect(editor.getDoc()).toBe(DOC);
    const tracked = mount(true);
    drag(tracked, 1, TOP + 4 * 40 + 20);
    expect(tracked.getDoc()).toMatch(/<!--del \w+ row=1 /);
    expect(tracked.getDoc()).toMatch(/<!--ins \w+ row--> 11/);
  });
});
