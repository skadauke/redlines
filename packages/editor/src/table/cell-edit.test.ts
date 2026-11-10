// @vitest-environment happy-dom
// Return, Backspace, Delete and typing in a cell (design: tables, "The caret and the keys"), as
// keystroke scripts with Track Changes off and on: ↩ and ⇧↩ write `<br>`, ⌫ and ⌦ never cross a
// cell's edge, a typed `|` is written `\|`, and what a person drops on a cell goes in as the cell's
// text.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { type Script, scriptRows, type Step } from '../blocks/script.ts';
import { createEditor, type Editor } from '../index.ts';

interface Row {
  name: string;
  doc: string;
  keys: Step[];
  off: Script['expect'];
  on: Script['expect'];
  skipOn?: Script['skip'];
  skipOff?: Script['skip'];
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) => [
    {
      name: `${row.name}, Track Changes off`,
      doc: row.doc,
      keys: row.keys,
      tc: false,
      expect: row.off,
      ...(row.skipOff ? { skip: row.skipOff } : {}),
    },
    {
      name: `${row.name}, Track Changes on`,
      doc: row.doc,
      keys: row.keys,
      tc: true,
      expect: row.on,
      ...(row.skipOn ? { skip: row.skipOn } : {}),
    },
  ]);

/** The same in both. */
const same = (caret: string) => ({ off: { caret }, on: { caret } });

const TAKE_BACK = 'Backspace after a Return over a selection leaves the deleted text deleted';

const HEAD = '| a | b |⏎| - | - |⏎';

describe('Return and Shift-Return in a cell', () => {
  scriptRows(
    both([
      {
        name: 'Return writes a line break in the cell',
        doc: `${HEAD}| 1‸2 | 3 |`,
        keys: ['Enter'],
        off: { caret: `${HEAD}| 1<br>‸2 | 3 |` },
        on: { caret: `${HEAD}| 1<ins><br>‸</ins>2 | 3 |` },
      },
      {
        name: 'Shift-Return writes the same',
        doc: `${HEAD}| 1‸2 | 3 |`,
        keys: ['Shift-Enter'],
        off: { caret: `${HEAD}| 1<br>‸2 | 3 |` },
        on: { caret: `${HEAD}| 1<ins><br>‸</ins>2 | 3 |` },
      },
      {
        name: 'Option-Return too',
        doc: `${HEAD}| 1‸2 | 3 |`,
        keys: ['Alt-Enter'],
        off: { caret: `${HEAD}| 1<br>‸2 | 3 |` },
        on: { caret: `${HEAD}| 1<ins><br>‸</ins>2 | 3 |` },
      },
      {
        name: 'Return replaces a selection in the cell',
        doc: `${HEAD}| 1[2] | 3 |`,
        keys: ['Enter'],
        off: { caret: `${HEAD}| 1<br>‸ | 3 |` },
        on: { caret: `${HEAD}| 1<sub 2><br>‸</sub> | 3 |` },
        skipOff: { 'take-back': TAKE_BACK },
        skipOn: { 'take-back': TAKE_BACK },
      },
      {
        name: 'Return in an empty cell',
        doc: `${HEAD}| ‸ | 3 |`,
        keys: ['Enter'],
        off: { caret: `${HEAD}| <br>‸ | 3 |` },
        on: { caret: `${HEAD}| <ins><br>‸</ins> | 3 |` },
      },
      {
        name: 'Return in the header',
        doc: '| a‸ | b |⏎| - | - |⏎| 1 | 3 |',
        keys: ['Enter'],
        off: { caret: '| a<br>‸ | b |⏎| - | - |⏎| 1 | 3 |' },
        on: { caret: '| a<ins><br>‸</ins> | b |⏎| - | - |⏎| 1 | 3 |' },
      },
      {
        name: 'a second Return writes a second break',
        doc: `${HEAD}| 1‸2 | 3 |`,
        keys: ['Enter', 'Enter'],
        off: { caret: `${HEAD}| 1<br><br>‸2 | 3 |` },
        on: { caret: `${HEAD}| 1<ins><br><br>‸</ins>2 | 3 |` },
      },
    ]),
  );
});

