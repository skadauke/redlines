// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { layoutOf } from './layout.ts';
import { tablesOf } from './model.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  // The tables follow the parse.
  editor.view.dispatch({ selection: { anchor: 0 } });
  open.push(editor);
  return editor;
}

const content = (editor: Editor) => editor.view.contentDOM;
const wrappers = (editor: Editor) => [...content(editor).querySelectorAll<HTMLElement>('.rl-tbl')];
const rows = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>('.rl-trow')];
const cellTexts = (row: HTMLElement) =>
  [...row.querySelectorAll('.rl-tc')].map((cell) => cell.textContent);

const PLAIN = '| a | b |\n| - | :-: |\n| cc | d |';
const withLedger = (body: string, marks: Record<string, string> = {}) =>
  `${body}\n\n<!-- redlines\nversion: 1\npeople:\n  ada: {name: Ada Lovelace}\n  bo: {name: Bo Chen}\n${
    Object.keys(marks).length
      ? `marks:\n${Object.entries(marks)
          .map(([id, by]) => `  ${id}: {by: ${by}, at: 2026-11-01T10:00Z}`)
          .join('\n')}\n`
      : ''
  }-->\n`;

describe('a table laid out as a table', () => {
  const FIXTURES: Record<string, string> = {
    plain: PLAIN,
    'with a line break': '| a | b |\n| - | - |\n| x<br>y | d |',
    'with an empty cell': '| a | b |\n| - | - |\n|  | d |\n| e |  |',
    'with an empty cell of one space': '| a | b |\n| - | - |\n| | d |\n| e | |',
    'with an empty cell of no space': '| a | b | c |\n| - | - | - |\n| 1 || x |\n|||',
    ragged: '| a | b |\n| - | - |\n| c |\n| d | e | f |',
    'in a CRLF file': PLAIN.replaceAll('\n', '\r\n'),
    'a header alone': '| a | b |\n| - | - |',
    aligned: '| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |',
  };

  for (const [name, doc] of Object.entries(FIXTURES)) {
    it(`puts the lines of a table ${name} in a wrapper, rows in rows and every character in one cell`, () => {
      const editor = load(`Intro.\n\n${doc}\n\nAfter.`);
      const [table] = tablesOf(editor.view.state);
      expect(table).toBeDefined();
      if (!table) return;
      const [wrapper] = wrappers(editor);
      expect(wrapper?.parentElement?.className).toBe('rl-tbl-scroll');
      expect(wrapper?.getAttribute('role')).toBe('table');
      expect(wrapper?.getAttribute('aria-colcount')).toBe(String(table.columns));
      expect(rows(wrapper!)).toHaveLength(table.rows.length);
      expect(rows(wrapper!).map((row) => row.classList.contains('rl-th'))).toEqual(
        table.rows.map((row) => row.header),
      );
      // The text outside the table is outside the wrapper.
      expect(wrapper?.textContent).not.toContain('Intro.');
      expect(wrapper?.textContent).not.toContain('After.');
      // Nothing but a cell is a child of a row, and the cells hold the row's whole text. (CodeMirror's own
      // buffers beside a widget and its line-end break are children of a row only where the row lacks
      // cells, whose widgets they stand beside; the theme hides them there.)
      for (const row of rows(wrapper!)) {
        const lacking = row.querySelector(':scope > .rl-tc-missing') !== null;
        const children = [...row.children].filter(
          (c) => !(lacking && (c.classList.contains('cm-widgetBuffer') || c.tagName === 'BR')),
        );
        expect(children.every((child) => child.classList.contains('rl-tc'))).toBe(true);
        expect(row.textContent).toBe(children.map((c) => c.textContent).join(''));
      }
      // Every character of each row is in exactly one cell: the cells' ranges tile the row.
      const { cells } = layoutOf(editor.view.state);
      for (const row of table.rows) {
        const end = row.header ? table.delimiter.to : row.to;
        const ranges: [number, number][] = [];
        cells.between(row.from, end, (from, to) => void ranges.push([from, to]));
        ranges.sort((a, b) => a[0] - b[0]);
        // The cells run from the start of the row to its end, one after the other.
        expect(ranges[0]?.[0]).toBe(row.from);
        expect(ranges.at(-1)?.[1]).toBe(end);
        for (const [i, [from]] of ranges.entries()) {
          if (i > 0) expect(from).toBe(ranges[i - 1]?.[1]);
        }
      }
    });
  }

  it('shows only the cells’ text: no pipes, no padding, no delimiter row', () => {
    const editor = load(PLAIN);
    const [wrapper] = wrappers(editor);
    expect(rows(wrapper!).map(cellTexts)).toEqual([
      ['a', 'b'],
      ['cc', 'd'],
    ]);
    expect(wrapper?.textContent).not.toContain('|');
    expect(wrapper?.textContent).not.toContain('---');
    expect(
      [...wrapper!.querySelectorAll('.rl-tc')].map((c) => c.getAttribute('data-align')),
    ).toEqual(['default', 'center', 'default', 'center']);
    expect(wrapper?.querySelector('.rl-th .rl-tc')?.getAttribute('role')).toBe('columnheader');
  });

  it('draws <br> as a line break and gives an empty cell a filler', () => {
    const editor = load(FIXTURES['with a line break'] as string);
    expect(content(editor).querySelectorAll('.rl-tc .rl-tbr br')).toHaveLength(1);
    const empty = load(FIXTURES['with an empty cell'] as string);
    expect(content(empty).querySelectorAll('.rl-tc-fill')).toHaveLength(2);
  });

  it('leaves a cell GFM does not show out of the table', () => {
    const editor = load(FIXTURES['ragged'] as string);
    const hidden = content(editor).querySelectorAll('.rl-tc-hidden');
    expect(hidden).toHaveLength(1);
  });

  it('makes two tables a blank line apart two wrappers, with the blank line in neither', () => {
    const editor = load(`${PLAIN}\n\n${PLAIN}`);
    const found = wrappers(editor);
    expect(found).toHaveLength(2);
    expect(found.map((w) => rows(w).length)).toEqual([2, 2]);
    const lines = [...content(editor).querySelectorAll('.cm-line')];
    expect(lines.filter((line) => !line.closest('.rl-tbl'))).toEqual([]);
  });

  it('keeps a struck block widget and the ledger after a table out of the wrapper', () => {
    const doc = withLedger(`${PLAIN}\n\n<!--del b2b2 Gone words.\\n\\n-->After.`, { b2b2: 'bo' });
    const editor = load(doc);
    const [wrapper] = wrappers(editor);
    expect(wrapper?.querySelector('.rl-del')).toBeNull();
    expect(wrapper?.textContent).not.toContain('redlines');
    expect(content(editor).textContent).toContain('After.');
  });

  it('draws a table in a quote or a list item as source, with no wrapper', () => {
    for (const doc of ['> | a |\n> | - |\n> | b |', '- | a |\n  | - |\n  | b |']) {
      const editor = load(doc);
      expect(wrappers(editor)).toEqual([]);
      expect(content(editor).textContent).toContain('|');
    }
  });

  it('is drawn in Clean and Redlines, and not in Raw', () => {
    const editor = load(PLAIN);
    for (const mode of ['clean', 'redlines'] as const) {
      editor.setViewMode(mode);
      expect(wrappers(editor)).toHaveLength(1);
    }
    editor.setViewMode('raw');
    expect(wrappers(editor)).toEqual([]);
    expect(content(editor).textContent).toContain('| a | b |');
    editor.setViewMode('redlines');
    expect(wrappers(editor)).toHaveLength(1);
  });

  it('keeps an empty cell’s filler through an update that leaves the cell alone, as when composing', () => {
    const editor = load(`Words.\n\n${FIXTURES['with an empty cell'] as string}`);
    const before = content(editor).querySelectorAll('.rl-tc-fill').length;
    expect(before).toBe(2);
    editor.view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(content(editor).querySelectorAll('.rl-tc-fill')).toHaveLength(2);
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length - 3 } });
    expect(content(editor).querySelectorAll('.rl-tc-fill')).toHaveLength(2);
  });

  it('hides the marker of an inserted row and the pipe in front of it, around it', () => {
    const doc = withLedger(
      '| a | b |\n| - | - |\n| <!--ins k3x9 row--> Plums | 7 |\n| Pears | 5 |',
      { k3x9: 'ada' },
    );
    const editor = load(doc);
    const [wrapper] = wrappers(editor);
    expect(rows(wrapper!).map(cellTexts)).toEqual([
      ['a', 'b'],
      ['Plums', '7'],
      ['Pears', '5'],
    ]);
  });
});

