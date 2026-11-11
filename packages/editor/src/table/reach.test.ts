// @vitest-environment happy-dom
// Selections that reach into a table (design: tables, "Selecting cells"): delete, clear, return and
// type over, as keystroke scripts with Track Changes off and on, each reading the same in every
// decision order.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { type Script, scriptRows, type Step } from '../blocks/script.ts';
import { createEditor, type Editor } from '../index.ts';

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

const TAKE_BACK = 'Backspace right after a Return over a selection leaves the deleted text deleted';
const T = '| a | b |⏎| - | - |⏎| 1 | 2 |⏎| 3 | 4 |';
const T2 = '| c | d |⏎| - | - |⏎| 5 | 6 |';
const LEDGER = '⏎⏎<!-- redlines⏎version: 1⏎-->⏎';

describe('select all, in a document that holds tables', () => {
  const docs: [string, string][] = [
    ['one table', `Intro.⏎⏎${T}⏎⏎After.`],
    ['two tables', `Intro.⏎⏎${T}⏎⏎Middle.⏎⏎${T2}⏎⏎After.`],
    ['a table first', `${T}⏎⏎After.`],
    ['a table last', `Intro.⏎⏎${T}`],
    ['a table alone', T],
    ['a table before the ledger', `Intro.⏎⏎${T}${LEDGER}`],
  ];
  for (const [name, doc] of docs) {
    // The selection is the whole body: `⟦` at the start and `⟧` before the ledger.
    const [body, ledger] = doc.split('⏎⏎<!-- redlines');
    const selected = `⟦${body}⟧${ledger === undefined ? '' : `⏎⏎<!-- redlines${ledger}`}`;
    // The line break that stays between the body and its ledger.
    const kept = ledger === undefined ? '' : '⏎';
    describe(name, () => {
      scriptRows(
        both([
          {
            name: 'Delete ends as one empty paragraph',
            doc: selected,
            keys: ['Delete'],
            off: { file: '', caret: '‸' },
            on: { newest: kept },
          },
          {
            name: 'Backspace ends as one empty paragraph',
            doc: selected,
            keys: ['Backspace'],
            off: { file: '', caret: '‸' },
            on: { newest: kept },
          },
          {
            name: 'Return ends as one empty paragraph',
            doc: selected,
            keys: ['Enter'],
            off: { file: '', caret: '‸' },
            on: { newest: kept },
            skip: { 'take-back': TAKE_BACK },
          },
          {
            name: 'a typed letter replaces everything',
            doc: selected,
            keys: [{ type: 'x' }],
            off: { file: 'x', caret: 'x‸' },
            on: { newest: `x${kept}` },
          },
        ]),
      );
    });
  }
});

describe('a selection over a whole table', () => {
  scriptRows(
    both([
      {
        name: 'plus a paragraph either side deletes the table as a block, and joins the paragraphs',
        doc: `In⟦tro.⏎⏎${T}⏎⏎Af⟧ter.`,
        keys: ['Delete'],
        off: { caret: 'In‸ter.' },
        on: { newest: 'Inter.' },
      },
      {
        name: 'of the table alone leaves its paragraphs apart',
        doc: `Intro.⏎⏎⟦${T}⏎⏎⟧After.`,
        keys: ['Delete'],
        off: { caret: 'Intro.⏎⏎‸After.' },
        on: { newest: 'Intro.⏎⏎After.' },
      },
    ]),
  );
});