describe('Backspace and Delete in a cell', () => {
  scriptRows(
    both([
      {
        name: '⌫ after a line break deletes all of it',
        doc: `${HEAD}| 1<br>‸2 | 3 |`,
        keys: ['Backspace'],
        off: { caret: `${HEAD}| 1‸2 | 3 |` },
        on: { caret: `${HEAD}| 1‸<del <br>>2 | 3 |` },
      },
      {
        name: '⌫ after a line break that is a tracked insertion takes it back',
        doc: `${HEAD}| 1<ins><br></ins>‸2 | 3 |`,
        keys: ['Backspace'],
        off: { caret: `${HEAD}| 1‸2 | 3 |` },
        on: { caret: `${HEAD}| 1‸2 | 3 |` },
      },
      {
        name: '⌦ in front of a line break deletes all of it',
        doc: `${HEAD}| 1‸<br>2 | 3 |`,
        keys: ['Delete'],
        off: { caret: `${HEAD}| 1‸2 | 3 |` },
        on: { caret: `${HEAD}| 1<del <br>>‸2 | 3 |` },
      },
      {
        name: '⌫ at the start of a cell does nothing',
        doc: `${HEAD}| 1 | ‸3 |`,
        keys: ['Backspace'],
        ...same(`${HEAD}| 1 | ‸3 |`),
      },
      {
        name: '⌫ in an empty cell does nothing',
        doc: `${HEAD}| 1 | ‸ |`,
        keys: ['Backspace'],
        ...same(`${HEAD}| 1 | ‸ |`),
      },
      {
        name: '⌫ at the start of the first cell of a row does nothing',
        doc: `${HEAD}| ‸1 | 3 |`,
        keys: ['Backspace'],
        ...same(`${HEAD}| ‸1 | 3 |`),
      },
      {
        name: '⌦ at the end of a cell does nothing',
        doc: `${HEAD}| 1‸ | 3 |`,
        keys: ['Delete'],
        ...same(`${HEAD}| 1‸ | 3 |`),
      },
      {
        name: '⌦ at the end of the last cell does nothing',
        doc: `${HEAD}| 1 | 3‸ |`,
        keys: ['Delete'],
        ...same(`${HEAD}| 1 | 3‸ |`),
      },
      {
        name: '⌫ in the middle of a cell deletes the character',
        doc: `${HEAD}| 12‸3 | 4 |`,
        keys: ['Backspace'],
        off: { caret: `${HEAD}| 1‸3 | 4 |` },
        on: { caret: `${HEAD}| 1‸<del 2>3 | 4 |` },
      },
      {
        name: '⌦ in the middle of a cell deletes the character',
        doc: `${HEAD}| 1‸23 | 4 |`,
        keys: ['Delete'],
        off: { caret: `${HEAD}| 1‸3 | 4 |` },
        on: { caret: `${HEAD}| 1<del 2>‸3 | 4 |` },
      },
      {
        name: '⌫ deletes an emoji at a cell’s edge whole',
        doc: `${HEAD}| a😀‸ | 4 |`,
        keys: ['Backspace'],
        off: { caret: `${HEAD}| a‸ | 4 |` },
        on: { caret: `${HEAD}| a‸<del 😀> | 4 |` },
      },
      {
        name: '⌦ deletes an emoji at a cell’s edge whole',
        doc: `${HEAD}| ‸😀a | 4 |`,
        keys: ['Delete'],
        off: { caret: `${HEAD}| ‸a | 4 |` },
        on: { caret: `${HEAD}| <del 😀>‸a | 4 |` },
      },
      {
        name: '⌫ after a combining mark deletes the mark, as in a paragraph, and never a pipe',
        doc: `${HEAD}| ae\u0301‸ | 4 |`,
        keys: ['Backspace'],
        off: { caret: `${HEAD}| ae‸ | 4 |` },
        on: { caret: `${HEAD}| ae‸<del \u0301> | 4 |` },
      },
      {
        name: '⌥⌫ deletes a word and stops at the cell’s start',
        doc: `${HEAD}| one two‸ | 4 |`,
        keys: ['Alt-Backspace'],
        off: { caret: `${HEAD}| one‸  | 4 |` },
        on: { caret: `${HEAD}| one ‸<del two> | 4 |` },
      },
      {
        name: '⌥⌫ at the start of a cell does nothing',
        doc: `${HEAD}| 1 | ‸two |`,
        keys: ['Alt-Backspace'],
        ...same(`${HEAD}| 1 | ‸two |`),
      },
      {
        name: '⌥⌦ deletes a word and stops at the cell’s end',
        doc: `${HEAD}| ‸one two | 4 |`,
        keys: ['Alt-Delete'],
        off: { caret: `${HEAD}|  ‸two | 4 |` },
        on: { caret: `${HEAD}| <del one>‸ two | 4 |` },
      },
      {
        name: '⌥⌦ at the end of a cell does nothing',
        doc: `${HEAD}| 1‸ | two |`,
        keys: ['Alt-Delete'],
        ...same(`${HEAD}| 1‸ | two |`),
      },
      {
        name: '⌘⌫ never goes past the cell’s start',
        doc: `${HEAD}| 1 | ‸two |`,
        keys: ['Mod-Backspace'],
        ...same(`${HEAD}| 1 | ‸two |`),
      },
      {
        name: '⌘⌦ never goes past the cell’s end',
        doc: `${HEAD}| 1‸ | two |`,
        keys: ['Mod-Delete'],
        ...same(`${HEAD}| 1‸ | two |`),
      },
    ]),
  );
});

