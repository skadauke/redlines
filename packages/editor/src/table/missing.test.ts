// @vitest-environment happy-dom
// The cells a row lacks (design: tables, "Edge cases"): a row with fewer cells than the header is drawn
// with empty cells after its last, in Clean, Simple and Redlines; the caret can be in one, by Tab, the
// arrows and a press, and writes nothing until text is typed there (`missing-typing.test.ts`); a row
// with more cells than the header has its extra cells hidden and kept, and no key lands in one.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { insertCols, touchedCols } from './ops.ts';
import { rectOf, selectRect, whole } from './cells.ts';
import { missingCaret } from './missing.ts';
import { tablesOf } from './model.ts';
import { isStop, nearestStop } from './stops.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, caret?: number, view?: 'clean' | 'simple' | 'redlines' | 'raw'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const notices: string[] = [];
  const editor = createEditor(parent, {
    doc,
    author: ada,
    tracking: false,
    ...(view ? { view } : {}),
    onNotice: (message) => notices.push(message),
  });
  Object.assign(editor, { notices });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: caret ?? 0 } });
  return editor;
}

const notices = (editor: Editor) => (editor as unknown as { notices: string[] }).notices;
const press = (editor: Editor, key: string, init: KeyboardEventInit = {}) =>
  runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key, ...init }), 'editor');
const head = (editor: Editor) => editor.view.state.selection.main.head;
/** The column of the cell its row lacks that the caret is in, or null. */
const lacking = (editor: Editor) => missingCaret(editor.view.state)?.cell.col ?? null;
const at = (doc: string, find: string, offset = 0) => doc.indexOf(find) + offset;
const rows = (editor: Editor) => [
  ...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tbl .rl-trow'),
];
const cellsOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>(':scope > .rl-tc')];

const H = '| a | b | c |\n| - | - | - |\n';
/** A table of three columns whose first body row has one cell, and the second two. */
const SHORT = `${H}| 1 |\n| 2 | 3 |\n| 4 | 5 | 6 |`;

describe('a row with fewer cells than the header is drawn with empty cells after its last', () => {
  for (const view of ['clean', 'simple', 'redlines'] as const) {
    it(`in ${view}: a cell for each column, in the column's width and alignment`, () => {
      const doc = '| a | b | c |\n| :-- | :-: | --: |\n| 1 |\n| 2 | 3 |\n| 4 | 5 | 6 |';
      const editor = load(doc, 0, view);
      const [header, one, two, full] = rows(editor);
      expect([one, two, full].map((row) => cellsOf(row!).length)).toEqual([3, 3, 3]);
      expect(cellsOf(header!)).toHaveLength(3);
      const missing = cellsOf(one!).filter((cell) => cell.classList.contains('rl-tc-missing'));
      expect(missing.map((cell) => cell.dataset['col'])).toEqual(['1', '2']);
      expect(missing.map((cell) => cell.dataset['vcol'])).toEqual(['1', '2']);
      expect(missing.map((cell) => cell.dataset['align'])).toEqual(['center', 'right']);
      expect(missing.map((cell) => cell.getAttribute('role'))).toEqual(['cell', 'cell']);
      expect(missing.map((cell) => cell.getAttribute('aria-colindex'))).toEqual(['2', '3']);
      // Each has a filler for the caret to stand on, and no text: nothing is written for it.
      expect(missing.every((cell) => cell.querySelector(':scope > .rl-tc-fill') !== null)).toBe(
        true,
      );
      expect(missing.every((cell) => (cell.textContent ?? '').replace(/\u200b/g, '') === '')).toBe(
        true,
      );
      expect(cellsOf(two!).filter((cell) => cell.classList.contains('rl-tc-missing'))).toHaveLength(
        1,
      );
      expect(
        cellsOf(full!).filter((cell) => cell.classList.contains('rl-tc-missing')),
      ).toHaveLength(0);
      // The text of the document is as it was.
      expect(editor.getDoc()).toBe(doc);
    });
  }

  it('draws nothing of it in Raw, which shows the source', () => {
    const editor = load(SHORT, 0, 'raw');
    expect(editor.view.contentDOM.querySelectorAll('.rl-tc, .rl-tc-missing')).toHaveLength(0);
    expect(editor.view.contentDOM.textContent).toContain('| 1 |');
  });

  it('draws the cells again when text is typed into one: they are real then', () => {
    const editor = load(SHORT, at(SHORT, '1', 1));
    expect(rows(editor)[1]!.querySelectorAll('.rl-tc-missing')).toHaveLength(2);
    press(editor, 'Tab');
    editor.view.dispatch({
      changes: { from: head(editor), insert: 'x' },
      selection: { anchor: head(editor) + 1 },
      userEvent: 'input.type',
    });
    expect(editor.getDoc()).toContain('| 1 | x |');
    const row = rows(editor)[1]!;
    expect(cellsOf(row)).toHaveLength(3);
    expect(row.querySelectorAll('.rl-tc-missing')).toHaveLength(1);
    expect(cellsOf(row).map((cell) => cell.textContent?.replace(/\u200b/g, ''))).toEqual([
      '1',
      'x',
      '',
    ]);
  });

  it('knows the cells a row lacks from the table, never from the document', () => {
    const editor = load(`Intro.\n\n${SHORT}\n\nAfter.`);
    const [table] = tablesOf(editor.view.state);
    expect(table?.rows.map((row) => row.cells.length)).toEqual([3, 1, 2, 3]);
    expect(table?.columns).toBe(3);
  });
});

