// @vitest-environment happy-dom
// Moving through a table (design: tables, "The caret and the keys"): the arrows, Home and End and the
// ⌘-arrows as keystroke scripts, with Track Changes off and on. Movement writes nothing. What needs
// layout, a move between cells at the same x, is checked in the WebKit script.
import { forceParsing } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { keymap, runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { type Script, scriptRows, type Step } from '../blocks/script.ts';
import { createEditor, type Editor } from '../index.ts';
import { rectOf, whole } from './cells.ts';
import { macTableCommands, selectAllInCell } from './keys.ts';

interface Row {
  name: string;
  doc: string;
  keys: Step[];
  /** The caret after, with the file unchanged; or the file and the caret when it is another. */
  caret: string;
  file?: string;
}

/** Each row with Track Changes off and on: the same result. */
const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) =>
    [false, true].map((tc) => ({
      name: `${row.name}, Track Changes ${tc ? 'on' : 'off'}`,
      doc: row.doc,
      keys: row.keys,
      tc,
      expect: { caret: row.caret, ...(row.file ? { file: row.file } : {}) },
    })),
  );

const HEAD = '| a | b |⏎| - | - |⏎';
const T = `${HEAD}| 12 | 34 |⏎| 56 | 78 |`;

describe('arrows in a table', () => {
  scriptRows(
    both([
      {
        name: '→ at the end of a cell goes to the start of the next',
        doc: T.replace('| 12 |', '| 12‸ |'),
        keys: ['ArrowRight'],
        caret: T.replace('| 34 |', '| ‸34 |'),
      },
      {
        name: '→ at the end of a row goes to the start of the next row',
        doc: T.replace('34 |', '34‸ |'),
        keys: ['ArrowRight'],
        caret: T.replace('| 56 |', '| ‸56 |'),
      },
      {
        name: '→ in the header crosses the delimiter row',
        doc: T.replace('| b |', '| b‸ |'),
        keys: ['ArrowRight'],
        caret: T.replace('| 12 |', '| ‸12 |'),
      },
      {
        name: '← at the start of a cell goes to the end of the one before',
        doc: T.replace('| 34 |', '| ‸34 |'),
        keys: ['ArrowLeft'],
        caret: T.replace('| 12 |', '| 12‸ |'),
      },
      {
        name: '← at the start of a row goes to the end of the row above',
        doc: T.replace('| 56 |', '| ‸56 |'),
        keys: ['ArrowLeft'],
        caret: T.replace('34 |', '34‸ |'),
      },
      {
        name: '⌥→ goes by word, across cells',
        doc: HEAD + '| one two‸ | 34 |',
        keys: ['Alt-ArrowRight'],
        caret: HEAD + '| one two | ‸34 |',
      },
      {
        name: '⌥← goes by word, across cells',
        doc: HEAD + '| one two | ‸34 |',
        keys: ['Alt-ArrowLeft'],
        caret: HEAD + '| one two‸ | 34 |',
      },
      {
        name: '⌥→ inside a cell stops at the end of the word',
        doc: HEAD + '| ‸one two | 34 |',
        keys: ['Alt-ArrowRight'],
        caret: HEAD + '| one‸ two | 34 |',
      },
      {
        name: 'Home goes to the start of the cell',
        doc: T.replace('| 12 |', '| 1‸2 |'),
        keys: ['Home'],
        caret: T.replace('| 12 |', '| ‸12 |'),
      },
      {
        name: 'End goes to the end of the cell',
        doc: T.replace('| 12 |', '| 1‸2 |'),
        keys: ['End'],
        caret: T.replace('| 12 |', '| 12‸ |'),
      },
    ]),
  );
});

