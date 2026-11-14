// @vitest-environment happy-dom
// Typing into a cell a row lacks (design: tables, "Edge cases": "typing into a missing cell writes its
// pipes first, plain, as rule 7 does"; format §3.7). Keystroke scripts with Track Changes off and on, each
// read in every decision order, Undo taking every step back with its selection and one Undo taking the
// pipes and the text back together; a paste and a drop at the caret there; and an input method composing
// there, which writes the pipes when it starts.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { newestView, originalView, parse, readTables } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { type Script, scriptRows, type Step } from '../blocks/script.ts';
import { createEditor, type Editor, redo, undo } from '../index.ts';
import { cellsOfRect, rectOf, rectSelection, selectRect, whole } from './cells.ts';
import { missingCaret } from './missing.ts';
import { tablesOf } from './model.ts';

interface Row {
  name: string;
  doc: string;
  keys: Step[];
  off: Script['expect'];
  on: Script['expect'];
  skip?: Script['skip'];
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) =>
    [false, true].map((tc) => ({
      name: `${row.name}, Track Changes ${tc ? 'on' : 'off'}`,
      doc: row.doc,
      keys: row.keys,
      tc,
      expect: tc ? row.on : row.off,
      ...(row.skip ? { skip: row.skip } : {}),
    })),
  );

/** The same in both. */
const same = (caret: string) => ({ off: { caret }, on: { caret } });

const H = '| a | b | c |⏎| - | - | - |⏎';

describe('typing into a cell a row lacks', () => {
  scriptRows(
    both([
      {
        name: 'the second missing cell: its pipes are written first, plain, and x is typed in it',
        doc: `${H}| 1‸ |`,
        keys: ['Tab', 'Tab', { type: 'x' }],
        off: { caret: `${H}| 1 | | x‸ |`, file: `${H}| 1 | | x |` },
        on: {
          caret: `${H}| 1 | | <ins>x‸</ins> |`,
          newest: `${H}| 1 | | x |`,
          // Rejecting it leaves a table that reads like the original: the pipes are no change.
          original: `${H}| 1 | |  |`,
        },
      },
      {
        name: 'the first missing cell',
        doc: `${H}| 1‸ |`,
        keys: ['Tab', { type: 'x' }],
        off: { caret: `${H}| 1 | x‸ |` },
        on: { caret: `${H}| 1 | <ins>x‸</ins> |`, original: `${H}| 1 |  |` },
      },
      {
        name: 'by the arrows, as by Tab',
        doc: `${H}| 1‸ |`,
        keys: ['ArrowRight', 'ArrowRight', { type: 'x' }],
        off: { caret: `${H}| 1 | | x‸ |` },
        on: { caret: `${H}| 1 | | <ins>x‸</ins> |` },
      },
      {
        name: 'by ⇧Tab from the row below',
        doc: `${H}| 1 |⏎| ‸4 | 5 | 6 |`,
        keys: ['Shift-Tab', { type: 'x' }],
        off: { caret: `${H}| 1 | | x‸ |⏎| 4 | 5 | 6 |` },
        on: { caret: `${H}| 1 | | <ins>x‸</ins> |⏎| 4 | 5 | 6 |` },
      },
      {
        name: 'a second letter goes on in the cell, and in the insertion',
        doc: `${H}| 1‸ |`,
        keys: ['Tab', { type: 'x' }, { type: 'y' }],
        off: { caret: `${H}| 1 | xy‸ |` },
        on: { caret: `${H}| 1 | <ins>xy‸</ins> |`, original: `${H}| 1 |  |` },
      },
      {
        name: 'a typed pipe is written escaped, as in any cell',
        doc: `${H}| 1‸ |`,
        keys: ['Tab', { type: '|' }],
        off: { caret: `${H}| 1 | \\|‸ |` },
        on: { caret: `${H}| 1 | <ins>\\|‸</ins> |` },
      },
      {
        name: 'a row in the middle of the table',
        doc: `${H}| 1‸ |⏎| 4 | 5 | 6 |`,
        keys: ['Tab', 'Tab', { type: 'x' }],
        off: { caret: `${H}| 1 | | x‸ |⏎| 4 | 5 | 6 |` },
        on: { caret: `${H}| 1 | | <ins>x‸</ins> |⏎| 4 | 5 | 6 |` },
      },
      {
        name: 'Return writes a line break there',
        doc: `${H}| 1‸ |`,
        keys: ['Tab', 'Enter'],
        off: { caret: `${H}| 1 | <br>‸ |` },
        on: { caret: `${H}| 1 | <ins><br>‸</ins> |` },
        skip: { 'take-back': 'Backspace after Return writes a pipe-less take-back' },
      },
      {
        name: '⌫ and ⌦ there do nothing, and write no pipe',
        doc: `${H}| 1‸ |`,
        keys: ['Tab', 'Backspace', 'Delete'],
        ...same(`${H}| 1 |‸`),
      },
    ]),
  );
});

