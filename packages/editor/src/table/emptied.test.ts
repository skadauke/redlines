// @vitest-environment happy-dom
// The second ⌫ (design: tables, "Selecting cells", the table of actions): ⌫ and ⌦ on whole rows,
// whole columns or the whole table clear their cells, as one change; pressed again, with every cell
// of them empty, they delete them with the operation Delete Row, Delete Column and Delete Table use,
// the format's refusal shown in the notice. A row with text in it is cleared and never deleted by the
// one key. Keystroke scripts with Track Changes off and on, each read in every decision order, and
// Undo taking every step back with its selection.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { newestView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { type Script, scriptRows, type Step } from '../blocks/script.ts';
import { createEditor, type Editor, redo, undo } from '../index.ts';
import { emptyStats, rectOf, whole } from './cells.ts';
import { tablesOf } from './model.ts';

interface Row {
  name: string;
  doc: string;
  keys: Step[];
  off: Script['expect'];
  on: Script['expect'];
  others?: string;
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) =>
    [false, true].map((tc) => ({
      name: `${row.name}, Track Changes ${tc ? 'on' : 'off'}`,
      doc: row.doc,
      keys: row.keys,
      tc,
      expect: tc ? row.on : row.off,
      ...(row.others ? { others: row.others } : {}),
    })),
  );

const H = '| a | b | c |⏎| - | - | - |⏎';
const R1 = '| 11 | 12 | 13 |';
const R2 = '| 21 | 22 | 23 |';
const R3 = '| 31 | 32 | 33 |';
const BLANK = '|  |  |  |';
/** A table of three columns and three body rows: the first two as given, the last `R3`. */
const G = (r1: string, r2: string, r3 = R3) => `${H}${r1}⏎${r2}⏎${r3}`;
const WITHOUT = (...rows: string[]) => `${H}${rows.join('⏎')}`;

