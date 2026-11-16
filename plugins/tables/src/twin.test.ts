// @vitest-environment happy-dom
// An HTML table with a Markdown twin (#690): the Table menu's commands convert it to its pipe table
// first, as one change; where the table has spans, a caption or more than a pipe table says, the
// commands are disabled with their reason.
import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { createTables } from './index.ts';

const notices: string[] = [];
const mounted: { editor: Editor; remove: () => void }[] = [];

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

const HTML =
  '<table>\n  <thead><tr><th>Name</th><th>Role</th></tr></thead>\n  <tbody><tr><td>Ada</td><td>Author</td></tr></tbody>\n</table>\n';

function caretIn(editor: Editor, needle: string): void {
  editor.view.dispatch({ selection: { anchor: editor.getDoc().indexOf(needle) + 1 } });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
}

describe('an HTML table', () => {
  it('Insert Row Below converts it to a pipe table and adds the row', () => {
    const editor = mount(HTML);
    caretIn(editor, 'Ada');
    expect(editor.getUiState().disabledReasons['table.insertRowBelow']).toBeUndefined();
    expect(editor.commands.run('table.insertRowBelow')).toBe(true);
    expect(editor.getDoc()).toBe('| Name | Role |\n| --- | --- |\n| Ada | Author |\n|  |  |\n');
  });

  it('Insert Column Right converts it too', () => {
    const editor = mount(HTML);
    caretIn(editor, 'Ada');
    expect(editor.commands.run('table.insertColumnRight')).toBe(true);
    expect(editor.getDoc().startsWith('| Name |  | Role |\n')).toBe(true);
  });

  it('tracked: the conversion is a substitution, and its card names it', () => {
    const editor = mount(HTML, true);
    caretIn(editor, 'Ada');
    editor.commands.run('table.insertRowBelow');
    const doc = editor.getDoc();
    // The HTML is the substitution's old text, and the ledger's note names the conversion.
    expect(doc).toMatch(/<!--sub \w+ <table>/);
    expect(doc).toContain('note: Converted the table to Markdown');
  });

  it('is disabled, with its reason, when it has a caption or a span', () => {
    for (const html of [
      '<table><caption>Names</caption><tr><th>Name</th></tr></table>\n',
      '<table><tr><th colspan="2">Name</th></tr></table>\n',
      '<table><tr><th>Name</th></tr><tr><td>a | b</td></tr></table>\n',
    ]) {
      const editor = mount(html);
      caretIn(editor, 'Name');
      const reason = editor.getUiState().disabledReasons['table.insertRowBelow'];
      expect(reason, html).toMatch(/can't be changed as Markdown/);
      expect(editor.commands.run('table.insertRowBelow')).toBe(false);
      expect(editor.getDoc()).toBe(html);
      expect(notices.at(-1)).toBe(reason);
    }
  });

  it('keeps the text editable in place: typing in a cell changes only the cell', () => {
    const editor = mount(HTML);
    caretIn(editor, 'Ada');
    editor.view.dispatch({ changes: { from: editor.view.state.selection.main.head, insert: 'x' } });
    expect(editor.getDoc()).toBe(HTML.replace('Ada', 'Axda'));
  });
});