describe('typing into a cell a row lacks, in a row without the pipes at its edges', () => {
  scriptRows(
    both([
      {
        name: 'no leading pipe',
        doc: `${H}1 | 2‸ |`,
        keys: ['Tab', { type: 'x' }],
        off: { caret: `${H}1 | 2 | x‸ |` },
        on: { caret: `${H}1 | 2 | <ins>x‸</ins> |`, original: `${H}1 | 2 |  |` },
      },
      {
        name: 'no closing pipe: no closing pipe is written',
        doc: `${H}| 1 | 2‸`,
        keys: ['Tab', { type: 'x' }],
        off: { caret: `${H}| 1 | 2 | x‸` },
        on: { caret: `${H}| 1 | 2 | <ins>x‸</ins>`, original: `${H}| 1 | 2 | ` },
      },
      {
        name: 'neither',
        doc: `${H}1 | 2‸`,
        keys: ['Tab', { type: 'x' }],
        off: { caret: `${H}1 | 2 | x‸` },
        on: { caret: `${H}1 | 2 | <ins>x‸</ins>`, original: `${H}1 | 2 | ` },
      },
      {
        name: 'a row that is one pipe',
        doc: `${H}|‸`,
        keys: ['Tab', { type: 'x' }],
        off: { caret: `${H}| | x‸` },
        on: { caret: `${H}| | <ins>x‸</ins>`, original: `${H}| | ` },
      },
      {
        name: 'a row that is one pipe, the second cell it lacks',
        doc: `${H}|‸`,
        keys: ['Tab', 'Tab', { type: 'x' }],
        off: { caret: `${H}| | | x‸` },
        on: { caret: `${H}| | | <ins>x‸</ins>` },
      },
      {
        name: 'a row of one cell and no pipe',
        doc: `${H}1‸`,
        keys: ['Tab', 'Tab', { type: 'x' }],
        off: { caret: `${H}1 | | x‸` },
        on: { caret: `${H}1 | | <ins>x‸</ins>` },
      },
    ]),
  );
});

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, caret: number, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const notices: string[] = [];
  const editor = createEditor(parent, {
    doc,
    author: ada,
    tracking,
    onNotice: (message) => notices.push(message),
  });
  Object.assign(editor, { notices });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: caret } });
  return editor;
}

const notices = (editor: Editor) => (editor as unknown as { notices: string[] }).notices;
const press = (editor: Editor, key: string, init: KeyboardEventInit = {}) =>
  runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key, ...init }), 'editor');
const head = (editor: Editor) => editor.view.state.selection.main.head;
const lacking = (editor: Editor) => missingCaret(editor.view.state)?.cell.col ?? null;
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
/** The cells of the first table of a text as the format reads them, a short row with blank cells after
 * its last as GFM does (the format's own tests hold its reader to micromark). */
const reads = (text: string): string[][] => {
  const table = readTables(text, parse(text))[0];
  return (table?.rows ?? []).map((row) =>
    Array.from({ length: table?.aligns.length ?? 0 }, (_, i) => {
      const cell = row.cells[i];
      return cell ? text.slice(cell.textFrom, cell.textTo) : '';
    }),
  );
};

const DOC = '| a | b | c |\n| - | - | - |\n| 1 |\n| 4 | 5 | 6 |';
/** The end of the text of the last cell of the short row: Tab goes on from there. */
const AT_ONE = DOC.indexOf('1 |') + 1;