describe('⌫ and ⌦ on whole rows', () => {
  scriptRows(
    both([
      {
        name: '⌫ clears a selected row, and the row stays',
        doc: G(R1, '| [21 | 22 | 23] |'),
        keys: ['Backspace'],
        off: { file: G(R1, BLANK) },
        on: { newest: G(R1, BLANK), original: G(R1, R2) },
      },
      {
        name: '⌫ again deletes the row, the caret in the row that is then there',
        doc: G(R1, '| [21 | 22 | 23] |'),
        keys: ['Backspace', 'Backspace'],
        off: { file: WITHOUT(R1, R3), caret: `${H}${R1}⏎| ‸31 | 32 | 33 |` },
        on: {
          // The row is kept below the table as it read before the clearing, which goes with it.
          file: `${WITHOUT(R1, R3)}⏎⏎<del row=2 | 21 | 22 | 23 |>`,
          newest: WITHOUT(R1, R3),
          original: G(R1, R2),
        },
      },
      {
        name: '⌦ does the same',
        doc: G(R1, '| [21 | 22 | 23] |'),
        keys: ['Delete', 'Delete'],
        off: { file: WITHOUT(R1, R3) },
        on: { newest: WITHOUT(R1, R3), original: G(R1, R2) },
      },
      {
        name: '⌫ then ⌦ does too: either key is the second',
        doc: G(R1, '| [21 | 22 | 23] |'),
        keys: ['Backspace', 'Delete'],
        off: { file: WITHOUT(R1, R3) },
        on: { newest: WITHOUT(R1, R3), original: G(R1, R2) },
      },
      {
        name: 'a row that is empty already goes with the one ⌫',
        doc: G(R1, '| ‸ |  |  |'),
        keys: ['Ctrl-l', 'Backspace'],
        off: { file: WITHOUT(R1, R3), caret: `${H}${R1}⏎| ‸31 | 32 | 33 |` },
        on: { newest: WITHOUT(R1, R3), original: G(R1, BLANK) },
      },
      {
        name: 'a row with text in one cell is cleared by ⌫, and stays',
        doc: G(R1, '| ‸ | 22 |  |'),
        keys: ['Ctrl-l', 'Backspace'],
        off: { file: G(R1, BLANK) },
        on: { newest: G(R1, BLANK), original: G(R1, '|  | 22 |  |') },
      },
      {
        name: 'a row with text in one cell is deleted by the second ⌫',
        doc: G(R1, '| ‸ | 22 |  |'),
        keys: ['Ctrl-l', 'Backspace', 'Backspace'],
        off: { file: WITHOUT(R1, R3) },
        on: { newest: WITHOUT(R1, R3), original: G(R1, '|  | 22 |  |') },
      },
      {
        name: 'text in other rows does not keep an empty row',
        doc: G('| 11 |  | 13 |', '| ‸ |  |  |', '| 31 | 32 |  |'),
        keys: ['Ctrl-l', 'Backspace'],
        off: { file: WITHOUT('| 11 |  | 13 |', '| 31 | 32 |  |') },
        on: { newest: WITHOUT('| 11 |  | 13 |', '| 31 | 32 |  |') },
      },
      {
        name: 'two rows go together, the caret in the row after them',
        doc: `${H}${R1}⏎| [21 | 22 | 23 |⏎| 31 | 32 | 33] |⏎| 41 | 42 | 43 |`,
        keys: ['Backspace', 'Backspace'],
        off: {
          file: WITHOUT(R1, '| 41 | 42 | 43 |'),
          caret: `${H}${R1}⏎| ‸41 | 42 | 43 |`,
        },
        on: {
          newest: WITHOUT(R1, '| 41 | 42 | 43 |'),
          original: `${H}${R1}⏎${R2}⏎${R3}⏎| 41 | 42 | 43 |`,
        },
      },
      {
        name: 'the last row: the caret goes to the row above',
        doc: G(R1, R2, '| [31 | 32 | 33] |'),
        keys: ['Backspace', 'Backspace'],
        off: { file: WITHOUT(R1, R2), caret: `${H}${R1}⏎| ‸21 | 22 | 23 |` },
        on: { newest: WITHOUT(R1, R2), original: G(R1, R2) },
      },
      {
        name: 'the header goes with the row after it: the next row is the header',
        doc: `| [a | b | c |⏎| - | - | - |⏎| 11 | 12 | 13] |⏎${R2}⏎${R3}`,
        keys: ['Backspace', 'Backspace'],
        off: {
          file: `${R2}⏎| - | - | - |⏎${R3}`,
          caret: `| ‸21 | 22 | 23 |⏎| - | - | - |⏎${R3}`,
        },
        on: { newest: `${R2}⏎| - | - | - |⏎${R3}`, original: `${H}${R1}⏎${R2}⏎${R3}` },
      },
      {
        name: 'a row shorter than the header is deleted as any row is',
        doc: G(R1, '| [21 | 22] |'),
        keys: ['Backspace', 'Backspace'],
        off: { file: WITHOUT(R1, R3) },
        on: { newest: WITHOUT(R1, R3), original: G(R1, '| 21 | 22 |') },
      },
      {
        // A line break is drawn, so it is text: the key that clears it does not take the row too.
        name: 'a cell with only a line break has text: the first ⌫ clears it, and the row stays',
        doc: G(R1, '| ‸<br> |  |  |'),
        keys: ['Ctrl-l', 'Backspace'],
        off: { file: G(R1, BLANK) },
        on: { newest: G(R1, BLANK), original: G(R1, '| <br> |  |  |') },
      },
      {
        name: 'and the second ⌫ deletes it, the line break kept in the row as it was',
        doc: G(R1, '| ‸<br> |  |  |'),
        keys: ['Ctrl-l', 'Backspace', 'Backspace'],
        off: { file: WITHOUT(R1, R3) },
        on: { newest: WITHOUT(R1, R3), original: G(R1, '| <br> |  |  |') },
      },
    ]),
  );
});