describe('the caret in a cell a row lacks', () => {
  it('goes there by →, one cell at a time, writes nothing, and on to the next row', () => {
    const editor = load(SHORT, at(SHORT, '1', 1));
    expect(lacking(editor)).toBeNull();
    press(editor, 'ArrowRight');
    expect(lacking(editor)).toBe(1);
    // The end of the row: the end of the line, past the closing pipe.
    expect(head(editor)).toBe(at(SHORT, '| 1 |') + '| 1 |'.length);
    press(editor, 'ArrowRight');
    expect(lacking(editor)).toBe(2);
    expect(head(editor)).toBe(at(SHORT, '| 1 |') + '| 1 |'.length);
    press(editor, 'ArrowRight');
    expect(lacking(editor)).toBeNull();
    expect(head(editor)).toBe(at(SHORT, '2 | 3'));
    expect(editor.getDoc()).toBe(SHORT);
    expect(notices(editor)).toEqual([]);
  });

  it('comes back by ←, one cell at a time, to the end of the last cell’s text', () => {
    const editor = load(SHORT, at(SHORT, '2 | 3'));
    // From the first cell of the row below, into the last cell of the row above that lacks any.
    press(editor, 'ArrowLeft');
    expect(lacking(editor)).toBe(2);
    press(editor, 'ArrowLeft');
    expect(lacking(editor)).toBe(1);
    press(editor, 'ArrowLeft');
    expect(lacking(editor)).toBeNull();
    expect(head(editor)).toBe(at(SHORT, '1 |'.slice(0, 1), 1));
    expect(editor.getDoc()).toBe(SHORT);
  });

  it('goes there by Tab, and back by ⇧Tab, with nothing written', () => {
    const editor = load(SHORT, at(SHORT, '1 |'));
    press(editor, 'Tab');
    expect(lacking(editor)).toBe(1);
    press(editor, 'Tab');
    expect(lacking(editor)).toBe(2);
    expect(editor.getDoc()).toBe(SHORT);
    // The next row's first cell, its text selected.
    press(editor, 'Tab');
    expect(lacking(editor)).toBeNull();
    expect(
      editor.view.state.sliceDoc(
        editor.view.state.selection.main.from,
        editor.view.state.selection.main.to,
      ),
    ).toBe('2');
    press(editor, 'Tab', { shiftKey: true });
    expect(lacking(editor)).toBe(2);
    press(editor, 'Tab', { shiftKey: true });
    expect(lacking(editor)).toBe(1);
    press(editor, 'Tab', { shiftKey: true });
    expect(lacking(editor)).toBeNull();
    expect(
      editor.view.state.sliceDoc(
        editor.view.state.selection.main.from,
        editor.view.state.selection.main.to,
      ),
    ).toBe('1');
    expect(editor.getDoc()).toBe(SHORT);
    expect(notices(editor)).toEqual([]);
  });

  it('adds a row by Tab in the last cell, which may be one its row lacks', () => {
    const doc = `${H}| 4 | 5 | 6 |\n| 7 |`;
    const editor = load(doc, at(doc, '7', 1));
    press(editor, 'Tab');
    press(editor, 'Tab');
    expect(lacking(editor)).toBe(2);
    expect(editor.getDoc()).toBe(doc);
    press(editor, 'Tab');
    expect(editor.getDoc()).toBe(`${doc}\n|  |  |  |`);
  });

  it('goes up and down to the cell in the same column, one its row lacks too', () => {
    const editor = load(SHORT, at(SHORT, '1', 1));
    press(editor, 'Tab');
    press(editor, 'Tab');
    expect([lacking(editor), editor.view.state.doc.lineAt(head(editor)).text]).toEqual([
      2,
      '| 1 |',
    ]);
    // Down: the row below lacks the third cell too, the one under it has it.
    press(editor, 'ArrowDown');
    expect([lacking(editor), editor.view.state.doc.lineAt(head(editor)).text]).toEqual([
      2,
      '| 2 | 3 |',
    ]);
    press(editor, 'ArrowDown');
    expect(lacking(editor)).toBeNull();
    expect(editor.view.state.doc.lineAt(head(editor)).text).toBe('| 4 | 5 | 6 |');
    press(editor, 'ArrowUp');
    expect([lacking(editor), editor.view.state.doc.lineAt(head(editor)).text]).toEqual([
      2,
      '| 2 | 3 |',
    ]);
    press(editor, 'ArrowUp');
    expect([lacking(editor), editor.view.state.doc.lineAt(head(editor)).text]).toEqual([
      2,
      '| 1 |',
    ]);
    // Up from the first cell its row lacks, into the cell above (the header's).
    press(editor, 'ArrowLeft');
    expect(lacking(editor)).toBe(1);
    press(editor, 'ArrowUp');
    expect(lacking(editor)).toBeNull();
    expect(editor.view.state.doc.lineAt(head(editor)).text).toBe('| a | b | c |');
    expect(editor.getDoc()).toBe(SHORT);
    // From a cell its row has to one the row below lacks, in the same column.
    const second = load(SHORT, at(SHORT, '2 | 3', 4));
    press(second, 'ArrowUp');
    expect([lacking(second), second.view.state.doc.lineAt(head(second)).text]).toEqual([
      1,
      '| 1 |',
    ]);
    press(second, 'ArrowDown');
    expect([lacking(second), second.view.state.doc.lineAt(head(second)).text]).toEqual([
      null,
      '| 2 | 3 |',
    ]);
    expect(second.getDoc()).toBe(SHORT);
  });

  it('is put there by a press on its filler, in the column of the filler pressed', () => {
    const editor = load(SHORT, 0);
    const row = rows(editor)[1]!;
    const fillers = [...row.querySelectorAll<HTMLElement>('.rl-tc-missing')];
    expect(fillers).toHaveLength(2);
    for (const [i, filler] of fillers.entries()) {
      const target = filler.querySelector('.rl-tc-fill') ?? filler;
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
      target.dispatchEvent(event);
      expect(event.defaultPrevented, `filler ${i}`).toBe(true);
      expect(lacking(editor), `filler ${i}`).toBe(i + 1);
      expect(head(editor)).toBe(at(SHORT, '| 1 |') + '| 1 |'.length);
    }
    expect(editor.getDoc()).toBe(SHORT);
  });

  it('draws the caret in the cell it is in, and hides the page’s own', () => {
    const editor = load(SHORT, at(SHORT, '1', 1));
    expect(editor.view.contentDOM.querySelectorAll('.rl-tc-active')).toHaveLength(0);
    press(editor, 'Tab');
    const active = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tc-active')];
    expect(active.map((cell) => cell.dataset['col'])).toEqual(['1']);
    press(editor, 'Tab');
    expect(
      [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tc-active')].map(
        (cell) => cell.dataset['col'],
      ),
    ).toEqual(['2']);
    press(editor, 'Tab');
    expect(editor.view.contentDOM.querySelectorAll('.rl-tc-active')).toHaveLength(0);
  });

  it('is in the first of them for a caret that lands at the end of the row, and is a stop there', () => {
    const end = at(SHORT, '| 1 |') + '| 1 |'.length;
    const editor = load(SHORT, end);
    expect(head(editor)).toBe(end);
    expect(lacking(editor)).toBe(1);
    expect(isStop(editor.view.state, end)).toBe(true);
    expect(nearestStop(editor.view.state, end)).toBe(end);
    // A selection never ends in one: its end moves to the end of the last cell's text.
    editor.view.dispatch({ selection: { anchor: at(SHORT, '1 |'), head: end } });
    expect(editor.view.state.selection.main.head).toBe(at(SHORT, '1 |', 1));
    // A row that has all its cells has no stop at its end.
    const full = at(SHORT, '| 4 | 5 | 6 |') + '| 4 | 5 | 6 |'.length;
    expect(isStop(editor.view.state, full)).toBe(false);
  });

  it('is the first of them again when the selection or the text changes', () => {
    const editor = load(SHORT, at(SHORT, '1', 1));
    press(editor, 'Tab');
    press(editor, 'Tab');
    expect(lacking(editor)).toBe(2);
    // The text changes: the caret is at the end of its row still, and in the first of the cells.
    editor.view.dispatch({ changes: { from: 0, insert: 'Intro.\n\n' } });
    expect(head(editor)).toBe(at(editor.getDoc(), '| 1 |') + '| 1 |'.length);
    expect(lacking(editor)).toBe(1);
    press(editor, 'ArrowRight');
    expect(lacking(editor)).toBe(2);
    // The same selection again: the column is not remembered.
    editor.view.dispatch({ selection: { anchor: head(editor) } });
    expect(lacking(editor)).toBe(1);
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(lacking(editor)).toBeNull();
  });

  it('is in a cell of no other row, not in a table in a quote, nor in Raw', () => {
    const quote = '> | a | b | c |\n> | - | - | - |\n> | 1 |';
    const editor = load(quote, quote.length);
    expect(lacking(editor)).toBeNull();
    const raw = load(SHORT, at(SHORT, '| 1 |') + '| 1 |'.length, 'raw');
    expect(lacking(raw)).toBeNull();
  });

  it('has Home, End, ⌥←, ⌥→, ⌘↑, ⌘↓, ⌃T, ⌘A and the delete keys do what they do in an empty cell', () => {
    const editor = load(SHORT, at(SHORT, '1', 1));
    press(editor, 'Tab');
    const before = head(editor);
    for (const [key, init] of [
      ['Home', {}],
      ['End', {}],
      ['Backspace', {}],
      ['Delete', {}],
      ['Backspace', { altKey: true }],
      ['Delete', { altKey: true }],
      ['Backspace', { metaKey: true }],
      ['Delete', { metaKey: true }],
      ['k', { ctrlKey: true }],
      ['t', { ctrlKey: true }],
    ] as const) {
      press(editor, key, init);
      expect(editor.getDoc(), `${key} ${JSON.stringify(init)}`).toBe(SHORT);
      expect(head(editor), `${key} ${JSON.stringify(init)}`).toBe(before);
      expect(lacking(editor), `${key} ${JSON.stringify(init)}`).toBe(1);
    }
    expect(notices(editor)).toEqual([]);
    // ⌥→ and ⌥← step as → and ← do.
    press(editor, 'ArrowRight', { altKey: true });
    expect(lacking(editor)).toBe(2);
    press(editor, 'ArrowLeft', { altKey: true });
    expect(lacking(editor)).toBe(1);
    // ⌘A: the cell is empty, so the whole table; with no throw.
    press(editor, 'a', { metaKey: true, ctrlKey: true });
    expect(editor.getDoc()).toBe(SHORT);
  });
});