describe('one step to undo, and what the file reads as', () => {
  for (const tracking of [false, true]) {
    const mode = `Track Changes ${tracking ? 'on' : 'off'}`;

    it(`takes the pipes and the text back in one Undo, and gives them back in one Redo, ${mode}`, () => {
      const editor = load(DOC, AT_ONE, tracking);
      const start = editor.getDoc();
      press(editor, 'Tab');
      press(editor, 'Tab');
      expect(lacking(editor)).toBe(2);
      const selection = [editor.view.state.selection.main.anchor, head(editor)];
      editor.view.dispatch({
        ...editor.view.state.replaceSelection('x'),
        userEvent: 'input.type',
      });
      const typed = editor.getDoc();
      expect(typed).not.toBe(start);
      expect(newestView(typed).text).toContain('| 1 | | x |');
      // Both versions have the pipes: the original reads as the table did.
      if (tracking) expect(reads(originalView(typed).text)).toEqual(reads(start));
      undo(editor.view);
      expect(editor.getDoc()).toBe(start);
      expect([editor.view.state.selection.main.anchor, head(editor)]).toEqual(selection);
      redo(editor.view);
      expect(editor.getDoc()).toBe(typed);
      expect(notices(editor)).toEqual([]);
    });
  }

  it('writes the same bytes with Track Changes off as the newest view with it on', () => {
    const off = load(DOC, AT_ONE, false);
    const on = load(DOC, AT_ONE, true);
    for (const editor of [off, on]) {
      press(editor, 'Tab');
      press(editor, 'Tab');
      editor.view.dispatch({ ...editor.view.state.replaceSelection('x'), userEvent: 'input.type' });
    }
    expect(off.getDoc()).toBe(newestView(on.getDoc()).text);
  });

  it('shows a tracked change made in Clean in the markup view, as typing does', () => {
    const editor = load(DOC, AT_ONE, true);
    editor.setViewMode('clean');
    press(editor, 'Tab');
    editor.view.dispatch({ ...editor.view.state.replaceSelection('x'), userEvent: 'input.type' });
    expect(editor.getUiState().view).not.toBe('clean');
  });
});

describe('what is typed in a cell a row lacks is what is typed in an empty cell', () => {
  const TEXTS = ['x', ' ', 'a b', ' a', 'a ', '**b**', '😀', 'é', '<br>', 'a|b', '\\', '\\|', '*'];
  for (const tracking of [false, true]) {
    it(`reads the same as typing it in a cell the row has, Track Changes ${tracking ? 'on' : 'off'}`, () => {
      const missing = '| a | b |\n| - | - |\n| 1 |';
      const empty = '| a | b |\n| - | - |\n| 1 |  |';
      for (const text of TEXTS) {
        const type = (doc: string, caret: number, tab: boolean) => {
          const editor = load(doc, caret, tracking);
          if (tab) press(editor, 'Tab');
          editor.view.dispatch({
            ...editor.view.state.replaceSelection(text),
            userEvent: 'input.type',
          });
          // The body, its marks' ids left out (each editor draws its own).
          const file = editor.getDoc();
          const body = file.includes('<!-- redlines')
            ? file.slice(0, file.indexOf('<!-- redlines'))
            : file;
          const ids = /<!--(?:\/|(?:ins|sub|del|fmt|cmt|split) )[a-z0-9]{4}/g;
          const out = [body.replace(ids, (m) => `${m.slice(0, -4)}ID`), head(editor)] as const;
          editor.destroy();
          return out;
        };
        const lacking_ = type(missing, missing.indexOf('1 |') + 1, true);
        const had = type(empty, empty.indexOf('|  |', empty.indexOf('1 |')) + 2, false);
        // The same text, and the caret in the same place.
        expect(lacking_[0], JSON.stringify(text)).toBe(had[0]);
        expect(lacking_[1], JSON.stringify(text)).toBe(had[1]);
      }
    });
  }
});