describe('⌫ and ⌦ on whole columns', () => {
  /** Column b selected, from its header cell to its last cell. */
  const COL = '| a | [b | c |⏎| - | - | - |⏎| 11 | 12 | 13 |⏎| 21 | 22 | 23 |⏎| 31 | 32] | 33 |';
  const ORIGINAL = '| a | b | c |⏎| - | - | - |⏎| 11 | 12 | 13 |⏎| 21 | 22 | 23 |⏎| 31 | 32 | 33 |';
  const CLEARED = '| a |  | c |⏎| - | - | - |⏎| 11 |  | 13 |⏎| 21 |  | 23 |⏎| 31 |  | 33 |';
  const REMOVED = '| a | c |⏎| - | - |⏎| 11 | 13 |⏎| 21 | 23 |⏎| 31 | 33 |';
  scriptRows(
    both([
      {
        name: '⌫ clears a selected column, and the column stays',
        doc: COL,
        keys: ['Backspace'],
        off: { file: CLEARED },
        on: { newest: CLEARED, original: ORIGINAL },
      },
      {
        name: '⌫ again deletes the column, the caret in the column that is then there',
        doc: COL,
        keys: ['Backspace', 'Backspace'],
        off: { file: REMOVED, caret: REMOVED.replace('| 33 |', '| ‸33 |') },
        on: { newest: REMOVED, original: ORIGINAL },
      },
      {
        name: '⌦ does the same',
        doc: COL,
        keys: ['Delete', 'Delete'],
        off: { file: REMOVED },
        on: { newest: REMOVED, original: ORIGINAL },
      },
      {
        name: 'two columns go together',
        doc: '| [a | b | c |⏎| - | - | - |⏎| 11 | 12 | 13 |⏎| 21 | 22 | 23 |⏎| 31 | 32] | 33 |',
        keys: ['Backspace', 'Backspace'],
        off: { file: '| c |⏎| - |⏎| 13 |⏎| 23 |⏎| 33 |' },
        on: { newest: '| c |⏎| - |⏎| 13 |⏎| 23 |⏎| 33 |', original: ORIGINAL },
      },
      {
        // The column's cells are the cells the rows have: the row that lacks one has no cell there to
        // clear. Track Changes cannot write the column's deletion while a row lacks it, and says so.
        name: 'a column that one row lacks: deleted from the rows that have it, refused in words when tracked',
        doc: '| a | b | [c |⏎| - | - | - |⏎| 11 | 12 | 13 |⏎| 21 | 22 |⏎| 31 | 32 | 33] |',
        keys: ['Backspace', 'Backspace'],
        off: { file: '| a | b |⏎| - | - |⏎| 11 | 12 |⏎| 21 | 22 |⏎| 31 | 32 |' },
        on: {
          refusal: 'A row of this table has fewer cells than its header. Fill it in first.',
          // The refused key wrote nothing: the column is as the first ⌫ left it.
          file: '| a | b | <del c> |⏎| - | - | - |⏎| 11 | 12 | <del 13> |⏎| 21 | 22 |⏎| 31 | 32 | <del 33> |',
        },
      },
      {
        name: 'the last columns go: the caret is in the one before',
        doc: '| a | [b | c |⏎| - | - | - |⏎| 11 | 12 | 13 |⏎| 21 | 22 | 23 |⏎| 31 | 32 | 33] |',
        keys: ['Backspace', 'Backspace'],
        off: {
          file: '| a |⏎| - |⏎| 11 |⏎| 21 |⏎| 31 |',
          caret: '| a |⏎| - |⏎| 11 |⏎| 21 |⏎| ‸31 |',
        },
        on: { newest: '| a |⏎| - |⏎| 11 |⏎| 21 |⏎| 31 |', original: ORIGINAL },
      },
    ]),
  );
});

