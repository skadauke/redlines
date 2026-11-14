// @vitest-environment happy-dom
// Tab, Shift-Tab, ⌘↩ and the new row (design: tables, "The caret and the keys" and "Rows and
// columns"), as keystroke scripts with Track Changes off and on.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { type Script, scriptRows, type Step } from '../blocks/script.ts';
import { parse } from '@redlines/format';
import { createEditor, type Editor, undo } from '../index.ts';

interface Row {
  name: string;
  doc: string;
  keys: Step[];
  off: Script['expect'];
  on: Script['expect'];
  skip?: Script['skip'];
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) => [
    {
      name: `${row.name}, Track Changes off`,
      doc: row.doc,
      keys: row.keys,
      tc: false,
      expect: row.off,
      ...(row.skip ? { skip: row.skip } : {}),
    },
    {
      name: `${row.name}, Track Changes on`,
      doc: row.doc,
      keys: row.keys,
      tc: true,
      expect: row.on,
      ...(row.skip ? { skip: row.skip } : {}),
    },
  ]);

const same = (caret: string) => ({ off: { caret }, on: { caret } });

const T = '| a | b |⏎| - | - |⏎| 1 | 2 |⏎| 3 | 4 |';

describe('Tab through a table', () => {
  scriptRows(
    both([
      {
        name: 'Tab selects the next cell’s text',
        doc: T.replace('| a |', '| a‸ |'),
        keys: ['Tab'],
        ...same(T.replace('| b |', '| [b] |')),
      },
      {
        name: 'Tab at the end of a row goes to the first cell of the next, past the delimiter row',
        doc: T.replace('| b |', '| b‸ |'),
        keys: ['Tab'],
        ...same(T.replace('| 1 |', '| [1] |')),
      },
      {
        name: 'Tab through every cell, in order',
        doc: T.replace('| a |', '| a‸ |'),
        keys: ['Tab', 'Tab', 'Tab', 'Tab', 'Tab'],
        ...same(T.replace('| 4 |', '| [4] |')),
      },
      {
        name: 'Shift-Tab selects the previous cell’s text',
        doc: T.replace('| 2 |', '| 2‸ |'),
        keys: ['Shift-Tab'],
        ...same(T.replace('| 1 |', '| [1] |')),
      },
      {
        name: 'Shift-Tab in the first cell of a row goes to the last of the row above',
        doc: T.replace('| 1 |', '| 1‸ |'),
        keys: ['Shift-Tab'],
        ...same(T.replace('| b |', '| [b] |')),
      },
      {
        name: 'Shift-Tab in the first cell does nothing and is not refused',
        doc: T.replace('| a |', '| a‸ |'),
        keys: ['Shift-Tab'],
        ...same(T.replace('| a |', '| a‸ |')),
      },
      {
        name: 'Tab into an empty cell puts the caret in it',
        doc: '| a | b |⏎| - | - |⏎| 1‸ |  |',
        keys: ['Tab'],
        ...same('| a | b |⏎| - | - |⏎| 1 | ‸ |'),
      },
    ]),
  );
});

describe('Tab in the last cell, and ⌘↩', () => {
  scriptRows(
    both([
      {
        name: 'Tab in the last cell adds a row, and the caret is in its first cell',
        doc: T.replace('| 4 |', '| 4‸ |'),
        keys: ['Tab'],
        off: { caret: `${T}⏎| ‸  |   |` },
        on: { caret: `${T}⏎| <ins> ‸  |   |` },
      },
      {
        name: 'typing in the new row writes no marks of its own',
        doc: T.replace('| 4 |', '| 4‸ |'),
        keys: ['Tab', { type: 'x' }],
        off: { caret: `${T}⏎| x‸  |   |` },
        on: { caret: `${T}⏎| <ins> x‸  |   |` },
      },
      {
        name: '⌘↩ inserts a row below the caret’s row',
        doc: T.replace('| 1 |', '| 1‸ |'),
        keys: ['Mod-Enter'],
        off: { caret: '| a | b |⏎| - | - |⏎| 1 | 2 |⏎| ‸  |   |⏎| 3 | 4 |' },
        on: { caret: '| a | b |⏎| - | - |⏎| 1 | 2 |⏎| <ins> ‸  |   |⏎| 3 | 4 |' },
      },
      {
        name: '⌘↩ in the header inserts the first body row',
        doc: T.replace('| a |', '| a‸ |'),
        keys: ['Mod-Enter'],
        off: { caret: '| a | b |⏎| - | - |⏎| ‸  |   |⏎| 1 | 2 |⏎| 3 | 4 |' },
        on: { caret: '| a | b |⏎| - | - |⏎| <ins> ‸  |   |⏎| 1 | 2 |⏎| 3 | 4 |' },
      },
      {
        name: 'Tab in the last cell of a table that ends the file before the ledger',
        doc: `${T.replace('| 4 |', '| 4‸ |')}⏎⏎<!-- redlines⏎version: 1⏎-->⏎`,
        keys: ['Tab'],
        off: { caret: `${T}⏎| ‸  |   |` },
        on: { caret: `${T}⏎| <ins> ‸  |   |` },
      },
    ]),
  );
});

