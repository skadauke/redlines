// @vitest-environment happy-dom
// ⌫ and ⌦ that take the last character of a bare row's first or last cell (format §3.7, rule 7): the
// table keeps its cells, tracked or not, because the row's outer pipe is written plain.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { tablesOf } from './model.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const BARE = 'x | b\n--- | ---\nc | d\n';

function load(tracking: boolean): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: BARE,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking,
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  return editor;
}
const press = (editor: Editor, key: string) =>
  runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key, bubbles: true }), 'editor');
const columns = (editor: Editor) => tablesOf(editor.view.state)[0]?.columns;
const rows = (editor: Editor) => tablesOf(editor.view.state)[0]?.rows.length;

describe('⌫ and ⌦ in the last cell of a bare row', () => {
  for (const tracking of [false, true]) {
    for (const [key, where] of [
      ['Backspace', 'after'],
      ['Delete', 'before'],
    ] as const) {
      it(`keep the table's cells: ${key}, Track Changes ${tracking ? 'on' : 'off'}`, () => {
        const editor = load(tracking);
        const at = BARE.indexOf('b') + (where === 'after' ? 1 : 0);
        editor.view.dispatch({ selection: { anchor: at } });
        expect(press(editor, key)).toBe(true);
        expect(editor.getDoc()).not.toBe(BARE);
        expect(columns(editor)).toBe(2);
        expect(rows(editor)).toBe(2);
        // The outer pipe is plain, and the cell is empty (tracked, its text is struck).
        expect(editor.getDoc().split('\n')[0]).toMatch(/\| .*\|$/);
        expect(editor.getDoc().split('\n')[0]?.endsWith(' |')).toBe(true);
      });
    }
    it(`keep the table's cells: ⌫ in the first cell, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      const editor = load(tracking);
      editor.view.dispatch({ selection: { anchor: BARE.indexOf('x') + 1 } });
      expect(press(editor, 'Backspace')).toBe(true);
      expect(columns(editor)).toBe(2);
      expect(rows(editor)).toBe(2);
      expect(editor.getDoc().startsWith('| ')).toBe(true);
    });
  }
});
