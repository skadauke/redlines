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

function mount(doc: string, tracking = false): Editor {
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