describe('⌫ and ⌦ on the whole table', () => {
  const AROUND = (table: string) => `Intro.⏎⏎${table}⏎⏎After.⏎`;
  const TEXT = '| a | b |⏎| - | - |⏎| 11 | 12 |⏎| 21 | 22 |';
  const BLANKED = '|  |  |⏎| - | - |⏎|  |  |⏎|  |  |';
  scriptRows(
    both([
      {
        name: '⌫ clears every cell, and the table stays',
        doc: AROUND('| [a | b |⏎| - | - |⏎| 11 | 12 |⏎| 21 | 22] |'),
        keys: ['Backspace'],
        off: { file: AROUND(BLANKED) },
        on: { newest: AROUND(BLANKED), original: AROUND(TEXT) },
      },
      {
        name: '⌫ again deletes the table, the caret where it was',
        doc: AROUND('| [a | b |⏎| - | - |⏎| 11 | 12 |⏎| 21 | 22] |'),
        keys: ['Backspace', 'Backspace'],
        off: { file: 'Intro.⏎⏎After.⏎', caret: 'Intro.⏎⏎‸After.⏎' },
        on: { newest: 'Intro.⏎⏎After.⏎', original: AROUND(TEXT) },
      },
      {
        name: '⌦ does the same',
        doc: AROUND('| [a | b |⏎| - | - |⏎| 11 | 12 |⏎| 21 | 22] |'),
        keys: ['Delete', 'Delete'],
        off: { file: 'Intro.⏎⏎After.⏎' },
        on: { newest: 'Intro.⏎⏎After.⏎', original: AROUND(TEXT) },
      },
      {
        name: 'a table that ends the document: the caret goes to the end of the text before it',
        doc: 'Intro.⏎⏎| [a | b |⏎| - | - |⏎| 11 | 12 |⏎| 21 | 22] |⏎',
        keys: ['Backspace', 'Backspace'],
        off: { file: 'Intro.⏎', caret: 'Intro.‸⏎' },
        on: { newest: 'Intro.⏎', original: `Intro.⏎⏎${TEXT}⏎` },
      },
      {
        name: 'a table that is empty already goes with the one ⌫',
        doc: AROUND('| ‸ |  |⏎| - | - |⏎|  |  |⏎|  |  |'),
        keys: ['Mod-a', 'Backspace'],
        off: { file: 'Intro.⏎⏎After.⏎' },
        on: { newest: 'Intro.⏎⏎After.⏎', original: AROUND(BLANKED) },
      },
      {
        name: 'a table with text in one cell is cleared by ⌫, and stays',
        doc: AROUND('| ‸ |  |⏎| - | - |⏎|  | 12 |⏎|  |  |'),
        keys: ['Mod-a', 'Backspace'],
        off: { file: AROUND(BLANKED) },
        on: { newest: AROUND(BLANKED), original: AROUND('|  |  |⏎| - | - |⏎|  | 12 |⏎|  |  |') },
      },
      {
        name: 'a table with text in one cell is deleted by the second ⌫',
        doc: AROUND('| ‸ |  |⏎| - | - |⏎|  | 12 |⏎|  |  |'),
        keys: ['Mod-a', 'Backspace', 'Backspace'],
        off: { file: 'Intro.⏎⏎After.⏎' },
        on: { newest: 'Intro.⏎⏎After.⏎' },
      },
      {
        name: 'a table of a header alone is cleared by ⌫, and stays',
        doc: AROUND('| [a | b] |⏎| - | - |'),
        keys: ['Backspace'],
        off: { file: AROUND('|  |  |⏎| - | - |') },
        on: { newest: AROUND('|  |  |⏎| - | - |'), original: AROUND('| a | b |⏎| - | - |') },
      },
      {
        name: 'a table of a header alone is deleted by the second ⌫, the caret where it was',
        doc: AROUND('| [a | b] |⏎| - | - |'),
        keys: ['Backspace', 'Backspace'],
        off: { file: 'Intro.⏎⏎After.⏎', caret: 'Intro.⏎⏎‸After.⏎' },
        on: { newest: 'Intro.⏎⏎After.⏎', original: AROUND('| a | b |⏎| - | - |') },
      },
    ]),
  );
});

