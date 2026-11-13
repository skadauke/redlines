// @vitest-environment happy-dom
// A table deleted whole, drawn where it was as a ghost table (design: tables, "How it shows"; format
// §3.4, §3.7 rule 6): the table's own layout, struck text in the author's color on the author's
// tint, not editable; past eight rows the rest folded into one line. Clean and Simple draw none, and
// Simple keeps the bar.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import {
  applyChanges,
  encodePayload,
  parse,
  readTables,
  tableEdit,
  trackedEdit,
} from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const ada = { handle: 'ada', name: 'Ada Lovelace' };

/** A document with a ledger that gives each mark's author. */
function withLedger(body: string, marks: Record<string, string>): string {
  const entries = Object.entries(marks).map(
    ([id, by]) => `  ${id}: {by: ${by}, at: 2026-10-31T09:30Z}\n`,
  );
  return `${body}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries.join('')}-->\n`;
}

/** The marker of a deletion of `table` before the block after it (format §3.4, §3.7 rule 6). */
const deleted = (table: string, id = 'b2b2') => `<!--del ${id} ${encodePayload(`${table}\n\n`)}-->`;

/** A table of `rows` rows, the header and the body's, of three columns. */
function table(rows: number): string {
  const body = Array.from({ length: rows - 1 }, (_, i) => `| r${i + 1} | b${i + 1} | c${i + 1} |`);
  return ['| H1 | H2 | H3 |', '| :-- | :-: | --: |', ...body].join('\n');
}

const SMALL = '| Fruit | Count |\n| ----- | ----: |\n| Apples | 3 |\n| Pears | 5 |';

function load(doc: string, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, view: 'redlines', ...options });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  return editor;
}

const dom = (editor: Editor) => editor.view.contentDOM;
const ghostTables = (editor: Editor) => [
  ...dom(editor).querySelectorAll<HTMLElement>('.rl-ghost-table'),
];
const rowsOf = (ghost: Element) => [...ghost.querySelectorAll<HTMLElement>('.rl-ghost-row')];
const cellsOf = (row: Element) => [...row.querySelectorAll<HTMLElement>('.rl-tc')];
const textsOf = (ghost: Element) =>
  rowsOf(ghost).map((row) => cellsOf(row).map((c) => c.textContent));
/** A document whose ledger gives the deletion b2b2 to Bo, whose color is the third. */
const byBo = (body: string) => withLedger(body, { b2b2: 'bo' });