describe('a paste and a drop at the caret in a cell a row lacks', () => {
  for (const tracking of [false, true]) {
    for (const userEvent of ['input.paste', 'input.drop']) {
      it(`go in as the cell’s text, a pipe escaped, a line break a <br>, ${userEvent}, Track Changes ${tracking ? 'on' : 'off'}`, () => {
        const editor = load(DOC, AT_ONE, tracking);
        press(editor, 'Tab');
        press(editor, 'Tab');
        editor.view.dispatch({
          changes: { from: head(editor), insert: 'a|b\nc\td' },
          selection: { anchor: head(editor) + 7 },
          userEvent,
        });
        expect(newestView(editor.getDoc()).text).toContain('| 1 | | a\\|b<br>c d |');
        expect(notices(editor)).toEqual([]);
        undo(editor.view);
        expect(editor.getDoc()).toBe(DOC);
      });
    }
  }

  it('is refused where it can’t be written, and the text of the table stays', () => {
    const editor = load(DOC, AT_ONE, false);
    press(editor, 'Tab');
    // Text with a line break and more changes than one insertion at the caret is not a paste.
    editor.view.dispatch({
      changes: [
        { from: head(editor), insert: 'x' },
        { from: 0, insert: 'y' },
      ],
      userEvent: 'input.paste',
    });
    expect(editor.getDoc()).toBe(DOC);
    expect(notices(editor)).toEqual(["A table's text goes in its cells."]);
  });
});

describe('a paste event at the caret in a cell a row lacks', () => {
  const paste = (editor: Editor, text: string): boolean => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    editor.view.contentDOM.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('puts plain text in, and refuses a range, which the cells it needs are not there for', () => {
    for (const tracking of [false, true]) {
      const editor = load(DOC, AT_ONE, tracking);
      press(editor, 'Tab');
      press(editor, 'Tab');
      // A range of cells, as tab-separated text: refused in words, nothing written.
      paste(editor, 'p\tq');
      expect(editor.getDoc()).toBe(DOC);
      expect(notices(editor)).toEqual([
        'Row 1 has fewer cells than the table. Write the cells it lacks first.',
      ]);
      // Plain text: the cell's text, pipes written first.
      notices(editor).length = 0;
      editor.view.dispatch({
        changes: { from: head(editor), insert: 'plain' },
        selection: { anchor: head(editor) + 5 },
        userEvent: 'input.paste',
      });
      expect(newestView(editor.getDoc()).text).toContain('| 1 | | plain |');
      expect(notices(editor)).toEqual([]);
    }
  });
});

describe('an input method composing in a cell a row lacks', () => {
  const compose = (editor: Editor, from: number, to: number, text: string, first = false) =>
    editor.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: first ? 'input.type.compose.start' : 'input.type.compose',
    });
  const composing = (editor: Editor, on: boolean) => {
    (editor.view as unknown as { inputState: { composing: number } }).inputState.composing = on
      ? 1
      : -1;
  };
  const start = (editor: Editor) =>
    editor.view.dom.dispatchEvent(new Event('compositionstart', { bubbles: true }));

  for (const tracking of [false, true]) {
    const mode = `Track Changes ${tracking ? 'on' : 'off'}`;

    it(`writes the pipes, plain, when it starts, and the composed text is in the new cell, ${mode}`, async () => {
      const editor = load(DOC, AT_ONE, tracking);
      press(editor, 'Tab');
      press(editor, 'Tab');
      start(editor);
      // The pipes only: no mark, and the cell is there, the caret in it.
      const written = editor.getDoc();
      expect(written.startsWith('| a | b | c |\n| - | - | - |\n| 1 | |  |\n')).toBe(true);
      expect(written).not.toContain('<!--ins');
      const stop = written.indexOf('|  |\n| 4') + 2;
      expect(head(editor)).toBe(stop);
      expect(lacking(editor)).toBeNull();
      // The composition goes on in a real empty cell, with its filler.
      const row = editor.view.contentDOM.querySelectorAll('.cm-line.rl-trow')[1];
      // The two empty cells it has now, with a filler each, and none that the row lacks.
      expect(row?.querySelectorAll('.rl-tc-fill')).toHaveLength(2);
      expect(row?.querySelectorAll('.rl-tc-missing')).toHaveLength(0);
      // An update that leaves the cell alone leaves its filler where it is, for the input method to
      // work beside: the same element, not one drawn again.
      const filler = row?.querySelectorAll('.rl-tc-fill')[1];
      editor.view.dispatch({ selection: { anchor: head(editor) }, userEvent: 'select' });
      expect(
        editor.view.contentDOM
          .querySelectorAll('.cm-line.rl-trow')[1]
          ?.querySelectorAll('.rl-tc-fill')[1],
      ).toBe(filler);
      composing(editor, true);
      compose(editor, stop, stop, '¨', true);
      compose(editor, stop, stop + 1, 'ö');
      await tick();
      expect(editor.getDoc()).toContain('| 1 | | ö |');
      composing(editor, false);
      editor.view.contentDOM.dispatchEvent(new Event('compositionend', { bubbles: true }));
      await tick();
      const done = editor.getDoc();
      expect(newestView(done).text).toContain('| 1 | | ö |');
      expect(done.includes('<!--ins')).toBe(tracking);
      if (tracking) expect(reads(originalView(done).text)).toEqual(reads(DOC));
      expect(notices(editor)).toEqual([]);
      // The pipes are a step of their own: one Undo takes the text, the next the pipes.
      undo(editor.view);
      expect(editor.getDoc()).toBe(written);
      undo(editor.view);
      expect(editor.getDoc()).toBe(DOC);
    });
  }

  it('writes the pipes of a row with no closing pipe, so that the cell is there to compose in', () => {
    const doc = '| a | b | c |\n| - | - | - |\n| 1 | 2';
    const editor = load(doc, doc.length, false);
    press(editor, 'Tab');
    start(editor);
    expect(editor.getDoc()).toBe('| a | b | c |\n| - | - | - |\n| 1 | 2 |  |');
    expect(head(editor)).toBe(editor.getDoc().length - 2);
  });

  it('does nothing when the caret is not in a cell its row lacks', () => {
    const editor = load(DOC, DOC.indexOf('4'), false);
    start(editor);
    expect(editor.getDoc()).toBe(DOC);
  });
});

