// Debug only: checks tables in WebKit, where happy-dom can't, because they need a real layout and
// WebKit's own hit-testing and editing: the columns line up, no stray cells, presses land in the cell
// under the pointer (empty cells, a `<br>`, a pipe in a code span), ↑ and ↓ move between cells at the
// same x, WebKit's own typing (`document.execCommand('insertText')`) lands in a cell, an empty cell
// and after a `<br>`, a selection that reaches into a table draws its cells, a rectangle of cells
// (a drag across cells, a shift-press, shift-arrows, Select Row, Column and Table) draws exactly its
// cells in Clean, Simple and Redlines, copy and cut put tab-separated text and an HTML table on the
// pasteboard, a paste of a range lands in the cells and adds the rows and columns it needs, deleted, inserted and
// moved rows and columns are drawn (ghosts lined up to the pixel, tints, double marks, bars in Simple),
// the grips, the + and the dragging of rows and columns work, an alignment change is drawn, carded and
// made from the menu and the grip, a table deleted whole is a ghost table (its columns lined up, the
// rows past eight folded into one line, not editable, carded), a row with fewer cells than the header is
// drawn with empty cells after its last and typing in one writes its pipes first, a row with more draws
// none beyond the header's and no key puts the caret in one, an empty cell holds a filler of its own
// whatever its padding and its row is as tall as a row of text, the caret can stand in an empty cell
// with one space of padding or none (Tab, the arrows, a press and typing reach it), Delete Table and a
// second ⌫ delete the emptied rows, columns and table, and a keystroke in a 300-row
// table stays within the budget. Serve the page with `VITE_TABLE_CHECK=1 pnpm dev` (or
// `pnpm tauri dev`, for WKWebView) and open it in WebKit: it reads nothing in a release build.
//
// The checks of Stage 4 (the ghost table, the cells a row lacks, the empty cell's filler, the second
// ⌫) were first run in Chromium, the built-in browser's engine, which is not WKWebView: what they
// measure there (the hit test, the layout of the cells, `user-select`, typing by `execCommand`) is
// Chromium's until the sweep runs the file in WKWebView, and each says where the engine could differ.
//
// Each check loads its document and does what a person does, and reports one console line,
// `TABLE-CHECK <name> pass` or `TABLE-CHECK <name> FAIL <json>`, then
// `TABLE-CHECK done <passed> passed, <failed> failed`. A check fails unless the behavior really
// happened: where it found nothing to measure, it says so and fails.

import { EditorSelection } from '@codemirror/state';
import type { Editor, Table, TableCell } from '@redlines/editor';
import { rectOf, tablesOf, touchedCols, undo, wholeRect } from '@redlines/editor';
import sample from './sample.md?raw';

const FRUIT = [
  'Intro paragraph.',
  '',
  '| Fruit | Count | Note |',
  '| ----- | ----- | ---- |',
  '| Apples | 3 | first<br>second |',
  '| Plums |  | `x \\| y` |',
  '| Pears | 12 | short |',
  '',
  'Below.',
].join('\n');

/** A table whose Pears row is an insertion by someone else, with its ledger. */
const WITH_ROW = [
  '| Fruit | Count |',
  '| ----- | ----- |',
  '| Apples | 3 |',
  '| <!--ins k3x9 row--> Pears | 5 |',
  '',
  '<!-- redlines',
  'version: 1',
  'marks:',
  '  k3x9: {by: bo, at: 2026-11-01T10:00Z}',
  '-->',
  '',
].join('\n');

/** A frame, and a little after it: the measures and the effects that follow an update. A page that
 * draws slowly (a hidden pane) is not waited for longer than a moment. */
const frames = async () => {
  await Promise.race([
    new Promise((resolve) => requestAnimationFrame(resolve)),
    new Promise((resolve) => setTimeout(resolve, 120)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 30));
};

const mac = /Mac/.test(navigator.platform);

/** Presses a key as a keyboard does, through CodeMirror's own key handling. */
function press(editor: Editor, key: string): boolean {
  const parts = key.split('-');
  const name = parts.pop() ?? key;
  const event = new KeyboardEvent('keydown', {
    key: name,
    code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
    shiftKey: parts.includes('Shift'),
    altKey: parts.includes('Alt'),
    ctrlKey: parts.includes('Ctrl') || (parts.includes('Mod') && !mac),
    metaKey: parts.includes('Cmd') || (parts.includes('Mod') && mac),
    bubbles: true,
    cancelable: true,
  });
  editor.view.contentDOM.dispatchEvent(event);
  // Whether a key binding took it.
  return event.defaultPrevented;
}

/** A press of the primary button at a point, as the pointer makes it: down, and up. */
function pressAt(editor: Editor, x: number, y: number, detail = 1): void {
  const target = document.elementFromPoint(x, y) ?? editor.view.contentDOM;
  const init: MouseEventInit = {
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
    detail,
    bubbles: true,
    cancelable: true,
  };
  target.dispatchEvent(new MouseEvent('mousedown', init));
  document.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
}

/** Loads a document in Clean, Track Changes off, with the caret at `‸` if it has one. */
async function load(editor: Editor, doc: string, tracking = false): Promise<void> {
  editor.setViewMode('clean');
  editor.setTracking(tracking, { inFile: false });
  editor.reloadDoc(doc.replace('‸', ''));
  editor.view.focus();
  const caret = doc.indexOf('‸');
  editor.view.dispatch({ selection: EditorSelection.cursor(Math.max(0, caret)) });
  await frames();
}

/** Puts the caret at `pos`, scrolled into view: coordinates are only found for what is on screen. */
async function place(editor: Editor, pos: number): Promise<void> {
  editor.view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
  await frames();
}

/** Scrolls an element to the middle of the window and returns its box, as it is then. */
async function reveal(element: HTMLElement): Promise<DOMRect> {
  element.scrollIntoView({ block: 'center', inline: 'nearest' });
  await frames();
  return element.getBoundingClientRect();
}

const table = (editor: Editor): Table => {
  const found = tablesOf(editor.view.state)[0];
  if (!found) throw new Error('the document has no table');
  return found;
};

const cellOf = (editor: Editor, row: number, col: number): TableCell => {
  const cell = table(editor).rows[row]?.cells[col];
  if (!cell) throw new Error(`no cell ${row},${col}`);
  return cell;
};

/** The elements of the table's cells, by row and column, as the page draws them. */
function cellElements(editor: Editor): HTMLElement[][] {
  const lines = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line.rl-trow')];
  return lines.map((line) => [...line.querySelectorAll<HTMLElement>(':scope > .rl-tc')]);
}

const head = (editor: Editor) => editor.view.state.selection.main.head;
const doc = (editor: Editor) => editor.view.state.doc.toString();
const inText = (cell: TableCell, pos: number) => cell.textFrom <= pos && pos <= cell.textTo;
const at = (text: string, find: string, offset = 0) => text.indexOf(find) + offset;

/** A table of fruit with a header, three body rows, a bold cell and a cell with a line break. */
const GRID = [
  'Intro.',
  '',
  '| Fruit | Count | Note |',
  '| ----- | ----- | ---- |',
  '| Apples | 3 | **sweet** |',
  '| Plums | 4 | a\\|b<br>x |',
  '| Pears | 5 | ok |',
  '',
  'Below.',
].join('\n');

/** The centre of a cell's box, scrolled into view. */
async function centre(editor: Editor, row: number, col: number, scroll = true) {
  const element = cellElements(editor)[row]?.[col];
  if (!element) throw new Error(`no cell ${row},${col} drawn`);
  const box = scroll ? await reveal(element) : element.getBoundingClientRect();
  return { x: box.left + Math.min(box.width / 2, 24), y: box.top + box.height / 2, box };
}

/** A drag as the pointer makes it: down at a point, moves, up at another. */
async function dragFrom(
  editor: Editor,
  from: { x: number; y: number },
  to: { x: number; y: number },
  init: MouseEventInit = {},
): Promise<void> {
  const target = document.elementFromPoint(from.x, from.y) ?? editor.view.contentDOM;
  const at = (point: { x: number; y: number }, buttons: number): MouseEventInit => ({
    clientX: point.x,
    clientY: point.y,
    button: 0,
    buttons,
    detail: 1,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(new MouseEvent('mousedown', at(from, 1)));
  for (const step of [0.25, 0.5, 0.75, 1]) {
    document.dispatchEvent(
      new MouseEvent(
        'mousemove',
        at({ x: from.x + (to.x - from.x) * step, y: from.y + (to.y - from.y) * step }, 1),
      ),
    );
    await frames();
  }
  document.dispatchEvent(new MouseEvent('mouseup', at(to, 0)));
  await frames();
}

/** The cells drawn as selected, as `r<row>c<col>`, in the order of the page. */
function selectedLabels(editor: Editor): string[] {
  const lines = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line.rl-trow')];
  return [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-sel')].map(
    (el) => `r${lines.indexOf(el.closest<HTMLElement>('.cm-line')!)}c${el.dataset['col']}`,
  );
}

/** The labels of the cells of rows `rows` and columns `cols`, both ends included. */
const labels = (rows: [number, number], cols: [number, number]) => {
  const out: string[] = [];
  for (let r = rows[0]; r <= rows[1]; r++)
    for (let c = cols[0]; c <= cols[1]; c++) out.push(`r${r}c${c}`);
  return out;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The rectangle the selection makes, as `rows`/`cols` and what it is, or null. */
function rect(editor: Editor) {
  const found = rectOf(editor.view.state);
  return found ? { rows: found.rows, cols: found.cols, whole: wholeRect(found) } : null;
}

/** A copy or a cut as ⌘C and ⌘X make it, and what it put on the pasteboard. */
function copyOrCut(editor: Editor, type: 'copy' | 'cut') {
  const clipboardData = new DataTransfer();
  const event = new ClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true });
  editor.view.contentDOM.dispatchEvent(event);
  return {
    taken: event.defaultPrevented,
    text: clipboardData.getData('text/plain'),
    html: clipboardData.getData('text/html'),
  };
}

/** A paste as ⌘V makes it. */
function pasteInto(editor: Editor, text: string, html?: string): boolean {
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  if (html !== undefined) clipboardData.setData('text/html', html);
  const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
  editor.view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Whether a cell's background is drawn (not transparent). */
const painted = (el: Element) => {
  const color = getComputedStyle(el).backgroundColor;
  return color !== '' && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)';
};

/** An input method's events in WebKit's order, with the changes it makes between them. */
function compose(editor: Editor, steps: string[], commit: string): void {
  const fire = (type: string, data = '') => {
    const event = new Event(type, { bubbles: true }) as Event & { data: string };
    event.data = data;
    editor.view.contentDOM.dispatchEvent(event);
  };
  fire('compositionstart');
  const at = head(editor);
  let length = 0;
  steps.forEach((text, i) => {
    editor.view.dispatch({
      changes: { from: at, to: at + length, insert: text },
      selection: EditorSelection.cursor(at + text.length),
      userEvent: i === 0 ? 'input.type.compose.start' : 'input.type.compose',
    });
    length = text.length;
    fire('compositionupdate', text);
  });
  if (steps.length) {
    editor.view.dispatch({
      changes: { from: at, to: at + length, insert: commit },
      selection: EditorSelection.cursor(at + commit.length),
      userEvent: 'input.type.compose',
    });
  }
  fire('compositionend', commit);
}

/** Long enough for a finished composition to be finished by the editor. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

type Problems = Record<string, unknown> | null;

interface Check {
  name: string;
  run(editor: Editor): Promise<Problems> | Problems;
}

/** The first column's text of each real row of the table, as the document has it. */
const firstColumn = (editor: Editor): string[] =>
  table(editor).rows.map((row) => {
    const cell = row.cells[0];
    return cell ? editor.view.state.doc.sliceString(cell.textFrom, cell.textTo) : '';
  });

const lineElements = (editor: Editor): HTMLElement[] => [
  ...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tbl > .cm-line.rl-trow'),
];
const ghostElements = (editor: Editor): HTMLElement[] => [
  ...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tbl > .rl-ghost'),
];

/** The pointer moves over the editor, as it does over a row. */
function hover(editor: Editor, x: number, y: number): void {
  editor.view.dom.dispatchEvent(
    new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true, buttons: 0 }),
  );
}