describe('what the second ⌫ is not', () => {
  const P = '| a | b | c |⏎| - | - | - |⏎| 11 | [12 | 13 |⏎| 21 | 22] | 23 |⏎| 31 | 32 | 33 |';
  const CLEARED = '| a | b | c |⏎| - | - | - |⏎| 11 |  | 13 |⏎| 21 |  | 23 |⏎| 31 | 32 | 33 |';
  scriptRows(
    both([
      {
        name: 'cells that are no whole rows or columns are cleared, again and again, never deleted',
        doc: P,
        keys: ['Backspace', 'Backspace', 'Delete'],
        off: { file: CLEARED },
        on: { newest: CLEARED },
      },
      {
        name: 'the caret in one cell is the editor’s own ⌫: emptying the row’s last text deletes no row',
        doc: G(R1, '|  | 22‸ |  |'),
        keys: ['Backspace', 'Backspace', 'Backspace'],
        off: { file: G(R1, BLANK) },
        on: { newest: G(R1, BLANK), original: G(R1, '|  | 22 |  |') },
      },
      {
        name: 'text selected inside one cell is the editor’s own ⌫ too: no row goes with it',
        doc: G(R1, '| [21] |  |  |'),
        keys: ['Backspace', 'Backspace'],
        off: { file: G(R1, BLANK) },
        on: { newest: G(R1, BLANK), original: G(R1, '| 21 |  |  |') },
      },
    ]),
  );
});

describe('your own pending changes in what goes', () => {
  scriptRows(
    both([
      {
        name: 'your own insertion in the row is just gone: the deletion keeps the row as it was',
        doc: G(R1, '| [21<ins>x</ins> | 22 | 23] |'),
        keys: ['Backspace', 'Backspace'],
        off: { file: WITHOUT(R1, R3) },
        on: { newest: WITHOUT(R1, R3), original: G(R1, R2) },
      },
      {
        name: 'your own new row goes outright: nothing is kept of it',
        doc: '| a | b |⏎| - | - |⏎| 1 | 2‸ |',
        keys: ['Tab', 'Ctrl-l', 'Backspace'],
        off: { file: '| a | b |⏎| - | - |⏎| 1 | 2 |', caret: '| a | b |⏎| - | - |⏎| ‸1 | 2 |' },
        on: {
          file: '| a | b |⏎| - | - |⏎| 1 | 2 |',
          newest: '| a | b |⏎| - | - |⏎| 1 | 2 |',
          original: '| a | b |⏎| - | - |⏎| 1 | 2 |',
        },
      },
    ]),
  );
});

describe('another person’s pending change in what goes (rules 3 and 6)', () => {
  // Their change stays theirs with Track Changes on, and is refused with the words; with it off the
  // rows, columns and table go with what is pending in them.
  scriptRows(
    both([
      {
        name: 'a row',
        doc: G(R1, '| ‸<del 21> | <del 22> | <del 23> |'),
        keys: ['Ctrl-l', 'Backspace'],
        others: 'bo',
        off: { newest: WITHOUT(R1, R3) },
        // The refused key wrote nothing: the file is the one it started from.
        on: {
          refusal: "bo's pending change is in this row. Decide it first.",
          file: G(R1, '| <del 21> | <del 22> | <del 23> |'),
        },
      },
      {
        name: 'a row, with an insertion of theirs in a cell: the first ⌫ strikes it, the second is refused',
        doc: G(R1, '| ‸<ins>x</ins> |  |  |'),
        keys: ['Ctrl-l', 'Backspace', 'Backspace'],
        others: 'bo',
        off: { newest: WITHOUT(R1, R3) },
        // Your deletion inside their insertion is all the first key wrote.
        on: {
          refusal: "bo's pending change is in this row. Decide it first.",
          file: G(R1, '| <ins><del x></ins> |  |  |'),
        },
      },
      {
        name: 'a column, after the first ⌫',
        doc: '| a | [b | c |⏎| - | - | - |⏎| 11 | 12 | 13 |⏎| 21 | <del 22> | 23 |⏎| 31 | 32] | 33 |',
        keys: ['Backspace', 'Backspace'],
        others: 'bo',
        off: { newest: '| a | c |⏎| - | - |⏎| 11 | 13 |⏎| 21 | 23 |⏎| 31 | 33 |' },
        // Only the first key wrote: the column is struck, and the second left it as it was.
        on: {
          refusal: "bo's pending change is in this column. Decide it first.",
          file: '| a | <del b> | c |⏎| - | - | - |⏎| 11 | <del 12> | 13 |⏎| 21 | <del 22> | 23 |⏎| 31 | <del 32> | 33 |',
        },
      },
      {
        name: 'a table',
        doc: 'Intro.⏎⏎| ‸ |  |⏎| - | - |⏎|  | <del 12> |⏎|  |  |⏎⏎After.⏎',
        keys: ['Mod-a', 'Backspace'],
        others: 'bo',
        off: { newest: 'Intro.⏎⏎After.⏎' },
        on: {
          refusal: "bo's pending change is in this table. Decide it first.",
          file: 'Intro.⏎⏎|  |  |⏎| - | - |⏎|  | <del 12> |⏎|  |  |⏎⏎After.',
        },
      },
    ]),
  );
});