describe('a deleted table in Redlines', () => {
  it('draws every row of a table of three rows, in a ghost wrapper, where the table was', () => {
    const editor = load(byBo(`One.\n\n${deleted(SMALL)}\n\nAfter.`));
    const [ghost] = ghostTables(editor);
    expect(ghostTables(editor)).toHaveLength(1);
    // The header and two body rows, with no fold.
    expect(textsOf(ghost!)).toEqual([
      ['Fruit', 'Count'],
      ['Apples', '3'],
      ['Pears', '5'],
    ]);
    expect(ghost!.querySelector('.rl-ghost-fold')).toBeNull();
    // Where the table was: between the lines of the text above and below it, which are lines.
    const page = [...dom(editor).children]
      .filter((el) => el.matches('.cm-line, .rl-struck-blocks'))
      .map((el) => (el.matches('.rl-struck-blocks') ? '~table~' : el.textContent));
    expect(page).toEqual(['One.', '~table~', 'After.']);
    // The source of the table is drawn nowhere, in the text or beside it.
    expect(dom(editor).textContent).not.toContain('| Fruit');
    expect(dom(editor).textContent).not.toContain('<!--');
  });

  it('is a table to assistive technology, with rows and cells, and says what it is', () => {
    const editor = load(byBo(`One.\n\n${deleted(SMALL)}\n\nAfter.`));
    const [ghost] = ghostTables(editor);
    expect(ghost!.getAttribute('role')).toBe('table');
    expect(ghost!.getAttribute('aria-label')).toBe('Deleted table');
    expect(ghost!.getAttribute('aria-rowcount')).toBe('3');
    expect(ghost!.getAttribute('aria-colcount')).toBe('2');
    const rows = rowsOf(ghost!);
    expect(rows.map((row) => row.getAttribute('role'))).toEqual(['row', 'row', 'row']);
    expect(rows.map((row) => row.getAttribute('aria-rowindex'))).toEqual(['1', '2', '3']);
    expect(cellsOf(rows[0]!).map((cell) => cell.getAttribute('role'))).toEqual([
      'columnheader',
      'columnheader',
    ]);
    expect(cellsOf(rows[2]!).map((cell) => cell.getAttribute('role'))).toEqual(['cell', 'cell']);
    expect(cellsOf(rows[2]!).map((cell) => cell.getAttribute('aria-colindex'))).toEqual(['1', '2']);
  });

  it('can be found in the DOM by its layout: its rows, its columns and what it folded', () => {
    const editor = load(byBo(`One.\n\n${deleted(table(20))}\n\nAfter.`));
    const [ghost] = ghostTables(editor);
    expect(ghost!.dataset['mark']).toBe('b2b2');
    expect(ghost!.dataset['columns']).toBe('3');
    expect(ghost!.dataset['rows']).toBe('20');
    expect(ghost!.dataset['more']).toBe('12');
    expect(ghost!.querySelector('.rl-ghost-scroll > .rl-ghost-grid')).not.toBeNull();
  });

  it('draws the first eight rows of a table of twenty, and one line for the other twelve', () => {
    const editor = load(byBo(`One.\n\n${deleted(table(20))}\n\nAfter.`));
    const [ghost] = ghostTables(editor);
    const rows = rowsOf(ghost!);
    // The header and seven body rows.
    expect(rows).toHaveLength(8);
    expect(textsOf(ghost!)[0]).toEqual(['H1', 'H2', 'H3']);
    expect(textsOf(ghost!)[7]).toEqual(['r7', 'b7', 'c7']);
    const fold = ghost!.querySelectorAll('.rl-ghost-fold');
    expect(fold).toHaveLength(1);
    expect(fold[0]!.textContent).toBe('and 12 more rows');
    // The whole table's size, and the line is a row after the eighth, as far as a reader goes.
    expect(ghost!.getAttribute('aria-rowcount')).toBe('20');
    expect(fold[0]!.getAttribute('role')).toBe('row');
    expect(fold[0]!.getAttribute('aria-rowindex')).toBe('9');
    expect(fold[0]!.querySelector('[role="cell"]')?.getAttribute('aria-colspan')).toBe('3');
    // The line comes after the rows, never among them.
    expect(ghost!.querySelector('.rl-ghost-grid')?.contains(fold[0]!)).toBe(false);
    expect(
      fold[0]!.compareDocumentPosition(rows[7]!) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it('folds a ninth row as "and 1 more row", and eight rows exactly are not folded', () => {
    const nine = ghostTables(load(byBo(`One.\n\n${deleted(table(9))}\n\nAfter.`)))[0]!;
    expect(rowsOf(nine)).toHaveLength(8);
    expect(nine.querySelector('.rl-ghost-fold')?.textContent).toBe('and 1 more row');
    const eight = ghostTables(load(byBo(`One.\n\n${deleted(table(8))}\n\nAfter.`)))[0]!;
    expect(rowsOf(eight)).toHaveLength(8);
    expect(eight.querySelector('.rl-ghost-fold')).toBeNull();
    expect(eight.dataset['more']).toBe('0');
  });

  it('draws struck text in the author’s color on the author’s tint, with the change bar', () => {
    const editor = load(byBo(`One.\n\n${deleted(SMALL)}\n\nAfter.`));
    const [ghost] = ghostTables(editor);
    // Bo's color is the third; the bar and the tint are Bo's.
    expect(ghost!.matches('.rl-struck.rl-bar.rl-author-3')).toBe(true);
    expect(ghost!.querySelector('.rl-ghost-scroll')?.classList).toContain('rl-author-3');
    const spans = [...ghost!.querySelectorAll('.rl-tc > .rl-del')];
    expect(spans.map((span) => span.textContent)).toEqual([
      'Fruit',
      'Count',
      'Apples',
      '3',
      'Pears',
      '5',
    ]);
    for (const span of spans) expect(span.classList).toContain('rl-author-3');
  });

  it('draws the header as the header, and the alignments as the delimiter row gave them', () => {
    const editor = load(byBo(`One.\n\n${deleted(table(3))}\n\nAfter.`));
    const [ghost] = ghostTables(editor);
    const rows = rowsOf(ghost!);
    expect(rows.map((row) => row.classList.contains('rl-th'))).toEqual([true, false, false]);
    for (const row of rows) {
      expect(cellsOf(row).map((cell) => cell.dataset['align'])).toEqual([
        'left',
        'center',
        'right',
      ]);
    }
  });

  it('draws a pipe as a pipe and a line break as a line break, never the letters of <br>', () => {
    const source = '| a \\| b | c<br>d |\n| - | - |\n| `x` | **y** |';
    const editor = load(byBo(`One.\n\n${deleted(source)}\n\nAfter.`));
    const [ghost] = ghostTables(editor);
    const [first, second] = cellsOf(rowsOf(ghost!)[0]!);
    expect(first!.textContent).toBe('a | b');
    expect(second!.textContent).toBe('cd');
    expect(second!.querySelector('br')).not.toBeNull();
    expect(ghost!.textContent).not.toContain('<br>');
    // Inline syntax is the text it is, as in any struck block.
    expect(cellsOf(rowsOf(ghost!)[1]!).map((cell) => cell.textContent)).toEqual(['`x`', '**y**']);
  });

  it('draws the columns the header has: a short row has empty cells, and extra cells are left out', () => {
    const source = '| a | b |\n| - | - |\n| short |\n| 1 | 2 | 3 |';
    const editor = load(byBo(`One.\n\n${deleted(source)}\n\nAfter.`));
    const [ghost] = ghostTables(editor);
    const rows = rowsOf(ghost!);
    expect(rows.map((row) => cellsOf(row).length)).toEqual([2, 2, 2]);
    // An empty cell holds a zero-width space, so that a row is a line high.
    expect(textsOf(ghost!)).toEqual([
      ['a', 'b'],
      ['short', '​'],
      ['1', '2'],
    ]);
    expect(ghost!.getAttribute('aria-colcount')).toBe('2');
  });

  it('draws a table whose rows have no pipes at their ends as a table', () => {
    const source = 'a | b\n--- | ---\n1 | 2';
    const editor = load(byBo(`One.\n\n${deleted(source)}\n\nAfter.`));
    expect(textsOf(ghostTables(editor)[0]!)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('draws a table deleted at the end of the text after the block above', () => {
    const doc = byBo(`One.<!--del b2b2 ${encodePayload(`\n\n${SMALL}`)}-->`);
    const editor = load(doc);
    const [ghost] = ghostTables(editor);
    expect(textsOf(ghost!)[0]).toEqual(['Fruit', 'Count']);
    expect(ghost!.dataset['rows']).toBe('3');
    const page = [...dom(editor).children]
      .filter((el) => el.matches('.cm-line, .rl-struck-blocks'))
      .map((el) => (el.matches('.rl-struck-blocks') ? '~table~' : el.textContent));
    expect(page).toEqual(['One.', '~table~']);
  });

  it('draws a table that is all the text as a ghost table, as the only thing there is', () => {
    // `deleteTable` writes a table that is the only block with no break at either end.
    const doc = byBo(`<!--del b2b2 ${encodePayload(SMALL)}-->`);
    const editor = load(doc);
    const [ghost] = ghostTables(editor);
    expect(ghostTables(editor)).toHaveLength(1);
    expect(textsOf(ghost!)).toEqual([
      ['Fruit', 'Count'],
      ['Apples', '3'],
      ['Pears', '5'],
    ]);
    // Not the source on a line of its own: the document has no line to draw.
    expect(dom(editor).querySelector('.cm-line .rl-del')).toBeNull();
    expect(dom(editor).textContent).not.toContain('| Fruit');
    for (const view of ['simple', 'clean'] as const) {
      const other = load(doc, { view });
      expect(ghostTables(other), view).toHaveLength(0);
      expect(dom(other).textContent, view).toBe('');
    }
  });

  it('is not drawn so under text, where a payload with no break is no form of a whole block', () => {
    const under = load(byBo(`One.\n\n<!--del b2b2 ${encodePayload(SMALL)}-->`));
    expect(ghostTables(under)).toHaveLength(0);
    expect(dom(under).querySelector('.cm-line .rl-del')).not.toBeNull();
  });

  it('keeps any other text that is all the text of the file as the struck line it is', () => {
    const editor = load(byBo('<!--del b2b2 Only paragraph.-->'));
    expect(dom(editor).querySelector('.rl-struck')).toBeNull();
    expect(dom(editor).querySelector('.cm-line .rl-del')?.textContent).toBe('Only paragraph.');
  });

  it('draws a table among other deleted blocks, in its place among them', () => {
    const payload = `Intro.\n\n${SMALL}\n\n## Head\n\n`;
    const doc = byBo(`One.\n\n<!--del b2b2 ${encodePayload(payload)}-->\n\nAfter.`);
    const editor = load(doc);
    const blocks = [...dom(editor).querySelectorAll('.rl-struck')].map((block) =>
      block.classList.contains('rl-ghost-table') ? 'table' : block.textContent,
    );
    expect(blocks).toEqual(['Intro.', 'table', 'Head']);
  });

  it('draws a table whoever deleted it: the operation on the table, or a deletion typed over it', () => {
    const plain = `Intro.\n\n${SMALL}\n\nAfter.\n`;
    const found = readTables(plain, parse(plain))[0]!;
    const time = '2026-11-10T10:00Z';
    const ops = tableEdit(plain, { kind: 'deleteTable', table: found.from }, { author: ada, time });
    const typed = trackedEdit(
      plain,
      { from: found.from, to: found.to, insert: '' },
      { author: ada, time },
    );
    for (const changes of [ops.changes, typed]) {
      const doc = applyChanges(plain, changes);
      expect(parse(doc).marks.map((mark) => mark.kind)).toEqual(['del']);
      const [ghost] = ghostTables(load(doc));
      expect(textsOf(ghost!)).toEqual([
        ['Fruit', 'Count'],
        ['Apples', '3'],
        ['Pears', '5'],
      ]);
      // Your own deletion is in your color.
      expect(ghost!.classList).toContain('rl-author-1');
    }
  });

  it('draws the text another person deleted in the table in their color', () => {
    const doc = withLedger(
      'One.\n\n<!--del b2b2 | a | b |\\n| - | - |\\n| 1 | -->\n\n<!--del c3c3 two-->\n\n<!--del b2b2  |\\n\\n-->\n\nAfter.',
      { b2b2: 'bo', c3c3: 'ada' },
    );
    const editor = load(doc);
    const [ghost] = ghostTables(editor);
    expect(textsOf(ghost!)).toEqual([
      ['a', 'b'],
      ['1', 'two'],
    ]);
    const colors = [...ghost!.querySelectorAll('.rl-tc > .rl-del')].map((run) => [
      run.textContent,
      run.className,
    ]);
    expect(colors.at(-1)).toEqual(['two', 'rl-del rl-author-1']);
    expect(colors.at(0)).toEqual(['a', 'rl-del rl-author-3']);
    // Both their colors on the bar: gray for several.
    expect(ghost!.classList).toContain('rl-bar-mixed');
    // Only one deletion's card: the table's.
    expect(ghost!.dataset['mark']).toBe('b2b2');
  });

  it('shows a pilcrow before a line break in a cell, struck, when line break marks are shown', () => {
    const source = '| a | c<br>d |\n| - | - |\n| 1 | 2 |';
    const doc = byBo(`One.\n\n${deleted(source)}\n\nAfter.`);
    const plain = ghostTables(load(doc))[0]!;
    expect(plain.textContent).not.toContain('¶');
    const marked = ghostTables(load(doc, { showLineBreakMarks: true }))[0]!;
    const cell = cellsOf(rowsOf(marked)[0]!)[1]!;
    expect(cell.textContent).toBe('c¶d');
    const pilcrow = [...cell.querySelectorAll('.rl-del')].find((run) => run.textContent === '¶');
    expect(pilcrow?.className).toBe('rl-del rl-author-3');
    // A table has no pilcrow of its own after it.
    expect(marked.textContent).not.toMatch(/¶$/);
  });
});

describe('a ghost table beside other tables and blocks', () => {
  const REAL = '| Plain | Table |\n| ----- | ----- |\n| One | 1 |\n| Two | 2 |';

  it('stands apart from a real table above it: each is its own table, and the line between is none', () => {
    const editor = load(byBo(`${REAL}\n\n${deleted(SMALL)}\n\nAfter.`));
    const wrappers = [...dom(editor).querySelectorAll('.rl-tbl')];
    expect(wrappers).toHaveLength(1);
    // The real table keeps its rows, and none of them is the ghost's.
    expect(wrappers[0]!.querySelectorAll(':scope > .cm-line')).toHaveLength(3);
    expect(wrappers[0]!.querySelector('.rl-ghost-table, .rl-ghost')).toBeNull();
    const [ghost] = ghostTables(editor);
    expect(wrappers[0]!.contains(ghost!)).toBe(false);
    expect(textsOf(ghost!)[0]).toEqual(['Fruit', 'Count']);
    // The real table's widths and rows are its own: its text is read as it was.
    expect(wrappers[0]!.textContent).toContain('Plain');
    expect(editor.view.state.doc.toString()).toContain('One | 1 |');
  });

  it('stands below a real table whose own deleted row is kept below it', () => {
    const rowGone = `<!--del g5nb ${encodePayload('row=2 | Two | 2 |')}-->`;
    const doc = withLedger(
      `${REAL.split('\n').slice(0, 3).join('\n')}\n\n${rowGone}\n\n${deleted(SMALL)}\n\nAfter.`,
      {
        b2b2: 'bo',
        g5nb: 'bo',
      },
    );
    const editor = load(doc);
    expect(dom(editor).querySelectorAll('.rl-tbl > .rl-ghost')).toHaveLength(1);
    expect(ghostTables(editor)).toHaveLength(1);
    expect(textsOf(ghostTables(editor)[0]!)[0]).toEqual(['Fruit', 'Count']);
  });

  it('draws two tables deleted one after the other, each with its own card', () => {
    const other = '| Veg |\n| --- |\n| Kale |';
    const doc = withLedger(`One.\n\n${deleted(SMALL)}\n\n${deleted(other, 'c3c3')}\n\nAfter.`, {
      b2b2: 'bo',
      c3c3: 'ada',
    });
    const editor = load(doc);
    const found = ghostTables(editor);
    expect(found.map((ghost) => ghost.dataset['mark'])).toEqual(['b2b2', 'c3c3']);
    expect(found.map((ghost) => textsOf(ghost)[0])).toEqual([['Fruit', 'Count'], ['Veg']]);
    expect(
      found.map((ghost) => [...ghost.classList].find((name) => /^rl-author-/.test(name))),
    ).toEqual(['rl-author-3', 'rl-author-1']);
  });

  it('draws a table deleted at the very start of the text, before the first block', () => {
    const editor = load(byBo(`${deleted(SMALL)}\n\nAfter.`));
    const page = [...dom(editor).children]
      .filter((el) => el.matches('.cm-line, .rl-struck-blocks'))
      .map((el) => (el.matches('.rl-struck-blocks') ? '~table~' : el.textContent));
    expect(page).toEqual(['~table~', 'After.']);
    expect(textsOf(ghostTables(editor)[0]!)[1]).toEqual(['Apples', '3']);
  });
});

describe('the layout of a ghost table', () => {
  it('is a table laid out by its own cells: automatic widths, in rows of cells', () => {
    const editor = load(byBo(`One.\n\n${deleted(SMALL)}\n\nAfter.`));
    const [ghost] = ghostTables(editor);
    const grid = ghost!.querySelector<HTMLElement>('.rl-ghost-grid')!;
    const style = getComputedStyle(grid);
    // The browser fits its columns to the widths of its own cells (a real table is given widths by
    // measuring its text, the way an automatic layout would), and they depend on nothing outside it.
    expect(style.display).toBe('table');
    expect(style.tableLayout).toBe('auto');
    expect(getComputedStyle(rowsOf(ghost!)[0]!).display).toBe('table-row');
    // (Its cells are the table's own, `.rl-tc`, which the table's look makes cells.)
    expect(cellsOf(rowsOf(ghost!)[0]!)[0]!.classList).toContain('rl-tc');
    // It scrolls sideways, where a table of long words is wider than the text.
    expect(getComputedStyle(ghost!.querySelector('.rl-ghost-scroll')!).overflowX).toBe('auto');
  });

  it('is no real table: no wrapper, no grips, no widths measured, no cell to select', () => {
    const editor = load(byBo(`One.\n\n${deleted(SMALL)}\n\nAfter.`));
    expect(dom(editor).querySelector('.rl-tbl')).toBeNull();
    expect(dom(editor).querySelector('[data-table]')).toBeNull();
    expect(dom(editor).querySelector('.cm-line.rl-trow')).toBeNull();
  });

  it('is drawn again by nothing a keystroke elsewhere does: its element stays', () => {
    const editor = load(byBo(`One.\n\n${deleted(table(20))}\n\nAfter.`));
    const before = ghostTables(editor)[0];
    expect(before).toBeDefined();
    editor.view.dispatch({ changes: { from: 3, insert: 'x' } });
    editor.view.dispatch({ changes: { from: 4, insert: 'y' } });
    expect(ghostTables(editor)[0]).toBe(before);
    expect(dom(editor).textContent).toContain('Onexy.');
  });
});

describe('the caret and the pointer at a ghost table', () => {
  it('puts no caret in it when it is pressed, and has no text that can be selected', () => {
    const editor = load(byBo(`One.\n\n${deleted(SMALL)}\n\nAfter.`));
    const { view } = editor;
    view.dispatch({ selection: { anchor: 3 } });
    const [ghost] = ghostTables(editor);
    const cell = ghost!.querySelector('.rl-tc')!;
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    cell.dispatchEvent(press);
    expect(view.state.selection.main.head).toBe(3);
    // The press is taken whole: the editor's own handling of it, which would put a caret, is not run.
    expect(press.defaultPrevented).toBe(true);
    // It is not editable: the editor draws a widget that is no content.
    expect(ghost!.closest('[contenteditable="false"]')).not.toBeNull();
    expect(getComputedStyle(ghost!).userSelect).toBe('none');
  });

  it('is stepped over by the caret: ↓ from the line above goes to the line below it, and ↑ back', () => {
    const editor = load(byBo(`One.\n\n${deleted(SMALL)}\n\nAfter.`));
    const { view } = editor;
    view.dispatch({ selection: { anchor: 2 } });
    const key = (name: string) =>
      runScopeHandlers(view, new KeyboardEvent('keydown', { key: name, bubbles: true }), 'editor');
    expect(key('ArrowDown')).toBe(true);
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('After.');
    expect(key('ArrowUp')).toBe(true);
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('One.');
  });

  it('opens its card in the table’s change when it is pressed: it carries the id of the deletion', () => {
    const editor = load(byBo(`One.\n\n${deleted(SMALL)}\n\nAfter.`));
    const [ghost] = ghostTables(editor);
    // Every drawn part finds the one change: the card of a struck block, and its box.
    for (const part of [ghost!, ...ghost!.querySelectorAll('.rl-tc, .rl-del')]) {
      expect(part.closest('[data-mark]')?.getAttribute('data-mark')).toBe('b2b2');
    }
    expect(ghost!.classList).toContain('rl-struck');
  });
});

describe('Clean and Simple', () => {
  const doc = byBo(`One.\n\n${deleted(table(20))}\n\nAfter.`);

  it('draw no ghost table in Clean: the newest text has no table', () => {
    const editor = load(doc, { view: 'clean' });
    expect(ghostTables(editor)).toHaveLength(0);
    expect(dom(editor).querySelector('.rl-struck, .rl-del')).toBeNull();
    expect(dom(editor).textContent).not.toContain('H1');
    expect(dom(editor).textContent).not.toContain('<!--');
    expect([...dom(editor).querySelectorAll('.cm-line')].map((line) => line.textContent)).toEqual([
      'One.',
      'After.',
    ]);
  });

  it('draw none in Simple, which keeps the bar, on the block after it', () => {
    const editor = load(doc, { view: 'simple' });
    expect(ghostTables(editor)).toHaveLength(0);
    expect(dom(editor).querySelector('.rl-struck, .rl-del, .rl-ghost-table')).toBeNull();
    expect(dom(editor).textContent).toBe(dom(load(doc, { view: 'clean' })).textContent);
    const after = [...dom(editor).querySelectorAll('.cm-line')].find(
      (line) => line.textContent === 'After.',
    );
    expect(after?.classList).toContain('rl-bar');
    expect(after?.classList).toContain('rl-author-3');
  });

  it('draw none in Simple for a table at the end of the text, and the bar stays on the text above', () => {
    const end = byBo(`One.<!--del b2b2 ${encodePayload(`\n\n${SMALL}`)}-->`);
    const editor = load(end, { view: 'simple' });
    expect(ghostTables(editor)).toHaveLength(0);
    const line = dom(editor).querySelector('.cm-line');
    expect(line?.textContent).toBe('One.');
    expect(line?.classList).toContain('rl-bar');
  });

  it('draw the ghost table again when the view comes back to Redlines', () => {
    const editor = load(doc);
    editor.setViewMode('clean');
    expect(ghostTables(editor)).toHaveLength(0);
    editor.setViewMode('redlines');
    expect(ghostTables(editor)).toHaveLength(1);
  });
});

describe('a deleted table that is no table of its own', () => {
  it('keeps a table in a list item or a quote as the source it is, and breaks nothing', () => {
    for (const body of [
      '- one\n- <!--del b2b2 | a |\\n  | - |\\n  | 1 |\\n- -->\n  three',
      'One.\n\n<!--del b2b2 > | a |\\n> | - |\\n> | 1 |\\n\\n-->\n\nAfter.',
    ]) {
      const editor = load(byBo(body));
      expect(ghostTables(editor), body).toHaveLength(0);
      expect(dom(editor).querySelector('.rl-struck'), body).not.toBeNull();
      expect(dom(editor).querySelector('.rl-struck .rl-del'), body).not.toBeNull();
    }
  });

  it('keeps a pipe-led block that is no table as the source it is', () => {
    const doc = byBo(`One.\n\n${deleted('| a | b |\n| c | d |')}\n\nAfter.`);
    const editor = load(doc);
    expect(ghostTables(editor)).toHaveLength(0);
    expect(dom(editor).querySelector('.rl-struck')?.textContent).toBe('| a | b | | c | d |');
  });
});