describe('a row with more cells than the header', () => {
  const doc = '| a | b |\n| - | - |\n| c | d | e |\n| f | g |';

  it('hides its extra cell, which has no stop, and keeps the text', () => {
    const editor = load(doc);
    const hidden = editor.view.contentDOM.querySelectorAll('.rl-tc-hidden');
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.textContent).toBe('| e |');
    expect(editor.view.contentDOM.querySelectorAll('.rl-tc-missing')).toHaveLength(0);
    expect(isStop(editor.view.state, at(doc, 'e'))).toBe(false);
    expect(nearestStop(editor.view.state, at(doc, 'e'))).toBe(at(doc, 'd |', 1));
    expect(editor.getDoc()).toBe(doc);
  });

  it('is left by Tab, ⇧Tab and the arrows without landing in it, and no key throws', () => {
    const editor = load(doc, at(doc, 'c |'));
    const selected = () => {
      const { from, to } = editor.view.state.selection.main;
      return editor.view.state.sliceDoc(from, to);
    };
    press(editor, 'Tab');
    expect(selected()).toBe('d');
    press(editor, 'Tab');
    // The next row's first cell, not the extra cell.
    expect(selected()).toBe('f');
    press(editor, 'Tab', { shiftKey: true });
    expect(selected()).toBe('d');
    // → from the end of d goes to f; ← comes back to the end of d.
    editor.view.dispatch({ selection: { anchor: at(doc, 'd |', 1) } });
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(at(doc, 'f'));
    press(editor, 'ArrowLeft');
    expect(head(editor)).toBe(at(doc, 'd |', 1));
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(() => press(editor, key), key).not.toThrow();
      expect(lacking(editor), key).toBeNull();
      for (const pos of [head(editor)]) {
        expect(isStop(editor.view.state, pos), key).toBe(true);
        expect(pos < at(doc, 'e') || pos > at(doc, 'e') + 3, key).toBe(true);
      }
    }
    expect(editor.getDoc()).toBe(doc);
  });

  it('loses no text to the delete keys at the cell next to it, or to typing refused after it', () => {
    const editor = load(doc, at(doc, 'd |', 1));
    for (const [key, init] of [
      ['Delete', {}],
      ['Delete', { altKey: true }],
      ['Delete', { metaKey: true }],
    ] as const) {
      press(editor, key, init);
      expect(editor.getDoc(), key).toBe(doc);
    }
    // Typing into the extra cell itself is refused, and the text is still there.
    const typed = load(doc);
    typed.view.dispatch({ changes: { from: at(doc, 'e'), insert: 'x' }, userEvent: 'input.type' });
    expect(typed.getDoc()).toBe(doc);
    expect(notices(typed)).toEqual(["A table's text goes in its cells."]);
  });

  it('is left out of a selected row, a column and the table: they are the cells it shows', () => {
    const editor = load(doc, at(doc, 'c |'));
    expect(selectRect(editor.view, 'row')).toBe(true);
    const { from, to } = editor.view.state.selection.main;
    expect(editor.view.state.sliceDoc(from, to)).toBe('c | d');
    expect(selectRect(editor.view, 'table')).toBe(true);
    const all = editor.view.state.selection.main;
    expect(editor.view.state.sliceDoc(all.from, all.to)).toBe(
      'a | b |\n| - | - |\n| c | d | e |\n| f | g',
    );
    expect(whole(rectOf(editor.view.state)!)).toBe('table');
    expect(editor.getDoc()).toBe(doc);
  });
});

