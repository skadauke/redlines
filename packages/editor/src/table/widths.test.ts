// @vitest-environment happy-dom
// Column widths (design: tables, "Column widths and wide tables"): the pure function, and the plugin
// that measures and holds them, with a stubbed measure, because happy-dom has no layout. The widths a
// browser lays out are checked in the WebKit script.
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, forceParsing } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import {
  cachedMeasure,
  BOLD_OFF,
  BOLD_ON,
  cellShows,
  columnWidths,
  type Measured,
  widthEnvironment,
  type WidthEnvironment,
  shownText,
  widthsOf,
} from './widths.ts';
import { tablesField, tablesOf } from './model.ts';

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

  it('reads what a cell shows of its syntax: a link’s text, no emphasis, code or image path', () => {
    const doc = [
      '| a | b |',
      '| - | - |',
      '| [docs](https://example.com/a/very/long/address) | **bold** and *it* and `code` |',
      '| ![the alt](images/photo-of-something.png "Title") | ~~old~~ <https://x.org/y> [sic] |',
    ].join('\n');
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: GFM }), tablesField],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    const shown = tablesOf(state.update({}).state)[0]!.rows.map((row) =>
      row.cells.map((cell) => shownText(state.update({}).state, cell)),
    );
    expect(shown).toEqual([
      ['a', 'b'],
      ['docs', 'bold and it and code'],
      ['the alt', 'old https://x.org/y [sic]'],
    ]);
  });

  it('marks the bold stretches of a cell for a measure that sets them bold', () => {
    const doc = ['| a | b |', '| - | - |', '| **bold** and *it* | x**y**z |'].join('\n');
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: GFM }), tablesField],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    const now = state.update({}).state;
    const cells = tablesOf(now)[0]!.rows[1]!.cells;
    expect(cells.map((cell) => shownText(now, cell, true))).toEqual([
      `${BOLD_ON}bold${BOLD_OFF} and it`,
      `x${BOLD_ON}y${BOLD_OFF}z`,
    ]);
    expect(cells.map((cell) => shownText(now, cell))).toEqual(['bold and it', 'xyz']);
  });

  it('takes the marking characters out of a cell’s own text', () => {
    const doc = ['| a |', '| - |', '| x\uE000y\uE001z **b** |'].join('\n');
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: GFM }), tablesField],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    const now = state.update({}).state;
    const cell = tablesOf(now)[0]!.rows[1]!.cells[0]!;
    expect(shownText(now, cell, true)).toBe(`xyz ${BOLD_ON}b${BOLD_OFF}`);
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
    const id = tablesOf(editor.view.state)[0]!.id;
    expect(style?.textContent).toMatch(
      new RegExp(`\\.rl-tbl\\[data-table="${id}"\\]\\{--w0:[\\d.]+px;--w1:[\\d.]+px;\\}`),
    );
    expect(style?.textContent).toContain('.rl-tc[data-col="1"]{width:var(--w1)}');
  });

  it('keeps a table’s widths on it when a table is added above it, never on another', async () => {
    const editor = await load();
    const [lower] = tablesOf(editor.view.state);
    const style = () => editor.view.dom.querySelector('style[data-rl-widths]')?.textContent ?? '';
    const rule = style();
    editor.view.dispatch({ changes: { from: 0, insert: '| n |\n| - |\n| 1 |\n\n' } });
    // At once, before anything is measured again: the new table has no rule, the old one its own.
    const tables = tablesOf(editor.view.state);
    expect(tables).toHaveLength(2);
    expect(tables[0]!.id).not.toBe(lower!.id);
    expect(tables[1]!.id).toBe(lower!.id);
    expect(style()).toBe(rule);
    const wrappers = [...editor.view.contentDOM.querySelectorAll('.rl-tbl')].map((el) =>
      el.getAttribute('data-table'),
    );
    expect(wrappers).toEqual(tables.map((t) => String(t.id)));
    expect(style()).toContain(`data-table="${lower!.id}"`);
    expect(style()).not.toContain(`data-table="${tables[0]!.id}"`);
    await settle(editor);
    expect(widthsOf(editor.view.state).map((w) => w.id)).toEqual(tables.map((t) => t.id));
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

  it('reads nothing from the page in a document with no table, and measures when one is made', async () => {
    const calls = { available: 0, signature: 0, measure: 0 };
    const spy: WidthEnvironment = {
      measure: () => {
        calls.measure++;
        return (text) => tenPx(text);
      },
      available: () => {
        calls.available++;
        return room;
      },
      signature: () => {
        calls.signature++;
        return signature;
      },
    };
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: 'Just words.\n',
      author: { handle: 'ada', name: 'Ada Lovelace' },
      extensions: [widthEnvironment.of(spy)],
    });
    open.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    await settle(editor);
    for (let i = 0; i < 3; i++) {
      editor.view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
    }
    window.dispatchEvent(new Event('resize'));
    await settle(editor);
    expect(calls).toEqual({ available: 0, signature: 0, measure: 0 });
    // A table typed in is measured.
    editor.view.dispatch({ changes: { from: 0, insert: '| a | b |\n| - | - |\n| c | d |\n\n' } });
    await settle(editor);
    expect(calls.available).toBeGreaterThan(0);
    expect(widthsOf(editor.view.state)).toHaveLength(1);
  });

  it('measures nothing where nothing is laid out', async () => {
    room = 0;
    const editor = await load();
    expect(widthsOf(editor.view.state)).toHaveLength(0);
  });
});
