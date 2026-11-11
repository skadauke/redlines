// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { createEditor, type Editor } from '@redlines/editor';
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
      title: 'Insert Row Below',
      shortcut: 'Mod-Enter',
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
      'table.insertRowBelow',
    ]);
  });
});