describe('typing in a cell', () => {
  scriptRows(
    both([
      {
        name: 'a typed pipe is written escaped',
        doc: `${HEAD}| 1‸2 | 3 |`,
        keys: [{ type: '|' }],
        off: { caret: `${HEAD}| 1\\|‸2 | 3 |` },
        on: { caret: `${HEAD}| 1<ins>\\|‸</ins>2 | 3 |` },
      },
      {
        name: 'a pipe typed after a backslash is the one it escapes',
        doc: `${HEAD}| 1\\‸2 | 3 |`,
        keys: [{ type: '|' }],
        off: { caret: `${HEAD}| 1\\|‸2 | 3 |` },
        on: { caret: `${HEAD}| 1<sub \\2>\\|‸2</sub> | 3 |` },
      },
      {
        name: 'a letter typed in an empty cell lands inside it',
        doc: `${HEAD}| ‸ | 3 |`,
        keys: [{ type: 'x' }],
        off: { caret: `${HEAD}| x‸ | 3 |` },
        on: { caret: `${HEAD}| <ins>x‸</ins> | 3 |` },
      },
      {
        name: 'a letter typed after a line break lands in the cell, after it',
        doc: `${HEAD}| 1<br>‸ | 3 |`,
        keys: [{ type: 'x' }],
        off: { caret: `${HEAD}| 1<br>x‸ | 3 |` },
        on: { caret: `${HEAD}| 1<br><ins>x‸</ins> | 3 |` },
      },
      {
        name: 'typing next to an emoji at a cell’s edge',
        doc: `${HEAD}| 😀‸ | 3 |`,
        keys: [{ type: 'x' }],
        off: { caret: `${HEAD}| 😀x‸ | 3 |` },
        on: { caret: `${HEAD}| 😀<ins>x‸</ins> | 3 |` },
      },
      {
        name: 'typing after a combining mark at a cell’s edge',
        doc: `${HEAD}| e\u0301‸ | 3 |`,
        keys: [{ type: 'x' }],
        off: { caret: `${HEAD}| e\u0301x‸ | 3 |` },
        on: { caret: `${HEAD}| e\u0301<ins>x‸</ins> | 3 |` },
      },
    ]),
  );
});

describe('text dropped or pasted on a cell', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  function drop(doc: string, text: string, userEvent = 'input.drop', tracking = false): string {
    const at = doc.indexOf('‸');
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: doc.replace('‸', ''),
      author: { handle: 'ada', name: 'Ada Lovelace' },
      tracking,
    });
    open.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    editor.view.dispatch({
      changes: { from: at, insert: text },
      selection: { anchor: at + text.length },
      userEvent,
    });
    return editor.getDoc();
  }

  const T = '| a | b |\n| - | - |\n| 1‸2 | 3 |';
  it('writes its pipes escaped and its line breaks as <br>', () => {
    expect(drop(T, 'a|b\nc')).toBe('| a | b |\n| - | - |\n| 1a\\|b<br>c2 | 3 |');
    expect(drop(T, 'a|b\r\nc', 'input.paste')).toBe('| a | b |\n| - | - |\n| 1a\\|b<br>c2 | 3 |');
  });

  it('leaves a pipe that a backslash escapes', () => {
    expect(drop(T, 'a\\|b')).toBe('| a | b |\n| - | - |\n| 1a\\|b2 | 3 |');
  });

  it('does it with Track Changes on, as one insertion', () => {
    const text = drop(T, 'a|b\nc', 'input.drop', true);
    expect(text).toMatch(/\| 1<!--ins \w+-->a\\\|b<br>c<!--\/\w+-->2 \| 3 \|/);
  });

  it('writes plain text in a cell as it is', () => {
    expect(drop(T, 'abc')).toBe('| a | b |\n| - | - |\n| 1abc2 | 3 |');
  });
});

describe('a table in a CRLF file', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  const doc = '| a | b |\r\n| - | - |\r\n| 12 | 3 |\r\n';
  function mount(tracking: boolean): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc,
      author: { handle: 'ada', name: 'Ada Lovelace' },
      tracking,
    });
    open.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    const at = editor.view.state.doc.toString().indexOf('2 |');
    editor.view.dispatch({ selection: { anchor: at } });
    return editor;
  }
  const press = (editor: Editor, key: string) =>
    runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key, bubbles: true }), 'editor');

  it('writes a break and Backspace takes it back, with Track Changes off', () => {
    const editor = mount(false);
    press(editor, 'Enter');
    expect(editor.getDoc()).toBe(doc.replace('12', '1<br>2'));
    press(editor, 'Backspace');
    expect(editor.getDoc()).toBe(doc);
  });

  it('writes a break as an insertion, and rejecting it gives every byte back', () => {
    const editor = mount(true);
    press(editor, 'Enter');
    const after = editor.getDoc();
    expect(after).toMatch(/\| 1<!--ins \w+--><br><!--\/\w+-->2 \| 3 \|/);
    // Every line break the file has is the file's own, a CR and an LF.
    expect(after.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const marks = parse(after).marks.filter((mark) => mark.kind === 'ins');
    expect(marks).toHaveLength(1);
    editor.reject(marks[0]!.id);
    expect(editor.getDoc()).toBe(doc);
  });
});