describe('selecting a column that the last row does not reach', () => {
  const SHORT_LAST = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 |';

  for (const tracking of [false, true]) {
    const mode = `Track Changes ${tracking ? 'on' : 'off'}`;
    const texts = (editor: Editor) =>
      cellsOfRect(rectOf(editor.view.state)!).map((cell) =>
        editor.view.state.sliceDoc(cell.textFrom, cell.textTo),
      );

    it(`selects exactly that column, and ⌫⌫ takes only its cells, ${mode}`, () => {
      const editor = load(SHORT_LAST, SHORT_LAST.indexOf('c'), tracking);
      expect(selectRect(editor.view, 'column')).toBe(true);
      const rect = rectOf(editor.view.state)!;
      expect(rect.cols).toEqual([2, 2]);
      expect(texts(editor)).toEqual(['c', '3']);
      expect(whole(rect)).toBe('column');
      // ⌫ clears the column's cells and no other's, and keeps the column selected.
      press(editor, 'Backspace');
      const cleared = newestView(editor.getDoc()).text;
      expect(cleared).toBe('| a | b |  |\n| - | - | - |\n| 1 | 2 |  |\n| 4 | 5 |');
      expect(rectOf(editor.view.state)?.cols).toEqual([2, 2]);
      // ⌫ again deletes the column: with Track Changes off the cells go, and with it on the format
      // refuses a column that a row lacks, in words, and nothing else changes.
      const before = editor.getDoc();
      press(editor, 'Backspace');
      if (tracking) {
        expect(editor.getDoc()).toBe(before);
        expect(notices(editor)).toEqual([
          'A row of this table has fewer cells than its header. Fill it in first.',
        ]);
      } else {
        expect(editor.getDoc()).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n| 4 | 5 |');
        expect(notices(editor)).toEqual([]);
      }
      // The neighbouring column is whole, as it was.
      expect(newestView(editor.getDoc()).text).toContain('| 1 | 2 |');
      expect(newestView(editor.getDoc()).text).toContain('| 4 | 5 |');
      expect(newestView(editor.getDoc()).text).toContain('| a | b |');
    });
  }

  it('selects the whole table, the last row’s two cells and all, and a short row as a row', () => {
    const editor = load(SHORT_LAST, SHORT_LAST.indexOf('c'), false);
    expect(selectRect(editor.view, 'table')).toBe(true);
    expect(whole(rectOf(editor.view.state)!)).toBe('table');
    expect(cellsOfRect(rectOf(editor.view.state)!)).toHaveLength(8);
    editor.view.dispatch({ selection: { anchor: SHORT_LAST.indexOf('5') } });
    expect(selectRect(editor.view, 'row')).toBe(true);
    expect(whole(rectOf(editor.view.state)!)).toBe('row');
    expect(cellsOfRect(rectOf(editor.view.state)!)).toHaveLength(2);
    // A column the last row does reach is as it was.
    editor.view.dispatch({ selection: { anchor: SHORT_LAST.indexOf('b') } });
    expect(selectRect(editor.view, 'column')).toBe(true);
    expect(rectOf(editor.view.state)?.cols).toEqual([1, 1]);
    expect(cellsOfRect(rectOf(editor.view.state)!)).toHaveLength(3);
  });
});