describe('↑ and ↓ in a table', () => {
  scriptRows(
    both([
      {
        name: '↓ goes to the cell below, at the same place in its text',
        doc: T.replace('| 12 |', '| 1‸2 |'),
        keys: ['ArrowDown'],
        caret: T.replace('| 56 |', '| 5‸6 |'),
      },
      {
        name: '↓ from the header goes past the delimiter row to the first row',
        doc: T.replace('| b |', '| b‸ |'),
        keys: ['ArrowDown'],
        caret: T.replace('| 34 |', '| 3‸4 |'),
      },
      {
        name: '↓ into a shorter cell goes to its end',
        doc: `${HEAD}| 12 | 34‸ |⏎| 5 | 78 |`,
        keys: ['ArrowDown'],
        caret: `${HEAD}| 12 | 34 |⏎| 5 | 78‸ |`,
      },
      {
        name: '↓ into an empty cell goes to its stop',
        doc: `${HEAD}| 1‸2 | 34 |⏎|  | 78 |`,
        keys: ['ArrowDown'],
        caret: `${HEAD}| 12 | 34 |⏎| ‸ | 78 |`,
      },
      {
        name: '↑ goes to the cell above, at the same place in its text',
        doc: T.replace('| 56 |', '| 5‸6 |'),
        keys: ['ArrowUp'],
        caret: T.replace('| 12 |', '| 1‸2 |'),
      },
      {
        name: '↑ from the first row goes past the delimiter row to the header',
        doc: T.replace('| 34 |', '| 3‸4 |'),
        keys: ['ArrowUp'],
        caret: T.replace('| b |', '| b‸ |'),
      },
      {
        name: '↑ from the header goes to the block above',
        doc: `Intro.⏎⏎${T.replace('| b |', '| b‸ |')}`,
        keys: ['ArrowUp'],
        caret: `Intro.‸⏎⏎${T}`,
      },
      {
        name: '↑ from the header of a table at the start of the document stays',
        doc: T.replace('| a |', '| a‸ |'),
        keys: ['ArrowUp'],
        caret: T.replace('| a |', '| a‸ |'),
      },
      {
        name: '↓ from the last row goes to the start of the paragraph below',
        doc: `Intro.⏎⏎${T.replace('| 78 |', '| 7‸8 |')}⏎⏎After.`,
        keys: ['ArrowDown'],
        caret: `Intro.⏎⏎${T}⏎⏎‸After.`,
      },
      {
        name: '↓ from the last row goes to the block below, a code block too',
        doc: `${T.replace('| 78 |', '| 7‸8 |')}⏎⏎\`\`\`⏎code⏎\`\`\``,
        keys: ['ArrowDown'],
        caret: `${T}⏎⏎‸\`\`\`⏎code⏎\`\`\``,
      },
      {
        name: '↓ from the last row of a table that ends the document opens the empty paragraph',
        doc: T.replace('| 78 |', '| 7‸8 |'),
        keys: ['ArrowDown'],
        caret: `${T}⏎⏎‸`,
      },
      {
        name: 'Backspace takes the empty paragraph back',
        doc: T.replace('| 78 |', '| 7‸8 |'),
        keys: ['ArrowDown', 'Backspace'],
        caret: T.replace('| 78 |', '| 7‸8 |'),
        file: T,
      },
      {
        name: '↓ from the last row of a table first in the document, with a paragraph below',
        doc: `${T.replace('| 78 |', '| 78‸ |')}⏎⏎After.`,
        keys: ['ArrowDown'],
        caret: `${T}⏎⏎‸After.`,
      },
    ]),
  );
});