const LEDGER = (by: string, ids: string[]) =>
  `<!-- redlines⏎version: 1⏎marks:⏎${ids.map((id) => `  ${id}: {by: ${by}, at: 2026-11-01T10:00Z}⏎`).join('')}-->⏎`;

describe('Tab and a pending change under the table', () => {
  const REFUSAL = 'Accept or reject the column changes in this table first.';
  const column = (tc: boolean): Script => ({
    name: `a column pending deleted: refused, with the file unchanged, Track Changes ${tc ? 'on' : 'off'}`,
    doc: `| a | b |⏎| - | - |⏎| 1 | 2‸ |⏎⏎<!--del m2bd col=2 \\| b \\\\n \\| - \\\\n \\| 1-->⏎⏎${LEDGER('bo', ['m2bd'])}`,
    keys: ['Tab'],
    tc,
    expect: { refusal: REFUSAL },
  });
  scriptRows([column(false), column(true)]);

  const ROW = '<!--del g5nb row=2 \\| 3 \\| 4 \\|-->';
  scriptRows(
    both([
      {
        name: 'a row pending deleted under the table: the new row goes in the table, above it',
        doc: `| a | b |⏎| - | - |⏎| 1 | 2‸ |⏎⏎${ROW}⏎⏎${LEDGER('bo', ['g5nb'])}`,
        keys: ['Tab'],
        off: { caret: `| a | b |⏎| - | - |⏎| 1 | 2 |⏎| ‸  |   |⏎⏎${'<del row=2 | 3 | 4 |>'}` },
        on: { caret: `| a | b |⏎| - | - |⏎| 1 | 2 |⏎| <ins> ‸  |   |⏎⏎${'<del row=2 | 3 | 4 |>'}` },
      },
    ]),
  );
});

describe('the new row, in an editor', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  function mount(doc: string, tracking: boolean, caret: string): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc,
      author: { handle: 'ada', name: 'Ada Lovelace' },
      tracking,
    });
    open.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    editor.view.dispatch({
      selection: { anchor: editor.view.state.doc.toString().indexOf(caret) },
    });
    return editor;
  }
  const press = (editor: Editor, key: string) =>
    runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key, bubbles: true }), 'editor');

  it('Undo takes the row back with the selection it had', () => {
    const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n';
    for (const tracking of [false, true]) {
      const editor = mount(doc, tracking, '2 |');
      editor.view.dispatch({
        selection: { anchor: editor.view.state.doc.toString().indexOf('2 |') + 1 },
      });
      const before = editor.view.state.selection.main.head;
      press(editor, 'Tab');
      expect(editor.getDoc()).not.toBe(doc);
      undo(editor.view);
      expect(editor.getDoc()).toBe(doc);
      expect(editor.view.state.selection.main.head).toBe(before);
    }
  });

  it('in a CRLF file, writes the file’s own line breaks, and rejecting gives every byte back', () => {
    const doc = '| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n';
    const editor = mount(doc, true, '2 |');
    editor.view.dispatch({
      selection: { anchor: editor.view.state.doc.toString().indexOf('2 |') + 1 },
    });
    press(editor, 'Tab');
    const after = editor.getDoc();
    expect(after).toMatch(/\| 2 \|\r\n\| <!--ins \w+ row-->/);
    expect(after.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const row = parse(after).marks.find((mark) => mark.payload === 'row');
    expect(row).toBeDefined();
    editor.reject(row!.id);
    expect(editor.getDoc()).toBe(doc);
  });

  it('is named Insert Row in the Undo menu', () => {
    const editor = mount('| a | b |\n| - | - |\n| 1 | 2 |\n', false, '2 |');
    editor.view.dispatch({
      selection: { anchor: editor.view.state.doc.toString().indexOf('2 |') + 1 },
    });
    press(editor, 'Tab');
    expect(editor.getUiState().undo).toBe('Insert Row');
  });
});

describe('a tracked row made in Clean', () => {
  const doc = '| a | b |\n| - | - |\n| 1 | 2 |\n';
  const mounted: Editor[] = [];
  afterEach(() => {
    for (const editor of mounted.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  it.each(['simple', 'redlines'] as const)(
    'shows Redlines in the look chosen last, as every other tracked edit made in Clean does (%s)',
    (markupView) => {
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, {
        doc,
        author: { handle: 'ada', name: 'Ada Lovelace' },
        tracking: true,
        view: 'clean',
        markupView,
      });
      mounted.push(editor);
      forceParsing(editor.view, editor.view.state.doc.length, 10_000);
      expect(editor.getUiState().view).toBe('clean');
      editor.view.dispatch({ selection: { anchor: doc.indexOf('2 |') + 1 } });
      // Tab in the last cell adds a row, tracked.
      runScopeHandlers(
        editor.view,
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
        'editor',
      );
      expect(editor.getDoc()).not.toBe(doc);
      expect(editor.getUiState().view).toBe(markupView);
    },
  );
});
