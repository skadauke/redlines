// @vitest-environment happy-dom
// Moving through a table (design: tables, "The caret and the keys"): the arrows, Home and End and the
// ⌘-arrows as keystroke scripts, with Track Changes off and on. Movement writes nothing. What needs
// layout, a move between cells at the same x, is checked in the WebKit script.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { type Script, scriptRows, type Step } from '../blocks/script.ts';
import { createEditor, type Editor } from '../index.ts';
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

  it('selects the cell’s text, and the document the second time', () => {
    const editor = load(doc.indexOf('12') + 1);
    expect(press(editor)).toBe(true);
    expect(selection(editor)).toEqual(cell);
    // The second press is CodeMirror's Select All: the document.
    expect(press(editor)).toBe(true);
    expect(selection(editor)).toEqual([0, doc.length]);
  });

  it('selects the document at once in an empty cell', () => {
    const editor = load(doc.indexOf('|  |') + 2);
    expect(selectAllInCell(editor.view)).toBe(false);
    expect(press(editor)).toBe(true);
    expect(selection(editor)).toEqual([0, doc.length]);
  });

  it('leaves a selection that reaches out of the cell to Select All, and a caret outside a table', () => {
    const editor = load(doc.indexOf('12'));
    editor.view.dispatch({ selection: { anchor: doc.indexOf('12'), head: doc.indexOf('78') } });
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