describe('the Mac keys in a table', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  /** Runs the Mac's key on the document, the caret at `‸`; the text with the caret after. */
  function run(key: string, doc: string): string {
    const at = doc.indexOf('‸');
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc: doc.replace('‸', '').replaceAll('⏎', '\n'),
      author: { handle: 'ada', name: 'Ada Lovelace' },
    });
    open.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    editor.view.dispatch({ selection: { anchor: at } });
    expect(macTableCommands[key]!(editor.view)).toBe(true);
    const head = editor.view.state.selection.main.head;
    const text = editor.view.state.doc.toString();
    return (text.slice(0, head) + '‸' + text.slice(head)).replaceAll('\n', '⏎');
  }

  const T2 = `Intro.⏎⏎${T}⏎⏎After.`;
  it('⌘← and ⌃A go to the start of the cell, ⌘→ and ⌃E to its end', () => {
    expect(run('Cmd-ArrowLeft', T2.replace('| 34 |', '| 3‸4 |'))).toBe(
      T2.replace('| 34 |', '| ‸34 |'),
    );
    expect(run('Ctrl-a', T2.replace('| 34 |', '| 3‸4 |'))).toBe(T2.replace('| 34 |', '| ‸34 |'));
    expect(run('Cmd-ArrowRight', T2.replace('| 34 |', '| 3‸4 |'))).toBe(
      T2.replace('| 34 |', '| 34‸ |'),
    );
    expect(run('Ctrl-e', T2.replace('| 34 |', '| 3‸4 |'))).toBe(T2.replace('| 34 |', '| 34‸ |'));
  });

  it('⌘↑ and ⌘↓ go to the start and the end of the document', () => {
    expect(run('Cmd-ArrowUp', T2.replace('| 34 |', '| 3‸4 |'))).toBe(`‸${T2}`);
    expect(run('Cmd-ArrowDown', T2.replace('| 34 |', '| 3‸4 |'))).toBe(`${T2}‸`);
  });
});

describe('↓ from a table before the ledger', () => {
  const doc = `${T.replace('| 78 |', '| 7‸8 |')}⏎⏎<!-- redlines⏎version: 1⏎-->⏎`;
  scriptRows([
    {
      name: 'opens the empty paragraph in front of it, Track Changes off',
      doc,
      keys: ['ArrowDown'],
      tc: false,
      expect: { caret: `${T}⏎⏎‸` },
    },
    {
      name: 'opens the empty paragraph in front of it, Track Changes on',
      doc,
      keys: ['ArrowDown'],
      tc: true,
      expect: { caret: `${T}⏎⏎‸⏎` },
    },
  ]);
});

describe('⌘A in a table', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });
  const doc = `Intro.\n\n| a | b |\n| - | - |\n| 12 | 34 |\n|  | 78 |\n\nAfter.`;
  function load(caret: number, raw = false): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' } });
    open.push(editor);
    forceParsing(editor.view, doc.length, 10_000);
    if (raw) editor.setViewMode('raw');
    editor.view.dispatch({ selection: { anchor: caret } });
    return editor;
  }
  /** The key, as the platform names it: ⌘ on a Mac, Ctrl elsewhere. */
  function press(editor: Editor): boolean {
    return [{ metaKey: true }, { ctrlKey: true }].some((init) =>
      runScopeHandlers(
        editor.view,
        new KeyboardEvent('keydown', { key: 'a', ...init, cancelable: true }),
        'editor',
      ),
    );
  }
  const selection = (editor: Editor) => {
    const { from, to } = editor.view.state.selection.main;
    return [from, to];
  };
  const cell = [doc.indexOf('12'), doc.indexOf('12') + 2];

  it('selects the cell’s text, then the table, then the document', () => {
    const editor = load(doc.indexOf('12') + 1);
    expect(press(editor)).toBe(true);
    expect(selection(editor)).toEqual(cell);
    expect(press(editor)).toBe(true);
    // The whole table: from the first cell's text to the last's.
    expect(selection(editor)).toEqual([doc.indexOf('a |'), doc.indexOf('78') + 2]);
    const rect = rectOf(editor.view.state)!;
    expect(whole(rect)).toBe('table');
    // The third press is CodeMirror's Select All: the document.
    expect(press(editor)).toBe(true);
    expect(selection(editor)).toEqual([0, doc.length]);
  });

  it('selects the table at once in an empty cell', () => {
    const editor = load(doc.indexOf('|  |') + 2);
    expect(press(editor)).toBe(true);
    expect(whole(rectOf(editor.view.state)!)).toBe('table');
    expect(press(editor)).toBe(true);
    expect(selection(editor)).toEqual([0, doc.length]);
  });

  it('leaves a selection that reaches out of the cell to Select All, and a caret outside a table', () => {
    const editor = load(doc.indexOf('12'));
    editor.view.dispatch({ selection: { anchor: doc.indexOf('12'), head: doc.indexOf('After') } });
    expect(selectAllInCell(editor.view)).toBe(false);
    const outside = load(2);
    expect(selectAllInCell(outside.view)).toBe(false);
    expect(press(outside)).toBe(true);
    expect(selection(outside)).toEqual([0, doc.length]);
  });

  it('is not bound in Raw', () => {
    const editor = load(doc.indexOf('12') + 1, true);
    expect(selectAllInCell(editor.view)).toBe(false);
    expect(press(editor)).toBe(true);
    expect(selection(editor)).toEqual([0, doc.length]);
  });
});