describe('a selection that ends inside a table', () => {
  const body = (header: string, rows: string[]) => `${header}⏎| - | - |⏎${rows.join('⏎')}`;
  scriptRows(
    both([
      {
        name: 'from mid paragraph into row 2’s cell 2: the tail goes, rows 0 to 2 are cleared',
        doc: `Intro ⟦text.⏎⏎${T.replace('| 4 |', '| 4⟧ |')}⏎⏎After.`,
        keys: ['Delete'],
        off: {
          caret: `Intro ‸⏎⏎${body('|  |  |', ['|  |  |', '|  |  |'])}⏎⏎After.`,
        },
        on: { newest: `Intro ⏎⏎${body('|  |  |', ['|  |  |', '|  |  |'])}⏎⏎After.` },
      },
      {
        name: 'Backspace does the same',
        doc: `Intro ⟦text.⏎⏎${T.replace('| 4 |', '| 4⟧ |')}⏎⏎After.`,
        keys: ['Backspace'],
        off: {
          caret: `Intro ‸⏎⏎${body('|  |  |', ['|  |  |', '|  |  |'])}⏎⏎After.`,
        },
        on: { newest: `Intro ⏎⏎${body('|  |  |', ['|  |  |', '|  |  |'])}⏎⏎After.` },
      },
      {
        name: 'from a cell into the paragraph below: the row is cleared, the head of the paragraph goes',
        doc: `${T.replace('| 1 | 2 |', '| 1 | ⟦2 |')}⏎⏎Af⟧ter.`,
        keys: ['Delete'],
        off: {
          caret: `${body('| a | b |', ['|  | ‸ |', '|  |  |'])}⏎⏎ter.`,
        },
        on: { newest: `${body('| a | b |', ['|  |  |', '|  |  |'])}⏎⏎ter.` },
      },
      {
        name: 'Return types a line break in the first cleared cell',
        doc: `${T.replace('| 1 | 2 |', '| 1 | ⟦2 |')}⏎⏎Af⟧ter.`,
        keys: ['Enter'],
        off: {
          caret: `${body('| a | b |', ['|  | <br>‸ |', '|  |  |'])}⏎⏎ter.`,
        },
        on: { newest: `${body('| a | b |', ['|  | <br> |', '|  |  |'])}⏎⏎ter.` },
        skip: { 'take-back': TAKE_BACK },
      },
      {
        name: 'Return from the paragraph above opens a paragraph there',
        doc: `Intro ⟦text.⏎⏎${T.replace('| 4 |', '| 4⟧ |')}⏎⏎After.`,
        keys: ['Enter'],
        off: {
          caret: `Intro ⏎⏎‸⏎⏎${body('|  |  |', ['|  |  |', '|  |  |'])}⏎⏎After.`,
        },
        on: { newest: `Intro ⏎⏎${body('|  |  |', ['|  |  |', '|  |  |'])}⏎⏎After.` },
        skip: { 'take-back': TAKE_BACK },
      },
      {
        name: 'a typed letter lands at the deletion’s start',
        doc: `Intro ⟦text.⏎⏎${T.replace('| 4 |', '| 4⟧ |')}⏎⏎After.`,
        keys: [{ type: 'x' }],
        off: {
          caret: `Intro x‸⏎⏎${body('|  |  |', ['|  |  |', '|  |  |'])}⏎⏎After.`,
        },
        on: { newest: `Intro x⏎⏎${body('|  |  |', ['|  |  |', '|  |  |'])}⏎⏎After.` },
      },
      {
        name: 'a typed letter lands in the first cleared cell',
        doc: `${T.replace('| 1 | 2 |', '| 1 | ⟦2 |')}⏎⏎Af⟧ter.`,
        keys: [{ type: 'x' }],
        off: {
          caret: `${body('| a | b |', ['|  | x‸ |', '|  |  |'])}⏎⏎ter.`,
        },
        on: { newest: `${body('| a | b |', ['|  | x |', '|  |  |'])}⏎⏎ter.` },
      },
      {
        name: 'from table A into table B: rows below the start cleared in A, rows above the end in B',
        doc: `${T.replace('| 3 | 4 |', '| 3 | ⟦4 |')}⏎⏎Middle.⏎⏎${T2.replace('| 5 | 6 |', '| 5⟧ | 6 |')}`,
        keys: ['Delete'],
        off: {
          caret: `${body('| a | b |', ['| 1 | 2 |', '|  | ‸ |'])}⏎⏎${body('|  |  |', ['|  |  |'])}`,
        },
        on: {
          newest: `${body('| a | b |', ['| 1 | 2 |', '|  |  |'])}⏎⏎${body('|  |  |', ['|  |  |'])}`,
        },
      },
    ]),
  );
});

describe('selected cells are drawn', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  function load(doc: string, from: number, to: number): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada Lovelace' } });
    open.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    editor.view.dispatch({ selection: { anchor: from, head: to } });
    return editor;
  }
  const doc = 'Intro.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\nAfter.';

  /** The text of each cell that has `.rl-sel`. */
  const selected = (editor: Editor) =>
    [...editor.view.contentDOM.querySelectorAll('.rl-sel')].map((el) => el.textContent?.trim());

  it('marks exactly the cells of the rows that a selection reaches', () => {
    const editor = load(doc, doc.indexOf('ro.'), doc.indexOf('2 |'));
    expect(selected(editor)).toEqual(['a', 'b', '1', '2']);
  });

  it('marks nothing for a selection inside one cell, or one outside every table', () => {
    const inCell = load(doc, doc.indexOf('3 |'), doc.indexOf('3 |') + 1);
    expect(selected(inCell)).toEqual([]);
    const outside = load(doc, 0, 5);
    expect(selected(outside)).toEqual([]);
  });

  it('marks every cell of a table that the selection covers', () => {
    const editor = load(doc, 0, doc.length);
    expect(selected(editor)).toEqual(['a', 'b', '1', '2', '3', '4']);
  });

  it('marks the cells of a selection that ends in the table from below', () => {
    const editor = load(doc, doc.indexOf('4 |'), doc.indexOf('ter.'));
    expect(selected(editor)).toEqual(['3', '4']);
  });
});

describe('what Delete over a reaching selection is, in one step', () => {
  it('is one step to undo', async () => {
    const { undo } = await import('../index.ts');
    const parent = document.createElement('div');
    document.body.append(parent);
    const doc = 'Intro text.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter.';
    const editor = createEditor(parent, {
      doc,
      author: { handle: 'ada', name: 'Ada Lovelace' },
      tracking: true,
    });
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    const anchor = doc.indexOf('text.');
    editor.view.dispatch({ selection: { anchor, head: doc.indexOf('2 |') + 1 } });
    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    );
    expect(editor.getDoc()).not.toBe(doc);
    undo(editor.view);
    expect(editor.getDoc()).toBe(doc);
    editor.destroy();
  });
});