describe('what refuses the second ⌫ in either mode (rule 2)', () => {
  const LEDGER = (ids: string[]) =>
    `<!-- redlines⏎version: 1⏎marks:⏎${ids.map((id) => `  ${id}: {by: bo, at: 2026-11-01T10:00Z}⏎`).join('')}-->⏎`;
  const COLUMN = `<!--del m2bd col=2 \\| c \\\\n \\| - \\\\n \\| 3 \\\\n \\| 4-->⏎⏎${LEDGER(['m2bd'])}`;
  const ROW = `<!--del g5nb row=2 \\| 3 \\| 4 \\|-->⏎⏎${LEDGER(['g5nb'])}`;
  scriptRows(
    both([
      {
        name: 'a row, while a column is pending deleted',
        doc: `| a | b |⏎| - | - |⏎| 1 | 2 |⏎| ‸ |  |⏎⏎${COLUMN}`,
        keys: ['Ctrl-l', 'Backspace'],
        off: { refusal: 'Accept or reject the column changes in this table first.' },
        on: { refusal: 'Accept or reject the column changes in this table first.' },
      },
      {
        name: 'a column, while a row is pending deleted, after the first ⌫',
        doc: `| a | [b | c |⏎| - | - | - |⏎| 1 | 2 | 3 |⏎| 5 | 6] | 7 |⏎⏎${ROW}`,
        keys: ['Backspace', 'Backspace'],
        off: { refusal: 'Accept or reject the row changes in this table first.' },
        on: { refusal: 'Accept or reject the row changes in this table first.' },
      },
    ]),
  );
});