describe('the commands of a caret in a cell a row lacks', () => {
  it('work on its column, and on its row', () => {
    const doc = '| a | b | c |\n| :-- | :-: | --: |\n| 1 |\n| 2 | 3 | 4 |';
    const editor = load(doc, at(doc, '1', 1));
    press(editor, 'Tab');
    press(editor, 'Tab');
    expect(lacking(editor)).toBe(2);
    const touched = touchedCols(editor.view.state);
    expect([touched?.first, touched?.last, touched?.row]).toEqual([2, 2, 1]);
    press(editor, 'ArrowLeft');
    expect(touchedCols(editor.view.state)?.first).toBe(1);
    // Insert Column Right goes after the column the caret is in, whichever cell the row lacks.
    expect(insertCols(editor.view, false)).toBe(true);
    expect(editor.getDoc().split('\n')[0]).toMatch(/^\| a \| b \| +\| c \|$/);
    expect(editor.getDoc().split('\n')[2]).toBe('| 1 |');
  });

  it('Select Cell, as the Table menu runs it, keeps the caret in the cell it is in', () => {
    const doc = '| a | b | c |\n| - | - | - |\n| 1 |\n| 2 | 3 | 4 |';
    const end = at(doc, '| 1 |') + '| 1 |'.length;
    const editor = load(doc, at(doc, '1', 1));
    press(editor, 'Tab');
    press(editor, 'Tab');
    expect(lacking(editor)).toBe(2);
    // The cell has no text to select: the caret stays in it, in its column, and nothing is written.
    expect(selectRect(editor.view, 'cell')).toBe(true);
    expect([lacking(editor), head(editor), editor.view.state.selection.main.empty]).toEqual([
      2,
      end,
      true,
    ]);
    expect(editor.getDoc()).toBe(doc);
    // The first of the two the row lacks, too, and a cell the row has still selects its text.
    press(editor, 'ArrowLeft');
    expect(selectRect(editor.view, 'cell')).toBe(true);
    expect([lacking(editor), head(editor)]).toEqual([1, end]);
    editor.view.dispatch({ selection: { anchor: at(doc, '3') } });
    expect(selectRect(editor.view, 'cell')).toBe(true);
    const { from, to } = editor.view.state.selection.main;
    expect(editor.view.state.sliceDoc(from, to)).toBe('3');
    expect(editor.getDoc()).toBe(doc);
  });
});

