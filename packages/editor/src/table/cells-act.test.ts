// @vitest-environment happy-dom
// What acts on a rectangle of cells (design: tables, "Selecting cells", the table of actions): clear,
// type over, format. Keystroke scripts with Track Changes off and on, each reading the same in every
// decision order and every state one Markdown table.
import { afterEach, describe, expect, it } from 'vitest';
import { type Script, scriptRows, type Step } from '../blocks/script.ts';
import { undo, undoDepth } from '../history/index.ts';
import { createEditor, type Editor } from '../index.ts';
import { newestView } from '@redlines/format';
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

describe('bold over cells decides on and off from all the selected text', () => {
  scriptRows(
    both([
      {
        name: 'cells all bold: ⌘B takes it away',
        doc: G('| 11 | [**12** | **13** |', '| 21 | **22** | **23**] |'),
        keys: ['Mod-b'],
        off: { file: G('| 11 | 12 | 13 |', '| 21 | 22 | 23 |') },
        on: { newest: G('| 11 | 12 | 13 |', '| 21 | 22 | 23 |') },
      },
      {
        name: 'one cell not bold: ⌘B makes them all bold',
        doc: G('| 11 | [**12** | 13 |', '| 21 | **22** | **23**] |'),
        keys: ['Mod-b'],
        off: { file: G('| 11 | **12** | **13** |', '| 21 | **22** | **23** |') },
        on: { newest: G('| 11 | **12** | **13** |', '| 21 | **22** | **23** |') },
      },
      {
        name: 'a cell only partly bold counts as not bold',
        doc: G('| 11 | [**12** | 13 |', '| 21 | a **b** | **23**] |'),
        keys: ['Mod-b'],
        off: { file: G('| 11 | **12** | **13** |', '| 21 | **a** **b** | **23** |') },
        on: { newest: G('| 11 | **12** | **13** |', '| 21 | **a** **b** | **23** |') },
      },
    ]),
  );

  it('says there is no text to make bold when every selected cell is empty', async () => {
    const { createFormatting } = await import('../../../../plugins/formatting/src/index.ts');
    const doc = '| a | b |\n| - | - |\n|  |  |\n|  |  |\n';
    const parent = document.createElement('div');
    document.body.append(parent);
    const notices: string[] = [];
    const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' } });
    createFormatting(editor, {
      author: { handle: 'ada', name: 'Ada' },
      notice: (m) => notices.push(m),
    });
    const first = doc.indexOf('|  |') + 2;
    editor.view.dispatch({ selection: { anchor: first, head: doc.lastIndexOf('|  |') + 2 } });
    expect(editor.commands.run('format.bold')).toBe(false);
    expect(notices).toEqual(['There is no text in the selected cells to make bold.']);
    expect(editor.getDoc()).toBe(doc);
    editor.destroy();
  });
});

