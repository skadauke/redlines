// @vitest-environment happy-dom
// Column widths (design: tables, "Column widths and wide tables"): the pure function, and the plugin
// that measures and holds them, with a stubbed measure, because happy-dom has no layout. The widths a
// browser lays out are checked in the WebKit script.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import {
  cachedMeasure,
  cellShows,
  columnWidths,
  type Measured,
  widthEnvironment,
  type WidthEnvironment,
  widthsOf,
} from './widths.ts';

/** Ten pixels a character. */
const tenPx = (text: string): Measured => ({
  longestWord: Math.max(0, ...text.split(/\s+/).map((word) => word.length * 10)),
  longestLine: Math.max(0, ...text.split('\n').map((line) => line.length * 10)),
});

describe('columnWidths', () => {
  const measure = (text: string) => tenPx(text);

  it('fills the text column when every line fits, in proportion to the lines', () => {
    const widths = columnWidths(
      [
        ['a', 'bb'],
        ['ccc', 'd'],
      ],
      measure,
      100,
    );
    expect(widths).toEqual([60, 40]);
  });

  it('is the longest words, for a table that scrolls', () => {
    const widths = columnWidths(
      [
        ['aaaa bbbbbb', 'cc dddd'],
        ['x', 'y'],
      ],
      measure,
      50,
    );
    expect(widths).toEqual([60, 40]);
  });

  it('shares what is left above the words between columns when only some lines break', () => {
    // Words 40 and 20, lines 190 and 50: 30 above the words to share of 170 + 30.
    const widths = columnWidths(
      [
        ['aaaa bbbb cccc dddd', 'x yy zz'],
        ['a', 'b'],
      ],
      measure,
      90,
    );
    expect(widths[0]!).toBeGreaterThan(40);
    expect(widths[1]!).toBeGreaterThan(20);
    expect(widths[0]! + widths[1]!).toBeLessThanOrEqual(90);
    expect(widths[0]! + widths[1]!).toBeGreaterThan(89);
  });

  it('gives a table with no text equal columns', () => {
    expect(
      columnWidths(
        [
          ['', ''],
          ['', ''],
        ],
        measure,
        100,
      ),
    ).toEqual([50, 50]);
  });

  it('counts a line break as the end of a line, and a ragged row as it is', () => {
    const widths = columnWidths([['aa\nb'], ['c', 'ddd']], measure, 1000);
    expect(widths).toHaveLength(2);
    expect(widths[0]! + widths[1]!).toBeLessThanOrEqual(1000);
  });

  it('measures a text once, and a header apart from a body', () => {
    const spy = vi.fn(measure);
    const cached = cachedMeasure(spy);
    columnWidths(
      [
        ['same', 'other'],
        ['same', 'same'],
        ['same', 'other'],
      ],
      cached,
      100,
    );
    // The header's 'same' and 'other', and the body's.
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('reads what a cell shows: no markers, a break as a break, a pipe as a pipe', () => {
    expect(cellShows('a<!--ins k3x9-->b<!--/k3x9-->\\|c<br>d')).toBe('ab|c\nd');
  });
});

describe('the widths of a table in an editor', () => {
  const open: Editor[] = [];
  let room = 200;
  let signature = 'one';
  const stub: WidthEnvironment = {
    measure: () => (text) => tenPx(text),
    available: () => room,
    signature: () => signature,
  };
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
    room = 200;
    signature = 'one';
  });

  const DOC = 'Intro.\n\n| a | b |\n| - | - |\n| one | two |\n\nAfter.';
  const at = (find: string, offset = 0) => DOC.indexOf(find) + offset;

  async function settle(editor: Editor) {
    void editor;
    // A frame, in which the view measures, and the microtask that dispatches what it found.
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  async function load(doc = DOC): Promise<Editor> {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc,
      author: { handle: 'ada', name: 'Ada Lovelace' },
      extensions: [widthEnvironment.of(stub)],
    });
    open.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    await settle(editor);
    return editor;
  }

  it('is measured when the document opens, for every table', async () => {
    const editor = await load(`${DOC}\n\n| x |\n| - |\n| y |`);
    const widths = widthsOf(editor.view.state);
    expect(widths).toHaveLength(2);
    expect(widths[0]!.columns).toHaveLength(2);
    expect(widths[0]!.columns.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(200);
    expect(widths[0]!.scrolls).toBe(false);
  });

  it('writes the widths as variables in a rule for the table’s id', async () => {
    const editor = await load();
    const style = editor.view.dom.querySelector('style[data-rl-widths]');
    expect(style?.textContent).toMatch(
      /\.rl-tbl\[data-table="0"\]\{--w0:[\d.]+px;--w1:[\d.]+px;\}/,
    );
    expect(style?.textContent).toContain('.rl-tc[data-col="1"]{width:var(--w1)}');
  });

  it('holds the widths while the caret is in the table, and finds them again when it leaves', async () => {
    const editor = await load();
    editor.view.dispatch({ selection: { anchor: at('one', 1) } });
    await settle(editor);
    const held = widthsOf(editor.view.state);
    editor.view.dispatch({
      changes: { from: at('one', 1), insert: 'xxxxxxxxxxxxxxxxxxxxxxxxx' },
      selection: { anchor: at('one', 1) + 25 },
      userEvent: 'input.type',
    });
    await settle(editor);
    expect(widthsOf(editor.view.state)).toBe(held);
    // Another cell, another row's text: still in the table, still held.
    editor.view.dispatch({
      selection: { anchor: editor.view.state.doc.toString().indexOf('two', 1) },
    });
    await settle(editor);
    expect(widthsOf(editor.view.state)).toBe(held);
    editor.view.dispatch({ selection: { anchor: 2 } });
    await settle(editor);
    const found = widthsOf(editor.view.state);
    expect(found).not.toBe(held);
    expect(found[0]!.columns[0]!).toBeGreaterThan(held[0]!.columns[0]!);
  });

  it('finds them again after a paste, with the caret in the table', async () => {
    const editor = await load();
    editor.view.dispatch({ selection: { anchor: at('one', 1) } });
    await settle(editor);
    const held = widthsOf(editor.view.state);
    editor.view.dispatch({
      changes: { from: at('one', 1), insert: 'abc' },
      selection: { anchor: at('one', 4) },
      userEvent: 'input.paste',
    });
    await settle(editor);
    expect(widthsOf(editor.view.state)).not.toBe(held);
  });

  it('finds them again after a row is added, with the caret in the table', async () => {
    const editor = await load();
    editor.view.dispatch({ selection: { anchor: at('two', 3) } });
    await settle(editor);
    const held = widthsOf(editor.view.state);
    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    await settle(editor);
    expect(editor.view.state.doc.toString()).not.toBe(DOC);
    expect(widthsOf(editor.view.state)).not.toBe(held);
  });

  it('finds them again on a resize, and when fonts load', async () => {
    const fonts = new EventTarget();
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
    const editor = await load();
    editor.view.dispatch({ selection: { anchor: at('one', 1) } });
    await settle(editor);
    let held = widthsOf(editor.view.state);
    room = 300;
    window.dispatchEvent(new Event('resize'));
    await settle(editor);
    expect(widthsOf(editor.view.state)).not.toBe(held);
    expect(widthsOf(editor.view.state)[0]!.columns.reduce((a, b) => a + b, 0)).toBeGreaterThan(250);
    held = widthsOf(editor.view.state);
    fonts.dispatchEvent(new Event('loadingdone'));
    await settle(editor);
    expect(widthsOf(editor.view.state)).not.toBe(held);
    Reflect.deleteProperty(document, 'fonts');
  });

  it('says a table scrolls when its longest words are wider than the room', async () => {
    room = 40;
    const editor = await load('| aaaaaaaa | b |\n| - | - |\n| c | d |');
    expect(widthsOf(editor.view.state)[0]!.scrolls).toBe(true);
    expect(editor.view.dom.querySelector('style[data-rl-widths]')?.textContent).toContain('width:');
  });

  it('measures nothing where nothing is laid out', async () => {
    room = 0;
    const editor = await load();
    expect(widthsOf(editor.view.state)).toHaveLength(0);
  });
});