describe('selecting a column that no body row reaches', () => {
  // The header has the column and every row below lacks it: the column is the header's cell alone.
  const NONE = '| a | b | c |\n| - | - | - |\n| 1 | 2 |\n| 4 | 5 |';
  const selected = (editor: Editor) => {
    const { from, to } = editor.view.state.selection.main;
    return editor.view.state.sliceDoc(from, to);
  };
  /** An editor on `doc` with the caret in the header cell `c`, or in the cell of column 2 that the last
   * row lacks, which → from the end of the row's last cell reaches. */
  function start(doc: string, tracking: boolean, where: 'header' | 'missing'): Editor {
    if (where === 'header') return load(doc, doc.indexOf('c'), tracking);
    const editor = load(doc, doc.lastIndexOf('5') + 1, tracking);
    press(editor, 'ArrowRight');
    expect(lacking(editor)).toBe(2);
    return editor;
  }

  for (const tracking of [false, true]) {
    for (const where of ['header', 'missing'] as const) {
      const label = `from ${where === 'header' ? 'the header cell' : 'a cell its row lacks'}, Track Changes ${tracking ? 'on' : 'off'}`;

      it(`selects the header's cell alone, and ⌫⌫ touches no other column, ${label}`, () => {
        const editor = start(NONE, tracking, where);
        expect(selectRect(editor.view, 'column')).toBe(true);
        // Not b, not the table: the one cell, as text, which is no rectangle of cells.
        expect(selected(editor)).toBe('c');
        expect(rectOf(editor.view.state)).toBeNull();
        press(editor, 'Backspace');
        const cleared = '| a | b |  |\n| - | - | - |\n| 1 | 2 |\n| 4 | 5 |';
        expect(newestView(editor.getDoc()).text).toBe(cleared);
        // A second ⌫ has nothing more to take: no cell of another column, no refusal.
        press(editor, 'Backspace');
        expect(newestView(editor.getDoc()).text).toBe(cleared);
        expect(notices(editor)).toEqual([]);
        if (tracking) expect(originalView(editor.getDoc()).text).toBe(NONE);
      });
    }
  }

  it('selects the header cell alone in a table of one short row, not the table', () => {
    const doc = '| a | b | c |\n| - | - | - |\n| 1 |';
    for (const col of [1, 2]) {
      const editor = load(doc, doc.length, false);
      // The end of the row is in its first missing cell; → goes on to the next.
      for (let n = 1; n < col; n++) press(editor, 'ArrowRight');
      expect(lacking(editor)).toBe(col);
      expect(selectRect(editor.view, 'column')).toBe(true);
      expect(selected(editor)).toBe(col === 1 ? 'b' : 'c');
      expect(rectOf(editor.view.state)).toBeNull();
      press(editor, 'Backspace');
      press(editor, 'Backspace');
      // The table has its columns, its row and its other header cells, and the file was no more.
      expect(editor.getDoc()).toBe(doc.replace(col === 1 ? '| b |' : '| c |', '|  |'));
      expect(notices(editor)).toEqual([]);
    }
  });

  it('selects the cells of several columns that no body row reaches, and ⌫⌫ takes only those', () => {
    const doc = '| a | b | c | d |\n| - | - | - | - |\n| 1 | 2 |\n| 4 | 5 |';
    for (const tracking of [false, true]) {
      const editor = load(doc, 0, tracking);
      const table = tablesOf(editor.view.state)[0]!;
      const selection = rectSelection(table, { row: 0, col: 2 }, { row: 2, col: 3 });
      expect(selection).not.toBeNull();
      editor.view.dispatch({ selection: selection! });
      expect(selected(editor)).toBe('c | d');
      const rect = rectOf(editor.view.state)!;
      expect([rect.rows, rect.cols]).toEqual([
        [0, 0],
        [2, 3],
      ]);
      expect(whole(rect)).toBe('column');
      press(editor, 'Backspace');
      expect(newestView(editor.getDoc()).text).toBe(
        '| a | b |  |  |\n| - | - | - | - |\n| 1 | 2 |\n| 4 | 5 |',
      );
      press(editor, 'Backspace');
      if (tracking) {
        // The format refuses columns that rows lack, in words, and nothing else changes.
        expect(notices(editor)).toEqual([
          'A row of this table has fewer cells than its header. Fill it in first.',
        ]);
        expect(newestView(editor.getDoc()).text).toBe(
          '| a | b |  |  |\n| - | - | - | - |\n| 1 | 2 |\n| 4 | 5 |',
        );
      } else {
        expect(editor.getDoc()).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n| 4 | 5 |');
        expect(notices(editor)).toEqual([]);
      }
    }
  });
});