/** A mouse event at a point, on `target` (or the element there). */
function mouse(target: EventTarget, type: string, x: number, y: number, init: MouseEventInit = {}) {
  target.dispatchEvent(
    new MouseEvent(type, {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

/** The bottom of the last real row as it is drawn now, from its cells: a row can change height with
 * what is selected or wrapped, so the drop is aimed from the edges as they are, never from a height. */
const bottomNow = (editor: Editor): number => {
  const cells = [
    ...(lineElements(editor).at(-1)?.querySelectorAll<HTMLElement>(':scope > .rl-tc') ?? []),
  ];
  return Math.max(...cells.map((cell) => cell.getBoundingClientRect().bottom));
};

/** Puts the pointer on the row `row` of the real rows and returns the grip that then shows. */
async function gripOf(editor: Editor, row: number): Promise<HTMLElement | null> {
  const line = lineElements(editor)[row];
  if (!line) return null;
  const box = await reveal(line);
  hover(editor, box.left + 30, box.top + box.height / 2);
  await frames();
  return editor.view.dom.querySelector<HTMLElement>('.rl-grip');
}

/** A document with the table and a ledger, for the row checks: Track Changes decides what it writes. */
const ROWS = GRID.replace('| Plums | 4 | a\\|b<br>x |', '| Plums | 4 | ok |');

/** A table whose Count column was centered by someone else (the old delimiter row kept in the change),
 * with its ledger. */
const WITH_ALIGN = [
  'Intro paragraph.',
  '',
  '<!--fmt k3x9 align=\\|\\x20-\\-\\-\\-\\-\\x20\\|\\x20-\\-\\-\\-\\-\\x20\\|-->',
  '',
  '| Fruit | Count |',
  '| ----- | :---: |',
  '| Apples | 3 |',
  '| Plums | 4 |',
  '',
  '<!--/k3x9-->',
  '',
  'Below.',
  '',
  '<!-- redlines',
  'version: 1',
  'people:',
  '  bo: {name: Bo Chen}',
  'marks:',
  '  k3x9: {by: bo, at: 2026-11-01T10:00Z}',
  '-->',
  '',
].join('\n');

/** The computed text alignment of each cell of column `col`, row by row. */
const alignedAs = (editor: Editor, col: number): string[] =>
  cellElements(editor).map((row) => {
    const cell = row.find((c) => c.dataset['col'] === String(col));
    return cell ? getComputedStyle(cell).textAlign : 'no cell';
  });

/** A table with no pipe at the edges of its rows, whose Count column (first, or last) was deleted by
 * someone else and is kept below it, with its ledger. */
const bareWithoutCount = (place: 'first' | 'last'): string =>
  [
    'Fruit | Price',
    '----- | -----',
    'Apples | 1.20',
    'Plums | 2.50',
    '',
    `<!--del g5nb col=${place === 'first' ? 1 : 3} Count\\n-\\-\\-\\n3\\n7-->`,
    '',
    '<!-- redlines',
    'version: 1',
    'people:',
    '  bo: {name: Bo Chen}',
    'marks:',
    '  g5nb: {by: bo, at: 2026-11-01T10:00Z}',
    '-->',
    '',
  ].join('\n');

/** The ghost cells of deleted columns, as the page draws them. */
const ghostCols = (editor: Editor): HTMLElement[] => [
  ...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tbl .rl-ghost-col'),
];

/** How far the cells of each row of a grid are from the cells of its first row, left edge by left
 * edge, in px: the columns must line up in every row, which must have as many cells as the first. */
function gridOff(grid: HTMLElement[][]): { cells: number[]; off: number } {
  const lefts = grid.map((row) => row.map((cell) => cell.getBoundingClientRect().left));
  const first = lefts[0] ?? [];
  let off = 0;
  for (const row of lefts) {
    if (row.length !== first.length) return { cells: lefts.map((r) => r.length), off: Infinity };
    row.forEach((left, i) => (off = Math.max(off, Math.abs(left - (first[i] ?? 0)))));
  }
  return { cells: lefts.map((r) => r.length), off };
}

/** How far the cells of each row are from the cells of the first row, left edge by left edge, in px:
 * ghosts and all, the columns must line up in every row. */
function linedUp(editor: Editor): { cells: number[]; off: number } {
  return gridOff(cellElements(editor));
}

/** Puts the pointer on column `col` of the header and returns the column grip that then shows. */
async function colGripOf(editor: Editor, col: number): Promise<HTMLElement | null> {
  const cell = cellElements(editor)[0]?.find((c) => c.dataset['col'] === String(col));
  if (!cell) return null;
  const box = await reveal(cell);
  hover(editor, box.left + box.width / 2, box.top + box.height / 2);
  await frames();
  return editor.view.dom.querySelector<HTMLElement>('.rl-col-grip');
}

/** The header's real cells, left to right: ghosts are no column of the document. */
const headerCells = (editor: Editor): HTMLElement[] =>
  (cellElements(editor)[0] ?? []).filter((cell) => cell.dataset['col'] !== undefined);

/** A table of `rows` rows, the header's and the body's, in three columns whose cells differ in length
 * from row to row, so that lining them up is the browser's work: a layout that gave each row its own
 * widths would show. */
function fruitTable(rows: number): string {
  const body = Array.from({ length: rows - 1 }, (_, n) => {
    if (n % 3 === 0) return `| Apples ${n + 1} | 3 | short |`;
    if (n % 3 === 1) return '| A fruit with a long name | 1234567 | x |';
    return '| Pear | 12 | a note that runs on a good while |';
  });
  return ['| Fruit | Count | Note |', '| ----- | ----- | ---- |', ...body].join('\n');
}

/** A document with `source` between two paragraphs. */
const around = (source: string): string => `Intro paragraph.\n\n${source}\n\nBelow.`;

/** The ghost tables the page draws: a table deleted whole, in Redlines (`ghost-table.ts`). */
const ghostTables = (editor: Editor): HTMLElement[] => [
  ...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-ghost-table'),
];

/** The rows of a ghost table that are drawn, and the cells of each, as the page has them. */
const ghostGrid = (ghost: HTMLElement): HTMLElement[][] =>
  [...ghost.querySelectorAll<HTMLElement>('.rl-ghost-row')].map((row) => [
    ...row.querySelectorAll<HTMLElement>(':scope > .rl-tc'),
  ]);

/** What a ghost table says of its size, as it carries it: the columns, the rows, and those not drawn. */
const ghostData = (ghost: HTMLElement) => ({
  columns: ghost.dataset['columns'],
  rows: ghost.dataset['rows'],
  more: ghost.dataset['more'],
});

/** The text of each row of a grid as a person reads it, the cells apart by `|` (a filler is no text). */
const gridTexts = (grid: HTMLElement[][]): string[] =>
  grid.map((row) => row.map((cell) => (cell.textContent ?? '').replace(/\u200b/g, '')).join('|'));

/** `source` loaded with Track Changes on and its table deleted whole by the Table menu's command, as
 * Redlines draws it: the one ghost table the page then has, or null where it has none or several. */
async function deleteWhole(editor: Editor, source: string): Promise<HTMLElement | null> {
  await load(editor, source, true);
  await place(editor, cellOf(editor, 1, 0).textFrom);
  if (!editor.commands.run('table.deleteTable')) return null;
  editor.setViewMode('redlines');
  await frames();
  return ghostTables(editor).length === 1 ? (ghostTables(editor)[0] ?? null) : null;
}

/**
 * A press of the primary button on the first struck text of a ghost table, as the pointer makes it (down,
 * then up at the same place), and what it did: whether the press landed on the ghost, was taken whole,
 * moved the selection, and what the card that opened says.
 */
async function pressGhost(editor: Editor, ghost: HTMLElement) {
  const struck = ghost.querySelector<HTMLElement>('.rl-tc .rl-del') ?? ghost;
  const box = await reveal(struck);
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const target = document.elementFromPoint(x, y);
  const before = editor.view.state.selection.main;
  const down = new MouseEvent('mousedown', {
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
    detail: 1,
    bubbles: true,
    cancelable: true,
  });
  (target ?? struck).dispatchEvent(down);
  mouse(window, 'mouseup', x, y);
  await frames();
  await frames();
  const after = editor.view.state.selection.main;
  return {
    hit: target !== null && ghost.contains(target),
    taken: down.defaultPrevented,
    moved: after.anchor !== before.anchor || after.head !== before.head,
    card:
      editor.view.dom.ownerDocument.querySelector('.rl-card .rl-card-what')?.textContent ?? null,
  };
}

/** The column of the cell its row lacks that the page draws the caret in, or null where it draws it in
 * none (`missing.ts`). */
const caretMissing = (editor: Editor): string | null =>
  editor.view.contentDOM.querySelector<HTMLElement>('.rl-tc-active')?.dataset['col'] ?? null;

/** The cells of each row that the page shows: an extra cell (`rl-tc-hidden`) is kept and not drawn. */
const shownCells = (editor: Editor): HTMLElement[][] =>
  cellElements(editor).map((row) =>
    row.filter((cell) => getComputedStyle(cell).display !== 'none'),
  );

/** A table whose first body row has one cell and whose second has two, under a header of three. */
const FEWER = around(
  [
    '| Fruit | Count | Note |',
    '| ----- | ----- | ---- |',
    '| Apples |',
    '| Plums | 4 |',
    '| Pears | 12 | short |',
  ].join('\n'),
);

/** A table whose first body row has a cell more than the header, which has two. */
const MORE = around(['| a | b |', '| - | - |', '| c | d | EXTRA |', '| f | g |'].join('\n'));

/** A table of three columns whose last body row is `row`, below a row of text to compare it with. */
const withRow = (row: string): string =>
  around(['| a | b | c |', '| - | - | - |', '| 1 | 2 | 3 |', row].join('\n'));

/**
 * Rows with an empty cell, by the padding that decides where its one caret stop is: with two spaces it
 * is between them, inside the cell; with one space or none it is the cell's end, where the next cell
 * begins. (The cell's filler once stood in the next cell then.)
 */
const EMPTY_FORMS: [string, string][] = [
  ['one space in the middle', withRow('| 1 | | x |')],
  ['one space in the first cell', withRow('| | 1 | x |')],
  ['no space in the middle', withRow('| 1 || x |')],
  ['two spaces in the middle', withRow('| 1 |  | x |')],
  ['two spaces in the first cell', withRow('|  | 1 | x |')],
  ['one space in the last cell', withRow('| 1 | x | |')],
  ['no space in the last cell', withRow('| 1 | x ||')],
  ['two empty cells side by side', withRow('| | | x |')],
  ['in the header', around(['| | | x |', '| - | - | - |', '| 1 | 2 | 3 |'].join('\n'))],
];

/** The top of the first text a cell shows, as the page draws it (the filler's zero-width space is no
 * text), or null for a cell with none. */
function textTop(cell: HTMLElement): number | null {
  const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if ((node.textContent ?? '').replace(/\u200b/g, '') === '') continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().top;
  }
  return null;
}

const CHECKS: Check[] = [
  {
    name: 'layout-columns-line-up',
    async run(editor) {
      await load(editor, FRUIT);
      const grid = cellElements(editor);
      if (grid.length !== 4) return { rows: grid.length, why: 'expected 4 rows drawn' };
      const problems: Record<string, unknown> = {};
      for (let col = 0; col < 3; col++) {
        const lefts = grid.map((row) => row[col]?.getBoundingClientRect().left);
        const widths = grid.map((row) => row[col]?.getBoundingClientRect().width);
        if (lefts.some((left) => left === undefined)) problems[`col${col}`] = 'a cell is missing';
        else if (Math.max(...(lefts as number[])) - Math.min(...(lefts as number[])) > 0.01) {
          problems[`col${col}-lefts`] = lefts;
        }
        if ((widths as number[]).some((width) => !(width > 0)))
          problems[`col${col}-widths`] = widths;
      }
      if (!editor.view.contentDOM.querySelector('.cm-line.rl-th'))
        problems['header'] = 'no .rl-th row';
      if (editor.view.contentDOM.querySelectorAll('.rl-tbl').length !== 1)
        problems['tables'] = 'not one';
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    name: 'layout-no-stray-cells',
    async run(editor) {
      await load(editor, FRUIT);
      const lines = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line.rl-trow')];
      const stray = lines.flatMap((line, r) =>
        [...line.children]
          .filter((child) => !child.classList.contains('rl-tc'))
          .map((child) => `row ${r}: <${child.tagName.toLowerCase()} class="${child.className}">`),
      );
      const counts = lines.map((line) => line.querySelectorAll(':scope > .rl-tc').length);
      const outside = [...editor.view.contentDOM.querySelectorAll('.rl-tc')].filter(
        (cell) => !cell.closest('.rl-tbl'),
      ).length;
      const flat = counts.some((count) => count !== 3);
      return stray.length || flat || outside || lines.length === 0
        ? { stray, counts, outside, rows: lines.length }
        : null;
    },
  },
  {
    name: 'raw-draws-no-table',
    async run(editor) {
      await load(editor, FRUIT);
      editor.setViewMode('raw');
      await frames();
      const drawn = editor.view.contentDOM.querySelectorAll('.rl-tbl, .rl-tc').length;
      const text = editor.view.contentDOM.textContent ?? '';
      editor.setViewMode('clean');
      await frames();
      return drawn || !text.includes('| Fruit | Count | Note |')
        ? { drawn, shows: text.slice(0, 80) }
        : null;
    },
  },
  {
    name: 'press-lands-in-every-cell',
    async run(editor) {
      await load(editor, FRUIT);
      const grid = cellElements(editor);
      const wrong: string[] = [];
      let pressed = 0;
      for (let row = 0; row < grid.length; row++) {
        for (let col = 0; col < 3; col++) {
          const element = grid[row]?.[col];
          if (!element) {
            wrong.push(`${row},${col}: no element`);
            continue;
          }
          const box = await reveal(element);
          for (const fraction of [0.1, 0.5, 0.9]) {
            // Away from where the caret is, so that a press that did nothing shows.
            editor.view.dispatch({ selection: EditorSelection.cursor(0) });
            await frames();
            pressAt(editor, box.left + box.width * fraction, box.top + box.height / 2);
            await frames();
            pressed++;
            const cell = cellOf(editor, row, col);
            if (!inText(cell, head(editor))) {
              wrong.push(
                `${row},${col} at ${fraction}: caret at ${head(editor)}, cell text ${cell.textFrom}-${cell.textTo}`,
              );
            }
          }
        }
      }
      return wrong.length || pressed !== 36 ? { wrong, pressed } : null;
    },
  },
  {
    name: 'press-in-empty-cell-draws-the-caret',
    async run(editor) {
      await load(editor, FRUIT);
      const element = cellElements(editor)[2]?.[1];
      if (!element) return { why: 'no empty cell drawn' };
      const box = await reveal(element);
      pressAt(editor, box.left + box.width / 2, box.top + box.height / 2);
      await frames();
      const cell = cellOf(editor, 2, 1);
      const coords = editor.view.coordsAtPos(head(editor));
      const problems: Record<string, unknown> = {};
      if (cell.textFrom !== cell.textTo) problems['empty'] = 'the fixture cell is not empty';
      if (head(editor) !== cell.textFrom) problems['head'] = head(editor);
      if (!coords || !(coords.bottom - coords.top > 0)) problems['coords'] = coords;
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    name: 'press-after-pipe-in-code-span',
    async run(editor) {
      await load(editor, FRUIT);
      const element = cellElements(editor)[2]?.[2];
      const cell = cellOf(editor, 2, 2);
      if (!element) return { why: 'no cell drawn' };
      // The right of the cell's text: after the `|` that the code span holds.
      const box = await reveal(element);
      pressAt(editor, box.right - 4, box.top + box.height / 2);
      await frames();
      const text = doc(editor);
      return inText(cell, head(editor)) && head(editor) > at(text, '\\|')
        ? null
        : { head: head(editor), cell: [cell.textFrom, cell.textTo] };
    },
  },
  {
    name: 'down-between-cells-at-the-same-x',
    async run(editor) {
      await load(editor, FRUIT);
      const text = doc(editor);
      await place(editor, at(text, 'Apples', 3));
      const start = head(editor);
      const before = editor.view.coordsAtPos(head(editor));
      const taken = press(editor, 'ArrowDown');
      await frames();
      const after = editor.view.coordsAtPos(head(editor));
      const target = cellOf(editor, 2, 0);
      const dx = before && after ? Math.abs(before.left - after.left) : null;
      return inText(target, head(editor)) && dx !== null && dx <= 12
        ? null
        : {
            start,
            taken,
            head: head(editor),
            target: [target.textFrom, target.textTo],
            dx,
            before,
            after,
          };
    },
  },
  {
    name: 'down-into-an-empty-cell',
    async run(editor) {
      await load(editor, FRUIT);
      const text = doc(editor);
      await place(editor, at(text, '| 3 |', 2));
      const from = cellOf(editor, 1, 1);
      if (!inText(from, head(editor)))
        return { why: 'the caret did not start in the Count cell', head: head(editor) };
      press(editor, 'ArrowDown');
      await frames();
      const empty = cellOf(editor, 2, 1);
      return head(editor) === empty.textFrom && empty.textFrom === empty.textTo
        ? null
        : { head: head(editor), empty: [empty.textFrom, empty.textTo] };
    },
  },
  {
    name: 'up-out-of-an-empty-cell',
    async run(editor) {
      await load(editor, FRUIT);
      const empty = cellOf(editor, 2, 1);
      await place(editor, empty.textFrom);
      press(editor, 'ArrowUp');
      await frames();
      const above = cellOf(editor, 1, 1);
      return inText(above, head(editor))
        ? null
        : { head: head(editor), above: [above.textFrom, above.textTo] };
    },
  },
  {
    name: 'down-in-a-cell-with-a-line-break-goes-by-line-first',
    async run(editor) {
      await load(editor, FRUIT);
      const cell = cellOf(editor, 1, 2);
      const text = doc(editor);
      await place(editor, at(text, 'first', 2));
      const first = editor.view.coordsAtPos(head(editor));
      press(editor, 'ArrowDown');
      await frames();
      const second = editor.view.coordsAtPos(head(editor));
      const problems: Record<string, unknown> = {};
      if (!inText(cell, head(editor))) problems['left the cell'] = head(editor);
      if (head(editor) <= at(text, '<br>') + 4) problems['not on the second line'] = head(editor);
      if (!first || !second || !(second.top > first.top))
        problems['no line below'] = { first, second };
      press(editor, 'ArrowDown');
      await frames();
      const next = cellOf(editor, 2, 2);
      if (!inText(next, head(editor))) problems['then the cell below'] = head(editor);
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    name: 'down-out-of-the-table-and-up-out-of-it',
    async run(editor) {
      await load(editor, FRUIT);
      const text = doc(editor);
      const last = cellOf(editor, 3, 0);
      await place(editor, last.textFrom + 1);
      press(editor, 'ArrowDown');
      await frames();
      const problems: Record<string, unknown> = {};
      const below = at(text, 'Below.');
      if (head(editor) < below || head(editor) > below + 6)
        problems['down'] = { head: head(editor), below };
      const header = cellOf(editor, 0, 0);
      await place(editor, header.textFrom + 1);
      press(editor, 'ArrowUp');
      await frames();
      const intro = at(text, 'Intro paragraph.');
      if (head(editor) < intro || head(editor) > intro + 'Intro paragraph.'.length) {
        problems['up'] = { head: head(editor), intro };
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    name: 'typing-in-a-cell',
    async run(editor) {
      await load(editor, FRUIT);
      const cell = cellOf(editor, 3, 0);
      await place(editor, cell.textTo);
      document.execCommand('insertText', false, 'X');
      await frames();
      const want = FRUIT.replace('| Pears |', '| PearsX |');
      return doc(editor) === want ? null : { got: doc(editor).replaceAll('\n', '⏎') };
    },
  },
  {
    name: 'typing-in-an-empty-cell',
    async run(editor) {
      await load(editor, FRUIT);
      const cell = cellOf(editor, 2, 1);
      await place(editor, cell.textFrom);
      document.execCommand('insertText', false, 'Y');
      await frames();
      const want = FRUIT.replace('| Plums |  |', '| Plums | Y |');
      return doc(editor) === want ? null : { got: doc(editor).replaceAll('\n', '⏎') };
    },
  },
  {
    name: 'typing-after-a-line-break',
    async run(editor) {
      await load(editor, FRUIT);
      const text = doc(editor);
      await place(editor, at(text, '<br>') + 4);
      document.execCommand('insertText', false, 'Z');
      await frames();
      const want = FRUIT.replace('first<br>second', 'first<br>Zsecond');
      return doc(editor) === want ? null : { got: doc(editor).replaceAll('\n', '⏎') };
    },
  },
  {
    name: 'a-typed-pipe-is-escaped',
    async run(editor) {
      await load(editor, FRUIT);
      const cell = cellOf(editor, 3, 0);
      await place(editor, cell.textTo);
      document.execCommand('insertText', false, '|');
      await frames();
      const want = FRUIT.replace('| Pears |', '| Pears\\| |');
      return doc(editor) === want ? null : { got: doc(editor).replaceAll('\n', '⏎') };
    },
  },
  {
    name: 'return-writes-a-line-break-and-tab-moves',
    async run(editor) {
      await load(editor, FRUIT);
      const cell = cellOf(editor, 3, 0);
      await place(editor, cell.textFrom + 2);
      press(editor, 'Enter');
      await frames();
      const problems: Record<string, unknown> = {};
      if (doc(editor) !== FRUIT.replace('| Pears |', '| Pe<br>ars |'))
        problems['return'] = doc(editor).replaceAll('\n', '⏎');
      editor.view.dispatch({ selection: EditorSelection.cursor(cellOf(editor, 3, 0).textFrom) });
      press(editor, 'Tab');
      await frames();
      const next = cellOf(editor, 3, 1);
      const { from, to } = editor.view.state.selection.main;
      if (from !== next.textFrom || to !== next.textTo)
        problems['tab'] = { from, to, next: [next.textFrom, next.textTo] };
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    name: 'a-reaching-selection-draws-its-cells',
    async run(editor) {
      await load(editor, FRUIT);
      const text = doc(editor);
      const to = cellOf(editor, 2, 1).textFrom;
      editor.view.dispatch({ selection: EditorSelection.range(at(text, 'paragraph', 2), to) });
      await frames();
      const marked = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-sel')];
      const problems: Record<string, unknown> = {};
      // Rows 0 to 2 are reached: nine cells.
      if (marked.length !== 9) problems['count'] = marked.length;
      const unpainted = marked.filter((el) => {
        // The cell is painted (a mark inside an empty cell has no width of its own).
        const cell = el.closest('.rl-tc') ?? el;
        const color = getComputedStyle(cell).backgroundColor;
        const box = cell.getBoundingClientRect();
        return color === 'rgba(0, 0, 0, 0)' || color === 'transparent' || !(box.width > 0);
      });
      if (unpainted.length) problems['unpainted'] = unpainted.length;
      // The last row is not reached.
      const lastRow = cellElements(editor)[3] ?? [];
      if (
        lastRow.length !== 3 ||
        lastRow.some((el) => el.querySelector('.rl-sel') || el.classList.contains('rl-sel'))
      ) {
        problems['last row'] = 'drawn as selected, or missing';
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A drag that enters a second cell selects cells, from the first to the one under the pointer,
    // and draws exactly those (`.rl-sel`, in the system's selection color); back in the first cell
    // it is text again. Nothing is written. In each of the three views.
    name: 'drag-across-cells-draws-the-rectangle',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const view of ['clean', 'simple', 'redlines'] as const) {
        await load(editor, GRID);
        editor.setViewMode(view);
        await frames();
        await centre(editor, 1, 0);
        // Both measured where they are now: the page is not scrolled between them.
        const from = await centre(editor, 1, 0, false);
        const to = await centre(editor, 2, 1, false);
        await dragFrom(editor, from, to);
        const found = rect(editor);
        if (!found || !same(found.rows, [1, 2]) || !same(found.cols, [0, 1])) {
          problems[`${view}-rect`] = found;
        }
        const drawn = selectedLabels(editor);
        if (!same(drawn, labels([1, 2], [0, 1]))) problems[`${view}-drawn`] = drawn;
        const mark = editor.view.contentDOM.querySelector('.rl-sel');
        if (!mark || !painted(mark.closest('.rl-tc') ?? mark))
          problems[`${view}-color`] = 'the selected cells are not painted';
        if (doc(editor) !== GRID) problems[`${view}-wrote`] = 'a drag wrote something';
        // Back in the first cell: text again, with nothing drawn as cells.
        const inside = { x: from.x + 6, y: from.y };
        await dragFrom(editor, from, inside);
        if (rect(editor) || selectedLabels(editor).length)
          problems[`${view}-text`] = selectedLabels(editor);
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    name: 'shift-press-extends-to-a-rectangle',
    async run(editor) {
      await load(editor, GRID);
      await centre(editor, 1, 0);
      const first = await centre(editor, 1, 0, false);
      pressAt(editor, first.x, first.y);
      await frames();
      const last = await centre(editor, 3, 2, false);
      const down = document.elementFromPoint(last.x, last.y) ?? editor.view.contentDOM;
      const init: MouseEventInit = {
        clientX: last.x,
        clientY: last.y,
        button: 0,
        buttons: 1,
        detail: 1,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      };
      down.dispatchEvent(new MouseEvent('mousedown', init));
      document.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
      await frames();
      const found = rect(editor);
      const drawn = selectedLabels(editor);
      const problems: Record<string, unknown> = {};
      if (!found || !same(found.rows, [1, 3]) || !same(found.cols, [0, 2]))
        problems['rect'] = found;
      if (!same(drawn, labels([1, 3], [0, 2]))) problems['drawn'] = drawn;
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // Shift-arrows: text inside the cell, then, once the end leaves it, cells; then a cell at a time.
    name: 'shift-arrows-make-grow-and-shrink-a-rectangle',
    async run(editor) {
      await load(editor, GRID);
      const cell = cellOf(editor, 1, 0);
      await place(editor, cell.textTo - 1);
      const problems: Record<string, unknown> = {};
      press(editor, 'Shift-ArrowRight');
      await frames();
      if (rect(editor) || selectedLabels(editor).length) problems['in-cell'] = rect(editor);
      press(editor, 'Shift-ArrowRight');
      await frames();
      const steps: [string, [number, number], [number, number]][] = [
        ['Shift-ArrowRight', [1, 1], [0, 2]],
        ['Shift-ArrowDown', [1, 2], [0, 2]],
        ['Shift-ArrowLeft', [1, 2], [0, 1]],
        ['Shift-ArrowUp', [1, 1], [0, 1]],
      ];
      // The first arrow out of the cell made the rectangle of two cells.
      if (!same(rect(editor)?.cols, [0, 1])) problems['made'] = rect(editor);
      if (!same(selectedLabels(editor), labels([1, 1], [0, 1]))) {
        problems['made-drawn'] = selectedLabels(editor);
      }
      for (const [key, rows, cols] of steps) {
        press(editor, key);
        await frames();
        const found = rect(editor);
        const drawn = selectedLabels(editor);
        if (!found || !same(found.rows, rows) || !same(found.cols, cols)) {
          problems[key] = found;
        } else if (!same(drawn, labels(rows, cols))) problems[`${key}-drawn`] = drawn;
      }
      // Esc: a caret in the cell where the selection ended.
      const ended = head(editor);
      press(editor, 'Escape');
      await frames();
      if (
        !editor.view.state.selection.main.empty ||
        head(editor) !== ended ||
        selectedLabels(editor).length
      ) {
        problems['escape'] = { head: head(editor), ended };
      }
      if (doc(editor) !== GRID) problems['wrote'] = 'a key wrote something';
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    name: 'select-row-column-and-table-draw-their-cells',
    async run(editor) {
      await load(editor, GRID);
      await place(editor, cellOf(editor, 2, 1).textFrom);
      const problems: Record<string, unknown> = {};
      const cases: [string, () => boolean, string, string[]][] = [
        ['row', () => editor.commands.run('table.selectRow'), 'row', labels([2, 2], [0, 2])],
        [
          'column',
          () => editor.commands.run('table.selectColumn'),
          'column',
          labels([0, 3], [1, 1]).sort(),
        ],
        ['table', () => editor.commands.run('table.selectTable'), 'table', labels([0, 3], [0, 2])],
        ['ctrl-L', () => press(editor, 'Ctrl-l'), 'row', labels([2, 2], [0, 2])],
      ];
      for (const [name, run, kind, want] of cases) {
        await place(editor, cellOf(editor, 2, 1).textFrom);
        if (!run()) problems[`${name}-ran`] = false;
        await frames();
        const found = rect(editor);
        const drawn = selectedLabels(editor).sort();
        if (found?.whole !== kind) problems[`${name}-kind`] = found;
        if (!same(drawn, [...want].sort())) problems[`${name}-drawn`] = drawn;
      }
      // Select Cell is the cell's text, not a rectangle.
      await place(editor, cellOf(editor, 2, 1).textFrom);
      editor.commands.run('table.selectCell');
      const range = editor.view.state.selection.main;
      const plums = cellOf(editor, 2, 1);
      if (range.from !== plums.textFrom || range.to !== plums.textTo || rect(editor)) {
        problems['cell'] = [range.from, range.to];
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // Copy puts tab-separated text and an HTML table on the pasteboard, never markers; cut also
    // clears the cells, in one step to undo.
    name: 'copy-and-cut-put-tsv-and-an-html-table',
    async run(editor) {
      await load(editor, GRID);
      const a = cellOf(editor, 0, 0);
      const b = cellOf(editor, 2, 2);
      editor.view.dispatch({ selection: EditorSelection.single(a.textFrom, b.textTo) });
      await frames();
      const problems: Record<string, unknown> = {};
      const copied = copyOrCut(editor, 'copy');
      const want = 'Fruit\tCount\tNote\nApples\t3\t**sweet**\nPlums\t4\t"a|b\nx"';
      if (!copied.taken) problems['copy-taken'] = false;
      if (copied.text !== want) problems['copy-text'] = copied.text;
      if (!/<table/.test(copied.html) || !/<th>Fruit<\/th>/.test(copied.html))
        problems['copy-html'] = copied.html;
      if (!/<strong>sweet<\/strong>/.test(copied.html) || /<!--/.test(copied.html))
        problems['copy-format'] = copied.html;
      if (doc(editor) !== GRID) problems['copy-wrote'] = true;
      // Cut: the same on the pasteboard, and the cells are cleared.
      const cut = copyOrCut(editor, 'cut');
      if (cut.text !== want) problems['cut-text'] = cut.text;
      await frames();
      const text = doc(editor);
      const cleared = tablesOf(editor.view.state)[0]
        ?.rows.slice(0, 3)
        .every((row) => row.cells.every((cell) => cell.textFrom === cell.textTo));
      if (!cleared) problems['cut-cleared'] = text;
      if (!text.includes('| Pears | 5 | ok |')) problems['cut-kept-the-rest'] = text;
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A range pasted from the caret goes over the cells rightward and down, and adds the rows it
    // needs; one step to undo.
    name: 'paste-a-range-over-cells-and-add-rows',
    async run(editor) {
      await load(editor, GRID);
      await place(editor, cellOf(editor, 2, 1).textFrom);
      const problems: Record<string, unknown> = {};
      const html = '<table><tr><td>x</td><td>y</td></tr><tr><td>z</td><td>w</td></tr></table>';
      if (!pasteInto(editor, 'x\ty\nz\tw', html)) problems['taken'] = false;
      await frames();
      const want = GRID.replace(
        '| Plums | 4 | a\\|b<br>x |\n| Pears | 5 | ok |',
        '| Plums | x | y |\n| Pears | z | w |',
      );
      if (doc(editor) !== want) problems['doc'] = doc(editor);
      // Rows are added when the range needs more.
      await place(editor, cellOf(editor, 3, 0).textFrom);
      pasteInto(editor, '1\t2\t3\n4\t5\t6');
      await frames();
      const rows = tablesOf(editor.view.state)[0]?.rows.length;
      if (rows !== 5 || !doc(editor).includes('| 4 | 5 | 6 |'))
        problems['grown'] = { rows, doc: doc(editor) };
      // A range wider than the table adds the columns it needs, at the right.
      await place(editor, cellOf(editor, 1, 1).textFrom);
      pasteInto(editor, 'a\tb\tc\td');
      await frames();
      const wide = tablesOf(editor.view.state)[0]?.columns;
      if (wide !== 5 || !doc(editor).includes('| a | b | c | d |'))
        problems['wide'] = { columns: wide, doc: doc(editor) };
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // Tracked, the paste is substitutions and inserted rows: Redlines tints the rows and the cells,
    // Simple draws the bars and no tint; Clean plain.
    name: 'tracked-paste-draws-in-redlines-and-simple',
    async run(editor) {
      await load(editor, GRID, true);
      await place(editor, cellOf(editor, 3, 1).textFrom);
      const problems: Record<string, unknown> = {};
      pasteInto(editor, 'x\ty\nz\tw');
      await frames();
      if (!/<!--ins [a-z0-9]{4} row-->/.test(doc(editor))) problems['row-mark'] = doc(editor);
      if (!/<!--sub /.test(doc(editor))) problems['substitution'] = doc(editor);
      for (const view of ['redlines', 'simple'] as const) {
        editor.setViewMode(view);
        await frames();
        const lines = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line.rl-trow')];
        const bars = lines.filter((line) => line.classList.contains('rl-bar')).length;
        const tinted = lines.filter((line) => line.classList.contains('rl-ins-row'));
        const painted_ = tinted.some((line) => painted(line.querySelector('.rl-tc') ?? line));
        if (bars < 2) problems[`${view}-bars`] = bars;
        if (view === 'redlines' && (!tinted.length || !painted_))
          problems['redlines-tint'] = tinted.length;
        if (view === 'simple' && painted_) problems['simple-tint'] = 'Simple draws a tint';
        // A rectangle draws the same in both.
        editor.view.dispatch({
          selection: EditorSelection.single(
            cellOf(editor, 1, 0).textFrom,
            cellOf(editor, 2, 1).textTo,
          ),
        });
        await frames();
        if (!same(selectedLabels(editor), labels([1, 2], [0, 1]))) {
          problems[`${view}-rect`] = selectedLabels(editor);
        }
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A paste into cells never brings a live marker (design §5.10): tab-separated text, text onto
    // selected cells, an HTML range and Paste as Plain Text, each with a marker in the clipboard.
    name: 'pastes-into-cells-bring-no-marker',
    async run(editor) {
      const marked = 'x<!--ins k3x9-->y<!--/k3x9-->z';
      const problems: Record<string, unknown> = {};
      const live = () => /<!--(?:ins|cmt|del|sub) k3x9/.test(doc(editor));
      await load(editor, GRID);
      await place(editor, cellOf(editor, 2, 1).textFrom);
      pasteInto(editor, `${marked}\tb`);
      if (live() || !doc(editor).includes('| xyz | b |')) problems['range'] = doc(editor);
      await load(editor, GRID);
      editor.view.dispatch({
        selection: EditorSelection.single(
          cellOf(editor, 1, 0).textFrom,
          cellOf(editor, 2, 1).textTo,
        ),
      });
      pasteInto(editor, marked);
      if (live() || (doc(editor).match(/xyz/g) ?? []).length !== 4)
        problems['onto-cells'] = doc(editor);
      await load(editor, GRID);
      editor.view.dispatch({
        selection: EditorSelection.single(
          cellOf(editor, 1, 0).textFrom,
          cellOf(editor, 2, 1).textTo,
        ),
      });
      editor.pastePlain(marked);
      await frames();
      if (live() || (doc(editor).match(/xyz/g) ?? []).length !== 4) problems['plain'] = doc(editor);
      await load(editor, GRID);
      await place(editor, cellOf(editor, 1, 1).textFrom);
      pasteInto(
        editor,
        'a\tb',
        '<table><tr><td>a&lt;!--ins k3x9--&gt;</td><td>b</td></tr></table>',
      );
      if (live()) problems['html'] = doc(editor);
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // An input method composing over selected cells, in the order WebKit sends the events:
    // compositionstart, the document changes and compositionupdates, compositionend. Committed, the
    // text lands in the first cell with its pipe escaped, the other cells are cleared, and one
    // Undo gives every cell back. Never across the pipes between cells.
    name: 'composition-over-cells-commits-into-the-first',
    async run(editor) {
      await load(editor, GRID);
      const problems: Record<string, unknown> = {};
      const a = cellOf(editor, 1, 0);
      const b = cellOf(editor, 2, 1);
      editor.view.dispatch({ selection: EditorSelection.single(a.textFrom, b.textTo) });
      if (!rectOf(editor.view.state)) return { why: 'no rectangle selected' };
      compose(editor, ['¨', 'あ'], 'a|b');
      await settle();
      const rows = tablesOf(editor.view.state)[0]?.rows;
      const shown = rows?.map((row) =>
        row.cells.map((c) => editor.view.state.sliceDoc(c.textFrom, c.textTo)),
      );
      if (!rows || rows.length !== 4 || rows.some((row) => row.cells.length !== 3)) {
        problems['shape'] = shown;
      } else if (shown?.[1]?.[0] !== 'a\\|b' || shown[1][1] !== '' || shown[2]?.[0] !== '') {
        problems['text'] = shown;
      }
      if (!undo(editor.view) || doc(editor) !== GRID) problems['undo'] = doc(editor);
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // The same, cancelled (Esc, or ending with nothing): no change at all, the cells selected again.
    name: 'composition-over-cells-cancelled-changes-nothing',
    async run(editor) {
      await load(editor, GRID);
      const problems: Record<string, unknown> = {};
      for (const steps of [['¨', 'あ'], []]) {
        await load(editor, GRID);
        const a = cellOf(editor, 1, 0);
        const b = cellOf(editor, 2, 1);
        editor.view.dispatch({ selection: EditorSelection.single(a.textFrom, b.textTo) });
        compose(editor, steps, '');
        await settle();
        if (doc(editor) !== GRID) problems[`doc-${steps.length}`] = doc(editor);
        const found = rect(editor);
        if (!found || !same(found.rows, [1, 2]) || !same(found.cols, [0, 1])) {
          problems[`rect-${steps.length}`] = found;
        }
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    name: 'keystroke-cost-in-a-300-row-table',
    async run(editor) {
      const rows = Array.from(
        { length: 300 },
        (_, n) => `| item ${n} | ${n} | place ${n} | the quick brown fox | owner ${n % 9} |`,
      );
      const long = [
        'Intro.',
        '',
        '| Item | Count | Place | Note | Owner |',
        '| ---- | ----- | ----- | ---- | ----- |',
        ...rows,
        '',
        'After.',
      ].join('\n');
      await load(editor, long);
      if (tablesOf(editor.view.state)[0]?.rows.length !== 301)
        return { why: 'the table was not read' };
      const cell = cellOf(editor, 150, 3);
      const pos = cell.textTo;
      editor.view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
      await frames();
      const samples: number[] = [];
      for (let i = 0; i < 60; i++) {
        const start = performance.now();
        editor.view.dispatch({
          changes: { from: pos, insert: 'x' },
          selection: EditorSelection.cursor(pos + 1),
          userEvent: 'input.type',
        });
        samples.push(performance.now() - start);
        editor.view.dispatch({
          changes: { from: pos, to: pos + 1 },
          selection: EditorSelection.cursor(pos),
        });
      }
      const median = [...samples].sort((a, b) => a - b)[samples.length >> 1] ?? Infinity;
      console.log(`TABLE-CHECK keystroke median ${median.toFixed(2)} ms of ${samples.length}`);
      return median < 16 && doc(editor) === long ? null : { median, budget: 16 };
    },
  },
  {
    // The bar of an inserted row, in Simple: the pointer over it widens it to 3 px (the first cell
    // draws a row's bar) and a click on it, which never reaches the row's text, switches the views
    // (`bar-switch.ts`'s `.rl-trow` fallback, which happy-dom cannot reach). A click beside the bar
    // does nothing.
    name: 'bar-click-on-an-inserted-row-switches-views',
    async run(editor) {
      await load(editor, WITH_ROW, false);
      editor.setViewMode('simple');
      await frames();
      const row = [
        ...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line.rl-trow'),
      ].find((line) => line.textContent?.includes('Pears'));
      const cell = row?.querySelector<HTMLElement>(':scope > .rl-tc');
      if (!row || !cell) return { why: 'no inserted row drawn' };
      if (!row.classList.contains('rl-bar'))
        return { why: 'the row has no bar', row: row.className };
      const box = await reveal(cell);
      const x = box.left - 23;
      const y = box.top + box.height / 2;
      const mouse = (type: string, px: number) =>
        new MouseEvent(type, { clientX: px, clientY: y, button: 0, detail: 1, bubbles: true });
      const problems: Record<string, unknown> = {};
      editor.view.scrollDOM.dispatchEvent(mouse('mousemove', x));
      await frames();
      const width = getComputedStyle(cell, '::before').width;
      if (!row.classList.contains('rl-bar-hot') || width !== '3px') {
        problems['hot'] = { hot: row.classList.contains('rl-bar-hot'), width };
      }
      editor.view.scrollDOM.dispatchEvent(mouse('mousedown', x));
      document.dispatchEvent(mouse('mouseup', x));
      await frames();
      if (editor.getUiState().view !== 'redlines') problems['switched'] = editor.getUiState().view;
      // Beside the bar: nothing.
      editor.setViewMode('simple');
      await frames();
      editor.view.scrollDOM.dispatchEvent(mouse('mousedown', x + 60));
      document.dispatchEvent(mouse('mouseup', x + 60));
      if (editor.getUiState().view !== 'simple') problems['beside'] = editor.getUiState().view;
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // The plan's table (`longDocument({ table: true })`): 300 rows of 5 columns, 40 pending
    // insertions in its cells and a ledger, typed in with Track Changes on at one place, the text
    // of a cell in row 150 (the view is Clean, as in every check here: the drawing of the marks is
    // checked elsewhere). The table layer must not make a keystroke slower than the spec's budget,
    // 16 ms, where WebKit measures about 2 ms (a timer of 1 ms).
    name: 'keystroke-cost-in-a-300-row-table-with-40-marks',
    async run(editor) {
      const rest = 'bcdfghjkmnpqrstvwxz23456789';
      const idFor = (n: number) =>
        `b${rest[Math.floor(n / 27) % 27]}${rest[n % 27]}${rest[(n * 7) % 27]}`;
      const ids = Array.from({ length: 40 }, (_, i) => idFor(i + 1));
      if (new Set(ids).size !== 40) return { why: 'the ids are not distinct' };
      const rows = Array.from({ length: 300 }, (_, n) => {
        const k = Math.floor((n * 40) / 300);
        const marked = Math.floor(((n + 1) * 40) / 300) > k;
        const note = marked
          ? `the quick brown fox <!--ins ${ids[k]}-->added<!--/${ids[k]}-->`
          : 'the quick brown fox';
        return `| item ${n} | ${n} | place ${n} | ${note} | owner ${n % 9} |`;
      });
      const entries = ids.map((id) => `  ${id}: {by: ada, at: 2026-10-31T09:30Z}\n`).join('');
      const long = [
        'Intro.',
        '',
        '| Item | Count | Place | Note | Owner |',
        '| ---- | ----- | ----- | ---- | ----- |',
        ...rows,
        '',
        'After.',
        '',
        `<!-- redlines\nversion: 1\nmarks:\n${entries}-->\n`,
      ].join('\n');
      await load(editor, long, true);
      const table = tablesOf(editor.view.state)[0];
      if (table?.rows.length !== 301) return { why: 'the table was not read' };
      const pos = cellOf(editor, 150, 0).textTo;
      editor.view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
      await frames();
      const samples: number[] = [];
      for (let i = 0; i < 60; i++) {
        const start = performance.now();
        editor.view.dispatch({
          changes: { from: pos, insert: 'x' },
          selection: EditorSelection.cursor(pos + 1),
          userEvent: 'input.type',
        });
        samples.push(performance.now() - start);
        editor.view.dispatch({
          changes: { from: pos, to: pos + 1 },
          selection: EditorSelection.cursor(pos),
          userEvent: 'delete.backward',
        });
      }
      const median = [...samples].sort((a, b) => a - b)[samples.length >> 1] ?? Infinity;
      console.log(`TABLE-CHECK keystroke with marks median ${median.toFixed(2)} ms`);
      return median < 16 ? null : { median, budget: 16 };
    },
  },
  {
    // A deleted row is a ghost at its place in Redlines, lined up with the real rows to the pixel,
    // struck in the author's color; Clean and Simple draw none. The deletion line stays hidden.
    name: 'deleted-row-is-a-ghost-in-redlines-and-none-in-simple',
    async run(editor) {
      await load(editor, ROWS, true);
      await place(editor, cellOf(editor, 2, 1).textFrom);
      const problems: Record<string, unknown> = {};
      if (!editor.commands.run('table.deleteRow')) return { why: 'Delete Row did nothing' };
      await frames();
      if (!/<!--del [a-z0-9]{4} row=2 /.test(doc(editor))) problems['deletion'] = doc(editor);
      editor.setViewMode('redlines');
      await frames();
      const [ghost] = ghostElements(editor);
      if (ghostElements(editor).length !== 1 || !ghost)
        return { ...problems, ghosts: ghostElements(editor).length };
      const real = cellElements(editor)[1] ?? [];
      const ghostCells = [...ghost.querySelectorAll<HTMLElement>(':scope > .rl-tc')];
      const offsets = ghostCells.map((cell, i) =>
        Math.abs(
          cell.getBoundingClientRect().left - (real[i]?.getBoundingClientRect().left ?? -1e6),
        ),
      );
      if (ghostCells.length !== 3 || offsets.some((o) => o > 0.5))
        problems['ghost-lines-up'] = offsets;
      const above = lineElements(editor)[1]?.getBoundingClientRect();
      const below = lineElements(editor)[2]?.getBoundingClientRect();
      const box = ghost.getBoundingClientRect();
      if (!above || !below || box.top < above.bottom - 1 || box.bottom > below.top + 1)
        problems['ghost-place'] = [above, box, below].map((b) => b?.top);
      const struck = ghost.querySelector('.rl-del');
      if (!struck || !getComputedStyle(struck).textDecorationLine.includes('line-through'))
        problems['struck'] = 'no line-through';
      if (!painted(ghostCells[0] ?? ghost)) problems['tint'] = 'no tint';
      if (!ghost.classList.contains('rl-bar')) problems['bar'] = 'no change bar';
      if (editor.view.contentDOM.textContent?.includes('<!--del'))
        problems['hidden'] = 'the deletion line shows';
      for (const view of ['simple', 'clean'] as const) {
        editor.setViewMode(view);
        await frames();
        if (ghostElements(editor).length) problems[`${view}-ghost`] = ghostElements(editor).length;
        if (editor.view.contentDOM.textContent?.includes('Plums'))
          problems[`${view}-text`] = 'the deleted row shows';
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A moved row: double underline and tint at the new place, a ghost with a double strikethrough at
    // the old; Simple draws the bar and no tint; the arrows skip the ghost.
    name: 'moved-row-draws-double-marks-and-the-arrows-skip-ghosts',
    async run(editor) {
      await load(editor, ROWS, true);
      await place(editor, cellOf(editor, 1, 0).textFrom);
      const problems: Record<string, unknown> = {};
      if (!editor.commands.run('table.moveRowDown')) return { why: 'Move Row Down did nothing' };
      await frames();
      if (
        !/<!--ins [a-z0-9]{4} row-->/.test(doc(editor)) ||
        !/<!--del [a-z0-9]{4} row=/.test(doc(editor))
      )
        problems['marks'] = doc(editor);
      editor.setViewMode('redlines');
      await frames();
      const moved = lineElements(editor).filter((line) => line.classList.contains('rl-moved-row'));
      const [ghost] = ghostElements(editor);
      if (moved.length !== 1) problems['moved-row'] = moved.length;
      if (!ghost?.classList.contains('rl-ghost-moved'))
        problems['ghost-moved'] = ghostElements(editor).length;
      const underline = moved[0]?.querySelector('.rl-tc');
      if (!underline || getComputedStyle(underline).textDecorationStyle !== 'double')
        problems['double-underline'] = underline && getComputedStyle(underline).textDecorationStyle;
      const strike = ghost?.querySelector('.rl-del');
      if (!strike || getComputedStyle(strike).textDecorationStyle !== 'double')
        problems['double-strike'] = strike && getComputedStyle(strike).textDecorationStyle;
      // ↓ from the row above the ghost goes to the row below it, ↑ back: the ghost has no caret.
      const lines = lineElements(editor);
      const ghostBox = ghost?.getBoundingClientRect();
      const before = lines.findLast(
        (line) => ghostBox && line.getBoundingClientRect().bottom <= ghostBox.top + 1,
      );
      if (before) {
        const row = lines.indexOf(before);
        await place(editor, cellOf(editor, row, 0).textFrom);
        press(editor, 'ArrowDown');
        await frames();
        const at = table(editor).rows.findIndex((r) =>
          r.cells.some((c) => inText(c, head(editor))),
        );
        if (at !== row + 1) problems['down-skips-ghost'] = { row, at };
        press(editor, 'ArrowUp');
        await frames();
        const back = table(editor).rows.findIndex((r) =>
          r.cells.some((c) => inText(c, head(editor))),
        );
        if (back !== row) problems['up-skips-ghost'] = { row, back };
      } else problems['no-row-above-ghost'] = true;
      editor.setViewMode('simple');
      await frames();
      const simple = lineElements(editor);
      if (ghostElements(editor).length) problems['simple-ghost'] = ghostElements(editor).length;
      if (
        simple.some(
          (line) =>
            line.classList.contains('rl-ins-row') || line.classList.contains('rl-moved-row'),
        )
      )
        problems['simple-look'] = 'tinted';
      if (!simple.some((line) => line.classList.contains('rl-bar')))
        problems['simple-bars'] = 'none';
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // The grip shows beside the hovered row, left of the bars and inside the window, in Redlines and
    // Simple; a press selects the row and opens the menu, whose Delete Row deletes it.
    name: 'row-grip-and-its-menu',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const view of ['redlines', 'simple'] as const) {
        await load(editor, ROWS, true);
        editor.setViewMode(view);
        await frames();
        const grip = await gripOf(editor, 2);
        if (!grip) return { ...problems, [`${view}-grip`]: 'none shows' };
        const box = grip.getBoundingClientRect();
        const line = lineElements(editor)[2]?.getBoundingClientRect();
        if (box.left < 0) problems[`${view}-off-window`] = box.left;
        // Left of the bars; where the window has no room for that, at its edge and clear of the text.
        if (line && !(box.right <= line.left - 24 || (box.left >= 3.5 && box.right <= line.left)))
          problems[`${view}-over-bars`] = [box.left, box.right, line.left];
        if (line && (box.bottom < line.top || box.top > line.bottom))
          problems[`${view}-beside-row`] = [box.top, line.top];
        if (editor.view.dom.querySelector('.rl-grips')?.getAttribute('aria-hidden') !== 'true')
          problems[`${view}-aria`] = 'not hidden';
        mouse(grip, 'mousedown', box.left + 3, box.top + 3);
        mouse(window, 'mouseup', box.left + 3, box.top + 3);
        await frames();
        const items = [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-grip-item')];
        if (
          items.map((i) => i.textContent).join('|') !==
          'Insert Row Above|Insert Row Below|Delete Row|Delete Table|Move Row Up|Move Row Down|Clear Contents'
        )
          problems[`${view}-items`] = items.map((i) => i.textContent);
        const selected = rectOf(editor.view.state);
        if (!selected || selected.rows[0] !== 2 || selected.rows[1] !== 2)
          problems[`${view}-selected`] = selected && selected.rows;
        const size = Math.min(...items.map((i) => parseFloat(getComputedStyle(i).fontSize)));
        if (!(size >= 13)) problems[`${view}-menu-size`] = size;
        const del = items.find((i) => i.textContent === 'Delete Row');
        if (!del) return { ...problems, [`${view}-menu`]: 'no Delete Row' };
        mouse(del, 'mousedown', 0, 0);
        await frames();
        if (!/<!--del [a-z0-9]{4} row=2 /.test(doc(editor)))
          problems[`${view}-delete`] = doc(editor);
        if (editor.view.dom.querySelector('.rl-grip-menu'))
          problems[`${view}-menu-open`] = 'still open';
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A + appears within 8 px of a row boundary in the strip beside the table and not at 9, with a
    // line across the table; a press inserts one row there (tracked: a marked row).
    name: 'plus-between-rows-inserts-a-row',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const view of ['redlines', 'simple'] as const) {
        await load(editor, ROWS, true);
        editor.setViewMode(view);
        await frames();
        const lines = lineElements(editor);
        const target = lines[2];
        if (!target) return { why: 'no row drawn' };
        const box = await reveal(target);
        const x = box.left - 20;
        hover(editor, x, box.top + 9);
        await frames();
        if (editor.view.dom.querySelector('.rl-plus'))
          problems[`${view}-at-9`] = 'a + shows 9 px away';
        hover(editor, x, box.top + 8);
        await frames();
        const plus = editor.view.dom.querySelector<HTMLElement>('.rl-plus');
        if (!plus) return { ...problems, [`${view}-plus`]: 'none shows within 8 px' };
        if (plus.dataset['boundary'] !== '2')
          problems[`${view}-boundary`] = plus.dataset['boundary'];
        if (!editor.view.dom.querySelector('.rl-plus-line')) problems[`${view}-line`] = 'no line';
        const rows = table(editor).rows.length;
        mouse(plus, 'mousedown', 0, 0);
        await frames();
        if (table(editor).rows.length !== rows + 1)
          problems[`${view}-inserted`] = table(editor).rows.length;
        if (!/<!--ins [a-z0-9]{4} row-->/.test(doc(editor)))
          problems[`${view}-marked`] = doc(editor);
        const newRow = table(editor).rows[2];
        if (!newRow || doc(editor).slice(newRow.from, newRow.to).includes('Plums'))
          problems[`${view}-place`] = 'not before Plums';
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A drag on a grip moves the row to the boundary under the pointer, the last included; the rows
    // dim and a drop line shows while it goes; Esc cancels and writes nothing.
    name: 'dragging-a-row-grip-moves-the-row',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const view of ['redlines', 'simple'] as const) {
        await load(editor, ROWS, false);
        editor.setViewMode(view);
        await frames();
        const grip = await gripOf(editor, 1);
        if (!grip) return { ...problems, [`${view}-grip`]: 'none shows' };
        const g = grip.getBoundingClientRect();
        const lines = lineElements(editor);
        const lastBox = lines.at(-1)?.getBoundingClientRect();
        if (!lastBox) return { why: 'no rows' };
        const start = { x: g.left + 3, y: g.top + 3 };
        mouse(grip, 'mousedown', start.x, start.y);
        hover(editor, start.x, start.y + 10);
        hover(editor, start.x + 10, bottomNow(editor) + 2);
        await frames();
        if (!editor.view.dom.querySelector('.rl-drop-line')) problems[`${view}-drop-line`] = 'none';
        if (!editor.view.dom.querySelector('.rl-drag-copy')) problems[`${view}-copy`] = 'none';
        if (!lineElements(editor)[1]?.classList.contains('rl-row-dim'))
          problems[`${view}-dim`] = 'not dimmed';
        const line = editor.view.dom
          .querySelector<HTMLElement>('.rl-drop-line')
          ?.getBoundingClientRect();
        const dropData = {
          ...editor.view.dom.querySelector<HTMLElement>('.rl-drop-line')?.dataset,
        };
        if (line && Math.abs(line.top - lastBox.bottom) > 3)
          problems[`${view}-line-at`] = [line.top, lastBox.bottom, dropData];
        // Esc cancels, and nothing is written.
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        mouse(window, 'mouseup', start.x + 10, bottomNow(editor) + 2);
        await frames();
        if (doc(editor) !== ROWS) problems[`${view}-esc`] = doc(editor);
        // Dropped after the last row, Apples is the last row.
        const again = await gripOf(editor, 1);
        if (!again) return { ...problems, [`${view}-grip-again`]: 'none shows' };
        const a = again.getBoundingClientRect();
        mouse(again, 'mousedown', a.left + 3, a.top + 3);
        hover(editor, a.left + 3, a.top + 14);
        hover(editor, a.left + 10, bottomNow(editor) + 2);
        mouse(window, 'mouseup', a.left + 10, bottomNow(editor) + 2);
        await frames();
        if (firstColumn(editor).join() !== 'Fruit,Plums,Pears,Apples')
          problems[`${view}-moved`] = {
            rows: firstColumn(editor),
            drop: dropData,
            pointerY: bottomNow(editor) + 2,
          };
        // The drag of three rows selected with it moves all three.
        await load(editor, ROWS, false);
        editor.setViewMode(view);
        await frames();
        editor.view.dispatch({
          selection: EditorSelection.single(
            cellOf(editor, 1, 0).textFrom,
            cellOf(editor, 2, 2).textTo,
          ),
        });
        await frames();
        const three = await gripOf(editor, 1);
        if (!three) return { ...problems, [`${view}-grip-rows`]: 'none shows' };
        const t = three.getBoundingClientRect();
        const bottom = lineElements(editor).at(-1)?.getBoundingClientRect();
        if (!bottom) return { why: 'no rows' };
        mouse(three, 'mousedown', t.left + 3, t.top + 3);
        hover(editor, t.left + 3, t.top + 14);
        hover(editor, t.left + 10, bottomNow(editor) + 2);
        mouse(window, 'mouseup', t.left + 10, bottomNow(editor) + 2);
        await frames();
        if (firstColumn(editor).join() !== 'Fruit,Pears,Apples,Plums')
          problems[`${view}-moved-many`] = firstColumn(editor);
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A cell whose text fits does not wrap (the columns' widths are measured, and WebKit lays text
    // out wider than a canvas measures it), and a selected row keeps its height: a row that grows
    // when it is selected moves every boundary under the pointer. The widths are in the failure.
    name: 'fitting-cells-do-not-wrap-and-a-selected-row-keeps-its-height',
    async run(editor) {
      await load(editor, ROWS);
      const problems: Record<string, unknown> = {};
      const lines = () => lineElements(editor);
      const heights = () =>
        lines().map((line) => Math.round(line.getBoundingClientRect().height * 10) / 10);
      const lineCount = (cell: HTMLElement) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return new Set(
          [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
        ).size;
      };
      const widths: unknown[] = [];
      const rows = cellElements(editor);
      rows.forEach((cells, r) =>
        cells.forEach((cell, c) => {
          const text = cell.textContent?.replace(/[\u200b]/g, '') ?? '';
          const wide = cell.getBoundingClientRect().width;
          const natural = (() => {
            const probe = document.createElement('span');
            probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
            probe.textContent = text;
            cell.append(probe);
            const w = probe.getBoundingClientRect().width;
            probe.remove();
            return w;
          })();
          widths.push([r, c, Math.round(wide), Math.round(natural)]);
          if (!text.includes('\n') && lineCount(cell) > 1)
            problems[`wraps-${r}-${c}`] = { text, cell: wide, natural };
        }),
      );
      const before = heights();
      for (let r = 0; r < before.length; r++) {
        editor.view.dispatch({ selection: EditorSelection.cursor(cellOf(editor, r, 0).textFrom) });
        await frames();
        editor.commands.run('table.selectRow');
        await frames();
        const after = heights();
        if (!same(after, before)) problems[`selected-row-${r}`] = { before, after };
        const tops = new Set(
          (cellElements(editor)[r] ?? []).map((cell) =>
            Math.round(cell.getBoundingClientRect().top),
          ),
        );
        if (tops.size !== 1) problems[`cells-not-level-${r}`] = [...tops];
      }
      if (Object.keys(problems).length) problems['widths'] = widths;
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // An inserted column: its cells in every row have the author's tint and an underline and a bar
    // on every row in Redlines; Simple draws the bars and no tint or underline; Clean draws none;
    // the columns line up in every row to the pixel; the caret is in the new column, in its row.
    name: 'inserted-column-is-tinted-in-redlines-and-bars-in-simple',
    async run(editor) {
      await load(editor, ROWS, true);
      await place(editor, cellOf(editor, 1, 1).textFrom);
      const problems: Record<string, unknown> = {};
      if (!editor.commands.run('table.insertColumnRight'))
        return { why: 'Insert Column Right did nothing' };
      await frames();
      if (!/<!--ins [a-z0-9]{4} col-->/.test(doc(editor))) problems['marker'] = doc(editor);
      if (table(editor).columns !== 4) problems['columns'] = table(editor).columns;
      if (!inText(cellOf(editor, 1, 2), head(editor))) problems['caret'] = head(editor);
      editor.setViewMode('redlines');
      await frames();
      const rows = cellElements(editor);
      const fresh = rows.map((row) => row[2]);
      if (fresh.some((cell) => !cell?.classList.contains('rl-ins-col')))
        problems['cells'] = fresh.map((cell) => cell?.className);
      for (const cell of fresh) {
        if (!cell) continue;
        if (!painted(cell)) problems['tint'] = 'a cell has no tint';
        if (!getComputedStyle(cell).textDecorationLine.includes('underline'))
          problems['underline'] = getComputedStyle(cell).textDecorationLine;
      }
      if (lineElements(editor).some((line) => !line.classList.contains('rl-bar')))
        problems['bars'] = lineElements(editor).map((line) => line.classList.contains('rl-bar'));
      const aligned = linedUp(editor);
      if (aligned.off > 0.5) problems['lines-up'] = aligned;
      editor.setViewMode('simple');
      await frames();
      if (
        cellElements(editor).some((row) =>
          row.some((cell) => cell.classList.contains('rl-ins-col')),
        )
      )
        problems['simple-look'] = 'a cell is marked';
      if (cellElements(editor).some((row) => row.some((cell) => painted(cell))))
        problems['simple-tint'] = 'a cell is painted';
      if (lineElements(editor).some((line) => !line.classList.contains('rl-bar')))
        problems['simple-bars'] = 'a row has no bar';
      editor.setViewMode('clean');
      await frames();
      if (lineElements(editor).some((line) => line.classList.contains('rl-bar')))
        problems['clean-bars'] = 'a row has a bar';
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A deleted column is a ghost cell in every row in Redlines, lined up with the real cells to the
    // pixel, between its neighbors, struck and tinted; Clean and Simple draw none, Simple the bars.
    name: 'deleted-column-is-a-ghost-in-every-row',
    async run(editor) {
      await load(editor, ROWS, true);
      await place(editor, cellOf(editor, 1, 1).textFrom);
      const problems: Record<string, unknown> = {};
      if (!editor.commands.run('table.deleteColumn')) return { why: 'Delete Column did nothing' };
      await frames();
      if (!/<!--del [a-z0-9]{4} col=2 /.test(doc(editor))) problems['deletion'] = doc(editor);
      editor.setViewMode('redlines');
      await frames();
      const ghosts = ghostCols(editor);
      if (ghosts.length !== 4) return { ...problems, ghosts: ghosts.length };
      const aligned = linedUp(editor);
      if (aligned.off > 0.5 || aligned.cells.some((n) => n !== 3)) problems['lines-up'] = aligned;
      for (const row of cellElements(editor)) {
        const at = row.findIndex((cell) => cell.classList.contains('rl-ghost-col'));
        if (at !== 1) problems['place'] = row.map((cell) => cell.className);
      }
      const struck = ghosts[1]?.querySelector('.rl-del');
      if (!struck || !getComputedStyle(struck).textDecorationLine.includes('line-through'))
        problems['struck'] = 'no line-through';
      if (!painted(ghosts[1] ?? editor.view.dom)) problems['tint'] = 'no tint';
      if (editor.view.contentDOM.textContent?.includes('<!--del'))
        problems['hidden'] = 'the deletion line shows';
      if (ghosts.map((g) => g.textContent).join('|') !== 'Count|3|4|5')
        problems['ghost-text'] = ghosts.map((g) => g.textContent);
      editor.setViewMode('simple');
      await frames();
      if (ghostCols(editor).length) problems['simple-ghost'] = ghostCols(editor).length;
      if (cellElements(editor).some((row) => row.length !== 2))
        problems['simple-cells'] = 'a ghost';
      if (lineElements(editor).some((line) => !line.classList.contains('rl-bar')))
        problems['simple-bars'] = 'a row has no bar';
      editor.setViewMode('clean');
      await frames();
      if (editor.view.contentDOM.textContent?.includes('Count'))
        problems['clean-text'] = 'the deleted column shows';
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A moved column: a double underline and the tint at the new place, a ghost with a double
    // strikethrough at the old; the arrows step over the ghost; Simple draws the bars and no tint.
    name: 'moved-column-draws-double-marks-and-the-arrows-skip-ghosts',
    async run(editor) {
      await load(editor, ROWS, true);
      await place(editor, cellOf(editor, 1, 0).textFrom);
      const problems: Record<string, unknown> = {};
      if (!editor.commands.run('table.moveColumnRight'))
        return { why: 'Move Column Right did nothing' };
      await frames();
      if (
        !/<!--ins [a-z0-9]{4} col-->/.test(doc(editor)) ||
        !/<!--del [a-z0-9]{4} col=/.test(doc(editor))
      )
        problems['marks'] = doc(editor);
      editor.setViewMode('redlines');
      await frames();
      const moved = cellElements(editor).map((row) =>
        row.find((c) => c.classList.contains('rl-moved-col')),
      );
      if (moved.some((cell) => !cell)) problems['moved-cells'] = moved.map((c) => c?.className);
      const underline = moved[0];
      if (!underline || getComputedStyle(underline).textDecorationStyle !== 'double')
        problems['double-underline'] = underline && getComputedStyle(underline).textDecorationStyle;
      const ghosts = ghostCols(editor);
      const strike = ghosts[0]?.querySelector('.rl-del');
      if (ghosts.length !== 4 || !ghosts[0]?.classList.contains('rl-ghost-moved'))
        problems['ghosts'] = ghosts.length;
      if (!strike || getComputedStyle(strike).textDecorationStyle !== 'double')
        problems['double-strike'] = strike && getComputedStyle(strike).textDecorationStyle;
      const aligned = linedUp(editor);
      if (aligned.off > 0.5) problems['lines-up'] = aligned;
      // → from the end of the first real cell goes into the next real cell, over the ghost.
      await place(editor, cellOf(editor, 1, 0).textTo);
      press(editor, 'ArrowRight');
      await frames();
      if (!inText(cellOf(editor, 1, 1), head(editor))) problems['right-skips-ghost'] = head(editor);
      press(editor, 'ArrowLeft');
      await frames();
      if (!inText(cellOf(editor, 1, 0), head(editor))) problems['left-skips-ghost'] = head(editor);
      editor.setViewMode('simple');
      await frames();
      if (ghostCols(editor).length) problems['simple-ghost'] = ghostCols(editor).length;
      if (cellElements(editor).some((row) => row.some((c) => painted(c))))
        problems['simple-look'] = 'tinted';
      if (lineElements(editor).some((line) => !line.classList.contains('rl-bar')))
        problems['simple-bars'] = 'none';
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // The column grip shows above the hovered column, in the strip above the table and inside the
    // window, in Redlines and Simple; a press selects the column and opens the menu, whose Delete
    // Column deletes it.
    name: 'column-grip-and-its-menu',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const view of ['redlines', 'simple'] as const) {
        await load(editor, ROWS, true);
        editor.setViewMode(view);
        await frames();
        const grip = await colGripOf(editor, 1);
        if (!grip) return { ...problems, [`${view}-grip`]: 'none shows' };
        const box = grip.getBoundingClientRect();
        const header = cellElements(editor)[0]?.find((c) => c.dataset['col'] === '1');
        const cell = header?.getBoundingClientRect();
        const top = Math.min(...lineElements(editor).map((l) => l.getBoundingClientRect().top));
        if (box.top < 0) problems[`${view}-off-window`] = box.top;
        if (cell && (box.right < cell.left || box.left > cell.right))
          problems[`${view}-over-column`] = [box.left, box.right, cell.left, cell.right];
        if (!(box.bottom <= top + 1 && box.top >= top - 30))
          problems[`${view}-strip`] = [box.top, box.bottom, top];
        if (editor.view.dom.querySelector('.rl-grips')?.getAttribute('aria-hidden') !== 'true')
          problems[`${view}-aria`] = 'not hidden';
        mouse(grip, 'mousedown', box.left + 3, box.top + 3);
        mouse(window, 'mouseup', box.left + 3, box.top + 3);
        await frames();
        const items = [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-grip-item')];
        if (
          items.map((i) => i.textContent).join('|') !==
          'Insert Column Left|Insert Column Right|Delete Column|Delete Table|Move Column Left|Move Column Right|Align Left|Align Center|Align Right|Default Alignment|Clear Contents'
        )
          problems[`${view}-items`] = items.map((i) => i.textContent);
        const selected = touchedCols(editor.view.state);
        if (!selected || selected.first !== 1 || selected.last !== 1)
          problems[`${view}-selected`] = selected && [selected.first, selected.last];
        const size = Math.min(...items.map((i) => parseFloat(getComputedStyle(i).fontSize)));
        if (!(size >= 13)) problems[`${view}-menu-size`] = size;
        const del = items.find((i) => i.textContent === 'Delete Column');
        if (!del) return { ...problems, [`${view}-menu`]: 'no Delete Column' };
        mouse(del, 'mousedown', 0, 0);
        await frames();
        if (!/<!--del [a-z0-9]{4} col=2 /.test(doc(editor)))
          problems[`${view}-delete`] = doc(editor);
        if (editor.view.dom.querySelector('.rl-grip-menu'))
          problems[`${view}-menu-open`] = 'still open';
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A + appears within 8 px of a column boundary in the strip above the table and not at 9, with a
    // line down the table; a press inserts one column there (tracked: a marked column).
    name: 'plus-between-columns-inserts-a-column',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const view of ['redlines', 'simple'] as const) {
        await load(editor, ROWS, true);
        editor.setViewMode(view);
        await frames();
        const cells = headerCells(editor);
        const second = cells[1];
        if (!second) return { why: 'no header drawn' };
        const box = await reveal(second);
        const y = box.top - 10;
        hover(editor, box.left + 9, y);
        await frames();
        if (editor.view.dom.querySelector('.rl-col-plus'))
          problems[`${view}-at-9`] = 'a + shows 9 px away';
        hover(editor, box.left + 8, y);
        await frames();
        const plus = editor.view.dom.querySelector<HTMLElement>('.rl-col-plus');
        if (!plus) return { ...problems, [`${view}-plus`]: 'none shows within 8 px' };
        if (plus.dataset['boundary'] !== '1')
          problems[`${view}-boundary`] = plus.dataset['boundary'];
        if (!editor.view.dom.querySelector('.rl-col-plus-line'))
          problems[`${view}-line`] = 'no line';
        const columns = table(editor).columns;
        mouse(plus, 'mousedown', 0, 0);
        await frames();
        if (table(editor).columns !== columns + 1)
          problems[`${view}-inserted`] = table(editor).columns;
        if (!/<!--ins [a-z0-9]{4} col-->/.test(doc(editor)))
          problems[`${view}-marked`] = doc(editor);
        const header = doc(editor).slice(table(editor).rows[0]?.from, table(editor).rows[0]?.to);
        if (!/Fruit \|.*col-->.*\| Count/.test(header)) problems[`${view}-place`] = header;
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A drag on a column grip moves the column to the boundary under the pointer, the last included;
    // the column dims and a vertical drop line shows while it goes; Esc cancels and writes nothing.
    name: 'dragging-a-column-grip-moves-the-column',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      const headerText = () =>
        table(editor)
          .rows[0]?.cells.map((c) => editor.view.state.doc.sliceString(c.textFrom, c.textTo))
          .join(',');
      for (const view of ['redlines', 'simple'] as const) {
        await load(editor, ROWS, false);
        editor.setViewMode(view);
        await frames();
        const grip = await colGripOf(editor, 0);
        if (!grip) return { ...problems, [`${view}-grip`]: 'none shows' };
        const g = grip.getBoundingClientRect();
        const start = { x: g.left + 3, y: g.top + 3 };
        const edge = () => (headerCells(editor).at(-1)?.getBoundingClientRect().right ?? 0) - 2;
        mouse(grip, 'mousedown', start.x, start.y);
        hover(editor, start.x + 10, start.y);
        hover(editor, edge(), start.y);
        await frames();
        const line = editor.view.dom.querySelector<HTMLElement>('.rl-drop-line');
        if (!line) problems[`${view}-drop-line`] = 'none';
        if (!editor.view.dom.querySelector('.rl-drag-copy')) problems[`${view}-copy`] = 'none';
        if (!editor.view.dom.querySelector('.rl-row-dim')) problems[`${view}-dim`] = 'not dimmed';
        const last = headerCells(editor).at(-1)?.getBoundingClientRect();
        const at = line?.getBoundingClientRect();
        if (at && last && Math.abs(at.left - last.right) > 3)
          problems[`${view}-line-at`] = [at.left, last.right];
        // Esc cancels, and nothing is written.
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        mouse(window, 'mouseup', edge(), start.y);
        await frames();
        if (doc(editor) !== ROWS) problems[`${view}-esc`] = doc(editor);
        const again = await colGripOf(editor, 0);
        if (!again) return { ...problems, [`${view}-grip-again`]: 'none shows' };
        const a = again.getBoundingClientRect();
        mouse(again, 'mousedown', a.left + 3, a.top + 3);
        hover(editor, a.left + 13, a.top + 3);
        hover(editor, edge(), a.top + 3);
        mouse(window, 'mouseup', edge(), a.top + 3);
        await frames();
        if (headerText() !== 'Count,Note,Fruit') problems[`${view}-moved`] = headerText();
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // The widths hold: typing in a cell, with the caret in the table, leaves every column where it
    // is, also after a column was inserted (the table's structure changed, and its widths were found
    // again before the caret rested); and the columns line up in every row.
    name: 'column-widths-are-held-while-the-caret-is-in-the-table',
    async run(editor) {
      await load(editor, ROWS, true);
      await place(editor, cellOf(editor, 1, 1).textFrom);
      const problems: Record<string, unknown> = {};
      if (!editor.commands.run('table.insertColumnLeft'))
        return { why: 'Insert Column Left did nothing' };
      await frames();
      editor.setViewMode('redlines');
      await frames();
      // The edges are taken from the table's own box: a table wider than its room scrolls sideways
      // (WebKit scrolls it to the caret as typing goes), and then every edge moves by the scroll.
      const wrapper = () => editor.view.contentDOM.querySelector<HTMLElement>('.rl-tbl');
      const scrollers = () => {
        const found: { name: string; el: HTMLElement }[] = [];
        for (let el = wrapper()?.parentElement ?? null; el; el = el.parentElement) {
          found.push({ name: `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60), el });
        }
        return found;
      };
      const snapshot = () => ({
        edges: headerCells(editor).map(
          (cell) =>
            Math.round(
              (cell.getBoundingClientRect().left - (wrapper()?.getBoundingClientRect().left ?? 0)) *
                10,
            ) / 10,
        ),
        wrapperLeft: Math.round((wrapper()?.getBoundingClientRect().left ?? 0) * 10) / 10,
        scrolls: scrollers().map(({ name, el }) => ({ name, left: el.scrollLeft })),
      });
      const before = snapshot();
      if (before.edges.length !== 4) return { why: 'the column was not drawn', before };
      for (let i = 0; i < 6; i++) {
        editor.view.dispatch({
          changes: { from: head(editor), insert: 'wide words go here ' },
          selection: EditorSelection.cursor(head(editor) + 19),
          userEvent: 'input.type',
        });
        await frames();
      }
      const after = snapshot();
      if (before.edges.some((left, i) => Math.abs(left - (after.edges[i] ?? -1e6)) > 0.5))
        problems['moved'] = { before, after };
      // The table's left edge holds, unless a box around it scrolled sideways to the caret (that is
      // the page doing its work); otherwise the failure names what took the room: the boxes around
      // it, their padding, overflow and scroll.
      const scrolledNow = after.scrolls.some((s, i) => s.left !== before.scrolls[i]?.left);
      if (Math.abs(before.wrapperLeft - after.wrapperLeft) > 0.5 && !scrolledNow) {
        problems['table-left'] = {
          before: before.wrapperLeft,
          after: after.wrapperLeft,
          scrolled: after.scrolls.filter((s, i) => s.left !== before.scrolls[i]?.left),
          boxes: scrollers().map(({ name, el }) => ({
            name,
            left: Math.round(el.getBoundingClientRect().left * 10) / 10,
            width: Math.round(el.getBoundingClientRect().width * 10) / 10,
            paddingLeft: getComputedStyle(el).paddingLeft,
            overflowX: getComputedStyle(el).overflowX,
            scrollbar: el.offsetWidth - el.clientWidth,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          })),
        };
      }
      const aligned = linedUp(editor);
      if (aligned.off > 0.5) problems['lines-up'] = aligned;
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // Align Center from the Table menu's command with Track Changes off: the delimiter row alone, the
    // new alignment in every row of the column in Clean, Simple and Redlines, no marker, no bar, no
    // underline; the columns still line up.
    name: 'align-center-from-the-menu-writes-the-delimiter-row',
    async run(editor) {
      await load(editor, ROWS, false);
      await place(editor, cellOf(editor, 1, 1).textFrom);
      const problems: Record<string, unknown> = {};
      if (!editor.commands.run('table.alignCenter')) return { why: 'Align Center did nothing' };
      await frames();
      if (doc(editor).includes('<!--')) problems['marks'] = doc(editor);
      if (!/\| :-+: \|/.test(doc(editor))) problems['delimiter'] = doc(editor);
      for (const view of ['clean', 'simple', 'redlines'] as const) {
        editor.setViewMode(view);
        await frames();
        if (alignedAs(editor, 1).some((a) => a !== 'center'))
          problems[`${view}-centered`] = alignedAs(editor, 1);
        if (alignedAs(editor, 0).some((a) => a === 'center'))
          problems[`${view}-others`] = alignedAs(editor, 0);
        if (editor.view.contentDOM.querySelector('.rl-fmt'))
          problems[`${view}-underline`] = 'drawn';
        if (lineElements(editor).some((line) => line.classList.contains('rl-bar')))
          problems[`${view}-bars`] = 'a row has a bar';
        const aligned = linedUp(editor);
        if (aligned.off > 0.5 || aligned.cells.some((n) => n !== 3))
          problems[`${view}-lines-up`] = aligned;
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // Align with Track Changes on is refused, in words on the page's notice, and writes nothing: never a
    // silent no-op, from the command and from the column grip's menu.
    name: 'align-with-track-changes-on-is-refused-in-words',
    async run(editor) {
      const WORDS =
        "Aligning a column with Track Changes on isn't ready yet. Turn off Track Changes to align it.";
      const problems: Record<string, unknown> = {};
      const shown = () => {
        const box = document.querySelector<HTMLElement>('.rl-notice');
        return box && !box.hidden ? (box.textContent ?? '').trim() : null;
      };
      await load(editor, ROWS, true);
      await place(editor, cellOf(editor, 1, 1).textFrom);
      const before = doc(editor);
      if (!editor.commands.run('table.alignCenter')) return { why: 'Align Center did nothing' };
      await frames();
      if (doc(editor) !== before) problems['written'] = doc(editor);
      if (shown() !== WORDS) problems['notice'] = shown();
      // From the column grip's menu.
      await load(editor, ROWS, true);
      const grip = await colGripOf(editor, 1);
      if (!grip) return { ...problems, grip: 'none shows' };
      const box = grip.getBoundingClientRect();
      mouse(grip, 'mousedown', box.left + 3, box.top + 3);
      mouse(window, 'mouseup', box.left + 3, box.top + 3);
      await frames();
      const item = [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-grip-item')].find(
        (i) => i.textContent === 'Align Right',
      );
      if (!item) return { ...problems, menu: 'no Align Right' };
      const text = doc(editor);
      mouse(item, 'mousedown', 0, 0);
      await frames();
      if (doc(editor) !== text) problems['menu-written'] = doc(editor);
      if (shown() !== WORDS) problems['menu-notice'] = shown();
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // The column grip's menu has the alignment items, the caret's alignment checked; a press on Align Right
    // aligns the column (Track Changes off: the delimiter row alone) and the menu then checks it.
    name: 'column-grip-menu-aligns-the-column',
    async run(editor) {
      await load(editor, ROWS, false);
      const problems: Record<string, unknown> = {};
      const open = async () => {
        const grip = await colGripOf(editor, 1);
        if (!grip) return null;
        const box = grip.getBoundingClientRect();
        mouse(grip, 'mousedown', box.left + 3, box.top + 3);
        mouse(window, 'mouseup', box.left + 3, box.top + 3);
        await frames();
        return [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-grip-item')];
      };
      const first = await open();
      if (!first) return { why: 'no column grip shows' };
      const checked = (items: HTMLElement[]) =>
        items.filter((i) => i.getAttribute('aria-checked') === 'true').map((i) => i.textContent);
      if (checked(first).join() !== 'Default Alignment')
        problems['checked-before'] = checked(first);
      const mark = first.find((i) => i.getAttribute('aria-checked') === 'true');
      const shown = mark && getComputedStyle(mark, '::before').content;
      if (!shown || !shown.includes('✓')) problems['check-mark'] = shown;
      const size = Math.min(...first.map((i) => parseFloat(getComputedStyle(i).fontSize)));
      if (!(size >= 13)) problems['menu-size'] = size;
      const right = first.find((i) => i.textContent === 'Align Right');
      if (!right) return { ...problems, menu: 'no Align Right' };
      mouse(right, 'mousedown', 0, 0);
      await frames();
      if (!/\| -+: \|/.test(doc(editor)) || doc(editor).includes('<!--'))
        problems['delimiter'] = doc(editor);
      if (alignedAs(editor, 1).some((a) => a !== 'right')) problems['right'] = alignedAs(editor, 1);
      if (editor.view.dom.querySelector('.rl-grip-menu')) problems['menu-open'] = 'still open';
      const again = await open();
      if (!again || checked(again).join() !== 'Align Right')
        problems['checked-after'] = again && checked(again);
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // Someone else's pending alignment change in Redlines: the new alignment, a dotted underline under the
    // header text of the column changed and a bar on the header row; its card names the column and the old
    // alignment; and with Track Changes on a letter typed right under its table is refused, in words
    // naming the person, and writes nothing.
    name: 'pending-alignment-change-in-redlines-is-drawn-carded-and-guards-the-gap',
    async run(editor) {
      await load(editor, WITH_ALIGN, false);
      editor.setViewMode('redlines');
      await frames();
      const problems: Record<string, unknown> = {};
      const marked = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-fmt')];
      if (marked.map((el) => el.textContent).join('|') !== 'Count')
        problems['underlined'] = marked.map((el) => el.textContent);
      const style = marked[0] && getComputedStyle(marked[0]);
      if (
        !style?.textDecorationLine.includes('underline') ||
        style.textDecorationStyle !== 'dotted'
      )
        problems['dotted'] = style && [style.textDecorationLine, style.textDecorationStyle];
      const bars = lineElements(editor).map((line) => line.classList.contains('rl-bar'));
      if (bars.join() !== 'true,false,false') problems['bars'] = bars;
      if (alignedAs(editor, 1).some((a) => a !== 'center'))
        problems['centered'] = alignedAs(editor, 1);
      const target = marked[0];
      if (!target) return { ...problems, card: 'nothing to press' };
      const box = await reveal(target);
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      mouse(target, 'mousedown', x, y);
      mouse(window, 'mouseup', x, y);
      await frames();
      await frames();
      const card = editor.view.dom.ownerDocument.querySelector('.rl-card .rl-card-what');
      if (card?.textContent !== 'Formatted: column Count centered (was default)')
        problems['card'] = card?.textContent ?? 'no card';
      // A letter typed on the line under the table, tracked.
      editor.setTracking(true, { inFile: false });
      const at = doc(editor).indexOf('Below.');
      const before = doc(editor);
      editor.view.dispatch({
        changes: { from: at, insert: 'x' },
        selection: { anchor: at + 1 },
        userEvent: 'input.type',
      });
      await frames();
      if (doc(editor) !== before) problems['gap-written'] = doc(editor).slice(at - 20, at + 20);
      const notice = document.querySelector<HTMLElement>('.rl-notice');
      const said = notice && !notice.hidden ? (notice.textContent ?? '').trim() : null;
      if (!said?.startsWith("Bo Chen's alignment change to the table above is pending."))
        problems['gap-notice'] = said;
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // Someone else's pending alignment change in Simple: the bar on the header row and nothing else of
    // the change (no underline), the new alignment, and the visible text Clean's, with no gap where the
    // markers and the blank lines around them are.
    name: 'pending-alignment-change-in-simple',
    async run(editor) {
      await load(editor, WITH_ALIGN, false);
      const problems: Record<string, unknown> = {};
      editor.setViewMode('clean');
      await frames();
      const clean = editor.view.contentDOM.textContent ?? '';
      const cleanTop = lineElements(editor)[0]?.getBoundingClientRect().top ?? 0;
      editor.setViewMode('simple');
      await frames();
      const text = editor.view.contentDOM.textContent ?? '';
      if (text !== clean)
        problems['text'] = { simple: text.slice(0, 100), clean: clean.slice(0, 100) };
      if (/align=|<!--/.test(text)) problems['markers'] = text.slice(0, 100);
      const bars = lineElements(editor).map((line) => line.classList.contains('rl-bar'));
      if (bars.join() !== 'true,false,false') problems['bars'] = bars;
      if (editor.view.contentDOM.querySelector('.rl-fmt')) problems['underline'] = 'drawn';
      for (const cell of headerCells(editor)) {
        if (getComputedStyle(cell).textDecorationLine !== 'none')
          problems['header-decoration'] = getComputedStyle(cell).textDecorationLine;
      }
      if (alignedAs(editor, 1).some((a) => a !== 'center'))
        problems['centered'] = alignedAs(editor, 1);
      const top = lineElements(editor)[0]?.getBoundingClientRect().top ?? 0;
      if (Math.abs(top - cleanTop) > 0.5) problems['gap'] = { simple: top, clean: cleanTop };
      const aligned = linedUp(editor);
      if (aligned.off > 0.5 || aligned.cells.some((n) => n !== 2)) problems['lines-up'] = aligned;
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A deleted column in a table with no pipe at the edges of its rows is a ghost at its place all the
    // same, the first and the last (#282): in every row, lined up with the real cells to the pixel,
    // the header's delimiter row hidden under it; Simple draws none, and the real cells as before.
    name: 'deleted-first-and-last-column-of-a-table-without-outer-pipes',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const place of ['first', 'last'] as const) {
        await load(editor, bareWithoutCount(place), false);
        editor.setViewMode('redlines');
        await frames();
        const ghosts = ghostCols(editor);
        if (ghosts.length !== 3) {
          problems[`${place}-ghosts`] = ghosts.length;
          continue;
        }
        const aligned = linedUp(editor);
        if (aligned.off > 0.5 || aligned.cells.some((n) => n !== 3))
          problems[`${place}-lines-up`] = aligned;
        const want = place === 'first' ? 0 : 2;
        for (const row of cellElements(editor)) {
          const at = row.findIndex((cell) => cell.classList.contains('rl-ghost-col'));
          if (at !== want) problems[`${place}-place`] = row.map((cell) => cell.className);
        }
        if (ghosts.map((g) => g.textContent).join('|') !== 'Count|3|7')
          problems[`${place}-text`] = ghosts.map((g) => g.textContent);
        const struck = ghosts[0]?.querySelector('.rl-del');
        if (!struck || !getComputedStyle(struck).textDecorationLine.includes('line-through'))
          problems[`${place}-struck`] = 'no line-through';
        const text = editor.view.contentDOM.textContent ?? '';
        if (text.includes('|') || text.includes('---') || text.includes('<!--'))
          problems[`${place}-source`] = text.slice(0, 120);
        for (const line of lineElements(editor)) {
          // Nothing but cells in a row (CodeMirror's own line-end `<br>` and widget buffers aside): a
          // ghost nested in a cell would break the grid.
          const stray = [...line.children].filter(
            (el) =>
              !el.classList.contains('rl-tc') &&
              !el.classList.contains('cm-widgetBuffer') &&
              el.tagName !== 'BR',
          );
          if (stray.length) problems[`${place}-stray`] = stray.map((el) => el.className);
        }
        editor.setViewMode('simple');
        await frames();
        if (ghostCols(editor).length) problems[`${place}-simple-ghost`] = ghostCols(editor).length;
        if (cellElements(editor).some((row) => row.length !== 2))
          problems[`${place}-simple-cells`] = cellElements(editor).map((row) => row.length);
        const simple = linedUp(editor);
        if (simple.off > 0.5) problems[`${place}-simple-lines-up`] = simple;
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // ⌘B over a whole column with Track Changes on (issue #267; format §3.7, "Cells apart"): the
    // table has eight pending insertions of someone else's in another column, more than the format
    // once tried in every order, and the bold is written for every cell of the column as one change
    // group, drawn bold in Redlines, and carded.
    name: 'bold-over-a-column-with-track-changes-on-is-written-drawn-and-carded',
    async run(editor) {
      const rest = 'bcdfghjkmnpqrstvwxz23456789';
      const ids = Array.from({ length: 8 }, (_, i) => `k${rest[i + 3]}${rest[i]}x`);
      const rows = Array.from({ length: 24 }, (_, n) => {
        const note =
          n < ids.length ? `some <!--ins ${ids[n]}-->new<!--/${ids[n]}--> words` : 'some words';
        return `| item ${n} | ${n} | ${note} |`;
      });
      const entries = ids.map((id) => `  ${id}: {by: bo, at: 2026-11-01T10:00Z}\n`).join('');
      const long = [
        'Intro.',
        '',
        '| Item | Count | Note |',
        '| ---- | ----- | ---- |',
        ...rows,
        '',
        'After.',
        '',
        `<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\nmarks:\n${entries}-->\n`,
      ].join('\n');
      await load(editor, long, true);
      const problems: Record<string, unknown> = {};
      const read = tablesOf(editor.view.state)[0];
      if (read?.rows.length !== 25) return { why: 'the table was not read' };
      const first = cellOf(editor, 0, 0);
      const last = cellOf(editor, 24, 0);
      editor.view.dispatch({ selection: { anchor: first.textFrom, head: last.textTo } });
      await frames();
      const selected = rect(editor);
      if (!selected || selected.rows.join() !== '0,24' || selected.cols.join() !== '0,0')
        return { why: 'the column is not a rectangle', selected };
      if (!editor.commands.run('format.bold')) return { why: 'Bold did nothing' };
      await frames();
      const marks = doc(editor).match(/<!--fmt [a-z0-9]{4} \+bold-->/g) ?? [];
      if (marks.length !== 25) problems['marks'] = marks.length;
      const groups = new Set(
        [
          ...doc(editor).matchAll(
            /^ {2}[a-z0-9]{4}: \{by: [^,]+, at: [^,}]+, group: ([a-z0-9]{4})/gm,
          ),
        ].map((m) => m[1]),
      );
      if (groups.size !== 1) problems['groups'] = [...groups];
      const written = (word: string) =>
        new RegExp(
          `\\| <!--fmt [a-z0-9]{4} \\+bold-->\\*\\*${word}\\*\\*<!--/[a-z0-9]{4}--> \\|`,
        ).test(doc(editor));
      if (!written('item 23') || !written('Item'))
        problems['written'] = {
          header: written('Item'),
          last: written('item 23'),
          tail: doc(editor).slice(
            doc(editor).indexOf('item 23') - 40,
            doc(editor).indexOf('item 23') + 60,
          ),
        };
      editor.setViewMode('redlines');
      await frames();
      const marked = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-fmt')].filter(
        (el) => /^(?:Item|item \d+)$/.test((el.textContent ?? '').trim()),
      );
      if (marked.length !== 25) problems['drawn'] = marked.length;
      const heavy = (el: HTMLElement): boolean =>
        Number(getComputedStyle(el).fontWeight) >= 600 ||
        [...el.querySelectorAll<HTMLElement>('*')].some(
          (c) => Number(getComputedStyle(c).fontWeight) >= 600,
        );
      const light = marked.filter((el) => !heavy(el)).length;
      if (light > 0) problems['bold'] = `${light} of ${marked.length} are not drawn bold`;
      const target = marked[0];
      if (!target) return { ...problems, card: 'nothing to press' };
      const box = await reveal(target);
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      mouse(target, 'mousedown', x, y);
      mouse(window, 'mouseup', x, y);
      await frames();
      await frames();
      const card = editor.view.dom.ownerDocument.querySelector('.rl-card .rl-card-what');
      // One card for the group: Bold, once for each of its 25 changes.
      const said = (card?.textContent ?? '').split(' · ');
      if (said.length !== 25 || said.some((one) => one !== 'Formatted: Bold'))
        problems['card'] = card?.textContent ?? 'no card';
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A table deleted whole (Delete Table, Track Changes on) is a ghost table in Redlines, where the
    // table was: the three rows of a table of three, in the table's own layout (the header cell and the
    // body cells of a column share their left edge), struck in the author's color on the author's tint,
    // with the bar and no fold line. It is not editable and has no text to select; a press on it puts no
    // caret there and opens its card, and ↑ ↓ step over it. Clean and Simple draw none, and Simple keeps
    // the bar. Chromium-measured: the hit test, the cells' layout and `isContentEditable` are the engine's,
    // and `user-select` is read under either of its names (WebKit's is prefixed in older versions).
    name: 'deleted-table-of-three-rows-is-a-ghost-table-lined-up-and-not-editable',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      const ghost = await deleteWhole(editor, around(fruitTable(3)));
      if (!ghost) {
        return {
          why: 'no ghost table',
          ghosts: ghostTables(editor).length,
          marked: /<!--del /.test(doc(editor)),
        };
      }
      const grid = ghostGrid(ghost);
      const rows = [...ghost.querySelectorAll<HTMLElement>('.rl-ghost-row')];
      const heads = rows.map((row) => row.classList.contains('rl-th'));
      if (!same(heads, [true, false, false])) problems['header'] = heads;
      const texts = gridTexts(grid);
      if (
        !same(texts, ['Fruit|Count|Note', 'Apples 1|3|short', 'A fruit with a long name|1234567|x'])
      )
        problems['texts'] = texts;
      // The columns: a cell of each, lined up to the pixel, each column to the right of the one before.
      const aligned = gridOff(grid);
      if (aligned.off > 0.5 || aligned.cells.some((n) => n !== 3)) problems['lines-up'] = aligned;
      const lefts = (grid[0] ?? []).map((cell) => cell.getBoundingClientRect().left);
      if (!lefts.every((left, i) => i === 0 || left > (lefts[i - 1] ?? Infinity)))
        problems['columns'] = lefts;
      const data = ghostData(ghost);
      if (!same(data, { columns: '3', rows: '3', more: '0' })) problems['data'] = data;
      if (ghost.querySelector('.rl-ghost-fold')) problems['fold'] = 'a fold line under three rows';
      // Struck, on the author's tint, with the bar.
      const struck = ghost.querySelector('.rl-tc .rl-del');
      if (!struck || !getComputedStyle(struck).textDecorationLine.includes('line-through'))
        problems['struck'] = 'no line-through';
      if (!painted(grid[1]?.[0] ?? ghost)) problems['tint'] = 'no tint';
      if (!ghost.classList.contains('rl-bar')) problems['bar'] = 'no change bar';
      // Where the table was, and none of it left as a table of the document or as source.
      const lineOf = (text: string) =>
        [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')].find(
          (line) => line.textContent === text,
        );
      const above = lineOf('Intro paragraph.')?.getBoundingClientRect();
      const below = lineOf('Below.')?.getBoundingClientRect();
      const box = ghost.getBoundingClientRect();
      if (!above || !below || box.top < above.bottom - 1 || box.bottom > below.top + 1)
        problems['place'] = [above?.bottom, box.top, box.bottom, below?.top];
      if (
        editor.view.contentDOM.querySelector('.rl-tbl, .cm-line.rl-trow') ||
        tablesOf(editor.view.state).length
      )
        problems['real-table'] = 'a table of the document is still drawn';
      if (editor.view.contentDOM.textContent?.includes('<!--'))
        problems['source'] = 'the deletion marker shows';
      // Not editable, nothing to select.
      const style = getComputedStyle(ghost);
      const select = style.userSelect || style.webkitUserSelect;
      if (
        ghost.isContentEditable ||
        !ghost.closest('[contenteditable="false"]') ||
        select !== 'none'
      )
        problems['editable'] = {
          isContentEditable: ghost.isContentEditable,
          inNoneditable: ghost.closest('[contenteditable="false"]') !== null,
          select,
        };
      // A press on it: taken whole, no caret there, its card.
      const pressed = await pressGhost(editor, ghost);
      if (!pressed.hit || !pressed.taken || pressed.moved) problems['press'] = pressed;
      if (pressed.card !== 'Deleted table (3 columns, 3 rows)') problems['card'] = pressed.card;
      // ↓ from the line above goes to the line below it, ↑ back: the ghost has no caret.
      const lineAtCaret = () => editor.view.state.doc.lineAt(head(editor)).text;
      await place(editor, doc(editor).indexOf('Intro paragraph.') + 'Intro paragraph.'.length);
      press(editor, 'ArrowDown');
      await frames();
      if (lineAtCaret() !== 'Below.') problems['down'] = lineAtCaret();
      press(editor, 'ArrowUp');
      await frames();
      if (lineAtCaret() !== 'Intro paragraph.') problems['up'] = lineAtCaret();
      // Clean and Simple draw none; Simple keeps the bar, on the text after the table.
      for (const view of ['simple', 'clean'] as const) {
        editor.setViewMode(view);
        await frames();
        if (ghostTables(editor).length) problems[`${view}-ghost`] = ghostTables(editor).length;
        if (editor.view.contentDOM.textContent?.includes('Fruit'))
          problems[`${view}-text`] = 'the deleted table shows';
        const bar = lineOf('Below.')?.classList.contains('rl-bar');
        if (view === 'simple' && !bar) problems['simple-bar'] = 'the text after it has no bar';
        if (view === 'clean' && bar) problems['clean-bar'] = 'the text after it has a bar';
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A table of twenty rows deleted whole draws eight of them, the header and seven body rows, and one
    // line for the other twelve, "and 12 more rows", under the rows and as wide as the table, in which
    // the columns still line up; its card counts the whole table. Nine rows fold to "and 1 more row",
    // and eight rows are not folded. Chromium-measured, as the check above.
    name: 'deleted-table-of-twenty-rows-draws-eight-and-one-fold-line',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      const cases: [number, string | null][] = [
        [20, 'and 12 more rows'],
        [9, 'and 1 more row'],
        [8, null],
      ];
      for (const [rows, words] of cases) {
        const ghost = await deleteWhole(editor, around(fruitTable(rows)));
        if (!ghost) {
          problems[`${rows}-ghost`] = {
            ghosts: ghostTables(editor).length,
            marked: /<!--del /.test(doc(editor)),
          };
          continue;
        }
        const grid = ghostGrid(ghost);
        const folds = [...ghost.querySelectorAll<HTMLElement>('.rl-ghost-fold')];
        const data = ghostData(ghost);
        const want = { columns: '3', rows: String(rows), more: String(Math.max(0, rows - 8)) };
        if (!same(data, want)) problems[`${rows}-data`] = data;
        if (grid.length !== 8 || grid.some((row) => row.length !== 3))
          problems[`${rows}-rows`] = grid.map((row) => row.length);
        if (folds.length !== (words ? 1 : 0) || (words && folds[0]?.textContent !== words))
          problems[`${rows}-fold`] = folds.map((fold) => fold.textContent);
        const aligned = gridOff(grid);
        if (aligned.off > 0.5) problems[`${rows}-lines-up`] = aligned;
        // The line is after the rows, never among them, and runs the width of the box that holds the
        // table (which the rows fill, and which scrolls sideways where they are wider).
        const [fold] = folds;
        const line = fold?.getBoundingClientRect();
        const held = ghost.querySelector<HTMLElement>('.rl-ghost-scroll')?.getBoundingClientRect();
        const last = grid.at(-1)?.[0]?.getBoundingClientRect();
        if (line && held && last) {
          if (line.top < last.bottom - 1) problems[`${rows}-fold-place`] = [line.top, last.bottom];
          if (Math.abs(line.left - held.left) > 1 || Math.abs(line.width - held.width) > 1)
            problems[`${rows}-fold-width`] = [line.left, line.width, held.left, held.width];
        }
        if (rows !== 20) continue;
        // A row past the eighth is not drawn (`Apples 10` is the eleventh: the header, then ten rows of
        // the body); a press opens the card of the whole table.
        if (ghost.textContent?.includes('Apples 10'))
          problems['20-eleventh'] = 'a row past the eighth is drawn';
        const pressed = await pressGhost(editor, ghost);
        if (!pressed.hit || !pressed.taken || pressed.moved) problems['20-press'] = pressed;
        if (pressed.card !== 'Deleted table (3 columns, 20 rows)')
          problems['20-card'] = pressed.card;
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A row with fewer cells than the header is drawn with empty cells after its last, in Clean, Simple
    // and Redlines: each in the column of its header cell (its left edge and its width), with a box and
    // no text but the filler; drawing them writes nothing. Chromium-measured: the cells' layout.
    name: 'a-row-with-fewer-cells-is-drawn-with-empty-cells-in-its-header-columns',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const view of ['clean', 'simple', 'redlines'] as const) {
        await load(editor, FEWER);
        editor.setViewMode(view);
        await frames();
        const grid = cellElements(editor);
        const header = headerCells(editor);
        const drawn = grid.map((row) => row.length);
        if (!same(drawn, [3, 3, 3, 3])) problems[`${view}-cells`] = drawn;
        const missing = grid.map((row) =>
          row
            .filter((cell) => cell.classList.contains('rl-tc-missing'))
            .map((cell) => cell.dataset['col'])
            .join(),
        );
        if (!same(missing, ['', '1,2', '2', ''])) problems[`${view}-missing`] = missing;
        grid.forEach((row, r) =>
          row.forEach((cell) => {
            const above = header
              .find((h) => h.dataset['col'] === cell.dataset['col'])
              ?.getBoundingClientRect();
            const box = cell.getBoundingClientRect();
            if (
              !above ||
              Math.abs(box.left - above.left) > 0.5 ||
              Math.abs(box.width - above.width) > 0.5
            )
              problems[`${view}-column-r${r}c${cell.dataset['col']}`] = [
                box.left,
                box.width,
                above?.left,
                above?.width,
              ];
          }),
        );
        const aligned = linedUp(editor);
        if (aligned.off > 0.5) problems[`${view}-lines-up`] = aligned;
        const empty = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tc-missing')];
        if (
          empty.length !== 3 ||
          empty.some(
            (cell) =>
              !(cell.getBoundingClientRect().width > 0) ||
              (cell.textContent ?? '').replace(/\u200b/g, '') !== '',
          )
        )
          problems[`${view}-empty`] = empty.map((cell) => cell.getBoundingClientRect().width);
        if (doc(editor) !== FEWER) problems[`${view}-wrote`] = doc(editor);
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // Tab goes into a cell its row lacks and writes nothing (the cell draws the caret, and the line's own
    // is hidden); typing in the second of two writes the pipes first, plain, and then the text, `| 1 | | x |`
    // with Track Changes off and the text an insertion with it on, as the row's cells now are cells of the
    // row; one Undo takes the pipes and the text back together. The typing is WebKit's own (`execCommand`),
    // which reaches the editor at the end of the row beside the widgets that draw the cells: Chromium-
    // measured, where the page's caret and its DOM may stand elsewhere than in WKWebView.
    name: 'typing-in-a-missing-cell-writes-its-pipes-first',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      // (a row of text below, for the row typed in to be as tall as)
      const start = around('| a | b | c |\n| - | - | - |\n| 1 |\n| 2 | 3 | 4 |');
      for (const tracking of [false, true]) {
        const label = tracking ? 'tracked' : 'plain';
        await load(editor, start, tracking);
        await place(editor, cellOf(editor, 1, 0).textTo);
        press(editor, 'Tab');
        await frames();
        const first = caretMissing(editor);
        press(editor, 'Tab');
        await frames();
        if (first !== '1' || caretMissing(editor) !== '2')
          problems[`${label}-tab`] = [first, caretMissing(editor)];
        if (doc(editor) !== start) problems[`${label}-tab-wrote`] = doc(editor);
        // The cell draws the caret, a line high, while the editor has the focus, and none without it; the
        // page's own is hidden in the row. CodeMirror marks the focus (`cm-focused`) only where the document
        // has it too, as a pane that is not the active window has not, so the class is put on for the one
        // measure and off for the other, and left as it was.
        const active = editor.view.contentDOM.querySelector<HTMLElement>('.rl-tc-active');
        const fill = active?.querySelector<HTMLElement>(':scope > .rl-tc-fill');
        const root = editor.view.dom;
        const focused = root.classList.contains('cm-focused');
        const lineWith = (focus: boolean) => {
          root.classList.toggle('cm-focused', focus);
          const style = fill && getComputedStyle(fill, '::after');
          return style ? { width: style.borderLeftWidth, height: parseFloat(style.height) } : null;
        };
        const drawn = lineWith(true);
        const blurred = lineWith(false);
        root.classList.toggle('cm-focused', focused);
        if (!drawn || drawn.width !== '1px' || !(drawn.height > 4))
          problems[`${label}-caret`] = drawn ?? 'no cell draws the caret';
        if (blurred && blurred.width !== '0px') problems[`${label}-caret-unfocused`] = blurred;
        const own = active && getComputedStyle(active.closest('.cm-line') ?? active).caretColor;
        if (own !== 'transparent' && own !== 'rgba(0, 0, 0, 0)')
          problems[`${label}-own-caret`] = own ?? 'no cell draws the caret';
        document.execCommand('insertText', false, 'x');
        await frames();
        const written = doc(editor);
        if (tracking) {
          if (!/\| 1 \| \| <!--ins ([a-z0-9]{4})-->x<!--\/\1--> \|/.test(written))
            problems[`${label}-doc`] = written.replaceAll('\n', '⏎').slice(0, 200);
        } else if (written !== start.replace('| 1 |', '| 1 | | x |')) {
          problems[`${label}-doc`] = written.replaceAll('\n', '⏎');
        }
        const cells = table(editor).rows[1]?.cells.length;
        if (cells !== 3 || editor.view.contentDOM.querySelector('.rl-tc-missing'))
          problems[`${label}-cells`] = cells;
        if (written.slice(head(editor) - 1, head(editor)) !== 'x')
          problems[`${label}-caret-after`] = written.slice(head(editor) - 3, head(editor) + 3);
        // The row is drawn as any row of text is, empty cell between and all: as tall as the row below,
        // and the text of its cells at one height. (A pass must mean it draws right.)
        const lines = lineElements(editor);
        const heights = [lines[1], lines[2]].map((line) => line?.getBoundingClientRect().height);
        if (!(Math.abs((heights[0] ?? NaN) - (heights[1] ?? NaN)) <= 0.5))
          problems[`${label}-height`] = heights;
        const tops = (cellElements(editor)[1] ?? [])
          .map(textTop)
          .filter((top): top is number => top !== null);
        if (tops.length !== 2 || Math.max(...tops) - Math.min(...tops) > 0.5)
          problems[`${label}-tops`] = tops;
        if (!undo(editor.view) || doc(editor) !== start)
          problems[`${label}-undo`] = doc(editor).replaceAll('\n', '⏎').slice(0, 200);
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A press on a cell a row lacks puts the caret in it, in its own column and its own row, and writes
    // nothing: the pointer's hit test finds the cell the row's widget draws. Chromium-measured: the hit test.
    name: 'a-press-on-a-missing-cell-puts-the-caret-in-it',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      await load(editor, FEWER);
      for (const [row, col] of [
        [1, 1],
        [1, 2],
        [2, 2],
      ] as const) {
        editor.view.dispatch({ selection: EditorSelection.cursor(0) });
        await frames();
        const element = cellElements(editor)[row]?.[col];
        if (!element?.classList.contains('rl-tc-missing')) {
          problems[`r${row}c${col}`] = 'no cell its row lacks drawn there';
          continue;
        }
        const box = await reveal(element);
        pressAt(editor, box.left + box.width / 2, box.top + box.height / 2);
        await frames();
        const active = cellElements(editor)[row]?.[col];
        if (caretMissing(editor) !== String(col) || !active?.classList.contains('rl-tc-active'))
          problems[`r${row}c${col}-caret`] = caretMissing(editor);
        if (head(editor) !== table(editor).rows[row]?.to)
          problems[`r${row}c${col}-head`] = head(editor);
        if (doc(editor) !== FEWER) problems[`r${row}c${col}-wrote`] = doc(editor);
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // An empty cell holds a filler of its own, whatever its padding (`| |` and `||` as well as `|  |`), and
    // no cell with text holds one; a row with an empty cell is as tall as a row of text (the same row with
    // text in those cells, and the row above it), and the text beside an empty cell stands as high as it
    // does then; where the cell's stop is inside it (two spaces of padding), a press on it puts the caret in
    // it, and the DOM place the editor gives the caret at its stop (`domAtPos`) is in it. (The filler of a
    // cell with one space of padding or none once stood in the next cell, which held that cell's text
    // 6.85 px low and its row 6.85 px tall; and any filler, a baseline-aligned box with `overflow:
    // hidden`, rested its bottom edge on the baseline and made its row 6.85 px taller.) Chromium-measured,
    // in px: the heights and tops and the hit test; WebKit's line layout and hit test are the sweep's.
    name: 'an-empty-cell-holds-its-own-filler-and-its-row-is-as-tall-as-a-row-of-text',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const [form, source] of EMPTY_FORMS) {
        await load(editor, source);
        const found = table(editor);
        const withEmpty = found.rows.flatMap((row, r) => {
          const empty = row.cells.filter((cell) => cell.textFrom === cell.textTo);
          return empty.length ? [{ r, row, empty }] : [];
        });
        if (withEmpty.length === 0) {
          problems[`${form}-fixture`] = 'no empty cell';
          continue;
        }
        const grid = cellElements(editor);
        const lines = lineElements(editor);
        const wanted = withEmpty.flatMap(({ row }) =>
          row.cells.filter((cell) => cell.textFrom === cell.textTo),
        ).length;
        const total = editor.view.contentDOM.querySelectorAll('.rl-tc-fill').length;
        if (total !== wanted) problems[`${form}-fillers-in-all`] = { total, wanted };
        const before = withEmpty.map(({ r }) => ({
          height: lines[r]?.getBoundingClientRect().height ?? NaN,
          tops: (grid[r] ?? []).map(textTop),
        }));
        withEmpty.forEach(({ r, row, empty }) => {
          const cells = grid[r] ?? [];
          // One filler in each empty cell, none in a cell with text, each at its own cell's left edge.
          const fills = cells.map((cell) => cell.querySelectorAll('.rl-tc-fill').length);
          const want = row.cells.map((cell) => (cell.textFrom === cell.textTo ? 1 : 0));
          if (!same(fills, want)) problems[`${form}-r${r}-fillers`] = { fills, want };
          for (const cell of empty) {
            const own = cells[cell.col];
            const box = own?.getBoundingClientRect();
            const fill = own?.querySelector('.rl-tc-fill')?.getBoundingClientRect();
            if (!box || !fill || fill.left < box.left - 0.5 || fill.left > box.right - 0.5)
              problems[`${form}-r${r}c${cell.col}-filler-box`] = [
                fill?.left,
                box?.left,
                box?.right,
              ];
          }
          // The text of a cell beside an empty one stands as high as the text of the others.
          const tops = (grid[r] ?? []).map(textTop).filter((top): top is number => top !== null);
          if (Math.max(...tops) - Math.min(...tops) > 0.5) problems[`${form}-r${r}-tops`] = tops;
        });
        // The same rows with text in the empty cells: the heights and the tops must not move.
        editor.view.dispatch({
          changes: withEmpty.flatMap(({ empty }) =>
            empty.map((cell) => ({ from: cell.textFrom, insert: 'y' })),
          ),
        });
        await frames();
        withEmpty.forEach(({ r }, i) => {
          const height = lineElements(editor)[r]?.getBoundingClientRect().height ?? NaN;
          const was = before[i];
          if (!was || !(Math.abs(was.height - height) <= 0.5))
            problems[`${form}-r${r}-height`] = { empty: was?.height, text: height };
          const tops = (cellElements(editor)[r] ?? []).map(textTop);
          tops.forEach((top, c) => {
            const earlier = was?.tops[c];
            if (typeof earlier === 'number' && !(top !== null && Math.abs(earlier - top) <= 0.5))
              problems[`${form}-r${r}c${c}-top`] = { empty: earlier, text: top };
          });
          // And the row above the last one is a row of text as well: the same height as a row with an
          // empty cell, in the body.
          const above = lineElements(editor)[1]?.getBoundingClientRect().height;
          if (r >= 2 && !(was && above !== undefined && Math.abs(was.height - above) <= 0.5))
            problems[`${form}-r${r}-height-above`] = { empty: was?.height, above };
        });
        // A press in the middle of each empty cell puts the caret in it, and the DOM place the editor gives
        // the caret at its stop (`domAtPos`, on the side its selection says) is in that cell, whatever its
        // padding: with one space or none the stop is where the next cell begins, and the caret leans to the
        // cell it is the end of.
        await load(editor, source);
        for (const { r, empty } of withEmpty) {
          for (const cell of empty) {
            editor.view.dispatch({ selection: EditorSelection.cursor(0) });
            await frames();
            const own = cellElements(editor)[r]?.[cell.col];
            if (!own) {
              problems[`${form}-r${r}c${cell.col}-cell`] = 'not drawn';
              continue;
            }
            const box = await reveal(own);
            pressAt(editor, box.left + box.width / 2, box.top + box.height / 2);
            await frames();
            if (head(editor) !== cell.textFrom)
              problems[`${form}-r${r}c${cell.col}-press`] = [head(editor), cell.textFrom];
            const { node } = editor.view.domAtPos(
              cell.textFrom,
              editor.view.state.selection.main.assoc || 1,
            );
            const holder = (node instanceof Element ? node : node.parentElement)?.closest('.rl-tc');
            if (holder !== own)
              problems[`${form}-r${r}c${cell.col}-caret-place`] = {
                in: holder?.getAttribute('data-col') ?? holder?.className ?? 'no cell',
                want: String(cell.col),
              };
          }
        }
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // The caret can stand in an empty cell with one space of padding or none (`| |`, `||`), where the
    // cell's one stop is the end of its own mark and the start of the next cell's: Tab and ⇧Tab visit it, →
    // and ← step into it and out of it, a press on its box puts the caret in it, the page draws the caret
    // there (the DOM selection is inside the cell's own mark, at its left edge: a caret leans to the cell it
    // is the end of), and the browser's own typing writes into it, a letter and a second, and into no
    // other cell. (The caret could not stand there: Tab, → and a press put it at the start of the next
    // cell's text, ← from there did not move, and the browser's typing went into the next cell.) Two
    // spaces of padding are here as a control. Chromium-measured: the hit test, `coordsAtPos` and the editing; WebKit's are
    // the sweep's.
    name: 'the-caret-stands-in-an-empty-cell-with-one-space-or-none',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const [form, source] of EMPTY_FORMS) {
        await load(editor, source);
        const wanted = table(editor).rows.flatMap((row) =>
          row.cells
            .filter((cell) => cell.textFrom === cell.textTo)
            .map((cell) => [row.index, cell.col]),
        );
        if (wanted.length === 0) {
          problems[`${form}-fixture`] = 'no empty cell';
          continue;
        }
        for (const [r, c] of wanted) {
          // Each on the document as it was given: what is typed into one is not in the next.
          await load(editor, source);
          const order = table(editor).rows.flatMap((row) =>
            row.cells.map((cell) => ({ row, cell })),
          );
          const found = order.find(({ row, cell }) => row.index === r && cell.col === c);
          if (!found) {
            problems[`${form}-r${r}c${c}-fixture`] = 'no such cell';
            continue;
          }
          const { row, cell } = found;
          const label = `${form}-r${row.index}c${cell.col}`;
          const at = order.findIndex((one) => one.cell === cell);
          const before = order[at - 1];
          const after = order[at + 1];
          const element = () => cellElements(editor)[row.index]?.[cell.col];
          // The caret is in the cell, as the model has it and as the page draws it: the DOM selection is
          // collapsed inside the cell's own mark, and the caret's place is at the cell's left edge.
          const drawn = (step: string) => {
            const picked = window.getSelection();
            const node = picked?.anchorNode;
            const holder = (node instanceof Element ? node : node?.parentElement)?.closest(
              '.rl-tc',
            );
            const own = element();
            if (head(editor) !== cell.textFrom && step !== 'typed')
              problems[`${label}-${step}-head`] = [head(editor), cell.textFrom];
            if (!own || !picked?.isCollapsed || holder !== own)
              problems[`${label}-${step}-dom`] = {
                collapsed: picked?.isCollapsed,
                in: holder?.getAttribute('data-col') ?? holder?.className ?? 'no cell',
                want: String(cell.col),
              };
            const { assoc } = editor.view.state.selection.main;
            const coords = editor.view.coordsAtPos(head(editor), assoc || 1);
            const box = own?.getBoundingClientRect();
            // At the cell's left edge; after what was typed, a little way along its text.
            const along = step === 'typed' ? box?.right : box?.left;
            if (!coords || !box || coords.left < box.left - 2 || coords.left > (along ?? 0) + 2)
              problems[`${label}-${step}-x`] = {
                caret: coords?.left,
                cell: [box?.left, box?.right],
              };
          };
          // Tab from the cell before it, and ⇧Tab from the cell after it.
          if (before) {
            await place(editor, before.cell.textFrom);
            press(editor, 'Tab');
            await frames();
            drawn('tab');
          }
          if (after) {
            await place(editor, after.cell.textFrom);
            press(editor, 'Shift-Tab');
            await frames();
            drawn('shift-tab');
          }
          // → from the end of the text before it, and then on into the next cell; ← the other way.
          if (before && before.row === row) {
            await place(editor, before.cell.textTo);
            press(editor, 'ArrowRight');
            await frames();
            drawn('right');
            if (after && after.row === row) {
              press(editor, 'ArrowRight');
              await frames();
              if (head(editor) !== after.cell.textFrom)
                problems[`${label}-right-on`] = [head(editor), after.cell.textFrom];
            }
          }
          if (after && after.row === row) {
            await place(editor, after.cell.textFrom);
            press(editor, 'ArrowLeft');
            await frames();
            drawn('left');
            if (before && before.row === row) {
              press(editor, 'ArrowLeft');
              await frames();
              if (head(editor) !== before.cell.textTo)
                problems[`${label}-left-on`] = [head(editor), before.cell.textTo];
            }
          }
          // A press in the middle of its box.
          await place(editor, 0);
          const own = element();
          if (!own) {
            problems[`${label}-cell`] = 'not drawn';
            continue;
          }
          const box = await reveal(own);
          pressAt(editor, box.left + box.width / 2, box.top + box.height / 2);
          await frames();
          drawn('press');
          // (A frame between reading the caret's coordinates and the browser's typing: typed in the same
          // turn as `coordsAtPos` was asked, the first letter is lost, in any cell.)
          await frames();
          // The browser's own typing at that caret: a letter, and a second, in the cell and no other.
          document.execCommand('insertText', false, 'Y');
          await frames();
          document.execCommand('insertText', false, 'Z');
          await frames();
          const want = `${source.slice(0, cell.textFrom)}YZ${source.slice(cell.textFrom)}`;
          if (doc(editor) !== want) problems[`${label}-typed`] = doc(editor).replaceAll('\n', '⏎');
          else {
            if (head(editor) !== cell.textFrom + 2)
              problems[`${label}-typed-head`] = [head(editor), cell.textFrom + 2];
            drawn('typed');
          }
        }
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // A row with more cells than the header draws no cell beyond the header's columns, in Clean, Simple
    // and Redlines: the extra cell is kept in the text and not drawn. No key puts the caret in it, from
    // each place around it: the arrows (↑ ↓ by the page's own geometry), Home and End, ⌥ with the arrows,
    // Tab and ⇧Tab. (The delete keys, which no browser decides, are in the unit tests' every-key
    // test.) Chromium-measured: ↑ ↓, Home and End take the page's coordinates.
    name: 'a-row-with-more-cells-draws-none-beyond-the-header-and-no-key-lands-in-one',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const view of ['clean', 'simple', 'redlines'] as const) {
        await load(editor, MORE);
        editor.setViewMode(view);
        await frames();
        const shown = shownCells(editor);
        const counts = shown.map((row) => row.length);
        if (!same(counts, [2, 2, 2])) problems[`${view}-cells`] = counts;
        const hidden = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tc-hidden')];
        if (
          hidden.length !== 1 ||
          getComputedStyle(hidden[0]!).display !== 'none' ||
          !hidden[0]?.textContent?.includes('EXTRA')
        )
          problems[`${view}-hidden`] = hidden.map((cell) => cell.textContent);
        if (editor.view.contentDOM.innerText.includes('EXTRA'))
          problems[`${view}-drawn`] = 'the extra cell is drawn';
        const aligned = gridOff(shown);
        if (aligned.off > 0.5) problems[`${view}-lines-up`] = aligned;
        if (doc(editor) !== MORE) problems[`${view}-wrote`] = doc(editor);
      }
      await load(editor, MORE);
      const row = table(editor).rows[1];
      const reach = cellOf(editor, 1, 2);
      if (!row) return { ...problems, why: 'no row with an extra cell' };
      await place(editor, row.from);
      const places = [
        row.from,
        cellOf(editor, 1, 0).textFrom,
        cellOf(editor, 1, 1).textFrom,
        cellOf(editor, 1, 1).textTo,
        reach.from,
        reach.from + 1,
        reach.textFrom,
        reach.textTo,
        reach.to,
      ];
      const keys = [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'Alt-ArrowLeft',
        'Alt-ArrowRight',
        'Tab',
        'Shift-Tab',
      ];
      const inside = (pos: number) => pos >= reach.textFrom && pos <= reach.to;
      // The keys do move the caret (a loop that never moved it would find nothing to be wrong): → from
      // the end of d goes on to f in the next row, over the extra cell, ← comes back, and Tab selects f.
      const end = cellOf(editor, 1, 1).textTo;
      editor.view.dispatch({ selection: EditorSelection.cursor(end) });
      press(editor, 'ArrowRight');
      if (head(editor) !== cellOf(editor, 2, 0).textFrom) problems['right-moves'] = head(editor);
      press(editor, 'ArrowLeft');
      if (head(editor) !== end) problems['left-moves'] = head(editor);
      editor.view.dispatch({ selection: EditorSelection.cursor(cellOf(editor, 1, 1).textFrom) });
      press(editor, 'Tab');
      const picked = editor.view.state.selection.main;
      if (editor.view.state.sliceDoc(picked.from, picked.to) !== 'f')
        problems['tab-moves'] = [picked.from, picked.to];
      for (const from of places) {
        for (const key of keys) {
          const label = `${key} at ${from - row.from}`;
          editor.view.dispatch({ selection: EditorSelection.cursor(from) });
          try {
            press(editor, key);
          } catch (error) {
            problems[`${label}-threw`] = String(error);
            continue;
          }
          const { anchor, head: to } = editor.view.state.selection.main;
          if (inside(anchor) || inside(to) || editor.view.contentDOM.querySelector('.rl-tc-active'))
            problems[label] = [anchor - row.from, to - row.from];
          if (doc(editor) !== MORE) problems[`${label}-wrote`] = doc(editor);
        }
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // Select Column on a column that the last row does not reach selects that column alone: the cells
    // the rows have in it (the header's and the first row's), drawn selected, and not the cell the last
    // row lacks, nor any other column's. On a column that no body row reaches it selects the header's
    // cell alone, as text, which is no rectangle, from the header and from a cell a row lacks.
    name: 'select-column-on-a-column-the-last-row-does-not-reach-selects-that-column-alone',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      await load(editor, around('| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 |'));
      await place(editor, cellOf(editor, 0, 2).textFrom);
      if (!editor.commands.run('table.selectColumn')) return { why: 'Select Column did nothing' };
      await frames();
      const found = rect(editor);
      if (!found || !same(found.cols, [2, 2]) || found.whole !== 'column') problems['rect'] = found;
      const drawn = selectedLabels(editor);
      if (!same(drawn, ['r0c2', 'r1c2'])) problems['drawn'] = drawn;
      const lacking = cellElements(editor)[2]?.find((cell) =>
        cell.classList.contains('rl-tc-missing'),
      );
      if (!lacking || painted(lacking))
        problems['missing-cell'] = lacking ? 'painted as selected' : 'not drawn';
      // No body row has a cell in the column: the header's cell, as text.
      const none = around('| a | b | c |\n| - | - | - |\n| 1 | 2 |\n| 4 | 5 |');
      for (const where of ['header', 'missing'] as const) {
        await load(editor, none);
        await place(editor, cellOf(editor, 0, 2).textFrom);
        if (where === 'missing') {
          await place(editor, cellOf(editor, 2, 1).textTo);
          press(editor, 'ArrowRight');
          await frames();
          if (caretMissing(editor) !== '2') {
            problems[`${where}-caret`] = caretMissing(editor);
            continue;
          }
        }
        if (!editor.commands.run('table.selectColumn')) {
          problems[`${where}-ran`] = false;
          continue;
        }
        await frames();
        const { from, to } = editor.view.state.selection.main;
        const text = editor.view.state.sliceDoc(from, to);
        if (text !== 'c' || rect(editor) || selectedLabels(editor).length)
          problems[`${where}-selected`] = {
            text,
            rect: rect(editor),
            drawn: selectedLabels(editor),
          };
        if (doc(editor) !== none) problems[`${where}-wrote`] = doc(editor);
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // Delete Table from the Table menu's command, with the caret in a cell. With Track Changes on it is
    // one block deletion, drawn in Redlines as the ghost table where the table was (Clean draws none, nor
    // any table), the caret on the text after it; off, the table's text goes. Each is one step to undo.
    name: 'delete-table-draws-the-ghost-table-tracked-and-takes-the-text-untracked',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      const start = around(fruitTable(4));
      for (const tracking of [true, false]) {
        const label = tracking ? 'tracked' : 'plain';
        await load(editor, start, tracking);
        await place(editor, cellOf(editor, 2, 1).textFrom);
        if (!editor.commands.run('table.deleteTable')) {
          problems[`${label}-ran`] = false;
          continue;
        }
        editor.setViewMode('redlines');
        await frames();
        const marked = /<!--del [a-z0-9]{4} /.test(doc(editor));
        if (marked !== tracking) problems[`${label}-marked`] = marked;
        if (!tracking && doc(editor) !== 'Intro paragraph.\n\nBelow.')
          problems[`${label}-text`] = doc(editor);
        if (doc(editor).slice(head(editor), head(editor) + 6) !== 'Below.')
          problems[`${label}-caret`] = doc(editor).slice(head(editor) - 4, head(editor) + 6);
        const [ghost] = ghostTables(editor);
        if (tracking && (ghostTables(editor).length !== 1 || ghost?.dataset['rows'] !== '4'))
          problems[`${label}-ghost`] = ghostTables(editor).map((g) => g.dataset['rows']);
        if (!tracking && ghostTables(editor).length) problems[`${label}-ghost`] = 'a ghost table';
        if (editor.view.contentDOM.querySelector('.rl-tbl') || tablesOf(editor.view.state).length)
          problems[`${label}-table`] = 'a table of the document is still drawn';
        editor.setViewMode('clean');
        await frames();
        if (ghostTables(editor).length || editor.view.contentDOM.textContent?.includes('Fruit'))
          problems[`${label}-clean`] = 'the deleted table shows in Clean';
        if (!undo(editor.view) || doc(editor) !== start)
          problems[`${label}-undo`] = doc(editor).replaceAll('\n', '⏎').slice(0, 200);
        await frames();
        if (tablesOf(editor.view.state).length !== 1) problems[`${label}-undone`] = 'no table back';
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // ⌫ on a selected row clears its cells and the row stays, with its text or without; ⌫ again, the
    // cells being empty (what the page shows), deletes it: with Track Changes off the row's text goes
    // and the caret is in the row then there; on, a ghost row appears (in Redlines) in its place, the
    // clearing folded into the one deletion line.
    name: 'second-backspace-deletes-an-emptied-row-and-a-ghost-row-appears-tracked',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const tracking of [false, true]) {
        const label = tracking ? 'tracked' : 'plain';
        await load(editor, ROWS, tracking);
        if (tracking) editor.setViewMode('redlines');
        await frames();
        await place(editor, cellOf(editor, 2, 1).textFrom);
        press(editor, 'Ctrl-l');
        await frames();
        if (rect(editor)?.whole !== 'row') {
          problems[`${label}-selected`] = rect(editor);
          continue;
        }
        press(editor, 'Backspace');
        await frames();
        // The first: the row's text is cleared (a deletion in each cell, tracked), and the row stays,
        // selected.
        if (lineElements(editor).length !== 4 || ghostElements(editor).length)
          problems[`${label}-first-rows`] = [
            lineElements(editor).length,
            ghostElements(editor).length,
          ];
        if (!tracking && doc(editor) !== ROWS.replace('| Plums | 4 | ok |', '|  |  |  |'))
          problems[`${label}-first`] = doc(editor);
        if (tracking && (doc(editor).match(/<!--del /g) ?? []).length !== 3)
          problems[`${label}-first-marks`] = doc(editor).match(/<!--del /g)?.length;
        if (rect(editor)?.whole !== 'row') problems[`${label}-first-selected`] = rect(editor);
        press(editor, 'Backspace');
        await frames();
        // The second: the row goes.
        if (
          lineElements(editor).length !== 3 ||
          firstColumn(editor).join() !== 'Fruit,Apples,Pears'
        )
          problems[`${label}-second-rows`] = firstColumn(editor);
        if (!tracking && doc(editor) !== ROWS.replace('| Plums | 4 | ok |\n', ''))
          problems[`${label}-second`] = doc(editor);
        if (tracking) {
          if (ghostElements(editor).length !== 1)
            problems[`${label}-ghost-row`] = ghostElements(editor).length;
          const marks = doc(editor).match(/<!--del /g) ?? [];
          if (marks.length !== 1 || !/<!--del [a-z0-9]{4} row=2 /.test(doc(editor)))
            problems[`${label}-second-marks`] = marks.length;
        }
        if (!inText(cellOf(editor, 2, 0), head(editor))) problems[`${label}-caret`] = head(editor);
        editor.setViewMode('clean');
        await frames();
        if (editor.view.contentDOM.textContent?.includes('Plums'))
          problems[`${label}-clean`] = 'the deleted row shows in Clean';
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // The same on a selected column, and on the whole table: ⌫ clears and they stay; ⌫ again deletes the
    // column (a ghost cell in every row, tracked) or the table (the ghost table, tracked; the text
    // gone, untracked).
    name: 'second-backspace-deletes-an-emptied-column-and-the-whole-table',
    async run(editor) {
      const problems: Record<string, unknown> = {};
      for (const tracking of [false, true]) {
        const label = tracking ? 'tracked' : 'plain';
        // The column.
        await load(editor, ROWS, tracking);
        if (tracking) editor.setViewMode('redlines');
        await frames();
        await place(editor, cellOf(editor, 1, 1).textFrom);
        editor.commands.run('table.selectColumn');
        await frames();
        press(editor, 'Backspace');
        await frames();
        if (table(editor).columns !== 3 || rect(editor)?.whole !== 'column')
          problems[`${label}-column-first`] = [table(editor).columns, rect(editor)?.whole];
        press(editor, 'Backspace');
        await frames();
        if (tracking) {
          const ghosts = ghostCols(editor).map((g) => g.textContent);
          if (ghosts.join('|') !== 'Count|3|4|5') problems[`${label}-column-ghosts`] = ghosts;
        } else if (table(editor).columns !== 2 || /\| 3 \|/.test(doc(editor))) {
          problems[`${label}-column-second`] = doc(editor);
        }
        // The table.
        await load(editor, ROWS, tracking);
        if (tracking) editor.setViewMode('redlines');
        await frames();
        await place(editor, cellOf(editor, 2, 1).textFrom);
        editor.commands.run('table.selectTable');
        await frames();
        press(editor, 'Backspace');
        await frames();
        if (
          editor.view.contentDOM.querySelectorAll('.rl-tbl').length !== 1 ||
          ghostTables(editor).length ||
          rect(editor)?.whole !== 'table'
        )
          problems[`${label}-table-first`] = [
            editor.view.contentDOM.querySelectorAll('.rl-tbl').length,
            ghostTables(editor).length,
            rect(editor)?.whole,
          ];
        press(editor, 'Backspace');
        await frames();
        if (editor.view.contentDOM.querySelector('.rl-tbl') || tablesOf(editor.view.state).length)
          problems[`${label}-table-second`] = 'a table of the document is still drawn';
        if (tracking) {
          const [ghost] = ghostTables(editor);
          if (ghostTables(editor).length !== 1 || ghost?.dataset['rows'] !== '4')
            problems[`${label}-ghost`] = ghostTables(editor).map((g) => g.dataset['rows']);
          // The clearing is folded into the deletion: the table is drawn as it read before it.
          if (ghost && gridTexts(ghostGrid(ghost))[2] !== 'Plums|4|ok')
            problems[`${label}-ghost-text`] = gridTexts(ghostGrid(ghost));
        } else if (doc(editor) !== 'Intro.\n\nBelow.') {
          problems[`${label}-table-text`] = doc(editor);
        }
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
];

export async function runTableCheck(editor: Editor): Promise<void> {
  // For a person at the console, to look at what a check found.
  (window as unknown as { tableCheckEditor: Editor }).tableCheckEditor = editor;
  let passed = 0;
  let failed = 0;
  for (const check of CHECKS) {
    try {
      const failure = await check.run(editor);
      if (failure) {
        failed++;
        console.log(`TABLE-CHECK ${check.name} FAIL ${JSON.stringify(failure)}`);
      } else {
        passed++;
        console.log(`TABLE-CHECK ${check.name} pass`);
      }
    } catch (error) {
      failed++;
      console.log(`TABLE-CHECK ${check.name} FAIL ${JSON.stringify({ threw: String(error) })}`);
    }
  }
  editor.setTracking(false, { inFile: false });
  editor.reloadDoc(sample);
  console.log(`TABLE-CHECK done ${passed} passed, ${failed} failed`);
}