describe('shift-arrows, Esc, Tab and Return with cells selected', () => {
  const H3 = '| a | b | c |⏎| - | - | - |⏎';
  const G = (row1: string, row2 = '| 21 | 22 | 23 |', row3 = '| 31 | 32 | 33 |') =>
    `${H3}${row1}⏎${row2}⏎${row3}`;
  const PLAIN = G('| 11 | 12 | 13 |');
  scriptRows(
    both([
      {
        name: '⇧→ from a cell’s end extends into the next cell as a rectangle',
        doc: G('| 11‸ | 12 | 13 |'),
        keys: ['Shift-ArrowRight'],
        caret: G('| 11[ | ]12 | 13 |'),
        file: PLAIN,
      },
      {
        name: '⇧→ again grows it by a cell, and stops at the table’s edge',
        doc: G('| 11‸ | 12 | 13 |'),
        keys: ['Shift-ArrowRight', 'Shift-ArrowRight', 'Shift-ArrowRight'],
        caret: G('| 11[ | 12 | 13] |'),
        file: PLAIN,
      },
      {
        name: '⇧← shrinks it by a cell',
        doc: G('| 11‸ | 12 | 13 |'),
        keys: ['Shift-ArrowRight', 'Shift-ArrowRight', 'Shift-ArrowLeft'],
        caret: G('| 11[ | ]12 | 13 |'),
        file: PLAIN,
      },
      {
        name: '⇧← back to the first cell is a caret there',
        doc: G('| 11‸ | 12 | 13 |'),
        keys: ['Shift-ArrowRight', 'Shift-ArrowLeft'],
        caret: G('| 11‸ | 12 | 13 |'),
        file: PLAIN,
      },
      {
        name: '⇧↓ from the cell’s last line selects into the cell below, and grows by a row',
        doc: G('| 11 | 1‸2 | 13 |'),
        keys: ['Shift-ArrowDown', 'Shift-ArrowDown'],
        caret: G('| 11 | 1[2 | 13 |', '| 21 | 22 | 23 |', '| 31 | 32] | 33 |'),
        file: PLAIN,
      },
      {
        name: '⇧↑ shrinks the rectangle by a row, and to a caret in the cell it began in',
        doc: G('| 11 | 1‸2 | 13 |'),
        keys: ['Shift-ArrowDown', 'Shift-ArrowDown', 'Shift-ArrowUp', 'Shift-ArrowUp'],
        caret: G('| 11 | 1‸2 | 13 |'),
        file: PLAIN,
      },
      {
        name: '⇧→ extends the text selection inside a cell as before',
        doc: G('| 1‸1 | 12 | 13 |'),
        keys: ['Shift-ArrowRight'],
        caret: G('| 1[1] | 12 | 13 |'),
        file: PLAIN,
      },
      {
        name: 'Esc with cells selected is a caret in the cell where the selection ended',
        doc: G('| 11 | [12 | 13 |', '| 21 | 22] | 23 |'),
        keys: ['Escape'],
        caret: G('| 11 | 12 | 13 |', '| 21 | 22‸ | 23 |'),
        file: PLAIN,
      },
      {
        name: 'Tab with cells selected goes to the cell after the one where the selection ended',
        doc: G('| 11 | [12 | 13 |', '| 21 | 22] | 23 |'),
        keys: ['Tab'],
        caret: G('| 11 | 12 | 13 |', '| 21 | 22 | [23] |'),
        file: PLAIN,
      },
      {
        name: '↩ with cells selected does nothing',
        doc: G('| 11 | [12 | 13 |', '| 21 | 22] | 23 |'),
        keys: ['Enter', 'Enter'],
        caret: G('| 11 | [12 | 13 |', '| 21 | 22] | 23 |'),
        file: PLAIN,
      },
    ]),
  );

  const DOC = `Intro.⏎⏎${PLAIN}⏎⏎After.`;
  scriptRows(
    both([
      {
        name: '⌘A is the cell’s text, again the whole table, again the document',
        doc: DOC.replace('| 12 |', '| 1‸2 |'),
        keys: ['Mod-a'],
        caret: DOC.replace('| 12 |', '| [12] |'),
        file: DOC,
      },
      {
        name: '⌘A twice is the whole table',
        doc: DOC.replace('| 12 |', '| 1‸2 |'),
        keys: ['Mod-a', 'Mod-a'],
        caret: DOC.replace('| a |', '| [a |').replace('| 33 |', '| 33] |'),
        file: DOC,
      },
      {
        name: '⌘A three times is the document',
        doc: DOC.replace('| 12 |', '| 1‸2 |'),
        keys: ['Mod-a', 'Mod-a', 'Mod-a'],
        caret: `[${DOC}]`,
        file: DOC,
      },
    ]),
  );
});