describe('tracked bold over many cells (issue #267)', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  async function boldOver(cells: number, tracking: boolean) {
    const { createFormatting } = await import('../../../../plugins/formatting/src/index.ts');
    const rows = Array.from({ length: cells }, (_, n) => `| r${n} | s${n} |`);
    const doc = ['| a | b |', '| - | - |', ...rows, ''].join('\n');
    const parent = document.createElement('div');
    document.body.append(parent);
    const notices: string[] = [];
    const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' }, tracking });
    open.push(editor);
    createFormatting(editor, {
      author: { handle: 'ada', name: 'Ada' },
      notice: (m) => notices.push(m),
    });
    editor.view.dispatch({
      selection: { anchor: doc.indexOf('r0'), head: doc.lastIndexOf('s') + 2 },
    });
    return { editor, doc, notices, ran: editor.commands.run('format.bold') };
  }

  it('is refused with the format library’s words, and writes nothing', async () => {
    // Twelve cells: each is one more pending change in the table for the next to be checked against.
    const { editor, doc, notices, ran } = await boldOver(6, true);
    expect(ran).toBe(false);
    expect(editor.getDoc()).toBe(doc);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(
      /^There are \d+ pending changes in this table, too many to check this change against\. Accept or reject some of them first\.$/,
    );
  });

  it('is made for a few cells, and with Track Changes off for as many as there are', async () => {
    expect((await boldOver(2, true)).ran).toBe(true);
    const plain = await boldOver(6, false);
    expect(plain.ran).toBe(true);
    expect(plain.notices).toEqual([]);
  });
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

describe('an input method composing over selected cells', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });
  const doc = '| a | b | c |\n| - | - | - |\n| 11 | 12 | 13 |\n| 21 | 22 | 23 |\n';
  const wait = () => new Promise((resolve) => setTimeout(resolve, 120));
  const event = (editor: Editor, type: string, data = '') => {
    const e = new Event(type, { bubbles: true }) as Event & { data: string };
    e.data = data;
    editor.view.contentDOM.dispatchEvent(e);
  };

  function mount(tracking: boolean): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' }, tracking });
    open.push(editor);
    editor.view.dispatch({ selection: { anchor: doc.indexOf('12'), head: doc.indexOf('23') + 2 } });
    expect(rectOf(editor.view.state)).not.toBeNull();
    return editor;
  }

  /** The events as WKWebView sends them, with the document changes an input method makes between. */
  function compose(editor: Editor, steps: string[], commit: string) {
    event(editor, 'compositionstart');
    const at = editor.view.state.selection.main.head;
    let length = 0;
    steps.forEach((text, i) => {
      editor.view.dispatch({
        changes: { from: at, to: at + length, insert: text },
        selection: { anchor: at + text.length },
        userEvent: i === 0 ? 'input.type.compose.start' : 'input.type.compose',
      });
      length = text.length;
      event(editor, 'compositionupdate', text);
    });
    if (commit !== '' || steps.length) {
      editor.view.dispatch({
        changes: { from: at, to: at + length, insert: commit },
        selection: { anchor: at + commit.length },
        userEvent: 'input.type.compose',
      });
    }
    event(editor, 'compositionend', commit);
  }

  for (const tracking of [false, true]) {
    const label = `Track Changes ${tracking ? 'on' : 'off'}`;

    it(`commits into the first cell, escaped, and one Undo gives every cell back, ${label}`, async () => {
      const editor = mount(tracking);
      const before = editor.getDoc();
      compose(editor, ['¨', 'あ', 'あb'], 'a|b');
      await wait();
      expect(newestView(editor.getDoc()).text).toBe(
        '| a | b | c |\n| - | - | - |\n| 11 | a\\|b |  |\n| 21 |  |  |\n',
      );
      expect(undo(editor.view)).toBe(true);
      expect(editor.getDoc()).toBe(before);
    });

    it(`cancelled with Esc leaves every cell as it was, selected, with no change, ${label}`, async () => {
      const editor = mount(tracking);
      const before = editor.getDoc();
      const depth = undoDepth(editor.view.state);
      compose(editor, ['¨', 'あ'], '');
      await wait();
      expect(editor.getDoc()).toBe(before);
      expect(rectOf(editor.view.state)).not.toBeNull();
      // Whatever the composition left in the history is nothing: Undo has nothing of ours to take.
      expect(undoDepth(editor.view.state)).toBeLessThanOrEqual(depth + 1);
      undo(editor.view);
      expect(editor.getDoc()).toBe(before);
    });

    it(`ending with no text at all changes nothing and keeps the cells selected, ${label}`, async () => {
      const editor = mount(tracking);
      const before = editor.getDoc();
      const depth = undoDepth(editor.view.state);
      compose(editor, [], '');
      await wait();
      expect(editor.getDoc()).toBe(before);
      expect(rectOf(editor.view.state)).not.toBeNull();
      expect(undoDepth(editor.view.state)).toBe(depth);
    });
  }
});