describe('in an editor', () => {
  const open: Editor[] = [];
  const notices: string[] = [];
  afterEach(() => {
    notices.length = 0;
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  function mount(doc: string, tracking: boolean): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, {
      doc,
      author: { handle: 'ada', name: 'Ada Lovelace' },
      tracking,
      onNotice: (message) => notices.push(message),
    });
    open.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    return editor;
  }
  const press = (editor: Editor, key: string, init: KeyboardEventInit = {}) => {
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    return runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
      'editor',
    );
  };
  const selection = (editor: Editor) => {
    const { anchor, head } = editor.view.state.selection.main;
    return [anchor, head];
  };

  const DOC = '| a | b |\n| - | - |\n| 11 | 12 |\n| 21 | 22 |\n| 31 | 32 |\n';

  for (const tracking of [false, true]) {
    const mode = `Track Changes ${tracking ? 'on' : 'off'}`;

    it(`Undo takes the deleted rows back with the selection they were deleted with, ${mode}`, () => {
      const editor = mount(DOC, tracking);
      const anchor = DOC.indexOf('21');
      const head = DOC.indexOf('22') + 2;
      editor.view.dispatch({ selection: { anchor, head } });
      press(editor, 'Backspace');
      const cleared = { doc: editor.getDoc(), selection: selection(editor) };
      expect(cleared.doc).not.toBe(DOC);
      press(editor, 'Backspace');
      const deleted = editor.getDoc();
      expect(deleted).not.toBe(cleared.doc);
      expect(editor.getUiState().undo).toBe('Delete Row');
      // One step: a single Undo gives the cleared row back, the rectangle selected as it was.
      expect(undo(editor.view)).toBe(true);
      expect({ doc: editor.getDoc(), selection: selection(editor) }).toEqual(cleared);
      const rect = rectOf(editor.view.state);
      expect(rect && whole(rect)).toBe('row');
      // Redo gives the deletion back; two Undos take both steps back.
      expect(redo(editor.view)).toBe(true);
      expect(editor.getDoc()).toBe(deleted);
      undo(editor.view);
      undo(editor.view);
      expect(editor.getDoc()).toBe(DOC);
      expect(selection(editor)).toEqual([anchor, head]);
    });

    it(`Undo takes a deleted table back with the selection it had, ${mode}`, () => {
      const doc = `Intro.\n\n${DOC}\nAfter.\n`;
      const editor = mount(doc, tracking);
      editor.view.dispatch({
        selection: { anchor: doc.indexOf('| a') + 2, head: doc.indexOf('32') + 2 },
      });
      const start = selection(editor);
      press(editor, 'Backspace');
      const cleared = { doc: editor.getDoc(), selection: selection(editor) };
      press(editor, 'Backspace');
      expect(newestView(editor.getDoc()).text).toBe('Intro.\n\nAfter.\n');
      expect(editor.getUiState().undo).toBe('Delete Table');
      undo(editor.view);
      expect({ doc: editor.getDoc(), selection: selection(editor) }).toEqual(cleared);
      const rect = rectOf(editor.view.state);
      expect(rect && whole(rect)).toBe('table');
      undo(editor.view);
      expect(editor.getDoc()).toBe(doc);
      expect(selection(editor)).toEqual(start);
    });
  }

  it('writes nothing when the format refuses, and keeps the rows selected', () => {
    // Rule 2: a column pending deleted keeps its cells, and a row that went would leave it one too many.
    const marker = '<!--del m2bd col=2 \\| c \\\\n \\| - \\\\n \\| 3 \\\\n \\| 4-->';
    const ledger =
      '<!-- redlines\nversion: 1\nmarks:\n  m2bd: {by: bo, at: 2026-11-01T10:00Z}\n-->\n';
    const doc = `| a | b |\n| - | - |\n| 1 | 2 |\n|  |  |\n\n${marker}\n\n${ledger}`;
    for (const tracking of [false, true]) {
      notices.length = 0;
      const editor = mount(doc, tracking);
      editor.view.dispatch({ selection: { anchor: doc.indexOf('|  |  |') + 2 } });
      press(editor, 'l', { ctrlKey: true });
      const start = selection(editor);
      expect(rectOf(editor.view.state)).not.toBeNull();
      press(editor, 'Backspace');
      expect(notices).toEqual(['Accept or reject the column changes in this table first.']);
      expect(editor.getDoc()).toBe(doc);
      expect(selection(editor)).toEqual(start);
      expect(editor.getUiState().undo).toBeNull();
    }
  });

  it('decides what is empty by what the page shows: a comment’s anchor is no text', () => {
    const ledger =
      '\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\ncomments:\n  c8d2:\n    by: bo\n    at: 2026-11-01T10:00Z\n    text: |-\n      Why?\n-->\n';
    const doc = `| a | b |\n| - | - |\n| 11 | 12 |\n|  | <!--cmt c8d2--> |\n${ledger}`;
    for (const tracking of [false, true]) {
      const editor = mount(doc, tracking);
      editor.view.dispatch({ selection: { anchor: doc.indexOf('|  |') + 2 } });
      press(editor, 'l', { ctrlKey: true });
      const rect = rectOf(editor.view.state);
      expect(rect && whole(rect)).toBe('row');
      // Nothing in either cell is text: the row goes at once, and the comment keeps a place.
      press(editor, 'Backspace');
      expect(notices).toEqual([]);
      expect(newestView(editor.getDoc()).text.startsWith('| a | b |\n| - | - |\n| 11 | 12 |')).toBe(
        true,
      );
      expect(newestView(editor.getDoc()).text).not.toContain('|  |');
      expect(parse(editor.getDoc()).marks.some((mark) => mark.id === 'c8d2')).toBe(true);
    }
  });

  it('reads what is empty the same in Clean, Simple and Redlines: deleted text is no text', () => {
    for (const view of ['clean', 'simple', 'redlines'] as const) {
      const editor = mount(DOC, true);
      editor.view.dispatch({
        selection: { anchor: DOC.indexOf('21'), head: DOC.indexOf('22') + 2 },
      });
      press(editor, 'Backspace');
      // The row's cells hold deletions now, struck in Redlines, hidden in the others.
      editor.setViewMode(view);
      press(editor, 'Backspace');
      expect(newestView(editor.getDoc()).text, view).toBe(
        '| a | b |\n| - | - |\n| 11 | 12 |\n| 31 | 32 |\n',
      );
    }
  });

  it('counts what the page shows as text: the author’s own HTML comment is none where it is hidden', () => {
    // Hidden in Clean and Simple, drawn as a note in Redlines (design §5.5), where the row has text.
    const doc = '| a | b |\n| - | - |\n| 11 | 12 |\n|  | <!-- todo --> |\n';
    const row = doc.indexOf('|  |') + 2;
    for (const [view, goes] of [
      ['clean', true],
      ['simple', true],
      ['redlines', false],
    ] as const) {
      const editor = mount(doc, false);
      editor.setViewMode(view);
      editor.view.dispatch({ selection: { anchor: row } });
      press(editor, 'l', { ctrlKey: true });
      press(editor, 'Backspace');
      const after = editor.getDoc();
      expect(after.includes('|  |  |'), view).toBe(!goes);
      expect(after.includes('todo'), view).toBe(false);
      press(editor, 'Backspace');
      expect(editor.getDoc(), view).toBe('| a | b |\n| - | - |\n| 11 | 12 |\n');
    }
  });

  it('writes the file’s own line breaks, and rejecting the deletion gives every byte back', () => {
    const crlf =
      'Intro.\r\n\r\n| a | b |\r\n| - | - |\r\n| 11 | 12 |\r\n| 21 | 22 |\r\n\r\nAfter.\r\n';
    for (const [from, to] of [
      [crlf.indexOf('21'), crlf.indexOf('22') + 2],
      [crlf.indexOf('| a') + 2, crlf.indexOf('22') + 2],
    ] as const) {
      const editor = mount(crlf, true);
      editor.view.dispatch({ selection: { anchor: from, head: to } });
      press(editor, 'Backspace');
      press(editor, 'Backspace');
      const after = editor.getDoc();
      expect(after).not.toBe(crlf);
      // Every line break the file has is the file's own, a CR and an LF.
      expect(after.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      for (let step = 0; step < 10; step++) {
        const mark = parse(editor.getDoc()).marks.find((m) => m.kind === 'del');
        if (!mark) break;
        editor.reject(mark.id);
      }
      expect(editor.getDoc()).toBe(crlf);
    }
  });

  it('works on the cells it selects, once: a long table’s column, with Track Changes off and on', () => {
    const rows = Array.from({ length: 300 }, (_, i) => `| r${i} | s${i} | t${i} |`);
    const doc = `| a | b | c |\n| - | - | - |\n${rows.join('\n')}\n`;
    for (const tracking of [false, true]) {
      const editor = mount(doc, tracking);
      editor.view.dispatch({
        selection: { anchor: doc.indexOf('| b |') + 2, head: doc.indexOf('s299') + 4 },
      });
      const rect = rectOf(editor.view.state);
      expect(rect && whole(rect)).toBe('column');
      // The first key reads one cell, the first, which has text: nothing more is asked of the rest.
      emptyStats.cells = 0;
      press(editor, 'Backspace');
      expect(emptyStats.cells).toBe(1);
      expect(tablesOf(editor.view.state)).toHaveLength(1);
      expect(rectOf(editor.view.state)).not.toBeNull();
      // The second reads the 301 cells of the column, each once, and no cell of the two others.
      emptyStats.cells = 0;
      press(editor, 'Backspace');
      expect(emptyStats.cells).toBe(301);
      const lines = newestView(editor.getDoc()).text.split('\n');
      expect(lines[0]).toBe('| a | c |');
      expect(lines[301]).toBe('| r299 | t299 |');
    }
  }, 60_000);
});