describe('keys that would break a row', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });
  const doc = `Intro.\n\n| a | b |\n| - | - |\n| 12 | 34 |\n\nAfter.`;
  function load(caret: number, head = caret, raw = false) {
    const notices: string[] = [];
    const fell: string[] = [];
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc,
      author: { handle: 'ada', name: 'Ada' },
      onNotice: (message) => notices.push(message),
      extensions: [
        // What comes after the table's keys: the keys that reach it fell through.
        Prec.high(
          keymap.of(
            ['Alt-ArrowUp', 'Alt-ArrowDown', 'Shift-Alt-ArrowUp', 'Shift-Alt-ArrowDown'].map(
              (key) => ({
                key,
                run: () => {
                  fell.push(key);
                  return true;
                },
              }),
            ),
          ),
        ),
      ],
    });
    open.push(editor);
    forceParsing(editor.view, doc.length, 10_000);
    if (raw) editor.setViewMode('raw');
    editor.view.dispatch({ selection: { anchor: caret, head } });
    return { editor, notices, fell };
  }
  const press = (editor: Editor, key: string, init: KeyboardEventInit) =>
    runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', { key, ...init, cancelable: true }),
      'editor',
    );
  const both = (editor: Editor, key: string, init: KeyboardEventInit = {}) =>
    [{ metaKey: true }, { ctrlKey: true }].some((mod) => press(editor, key, { ...init, ...mod }));
  const inCell = doc.indexOf('12') + 1;

  it('takes ⌥↑ and ⌥↓ to the start and end of the cell’s text, and with ⇧ selects within it', () => {
    const { editor, fell, notices } = load(inCell);
    const from = doc.indexOf('12');
    const to = from + 2;
    const selection = () => {
      const { anchor, head } = editor.view.state.selection.main;
      return [anchor, head];
    };
    press(editor, 'ArrowDown', { altKey: true });
    expect(selection()).toEqual([to, to]);
    press(editor, 'ArrowUp', { altKey: true });
    expect(selection()).toEqual([from, from]);
    press(editor, 'ArrowDown', { altKey: true, shiftKey: true });
    expect(selection()).toEqual([from, to]);
    press(editor, 'ArrowUp', { altKey: true, shiftKey: true });
    expect(selection()).toEqual([from, from]);
    expect(editor.view.state.doc.toString()).toBe(doc);
    expect(fell).toEqual([]);
    expect(notices).toEqual([]);
  });

  const refused: [string, string, KeyboardEventInit & { key: string }][] = [
    ['⌘[', 'Outdent', { key: '[' }],
    ['⌘]', 'Indent', { key: ']' }],
    ['⌘/', 'Toggle Comment', { key: '/' }],
    ['⇧⌘K', 'Delete Line', { key: 'k', shiftKey: true }],
  ];
  for (const [label, command, init] of refused) {
    it(`says ${label} does not work in a cell, and changes nothing`, () => {
      const { editor, notices } = load(inCell);
      const { key, ...rest } = init;
      expect(both(editor, key, rest)).toBe(true);
      expect(notices).toEqual([`${command} doesn't work in a table cell.`]);
      expect(editor.view.state.doc.toString()).toBe(doc);
    });
  }

  it('makes ⌃L Select Row in a cell, and leaves it to CodeMirror outside a table', () => {
    const { editor, notices } = load(inCell - 1, inCell + 1);
    expect(press(editor, 'l', { ctrlKey: true })).toBe(true);
    expect(notices).toEqual([]);
    expect(editor.view.state.doc.toString()).toBe(doc);
    const rect = rectOf(editor.view.state)!;
    expect(whole(rect)).toBe('row');
    expect(rect.rows).toEqual([1, 1]);
    const outside = load(2);
    expect(rectOf(outside.editor.view.state)).toBeNull();
  });

  it('leaves them to CodeMirror outside a table and in Raw', () => {
    const outside = load(2);
    both(outside.editor, '/');
    expect(outside.notices).toEqual([]);
    const raw = load(inCell, inCell, true);
    both(raw.editor, '/');
    expect(raw.notices).toEqual([]);
  });
});