describe('an empty cell’s filler', () => {
  const HEAD = '| a | b | c |\n| - | - | - |';
  // The empty cell's padding decides where its caret stop is: with two spaces the stop is between them,
  // inside the cell; with one or none it is the cell's end, which is also the start of the next cell.
  const FORMS: Record<string, string> = {
    'one space in the middle': `${HEAD}\n| 1 | | x |`,
    'one space in the first cell': `${HEAD}\n| | 1 | x |`,
    'no space in the middle': `${HEAD}\n| 1 || x |`,
    'two spaces in the middle': `${HEAD}\n| 1 |  | x |`,
    'two spaces in the first cell': `${HEAD}\n|  | 1 | x |`,
    'one space in the last cell': `${HEAD}\n| 1 | x | |`,
    'no space in the last cell': `${HEAD}\n| 1 | x ||`,
    'two empty cells side by side, one space each': `${HEAD}\n| | | x |`,
    'two empty cells side by side, no space': `${HEAD}\n|||x|`,
    'three empty cells': `${HEAD}\n| | | |`,
    'two empty cells in the header': '| | | x |\n| - | - | - |\n| 1 | 2 | 3 |',
    'a lone pipe': `${HEAD}\n|`,
  };

  /** What each cell of each row holds of fillers, as drawn, and as the text says it should: one in an
   * empty cell, none in a cell with text. */
  function fillers(editor: Editor) {
    const [table] = tablesOf(editor.view.state);
    const lines = rows(content(editor));
    return {
      drawn: lines.map((line) =>
        [...line.querySelectorAll(':scope > .rl-tc')].map(
          (cell) => cell.querySelectorAll('.rl-tc-fill').length,
        ),
      ),
      // (a body row that has fewer cells than the header is drawn with a cell for each it lacks, each
      // with a filler of its own: `missing.ts`)
      wanted: (table?.rows ?? []).map((row) => [
        ...row.cells.map((cell) => (cell.textFrom === cell.textTo ? 1 : 0)),
        ...Array.from(
          { length: row.header ? 0 : Math.max(0, (table?.columns ?? 0) - row.cells.length) },
          () => 1,
        ),
      ]),
      // A filler that is a child of a row, not of a cell, is a cell of its own to the table.
      loose: content(editor).querySelectorAll('.rl-trow > .rl-tc-fill').length,
      total: content(editor).querySelectorAll('.rl-tc-fill').length,
    };
  }

  for (const [name, form] of Object.entries(FORMS)) {
    it(`stands in its own cell, and no cell with text holds one: ${name}`, () => {
      const editor = load(`Intro.\n\n${form}\n\nAfter.`);
      const { drawn, wanted, loose, total } = fillers(editor);
      expect(drawn).toEqual(wanted);
      expect(loose).toBe(0);
      // None outside a cell, and none twice.
      expect(total).toBe(wanted.flat().reduce((sum, n) => sum + n, 0));
    });

    it(`stays in its own cell as the row is edited: ${name}`, () => {
      const editor = load(`Intro.\n\n${form}\n\nAfter.`);
      const [table] = tablesOf(editor.view.state);
      const row = table?.rows.at(-1);
      // An edit in a cell with text takes the patched path, which builds the row again.
      const text = row?.cells.find((cell) => cell.textFrom < cell.textTo);
      if (text) editor.view.dispatch({ changes: { from: text.textTo, insert: 'z' } });
      const { drawn, wanted, loose } = fillers(editor);
      expect(drawn).toEqual(wanted);
      expect(loose).toBe(0);
    });
  }

  it('is where the page puts the caret, for an empty cell whose stop is inside it', () => {
    // (A stop at the cell's end, with one space of padding or none, is where the next cell begins, which
    // `cellAt` gives to the next cell: the caret has never stood in such a cell, and no place of the
    // page is looked for here. The filler is in its cell all the same: the tests above.)
    for (const [name, form] of Object.entries(FORMS)) {
      const editor = load(`Intro.\n\n${form}\n\nAfter.`);
      const [table] = tablesOf(editor.view.state);
      for (const [r, line] of rows(content(editor)).entries()) {
        for (const [c, cell] of (table?.rows[r]?.cells ?? []).entries()) {
          if (cell.textFrom !== cell.textTo || cell.textFrom >= cell.to) continue;
          const { node } = editor.view.domAtPos(cell.textFrom);
          const element = node instanceof Element ? node : node.parentElement;
          expect(element?.closest('.rl-tc'), `${name}, row ${r}, cell ${c}`).toBe(
            line.querySelectorAll(':scope > .rl-tc')[c],
          );
        }
      }
    }
  });

  it('stands in the cell of an inserted row that holds only its marker', () => {
    // The cell is empty, its stop after the one space that follows the marker: the cell's end.
    const doc = withLedger('| a | b |\n| - | - |\n| <!--ins k3x9 row--> | 7 |\n| Pears | 5 |', {
      k3x9: 'ada',
    });
    const editor = load(doc);
    const { drawn, wanted, loose } = fillers(editor);
    expect(wanted).toEqual([
      [0, 0],
      [1, 0],
      [0, 0],
    ]);
    expect(drawn).toEqual(wanted);
    expect(loose).toBe(0);
  });
});
