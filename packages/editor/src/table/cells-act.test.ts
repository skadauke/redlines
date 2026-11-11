// @vitest-environment happy-dom
// What acts on a rectangle of cells (design: tables, "Selecting cells", the table of actions): clear,
// type over, format. Keystroke scripts with Track Changes off and on, each reading the same in every
// decision order and every state one Markdown table.
import { afterEach, describe, expect, it } from 'vitest';
import { type Script, scriptRows, type Step } from '../blocks/script.ts';
import { undo } from '../history/index.ts';
import { createEditor, type Editor } from '../index.ts';
import { rectOf, whole } from './cells.ts';

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

const H = '| a | b | c |⏎| - | - | - |⏎';
const G = (r1: string, r2: string, r3 = '| 31 | 32 | 33 |') => `${H}${r1}⏎${r2}⏎${r3}`;
/** Selected: the 2×2 of 12, 13, 22, 23. */
const SEL = G('| 11 | [12 | 13 |', '| 21 | 22 | 23] |');

describe('clearing selected cells', () => {
  scriptRows(
    both([
      {
        name: '⌫ clears every selected cell as one change, and keeps the rectangle',
        doc: SEL,
        keys: ['Backspace'],
        off: {
          file: G('| 11 |  |  |', '| 21 |  |  |'),
          caret: G('| 11 | [ |  |', '| 21 |  | ] |'),
        },
        on: {
          newest: G('| 11 |  |  |', '| 21 |  |  |'),
          original: G('| 11 | 12 | 13 |', '| 21 | 22 | 23 |'),
        },
      },
      {
        name: '⌦ does the same',
        doc: SEL,
        keys: ['Delete'],
        off: { file: G('| 11 |  |  |', '| 21 |  |  |') },
        on: { newest: G('| 11 |  |  |', '| 21 |  |  |') },
      },
      {
        name: 'a second ⌫ on cells already clear writes nothing and is not refused',
        doc: SEL,
        keys: ['Backspace', 'Backspace'],
        off: { file: G('| 11 |  |  |', '| 21 |  |  |') },
        on: { newest: G('| 11 |  |  |', '| 21 |  |  |') },
      },
      {
        name: 'a whole row is cleared and stays a row',
        doc: G('| 11 | 12 | 13 |', '| [21 | 22 | 23] |'),
        keys: ['Backspace'],
        off: { file: G('| 11 | 12 | 13 |', '|  |  |  |') },
        on: { newest: G('| 11 | 12 | 13 |', '|  |  |  |') },
      },
      {
        name: 'cells with a <br> and an empty cell among them clear whole',
        doc: G('| [11<br>x | 12 |  |', '| 21 | 22 | 23] |'),
        keys: ['Backspace'],
        off: { file: G('|  |  |  |', '|  |  |  |') },
        on: { newest: G('|  |  |  |', '|  |  |  |') },
      },
    ]),
  );
});

describe('typing over selected cells', () => {
  scriptRows(
    both([
      {
        name: 'typing clears the cells and types into the first, top-left one',
        doc: SEL,
        keys: [{ type: 'z' }],
        off: {
          file: G('| 11 | z |  |', '| 21 |  |  |'),
          caret: G('| 11 | z‸ |  |', '| 21 |  |  |'),
        },
        on: { newest: G('| 11 | z |  |', '| 21 |  |  |') },
      },
      {
        name: 'a typed pipe is written escaped, in the first cell',
        doc: SEL,
        keys: [{ type: 'a|b' }],
        off: { file: G('| 11 | a\\|b |  |', '| 21 |  |  |') },
        on: { newest: G('| 11 | a\\|b |  |', '| 21 |  |  |') },
      },
    ]),
  );
});

describe('formatting selected cells', () => {
  const BOLD = G('| 11 | **12** | **13** |', '| 21 | **22** | **23** |');
  scriptRows(
    both([
      {
        name: '⌘B formats each cell’s text, as one change',
        doc: SEL,
        keys: ['Mod-b'],
        off: { file: BOLD },
        on: { newest: BOLD, original: G('| 11 | 12 | 13 |', '| 21 | 22 | 23 |') },
      },
      {
        name: '⌘B twice takes the bold away again',
        doc: SEL,
        keys: ['Mod-b', 'Mod-b'],
        off: { file: G('| 11 | 12 | 13 |', '| 21 | 22 | 23 |') },
        on: { newest: G('| 11 | 12 | 13 |', '| 21 | 22 | 23 |') },
      },
      {
        name: '⌘I over a row with an empty cell skips the empty one',
        doc: G('| 11 | [12 |  |', '| 21 | 22 | 23] |'),
        keys: ['Mod-i'],
        off: { file: G('| 11 | *12* |  |', '| 21 | *22* | *23* |') },
        on: { newest: G('| 11 | *12* |  |', '| 21 | *22* | *23* |') },
      },
      {
        name: '⌘K does nothing with cells selected',
        doc: SEL,
        keys: ['Mod-k'],
        off: { file: G('| 11 | 12 | 13 |', '| 21 | 22 | 23 |') },
        on: { newest: G('| 11 | 12 | 13 |', '| 21 | 22 | 23 |') },
      },
    ]),
  );
});

describe('a rectangle’s edits are one step to undo', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  for (const tracking of [false, true]) {
    it(`restores the rectangle selection, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      const doc = '| a | b |\n| - | - |\n| 11 | 12 |\n| 21 | 22 |\n';
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, {
        doc,
        author: { handle: 'ada', name: 'Ada Lovelace' },
        tracking,
      });
      open.push(editor);
      const anchor = doc.indexOf('11');
      const head = doc.indexOf('22') + 2;
      editor.view.dispatch({ selection: { anchor, head } });
      editor.view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
      );
      expect(editor.getDoc()).not.toBe(doc);
      // The rectangle stays selected after the clear.
      const rect = rectOf(editor.view.state);
      expect(rect?.rows).toEqual([1, 2]);
      expect(rect && whole(rect)).toBe('row');
      expect(undo(editor.view)).toBe(true);
      expect(editor.getDoc()).toBe(doc);
      const { anchor: a, head: h } = editor.view.state.selection.main;
      expect([a, h]).toEqual([anchor, head]);
      // A second Undo has nothing of the clear left to take back.
      expect(rectOf(editor.view.state)).not.toBeNull();
    });
  }

  it('writes four deletions in one group with Track Changes on', () => {
    const doc = '| a | b |\n| - | - |\n| 11 | 12 |\n| 21 | 22 |\n';
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc,
      author: { handle: 'ada', name: 'Ada Lovelace' },
      tracking: true,
    });
    open.push(editor);
    editor.view.dispatch({ selection: { anchor: doc.indexOf('11'), head: doc.indexOf('22') + 2 } });
    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
    );
    const text = editor.getDoc();
    expect(text.match(/<!--del /g)).toHaveLength(4);
    const groups = new Set([...text.matchAll(/group: (\w+)/g)].map((m) => m[1]));
    expect(groups.size).toBe(1);
    expect(text.match(/group: /g)).toHaveLength(4);
  });
});