describe('Tab in a table', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });
  const doc = `Intro.\n\n| a | b |\n| - | - |\n| 12 | 34 |\n| 56 | 78 |\n\nAfter.`;
  function load(anchor: number, head = anchor): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' } });
    open.push(editor);
    forceParsing(editor.view, doc.length, 10_000);
    editor.view.dispatch({ selection: { anchor, head } });
    return editor;
  }
  /** A Tab through the page's key handling: whether it was kept from the browser. */
  function tab(editor: Editor, shiftKey = false): boolean {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    editor.view.contentDOM.dispatchEvent(event);
    return event.defaultPrevented;
  }
  const selection = (editor: Editor) => {
    const { from, to } = editor.view.state.selection.main;
    return [from, to];
  };
  const at = (find: string, n = 0) => doc.indexOf(find) + n;

  it('acts on the head’s cell when the selection reaches out of its cell, and keeps the focus', () => {
    // From the paragraph above into the last cell: the head's cell is 78; Tab there adds a row.
    const editor = load(at('Intro') + 2, at('78', 1));
    expect(tab(editor)).toBe(true);
    expect(editor.view.state.doc.toString()).toContain('| 78 |\n|  |  |');
    // Backwards: the cell before the head's, its text selected.
    const back = load(at('After') + 2, at('56', 1));
    expect(tab(back, true)).toBe(true);
    expect(selection(back)).toEqual([at('34'), at('34') + 2]);
  });

  it('is a no-op, not a move of the focus, when the head is outside every cell', () => {
    const editor = load(at('34', 1), at('Intro') + 3);
    expect(tab(editor)).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(doc);
    expect(selection(editor)).toEqual([at('Intro') + 3, at('34', 1)]);
    // Away from tables the block keys have it: in a paragraph Tab does nothing, and the focus stays.
    const outside = load(2);
    expect(tab(outside)).toBe(true);
    expect(outside.view.state.doc.toString()).toBe(doc);
  });

  it('leaves the document after Escape, as CodeMirror’s own Tab does', () => {
    const editor = load(at('78', 1));
    // CodeMirror reads the key codes.
    const key = (name: string, keyCode: number) => {
      const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'keyCode', { value: keyCode });
      editor.view.contentDOM.dispatchEvent(event);
      return event.defaultPrevented;
    };
    key('Escape', 27);
    // In the last cell, Tab would have added a row.
    expect(key('Tab', 9)).toBe(false);
    expect(editor.view.state.doc.toString()).toBe(doc);
    // Any other key ends it: the next Tab is the table's again.
    key('ArrowLeft', 37);
    expect(key('Tab', 9)).toBe(true);
    expect(editor.view.state.doc.toString()).not.toBe(doc);
  });
});
