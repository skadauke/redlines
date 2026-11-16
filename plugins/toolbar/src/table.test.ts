// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import {
  createEditor,
  type Editor,
  type EditorCommand,
  headInTable,
  selectRect,
} from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { MENUS, shownBar } from './items.ts';
import { createToolbar } from './index.ts';

const T = 'Intro.\n\n| a | b |\n| - | - |\n| one | two |\n| three | four |\n\nAfter.\n';
const editors: Editor[] = [];

function mount(doc = T): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' } });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  editors.push(editor);
  return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** The Table menu's commands, as the tables plugin registers them (they work only in a table). */
const commands: EditorCommand[] = MENUS.find((menu) => menu.id === 'table')!.rows.flatMap((row) =>
  row.map(({ command: id }) => ({
    id,
    title: id === 'table.deleteTable' ? 'Delete Table' : id,
    run: () => true,
    disabledReason: (state) => (headInTable(state) ? undefined : 'Not in a table.'),
  })),
);

const at = (editor: Editor, text: string) =>
  editor.view.dispatch({
    selection: { anchor: editor.view.state.doc.toString().indexOf(text) + 1 },
  });
const table = (editor: Editor) =>
  shownBar(commands, editor.view.state).menus.find((menu) => menu.id === 'table');
/** The ids of the items that are dimmed. */
const dimmed = (editor: Editor) =>
  table(editor)
    ?.rows.flat()
    .filter((item) => !item.enabled)
    .map((item) => item.id);

describe('the Table menu', () => {
  it('is in the bar only in a table', () => {
    const editor = mount();
    at(editor, 'Intro');
    expect(table(editor)).toBeUndefined();
    at(editor, 'one');
    expect(table(editor)?.label).toBe('Table');
  });

  it('puts Row and Column side by side, the same six actions on each, then Align and Delete Table', () => {
    const editor = mount();
    at(editor, 'one');
    const menu = table(editor)!;
    expect(menu.sides).toEqual(['Row', 'Column']);
    expect(menu.rows.map((row) => row.map((item) => item.label))).toEqual([
      ['Insert Above', 'Insert Left'],
      ['Insert Below', 'Insert Right'],
      ['Move Up', 'Move Left'],
      ['Move Down', 'Move Right'],
      ['Select', 'Select'],
      ['Delete', 'Delete'],
      ['Left', 'Center', 'Right'],
      ['Delete Table'],
    ]);
    expect(menu.rows[6]?.[0]?.caption).toBe('Align column');
    expect(dimmed(editor)).toEqual([]);
  });

  it('says in its header where the caret is and what is selected', () => {
    const editor = mount();
    at(editor, 'two');
    expect(table(editor)?.heading).toBe('Table · Row 2, column 2');
    selectRect(editor.view, 'row');
    expect(table(editor)?.heading).toBe('Row 2 selected');
    at(editor, 'two');
    selectRect(editor.view, 'column');
    expect(table(editor)?.heading).toBe('Column 2 selected');
    at(editor, 'two');
    selectRect(editor.view, 'table');
    expect(table(editor)?.heading).toBe('Whole table selected');
  });

  it('dims the Column side with a row selected, and the Row side with a column', () => {
    const editor = mount();
    at(editor, 'one');
    selectRect(editor.view, 'row');
    expect(dimmed(editor)).toEqual([
      'table.insertColumnLeft',
      'table.insertColumnRight',
      'table.moveColumnLeft',
      'table.moveColumnRight',
      'table.selectColumn',
      'table.deleteColumn',
      'table.alignLeft',
      'table.alignCenter',
      'table.alignRight',
    ]);
    at(editor, 'one');
    selectRect(editor.view, 'column');
    expect(dimmed(editor)).toEqual([
      'table.insertRowAbove',
      'table.insertRowBelow',
      'table.moveRowUp',
      'table.moveRowDown',
      'table.selectRow',
      'table.deleteRow',
    ]);
    const item = table(editor)
      ?.rows.flat()
      .find((i) => i.id === 'table.deleteRow');
    expect(item?.reason).toMatch(/Columns are selected/);
  });

  it('names the two sides of a line for assistive technology', () => {
    const editor = mount();
    at(editor, 'one');
    const items = table(editor)?.rows.flat() ?? [];
    expect(items.find((i) => i.id === 'table.selectRow')?.side).toBe('row');
    expect(items.find((i) => i.id === 'table.selectColumn')?.side).toBe('column');
    expect(items.find((i) => i.id === 'table.alignLeft')?.side).toBe('align column');
  });

  it('keeps its header up to date as the selection moves, without drawing the menu again', () => {
    const editor = mount();
    editor.commands.register(commands);
    const toolbar = createToolbar(editor, { notice: () => {} });
    at(editor, 'one');
    toolbar.show();
    const head = () =>
      document.querySelector('.rl-toolbar-menu[aria-label="Table"] .rl-toolbar-menu-head');
    const element = head();
    expect(element?.textContent).toBe('Table · Row 2, column 1');
    at(editor, 'four');
    expect(head()).toBe(element);
    expect(head()?.textContent).toBe('Table · Row 3, column 2');
    selectRect(editor.view, 'column');
    expect(head()?.textContent).toBe('Column 2 selected');
    toolbar.destroy();
  });
});
