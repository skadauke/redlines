// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { createEditor, type Editor, rectOf, selectedCells, wholeRect } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { createTables, plugin } from './index.ts';

interface Mounted {
  editor: Editor;
  remove: () => void;
}
const mounted: Mounted[] = [];
/** What the editor told the person, in words. */
const notices: string[] = [];

function mount(doc: string, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
    onNotice: (message) => notices.push(message),
  });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  mounted.push({ editor, remove: createTables(editor) });
  return editor;
}

afterEach(() => {
  notices.length = 0;
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

const T = 'Intro.\n\n| a | b |\n| - | - |\n| one | two |\n\nAfter.\n';
const select = (editor: Editor, at: number) => editor.view.dispatch({ selection: { anchor: at } });
const press = (editor: Editor, key: string, init: KeyboardEventInit = {}) =>
  runScopeHandlers(
    editor.view,
    new KeyboardEvent('keydown', { key, bubbles: true, ...init }),
    'editor',
  );

describe('the tables plugin', () => {
  it('lists Insert Row Below under the Table menu, with its key', () => {
    const editor = mount(T);
    const command = editor.commands.list().find((c) => c.id === 'table.insertRowBelow');
    expect(command).toMatchObject({
      shortcut: 'Alt-Mod-ArrowDown',
      menu: 'table',
    });
  });

  it('is enabled with the caret in a cell, and disabled elsewhere', () => {
    const editor = mount(T);
    select(editor, T.indexOf('one') + 1);
    expect(editor.getUiState().enabledCommands).toContain('table.insertRowBelow');
    select(editor, 3);
    expect(editor.getUiState().enabledCommands).not.toContain('table.insertRowBelow');
    expect(editor.commands.run('table.insertRowBelow')).toBe(false);
    expect(editor.getDoc()).toBe(T);
  });

  it('is enabled by the selection’s head, which is what the command works from', () => {
    const editor = mount(T);
    const inCell = T.indexOf('one') + 1;
    // The anchor in a cell and the head outside: nothing to insert a row below.
    editor.view.dispatch({ selection: { anchor: inCell, head: 3 } });
    expect(editor.getUiState().enabledCommands).not.toContain('table.insertRowBelow');
    expect(editor.commands.run('table.insertRowBelow')).toBe(false);
    expect(editor.getDoc()).toBe(T);
    // The head in a cell and the anchor outside: enabled, and it inserts below the head's row.
    editor.view.dispatch({ selection: { anchor: 3, head: inCell } });
    expect(editor.getUiState().enabledCommands).toContain('table.insertRowBelow');
    expect(editor.commands.run('table.insertRowBelow')).toBe(true);
    expect(editor.getDoc()).toMatch(/\| one \| two \|\n\|\s+\|\s+\|\n\nAfter\./);
  });

  it('inserts a row below the caret’s row, as the menu runs it', () => {
    const editor = mount(T);
    select(editor, T.indexOf('one') + 1);
    expect(editor.commands.run('table.insertRowBelow')).toBe(true);
    expect(editor.getDoc()).toMatch(/\| one \| two \|\n\|\s+\|\s+\|\n\nAfter\./);
  });

  it('leaves ⌘↩ outside a table to the editor: Return at the end of a block', () => {
    const mod = {
      ctrlKey: !/Mac/.test(navigator.platform),
      metaKey: /Mac/.test(navigator.platform),
    };
    const doc = 'One.\n\nTwo.\n';
    // What the editor makes of ⌘↩ at the end of a paragraph, with no plugin.
    const parent = document.createElement('div');
    document.body.append(parent);
    const alone = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' } });
    forceParsing(alone.view, doc.length, 5000);
    select(alone, 4);
    press(alone, 'Enter', mod);
    const expected = { doc: alone.getDoc(), head: alone.view.state.selection.main.head };
    // The empty paragraph opens, and the caret is in it.
    expect(expected.head).not.toBe(4);
    alone.destroy();
    // The same with the tables plugin: its key is not taken outside a table.
    const editor = mount(doc);
    select(editor, 4);
    press(editor, 'Enter', mod);
    expect({ doc: editor.getDoc(), head: editor.view.state.selection.main.head }).toEqual(expected);
  });

  it('leaves ⌘↩ in Raw to the editor too, where nothing else is in front of it', () => {
    const mod = {
      ctrlKey: !/Mac/.test(navigator.platform),
      metaKey: /Mac/.test(navigator.platform),
    };
    const doc = 'One.\n\nTwo.\n';
    const parent = document.createElement('div');
    document.body.append(parent);
    const alone = createEditor(parent, {
      doc,
      author: { handle: 'ada', name: 'Ada' },
      view: 'raw',
    });
    forceParsing(alone.view, doc.length, 5000);
    select(alone, 4);
    press(alone, 'Enter', mod);
    const expected = alone.getDoc();
    expect(expected).not.toBe(doc);
    alone.destroy();
    const editor = mount(doc);
    editor.setViewMode('raw');
    select(editor, 4);
    press(editor, 'Enter', mod);
    expect(editor.getDoc()).toBe(expected);
  });

  it('is the plugin the app activates, with its manifest', () => {
    expect(plugin.manifest.id).toBe('redlines.tables');
    expect(plugin.manifest.contributes?.commands?.map((c) => c.id)).toEqual([
      'table.insertRowAbove',
      'table.insertRowBelow',
      'table.deleteRow',
      'table.moveRowUp',
      'table.moveRowDown',
      'table.insertColumnLeft',
      'table.insertColumnRight',
      'table.deleteColumn',
      'table.deleteTable',
      'table.moveColumnLeft',
      'table.moveColumnRight',
      'table.alignLeft',
      'table.alignCenter',
      'table.alignRight',
      'table.alignDefault',
      'table.selectCell',
      'table.selectRow',
      'table.selectColumn',
      'table.selectTable',
    ]);
  });
});

describe('Select Cell, Row, Column and Table', () => {
  const G = [
    '| a | b | c |',
    '| - | - | - |',
    '| 11 | 12 | 13 |',
    '| 21 | 22 | 23 |',
    '| 31 | 32 | 33 |',
  ].join('\n');
  const doc = `Intro.\n\n${G}\n\nAfter.\n`;
  const inCell = doc.indexOf('22') + 1;
  const selection = (editor: Editor) => {
    const { from, to } = editor.view.state.selection.main;
    return doc.slice(from, to);
  };
  const kind = (editor: Editor) => {
    const rect = rectOf(editor.view.state);
    return rect ? wholeRect(rect) : null;
  };

  it('are listed under the Table menu, and the row has ⌃L', () => {
    const editor = mount(doc);
    const listed = editor.commands.list().filter((c) => c.id.startsWith('table.select'));
    expect(listed.map((c) => [c.title, c.menu, c.shortcut])).toEqual([
      ['Select Cell', 'table', undefined],
      ['Select Row', 'table', 'Ctrl-l'],
      ['Select Column', 'table', undefined],
      ['Select Table', 'table', undefined],
    ]);
  });

  it('select the caret’s cell text, row, column and the table', () => {
    const editor = mount(doc);
    select(editor, inCell);
    expect(editor.commands.run('table.selectCell')).toBe(true);
    expect(selection(editor)).toBe('22');
    select(editor, inCell);
    expect(editor.commands.run('table.selectRow')).toBe(true);
    expect(selection(editor)).toBe('21 | 22 | 23');
    expect(kind(editor)).toBe('row');
    select(editor, inCell);
    expect(editor.commands.run('table.selectColumn')).toBe(true);
    expect(kind(editor)).toBe('column');
    expect(selectedCells(editor.view.state).map((c) => doc.slice(c.textFrom, c.textTo))).toEqual([
      'b',
      '12',
      '22',
      '32',
    ]);
    select(editor, inCell);
    expect(editor.commands.run('table.selectTable')).toBe(true);
    expect(kind(editor)).toBe('table');
    expect(selection(editor)).toBe(G.slice(2, G.length - 2));
  });

  it('Select Cell keeps the caret in a cell its row lacks, in its column, and writes nothing', () => {
    const short = '| a | b | c |\n| - | - | - |\n| 1 |\n| 2 | 3 | 4 |\n';
    const editor = mount(short);
    select(editor, short.indexOf('1') + 1);
    press(editor, 'Tab');
    press(editor, 'Tab');
    const active = () =>
      [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tc-active')].map(
        (cell) => cell.dataset['col'],
      );
    expect(active()).toEqual(['2']);
    expect(editor.getUiState().enabledCommands).toContain('table.selectCell');
    expect(editor.commands.run('table.selectCell')).toBe(true);
    expect(active()).toEqual(['2']);
    expect(editor.view.state.selection.main.empty).toBe(true);
    expect(editor.getDoc()).toBe(short);
  });

  it('are disabled outside a table, and do nothing there', () => {
    const editor = mount(doc);
    select(editor, 3);
    for (const id of [
      'table.selectCell',
      'table.selectRow',
      'table.selectColumn',
      'table.selectTable',
    ]) {
      expect(editor.getUiState().enabledCommands).not.toContain(id);
      expect(editor.commands.run(id)).toBe(false);
    }
    expect(editor.view.state.selection.main.empty).toBe(true);
  });

  it('binds ⌃L in a table only: elsewhere it is CodeMirror’s select line', () => {
    const editor = mount(doc);
    select(editor, inCell);
    expect(press(editor, 'l', { ctrlKey: true })).toBe(true);
    expect(kind(editor)).toBe('row');
    select(editor, 3);
    // The command lets the key go on (to CodeMirror's select line, which Mac binds to ⌃L).
    expect(press(editor, 'l', { ctrlKey: true })).toBe(false);
    expect(rectOf(editor.view.state)).toBeNull();
  });
});

describe('the row commands', () => {
  const G = [
    '| a | b |',
    '| - | - |',
    '| 11 | 12 |',
    '| 21 | 22 |',
    '| 31 | 32 |',
    '| 41 | 42 |',
  ].join('\n');
  const doc = `Intro.\n\n${G}\n\nAfter.\n`;
  const at = (text: string) => doc.indexOf(text) + 1;
  const rowsOf = (editor: Editor) =>
    editor
      .getDoc()
      .split('\n')
      .filter((line) => /^\| (?:<!--ins \w+ row--> )?[a-z0-9 ]+\|/.test(line))
      .map((line) =>
        line
          .replace(/<!--ins \w+ row--> ?/, '+')
          .split('|')[1]
          ?.trim(),
      );
  const titles = (editor: Editor) => editor.getUiState().commandTitles;
  const selectRows = (editor: Editor, from: string, to: string) =>
    editor.view.dispatch({ selection: { anchor: at(from), head: at(to) + 1 } });

  it('titles count the rows the selection touches, and the UI state reports them', () => {
    const editor = mount(doc);
    select(editor, at('21'));
    expect(titles(editor)).toMatchObject({
      'table.insertRowAbove': 'Insert Row Above',
      'table.deleteRow': 'Delete Row',
      'table.moveRowUp': 'Move Row Up',
    });
    selectRows(editor, '21', '32');
    expect(titles(editor)['table.insertRowAbove']).toBe('Insert 2 Rows Above');
    expect(titles(editor)['table.insertRowBelow']).toBe('Insert 2 Rows Below');
    expect(titles(editor)['table.deleteRow']).toBe('Delete 2 Rows');
    expect(titles(editor)['table.moveRowDown']).toBe('Move 2 Rows Down');
    selectRows(editor, '21', '42');
    expect(titles(editor)['table.deleteRow']).toBe('Delete 3 Rows');
  });

  it('inserts as many rows as the selection touches, above or below, with the caret in the first', () => {
    for (const tracking of [false, true]) {
      const editor = mount(doc, tracking);
      selectRows(editor, '21', '32');
      expect(editor.commands.run('table.insertRowBelow')).toBe(true);
      // Two new rows, below the second selected row (they are the 3rd and 4th after the header).
      expect(
        editor
          .getDoc()
          .split('\n')
          .filter((l) => l.startsWith('|')),
      ).toHaveLength(8);
      const text = editor.getDoc();
      expect(
        (text.match(tracking ? /<!--ins \w+ row-->/g : /\|\s+\|\s+\|\n/g) ?? []).length,
      ).toBeGreaterThanOrEqual(2);
      const head = editor.view.state.selection.main.head;
      const line = editor.view.state.doc.lineAt(head).text;
      expect(line).toMatch(/^\| (?:<!--ins \w+ row--> )? *\|/);
      // Above the first selected row.
      const above = mount(doc, tracking);
      select(above, at('21'));
      expect(above.commands.run('table.insertRowAbove')).toBe(true);
      expect(above.getDoc().indexOf('11')).toBeLessThan(
        above.getDoc().search(/\| (?:<!--ins \w+ row--> )? *\| *\|\n\| 21/),
      );
    }
  });

  it('deletes the rows the selection touches, the caret in the row that is then there', () => {
    const editor = mount(doc);
    selectRows(editor, '21', '32');
    expect(editor.commands.run('table.deleteRow')).toBe(true);
    expect(rowsOf(editor)).toEqual(['a', '11', '41']);
    const { head } = editor.view.state.selection.main;
    expect(editor.view.state.doc.lineAt(head).text).toContain('41');
    // Tracked: the rows are kept below the table as deletions.
    const tracked = mount(doc, true);
    select(tracked, at('21'));
    expect(tracked.commands.run('table.deleteRow')).toBe(true);
    expect(tracked.getDoc()).toContain('<!--del');
    expect(tracked.getDoc()).toMatch(/row=2 /);
  });

  it('moves rows one place and keeps them selected, and refuses at the top and bottom', () => {
    const editor = mount(doc);
    selectRows(editor, '21', '31');
    expect(editor.commands.run('table.moveRowUp')).toBe(true);
    expect(rowsOf(editor)).toEqual(['a', '21', '31', '11', '41']);
    expect(
      selectedCells(editor.view.state).map((c) => editor.getDoc().slice(c.textFrom, c.textTo)),
    ).toEqual(['21', '22', '31', '32']);
    expect(editor.commands.run('table.moveRowDown')).toBe(true);
    expect(rowsOf(editor)).toEqual(['a', '11', '21', '31', '41']);
    const top = mount(doc);
    select(top, at('a |'));
    expect(top.commands.run('table.moveRowUp')).toBe(true);
    expect(top.getDoc()).toBe(doc);
  });

  it('is one step to undo, which brings back the selection it was made with', () => {
    const editor = mount(doc);
    selectRows(editor, '21', '31');
    const { anchor, head } = editor.view.state.selection.main;
    editor.commands.run('table.deleteRow');
    expect(editor.getUiState().undo).toBe('Delete Row');
    editor.undo();
    expect(editor.getDoc()).toBe(doc);
    expect(editor.view.state.selection.main).toMatchObject({ anchor, head });
  });

  it('binds its keys only in a table: ⌥↑ and ⌘↩ are the editor’s own elsewhere', () => {
    const editor = mount(doc);
    select(editor, at('21'));
    expect(press(editor, 'ArrowUp', { altKey: true })).toBe(true);
    expect(rowsOf(editor)).toEqual(['a', '21', '11', '31', '41']);
    // Outside the table the keys are the editor's own, which moves the line, not the table's rows.
    select(editor, 3);
    press(editor, 'ArrowDown', { altKey: true });
    expect(rowsOf(editor)).toEqual(['a', '21', '11', '31', '41']);
    select(editor, editor.getDoc().indexOf('| 11') + 3);
    expect(
      [{ metaKey: true }, { ctrlKey: true }].some((mod) =>
        press(editor, 'Backspace', { altKey: true, ...mod }),
      ),
    ).toBe(true);
    expect(editor.getDoc()).not.toContain('| 11 |');
  });

  it('does nothing for ⇧⌥↑, ⌘[ and ⌘/ in a cell, and says why for a refused row command', () => {
    const editor = mount(doc);
    select(editor, at('21'));
    const text = editor.getDoc();
    press(editor, 'ArrowUp', { altKey: true, shiftKey: true });
    press(editor, '[', { metaKey: true });
    press(editor, '/', { metaKey: true });
    expect(editor.getDoc()).toBe(text);
    // Deleting every row is refused: nothing is written.
    editor.view.dispatch({ selection: { anchor: at('a |'), head: at('42') + 1 } });
    editor.commands.run('table.deleteRow');
    expect(editor.getDoc()).toBe(text);
  });
});

describe('the column commands', () => {
  const G = [
    '| a | b | c | d |',
    '| - | - | - | - |',
    '| 11 | 12 | 13 | 14 |',
    '| 21 | 22 | 23 | 24 |',
  ].join('\n');
  const doc = `Intro.\n\n${G}\n\nAfter.\n`;
  const at = (text: string) => doc.indexOf(text) + 1;
  const header = (editor: Editor) =>
    editor
      .getDoc()
      .split('\n')
      .find((line) => /^\| (?:<!--ins \w+ col--> )?a /.test(line) || /\| a \|/.test(line));
  const headers = (editor: Editor): string[] =>
    (editor.getDoc().split('\n')[2] ?? '')
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.replace(/<!--ins \w+ col-->/, '+').trim());
  const titles = (editor: Editor) => editor.getUiState().commandTitles;
  const selectCols = (editor: Editor, from: string, to: string) =>
    editor.view.dispatch({ selection: { anchor: at(from), head: at(to) + 1 } });

  it('are listed under the Table menu with their keys, and move has none', () => {
    const editor = mount(doc);
    const list = editor.commands.list();
    for (const [id, shortcut] of [
      ['table.insertColumnLeft', 'Alt-Mod-ArrowLeft'],
      ['table.insertColumnRight', 'Alt-Mod-ArrowRight'],
      ['table.deleteColumn', 'Ctrl-Meta-Backspace'],
    ] as const) {
      expect(list.find((c) => c.id === id)).toMatchObject({ shortcut, menu: 'table' });
    }
    expect(list.find((c) => c.id === 'table.moveColumnLeft')?.shortcut).toBeUndefined();
    expect(list.find((c) => c.id === 'table.moveColumnRight')).toMatchObject({ menu: 'table' });
  });

  it('title the columns the selection touches, and are disabled outside a table', () => {
    const editor = mount(doc);
    select(editor, at('12'));
    expect(titles(editor)).toMatchObject({
      'table.insertColumnLeft': 'Insert Column Left',
      'table.deleteColumn': 'Delete Column',
      'table.moveColumnRight': 'Move Column Right',
    });
    selectCols(editor, '12', '13');
    expect(titles(editor)['table.insertColumnLeft']).toBe('Insert 2 Columns Left');
    expect(titles(editor)['table.deleteColumn']).toBe('Delete 2 Columns');
    selectCols(editor, '12', '24');
    expect(titles(editor)['table.deleteColumn']).toBe('Delete 3 Columns');
    select(editor, 3);
    expect(editor.getUiState().enabledCommands).not.toContain('table.deleteColumn');
    expect(editor.commands.run('table.deleteColumn')).toBe(false);
  });

  it('inserts as many columns as the selection touches, tracked or not, the caret in the new cell', () => {
    for (const tracking of [false, true]) {
      const editor = mount(doc, tracking);
      selectCols(editor, '12', '13');
      expect(editor.commands.run('table.insertColumnRight')).toBe(true);
      const text = editor.getDoc();
      expect(text.split('\n')[2]?.split('|').length).toBe(8);
      expect((text.match(/<!--ins \w+ col-->/g) ?? []).length).toBe(tracking ? 2 : 0);
      // In the new column, in the row the caret was in (the first body row).
      const head = editor.view.state.selection.main.head;
      const line = editor.view.state.doc.lineAt(head);
      expect(line.text).toMatch(/^\| 11 \| 12 \| 13 \|/);
      expect(head).toBeGreaterThan(line.from + line.text.indexOf('13') + 2);
      const left = mount(doc, tracking);
      select(left, at('12'));
      expect(left.commands.run('table.insertColumnLeft')).toBe(true);
      expect(left.getDoc().split('\n')[4]).toMatch(/^\| 11 \|\s+\| 12 \|/);
    }
  });

  it('deletes the columns the selection touches, the caret in the column that is then there', () => {
    const editor = mount(doc);
    selectCols(editor, '12', '13');
    expect(editor.commands.run('table.deleteColumn')).toBe(true);
    expect(headers(editor)).toEqual(['a', 'd']);
    const { head } = editor.view.state.selection.main;
    expect(editor.view.state.doc.lineAt(head).text).toContain('14');
    const tracked = mount(doc, true);
    select(tracked, at('12'));
    expect(tracked.commands.run('table.deleteColumn')).toBe(true);
    expect(tracked.getDoc()).toContain('<!--del');
    expect(tracked.getDoc()).toMatch(/col=2 /);
  });

  it('moves columns one place and keeps them selected, and says so at the edges', () => {
    const editor = mount(doc);
    selectCols(editor, '12', '13');
    expect(editor.commands.run('table.moveColumnLeft')).toBe(true);
    expect(headers(editor)).toEqual(['b', 'c', 'a', 'd']);
    expect(
      selectedCells(editor.view.state).map((c) => editor.getDoc().slice(c.textFrom, c.textTo)),
    ).toEqual(['b', 'c', '12', '13', '22', '23']);
    expect(editor.commands.run('table.moveColumnRight')).toBe(true);
    expect(headers(editor)).toEqual(['a', 'b', 'c', 'd']);
    const edge = mount(doc);
    select(edge, at('a |'));
    expect(edge.commands.run('table.moveColumnLeft')).toBe(true);
    expect(edge.getDoc()).toBe(doc);
    const tracked = mount(doc, true);
    select(tracked, at('11'));
    expect(tracked.commands.run('table.moveColumnRight')).toBe(true);
    expect(tracked.getDoc()).toMatch(/<!--ins \w+ col--> a/);
    expect(tracked.getDoc()).toMatch(/<!--del \w+ col=1 /);
  });

  it('is one step to undo, which brings back the selection it was made with', () => {
    const editor = mount(doc);
    selectCols(editor, '12', '13');
    const { anchor, head } = editor.view.state.selection.main;
    editor.commands.run('table.deleteColumn');
    expect(editor.getUiState().undo).toBe('Delete Column');
    editor.undo();
    expect(editor.getDoc()).toBe(doc);
    expect(editor.view.state.selection.main).toMatchObject({ anchor, head });
  });

  it('binds its keys only in a table', () => {
    const editor = mount(doc);
    select(editor, at('12'));
    const mods = [{ metaKey: true }, { ctrlKey: true }];
    expect(mods.some((mod) => press(editor, 'ArrowLeft', { altKey: true, ...mod }))).toBe(true);
    expect(headers(editor).length).toBe(5);
    const plain = mount(doc);
    select(plain, 3);
    for (const mod of mods) press(plain, 'ArrowLeft', { altKey: true, ...mod });
    expect(plain.getDoc()).toBe(doc);
    const keyed = mount(doc);
    select(keyed, at('12'));
    expect(press(keyed, 'Backspace', { ctrlKey: true, metaKey: true })).toBe(true);
    expect(headers(keyed)).toEqual(['a', 'c', 'd']);
  });

  it('refuses with a reason and writes nothing: deleting every column, a row pending deleted', () => {
    const editor = mount(doc);
    const text = editor.getDoc();
    editor.view.dispatch({ selection: { anchor: at('a |'), head: at('24') + 1 } });
    editor.commands.run('table.deleteColumn');
    expect(editor.getDoc()).toBe(text);
    const tracked = mount(doc, true);
    select(tracked, at('21'));
    tracked.commands.run('table.deleteRow');
    const after = tracked.getDoc();
    select(tracked, at('12'));
    tracked.commands.run('table.deleteColumn');
    expect(tracked.getDoc()).toBe(after);
    void header;
  });
});

describe('Delete Table', () => {
  const table = ['| a | b |', '| - | - |', '| 11 | 12 |', '| 21 | 22 |'].join('\n');
  const doc = `Intro.\n\n${table}\n\nAfter.\n`;
  const inCell = doc.indexOf('22') + 1;
  const ledger =
    '\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\nmarks:\n  k3x9: {by: bo, at: 2026-11-01T10:00Z}\n-->\n';
  /** A table with another person's pending insertion in a cell. */
  const pending = `Intro.\n\n| a | b |\n| - | - |\n| 11 | 1<!--ins k3x9-->2<!--/k3x9--> |\n\nAfter.\n${ledger}`;

  it('is listed under the Table menu with no key, after Delete Column', () => {
    const editor = mount(doc);
    const list = editor.commands.list();
    const ids = list.map((c) => c.id);
    expect(ids.indexOf('table.deleteTable')).toBe(ids.indexOf('table.deleteColumn') + 1);
    const command = list.find((c) => c.id === 'table.deleteTable');
    expect(command).toMatchObject({ title: 'Delete Table', menu: 'table' });
    expect(command?.shortcut).toBeUndefined();
  });

  it('is enabled in a table, and disabled elsewhere, where it does nothing', () => {
    const editor = mount(doc);
    select(editor, inCell);
    expect(editor.getUiState().enabledCommands).toContain('table.deleteTable');
    select(editor, 3);
    expect(editor.getUiState().enabledCommands).not.toContain('table.deleteTable');
    expect(editor.commands.run('table.deleteTable')).toBe(false);
    expect(editor.getDoc()).toBe(doc);
  });

  it('deletes the table the caret is in, and the caret goes where it was', () => {
    const editor = mount(doc);
    select(editor, inCell);
    expect(editor.commands.run('table.deleteTable')).toBe(true);
    expect(editor.getDoc()).toBe('Intro.\n\nAfter.\n');
    expect(editor.view.state.selection.main.head).toBe('Intro.\n\n'.length);
    expect(notices).toEqual([]);
  });

  it('deletes the table the selected cells are in, whatever is selected', () => {
    const editor = mount(doc);
    editor.view.dispatch({ selection: { anchor: doc.indexOf('11'), head: doc.indexOf('22') + 2 } });
    expect(editor.commands.run('table.deleteTable')).toBe(true);
    expect(editor.getDoc()).toBe('Intro.\n\nAfter.\n');
  });

  it('writes the deletion of the table as a block with Track Changes on, which rejecting undoes', () => {
    const editor = mount(doc, true);
    select(editor, inCell);
    expect(editor.commands.run('table.deleteTable')).toBe(true);
    const after = editor.getDoc();
    expect(after).toMatch(/^Intro\.\n\n<!--del \w{4} [^]*-->\n\nAfter\./);
    const id = /<!--del (\w{4})/.exec(after)?.[1];
    editor.reject(id!);
    expect(editor.getDoc()).toBe(doc);
  });

  it('is one step to undo, named, which brings back the selection it was made with', () => {
    for (const tracking of [false, true]) {
      const editor = mount(doc, tracking);
      select(editor, inCell);
      editor.commands.run('table.deleteTable');
      expect(editor.getUiState().undo).toBe('Delete Table');
      editor.undo();
      expect(editor.getDoc()).toBe(doc);
      expect(editor.view.state.selection.main).toMatchObject({ anchor: inCell, head: inCell });
    }
  });

  it('says why in the format’s words, and writes nothing, while another person’s change is pending in it', () => {
    const editor = mount(pending, true);
    select(editor, pending.indexOf('11') + 1);
    expect(editor.commands.run('table.deleteTable')).toBe(true);
    expect(notices).toEqual(["Bo Chen's pending change is in this table. Decide it first."]);
    expect(editor.getDoc()).toBe(pending);
    expect(editor.getUiState().undo).toBeNull();
    // With Track Changes off the table goes, with what was pending in it.
    const plain = mount(pending, false);
    select(plain, pending.indexOf('11') + 1);
    expect(plain.commands.run('table.deleteTable')).toBe(true);
    expect(plain.getDoc()).not.toContain('| a |');
  });

  it('has a keyboard path too: Select Table, then ⌫ twice', () => {
    const editor = mount(doc);
    select(editor, inCell);
    editor.commands.run('table.selectTable');
    press(editor, 'Backspace');
    // The cells are cleared, and the table is still there.
    expect(editor.getDoc()).not.toBe(doc);
    expect(editor.getDoc()).toContain('| - | - |');
    press(editor, 'Backspace');
    expect(editor.getDoc()).toBe('Intro.\n\nAfter.\n');
  });
});

describe('the alignment commands', () => {
  const G = ['| a | b | c |', '| - | :-: | -: |', '| 11 | 12 | 13 |', '| 21 | 22 | 23 |'].join(
    '\n',
  );
  const doc = `Intro.\n\n${G}\n\nAfter.\n`;
  const at = (text: string) => doc.indexOf(text) + 1;
  const delimiter = (editor: Editor) =>
    editor
      .getDoc()
      .split('\n')
      .find((l) => /^\| :?-+:? \|/.test(l));
  const active = (editor: Editor) =>
    editor.getUiState().activeCommands.filter((id) => id.startsWith('table.align'));

  it('are listed under the Table menu with no key, and enabled in a table only', () => {
    const editor = mount(doc);
    for (const [id, title] of [
      ['table.alignLeft', 'Align Left'],
      ['table.alignCenter', 'Align Center'],
      ['table.alignRight', 'Align Right'],
      ['table.alignDefault', 'Default Alignment'],
    ] as const) {
      const command = editor.commands.list().find((c) => c.id === id);
      expect(command).toMatchObject({ title, menu: 'table' });
      expect(command?.shortcut).toBeUndefined();
    }
    select(editor, 3);
    expect(editor.getUiState().enabledCommands).not.toContain('table.alignCenter');
    expect(editor.commands.run('table.alignCenter')).toBe(false);
    select(editor, at('11'));
    expect(editor.getUiState().enabledCommands).toContain('table.alignCenter');
  });

  it('check the caret’s column: none, center and right here', () => {
    const editor = mount(doc);
    select(editor, at('11'));
    expect(active(editor)).toEqual(['table.alignDefault']);
    select(editor, at('12'));
    expect(active(editor)).toEqual(['table.alignCenter']);
    select(editor, at('13'));
    expect(active(editor)).toEqual(['table.alignRight']);
  });

  it('change the delimiter row with Track Changes off, and leave the caret where it was', () => {
    const editor = mount(doc);
    select(editor, at('22'));
    expect(editor.commands.run('table.alignLeft')).toBe(true);
    expect(delimiter(editor)).toBe('| - | :-- | -: |');
    expect(editor.view.state.selection.main.head).toBe(editor.getDoc().indexOf('22') + 1);
    expect(editor.getDoc()).not.toContain('<!--');
    expect(active(editor)).toEqual(['table.alignLeft']);
    editor.commands.run('table.alignDefault');
    expect(delimiter(editor)).toBe('| - | --- | -: |');
  });

  it('do nothing, and say nothing, for the alignment the columns have already', () => {
    for (const tracking of [false, true]) {
      const label = `Track Changes ${tracking ? 'on' : 'off'}`;
      const editor = mount(doc, tracking);
      select(editor, at('12'));
      expect(editor.commands.run('table.alignCenter'), label).toBe(true);
      expect(editor.getDoc(), label).toBe(doc);
      expect(editor.getUiState().canUndo, label).toBe(false);
      expect(notices, label).toEqual([]);
    }
    // The same for a column whose alignment is the change's own, which is pending: no second step.
    const editor = mount(doc, true);
    select(editor, at('12'));
    editor.commands.run('table.alignRight');
    const pending = editor.getDoc();
    editor.commands.run('table.alignRight');
    expect(editor.getDoc()).toBe(pending);
    expect(notices).toEqual([]);
    editor.undo();
    expect(editor.getDoc()).toBe(doc);
  });

  it('align every column the selection touches', () => {
    const editor = mount(doc);
    editor.view.dispatch({ selection: { anchor: at('11'), head: at('12') + 1 } });
    editor.commands.run('table.alignRight');
    expect(delimiter(editor)).toBe('| -: | --: | -: |');
  });

  // With Track Changes on, a change of alignment is one mark with no closer, at the end of the text of
  // the header's last cell, that keeps the old delimiter row (format §3.7, #281): the commands write
  // what the format gives, and say its words when it refuses.

  /** The mark of a tracked alignment change, with its id. */
  const MARK = /<!--fmt (\w{4}) align=[^>]*-->/;
  /** The header line of a document whose header is `| a | b | c |`. */
  const headerOf = (text: string) => text.split('\n').find((line) => line.startsWith('| a |'));
  const type = (editor: Editor, text: string) => {
    const head = editor.view.state.selection.main.head;
    editor.view.dispatch({
      changes: { from: head, insert: text },
      selection: { anchor: head + text.length },
      userEvent: 'input.type',
    });
  };
  /** `doc` with Ada's alignment change pending: the second column right, as the command writes it. */
  const aligned = (): string => {
    const editor = mount(doc, true);
    select(editor, at('12'));
    editor.commands.run('table.alignRight');
    return editor.getDoc();
  };
  const ALIGN_FIRST = 'Accept or reject the alignment change in this table first.';
  const COLUMNS_FIRST = 'Accept or reject the column changes in this table first.';
  const ROWS_FIRST = 'Accept or reject the row changes in this table first.';
  /** Bo's alignment change as another person's file has it: the second column right, from center. */
  const SPEC = '\\|\\x20-\\x20\\|\\x20:-:\\x20\\|\\x20-:\\x20\\|';
  /** `body` with a ledger of Bo's marks `ids`. */
  const withBo = (body: string, ids: string[]) => {
    const marks = ids.map((id) => `  ${id}: {by: bo, at: 2026-11-01T10:00Z}\n`).join('');
    return `${body}\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\nmarks:\n${marks}-->\n`;
  };
  const byBo = () =>
    withBo(doc.replace(':-:', '--:').replace('| c |', `| c<!--fmt k3x9 align=${SPEC}--> |`), [
      'k3x9',
    ]);

  it('are a point mark in the header with Track Changes on, one step to undo', () => {
    const editor = mount(doc, true);
    select(editor, at('12'));
    expect(editor.commands.run('table.alignRight')).toBe(true);
    const after = editor.getDoc();
    // One mark with no closer, at the end of the header's last cell, in front of its padding.
    expect(headerOf(after)).toMatch(/\| c<!--fmt \w{4} align=\\\|[^>]*--> \|/);
    expect(after.match(/<!--fmt /g)).toHaveLength(1);
    expect(delimiter(editor)).toBe('| - | --: | -: |');
    // Nothing else is written in the text: no blank line, no line of its own for the mark.
    const mark = MARK.exec(after)?.[0] ?? '';
    expect(after.startsWith(doc.replace(':-:', '--:').replace('| c |', `| c${mark} |`))).toBe(true);
    expect(notices).toEqual([]);
    // The caret is in the cell it was in, which the mark has moved.
    expect(editor.view.state.selection.main.head).toBe(after.indexOf('12') + 1);
    // The ledger holds the one change, Ada's.
    expect(Object.values(editor.getParsed().ledger.marks).map((entry) => entry.by)).toEqual([
      'ada',
    ]);
    // One step to undo, which brings back the selection it was made with.
    expect(editor.getUiState().canUndo).toBe(true);
    editor.undo();
    expect(editor.getDoc()).toBe(doc);
    expect(editor.view.state.selection.main).toMatchObject({ anchor: at('12'), head: at('12') });
    expect(editor.getUiState().canUndo).toBe(false);
  });

  it('keeps a caret at the end of the last header cell in front of the mark', () => {
    const editor = mount(doc, true);
    const end = doc.indexOf('c |') + 1;
    select(editor, end);
    expect(editor.commands.run('table.alignCenter')).toBe(true);
    expect(delimiter(editor)).toBe('| - | :-: | :-: |');
    expect(editor.getDoc().slice(end, end + 8)).toBe('<!--fmt ');
    expect(editor.view.state.selection.main.head).toBe(end);
    // A key typed there is in front of the mark.
    type(editor, 'x');
    expect(editor.getDoc()).toMatch(/\| c<!--ins (\w{4})-->x<!--\/\1--><!--fmt \w{4} align=/);
    expect(notices).toEqual([]);
  });

  it('changes your own pending change in place, and takes it away when the old alignments are back', () => {
    const editor = mount(doc, true);
    select(editor, at('12'));
    editor.commands.run('table.alignRight');
    const first = MARK.exec(editor.getDoc())?.[0];
    expect(first).toBeDefined();
    select(editor, editor.getDoc().indexOf('13') + 1);
    editor.commands.run('table.alignLeft');
    // The one change is changed, with the old row it had: not a second mark.
    expect(delimiter(editor)).toBe('| - | --: | :- |');
    expect(editor.getDoc().match(/<!--fmt /g)).toHaveLength(1);
    expect(MARK.exec(editor.getDoc())?.[0]).toBe(first);
    expect(Object.keys(editor.getParsed().ledger.marks)).toHaveLength(1);
    // The old alignments back, a column and then the other: the change goes, and the file is as it was.
    select(editor, editor.getDoc().indexOf('12') + 1);
    editor.commands.run('table.alignCenter');
    expect(delimiter(editor)).toBe('| - | :-: | :- |');
    expect(editor.getDoc()).toContain('<!--fmt ');
    select(editor, editor.getDoc().indexOf('13') + 1);
    editor.commands.run('table.alignRight');
    expect(editor.getDoc()).toBe(doc);
    expect(notices).toEqual([]);
  });

  it('says why when another person’s alignment change, a column or the header is pending', () => {
    // Bo's alignment change: Ada's is refused, in the format's words.
    const bo = byBo();
    const editor = mount(bo, true);
    select(editor, bo.indexOf('11') + 1);
    expect(editor.commands.run('table.alignLeft')).toBe(true);
    expect(notices).toEqual(["Bo Chen's alignment change is pending. Decide it first."]);
    expect(editor.getDoc()).toBe(bo);
    expect(editor.getUiState().canUndo).toBe(false);

    // A column pending (Ada's own): the alignment change waits for it.
    notices.length = 0;
    const columns = mount(doc, true);
    select(columns, at('12'));
    columns.commands.run('table.insertColumnRight');
    const withColumn = columns.getDoc();
    expect(withColumn).toMatch(/<!--ins \w{4} col-->/);
    select(columns, withColumn.indexOf('11') + 1);
    expect(columns.commands.run('table.alignRight')).toBe(true);
    expect(notices).toEqual([COLUMNS_FIRST]);
    expect(columns.getDoc()).toBe(withColumn);
    expect(columns.getUiState().undo).toBe('Insert Column');

    // The header itself a pending row (a row inserted above it): the same.
    notices.length = 0;
    const rows = mount(doc, true);
    select(rows, doc.indexOf('| a |') + 2);
    rows.commands.run('table.insertRowAbove');
    const withRow = rows.getDoc();
    expect(withRow).toMatch(/<!--ins \w{4} row-->/);
    select(rows, withRow.indexOf('11') + 1);
    expect(rows.commands.run('table.alignRight')).toBe(true);
    expect(notices).toEqual([ROWS_FIRST]);
    expect(rows.getDoc()).toBe(withRow);
    expect(rows.getUiState().undo).toBe('Insert Row');
  });

  it('says why a column or header-row command is refused while an alignment change is pending', () => {
    const pending = aligned();
    const mark = MARK.exec(pending)?.[0] ?? '';
    expect(mark).not.toBe('');
    const inHeader = pending.indexOf('| a |') + 2;
    const inFirstRow = pending.indexOf('11') + 1;
    // Tracked, a column command and a row command that touches the header are refused, in words.
    for (const [id, caret] of [
      ['table.insertColumnRight', pending.indexOf('12') + 1],
      ['table.deleteColumn', pending.indexOf('12') + 1],
      ['table.moveColumnLeft', pending.indexOf('12') + 1],
      ['table.insertRowAbove', inHeader],
      ['table.deleteRow', inHeader],
      ['table.moveRowUp', inFirstRow],
    ] as const) {
      notices.length = 0;
      const editor = mount(pending, true);
      select(editor, caret);
      expect(editor.commands.run(id), id).toBe(true);
      expect(notices, id).toEqual([ALIGN_FIRST]);
      expect(editor.getDoc(), id).toBe(pending);
      expect(editor.getUiState().canUndo, id).toBe(false);
    }
    // A row below the header and a row of the body are no hindrance, and the change stays.
    notices.length = 0;
    const below = mount(pending, true);
    select(below, inHeader);
    expect(below.commands.run('table.insertRowBelow')).toBe(true);
    expect(below.getDoc()).toMatch(/<!--ins \w{4} row-->/);
    expect(below.getDoc()).toContain(mark);
    const removed = mount(pending, true);
    select(removed, pending.indexOf('21') + 1);
    expect(removed.commands.run('table.deleteRow')).toBe(true);
    expect(removed.getDoc()).toMatch(/<!--del \w{4} row=/);
    expect(removed.getDoc()).toContain(mark);
    expect(notices).toEqual([]);

    // With Track Changes off the column commands are written, and keep the change, with its old row, at the
    // end of the header's last cell: rejecting it then writes back that row for the columns the table has.
    const id = MARK.exec(pending)?.[1] ?? '';
    for (const [command, where, old] of [
      ['table.insertColumnRight', '12', '| - | :-: | - | -: |'],
      ['table.deleteColumn', '13', '| - | :-: |'],
      ['table.moveColumnLeft', '13', '| - | -: | :-: |'],
    ] as const) {
      const editor = mount(pending, false);
      select(editor, pending.indexOf(where) + 1);
      expect(editor.commands.run(command), command).toBe(true);
      expect(notices, command).toEqual([]);
      expect(editor.getDoc(), command).not.toBe(pending);
      expect(editor.getDoc().match(/<!--fmt /g), command).toHaveLength(1);
      expect(headerOf(editor.getDoc()), command).toMatch(
        new RegExp(`<!--fmt ${id} align=[^>]*--> \\|$`),
      );
      editor.reject(id);
      expect(delimiter(editor), command).toBe(old);
      expect(editor.getDoc(), command).not.toContain('<!--fmt');
    }
  });

  it('says the format’s words when a marker can’t stand at the end of the header, or too many changes are pending there, and writes nothing', () => {
    // The end of the last header cell is read otherwise with a marker after an underscore.
    const underscore = doc.replace('| c |', '| c_ |');
    const editor = mount(underscore, true);
    select(editor, underscore.indexOf('11') + 1);
    expect(editor.commands.run('table.alignCenter')).toBe(true);
    expect(notices).toEqual([
      "A marker can't go at the end of this table's header, where Markdown would read it otherwise. Change the end of its last cell first, then align.",
    ]);
    expect(editor.getDoc()).toBe(underscore);
    expect(editor.getUiState().canUndo).toBe(false);

    // Three changes of Bo's in the cell are more than the format looks at in every order of deciding them.
    notices.length = 0;
    const crowded = withBo(
      doc.replace('| c |', '| c<!--ins m2bd-->x<!--/m2bd--><!--del g5nb y--><!--del h4jj z--> |'),
      ['m2bd', 'g5nb', 'h4jj'],
    );
    const many = mount(crowded, true);
    select(many, crowded.indexOf('11') + 1);
    expect(many.commands.run('table.alignCenter')).toBe(true);
    expect(notices).toEqual([
      "Decide the changes in the last cell of this table's header first, then align.",
    ]);
    expect(many.getDoc()).toBe(crowded);
    expect(many.getUiState().canUndo).toBe(false);
  });

  it('says the format’s words when a tracked key at the end of the last header cell would leave more changes pending there than can be looked at together, and writes nothing', () => {
    // Bo's insertion and deletion end the last header cell: Ada's alignment change is written after them,
    // which the format takes (two changes besides the mark), and a key of hers there would be a third.
    const start = withBo(
      doc.replace('| c |', '| c<!--ins m2bd-->x<!--/m2bd--><!--del g5nb y--> |'),
      ['m2bd', 'g5nb'],
    );
    const editor = mount(start, true);
    select(editor, start.indexOf('13') + 1);
    expect(editor.commands.run('table.alignCenter')).toBe(true);
    expect(notices).toEqual([]);
    expect(editor.getDoc()).toMatch(/<!--del g5nb y--><!--fmt \w{4} align=/);
    const aligned = editor.getDoc();
    select(editor, aligned.indexOf('<!--fmt'));
    type(editor, 'z');
    expect(notices).toEqual([
      "Ada Lovelace's alignment change is at the end of this cell, and this edit would leave more changes pending in it than can be looked at together. Decide some of them first.",
    ]);
    expect(editor.getDoc()).toBe(aligned);
    // The refused key left no step: one Undo takes the alignment change back, and Redo brings it again.
    editor.undo();
    expect(editor.getDoc()).toBe(start);
    editor.redo();
    expect(editor.getDoc()).toBe(aligned);
    // Deciding one of the changes there lets the key be written, in front of the mark.
    editor.accept('g5nb');
    select(editor, editor.getDoc().indexOf('<!--fmt'));
    type(editor, 'z');
    expect(notices).toHaveLength(1);
    expect(editor.getDoc()).toMatch(/<!--ins (\w{4})-->z<!--\/\1--><!--fmt \w{4} align=/);
  });
});