describe('typing into a cell a row lacks, in a CRLF file', () => {
  const doc = '| a | b | c |\r\n| - | - | - |\r\n| 1 |\r\n| 4 | 5 | 6 |\r\n';
  const at = '| a | b | c |\n| - | - | - |\n| 1 |'.indexOf('1 |') + 1;

  it('writes the file’s own line breaks, none of its own, and rejecting gives the pipes’ file back', () => {
    for (const tracking of [false, true]) {
      const editor = load(doc, at, tracking);
      expect(editor.getDoc()).toBe(doc);
      press(editor, 'Tab');
      press(editor, 'Tab');
      expect(editor.getDoc()).toBe(doc);
      editor.view.dispatch({ ...editor.view.state.replaceSelection('x'), userEvent: 'input.type' });
      const after = editor.getDoc();
      // Every line break the file has is the file's own, a CR and an LF, no more of them.
      expect(after.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      if (!tracking) {
        expect(after.match(/\r\n/g)).toHaveLength(4);
        expect(after).toBe('| a | b | c |\r\n| - | - | - |\r\n| 1 | | x |\r\n| 4 | 5 | 6 |\r\n');
        continue;
      }
      const marks = parse(after).marks.filter((mark) => mark.kind === 'ins');
      expect(marks).toHaveLength(1);
      expect(after).toMatch(/\| 1 \| \| <!--ins \w+-->x<!--\/\w+--> \|\r\n\| 4 \| 5 \| 6 \|\r\n/);
      editor.reject(marks[0]!.id);
      // The pipes stay, plain, in both versions; every other byte is as it was.
      expect(editor.getDoc()).toBe(
        '| a | b | c |\r\n| - | - | - |\r\n| 1 | |  |\r\n| 4 | 5 | 6 |\r\n',
      );
    }
  });
});

describe('what a help while typing writes at the caret in a cell a row lacks', () => {
  it('keeps the caret inside a pair it wrote, and escapes what it writes as typing does', () => {
    const editor = load(DOC, AT_ONE, false);
    press(editor, 'Tab');
    const from = head(editor);
    editor.view.dispatch({
      changes: { from, insert: '()' },
      selection: { anchor: from + 1 },
      userEvent: 'input.type',
    });
    expect(editor.getDoc()).toContain('| 1 | () |');
    expect(editor.view.state.sliceDoc(head(editor), head(editor) + 1)).toBe(')');
    expect(editor.view.state.sliceDoc(head(editor) - 1, head(editor))).toBe('(');
    // A pipe inside what it wrote is escaped, and the caret is after it, not inside the backslash.
    const pipe = load(DOC, AT_ONE, false);
    press(pipe, 'Tab');
    const start = head(pipe);
    pipe.view.dispatch({
      changes: { from: start, insert: 'a|b' },
      selection: { anchor: start + 2 },
      userEvent: 'input.type',
    });
    expect(pipe.getDoc()).toContain('| 1 | a\\|b |');
    expect(pipe.view.state.sliceDoc(head(pipe) - 3, head(pipe))).toBe('a\\|');
  });
});