describe('every key at every place of a row with more cells than the header', () => {
  const doc = '| a | b |\n| - | - |\n| c | d | e |\n| f | g |';
  const [first, last] = [at(doc, '| c'), at(doc, '| c | d | e |') + '| c | d | e |'.length];

  it('throws nothing, leaves the caret on a stop, and keeps the text of the extra cell', () => {
    const keys: [string, KeyboardEventInit][] = [
      ['ArrowLeft', {}],
      ['ArrowRight', {}],
      ['ArrowUp', {}],
      ['ArrowDown', {}],
      ['Tab', {}],
      ['Tab', { shiftKey: true }],
      ['Home', {}],
      ['End', {}],
      ['Backspace', {}],
      ['Delete', {}],
      ['Backspace', { altKey: true }],
      ['Delete', { altKey: true }],
    ];
    for (let pos = first; pos <= last; pos++) {
      for (const [key, init] of keys) {
        const editor = load(doc, pos);
        const label = `${key} ${JSON.stringify(init)} at ${pos}`;
        expect(() => press(editor, key, init), label).not.toThrow();
        expect(isStop(editor.view.state, head(editor)), label).toBe(true);
        expect(lacking(editor), label).toBeNull();
        // The extra cell is where it was, whatever the key did to the text beside it.
        expect(editor.getDoc(), label).toContain(' e |');
        if (!['Backspace', 'Delete'].includes(key)) expect(editor.getDoc(), label).toBe(doc);
        editor.destroy();
      }
    }
  });
});
