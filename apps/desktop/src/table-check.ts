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
// made from the menu and the grip, and a keystroke in a 300-row
// table stays within the budget. Serve the page with `VITE_TABLE_CHECK=1 pnpm dev` (or
// `pnpm tauri dev`, for WKWebView) and open it in WebKit: it reads nothing in a release build.
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
  editor.setTracking(tracking);
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

/** The ghost cells of deleted columns, as the page draws them. */
const ghostCols = (editor: Editor): HTMLElement[] => [
  ...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tbl .rl-ghost-col'),
];

/** How far the cells of each row are from the cells of the first row, left edge by left edge, in px:
 * ghosts and all, the columns must line up in every row. */
function linedUp(editor: Editor): { cells: number[]; off: number } {
  const grid = cellElements(editor).map((row) =>
    row.map((cell) => cell.getBoundingClientRect().left),
  );
  const first = grid[0] ?? [];
  let off = 0;
  for (const row of grid) {
    if (row.length !== first.length) return { cells: grid.map((r) => r.length), off: Infinity };
    row.forEach((left, i) => (off = Math.max(off, Math.abs(left - (first[i] ?? 0)))));
  }
  return { cells: grid.map((r) => r.length), off };
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
          'Insert Row Above|Insert Row Below|Delete Row|Move Row Up|Move Row Down|Clear Contents'
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
          'Insert Column Left|Insert Column Right|Delete Column|Move Column Left|Move Column Right|Align Left|Align Center|Align Right|Default Alignment|Clear Contents'
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
    // Align Center from the Table menu's command, tracked: a format change around the table, the new
    // alignment in every row of the column, a dotted underline under its header text and a bar on the
    // header row in Redlines, the bar alone in Simple, nothing in Clean; its card names the column and
    // the old alignment; the columns still line up and the markers show nowhere.
    name: 'align-center-from-the-menu-tracked-draws-and-cards-the-change',
    async run(editor) {
      await load(editor, ROWS, true);
      await place(editor, cellOf(editor, 1, 1).textFrom);
      const problems: Record<string, unknown> = {};
      if (!editor.commands.run('table.alignCenter')) return { why: 'Align Center did nothing' };
      await frames();
      if (!/<!--fmt [a-z0-9]{4} align=/.test(doc(editor))) problems['change'] = doc(editor);
      if (!/\| :-+: \|/.test(doc(editor))) problems['delimiter'] = doc(editor);
      editor.setViewMode('redlines');
      await frames();
      const marked = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-fmt')];
      if (marked.map((el) => el.textContent).join('|') !== 'Count')
        problems['underlined'] = marked.map((el) => el.textContent);
      const underline = marked[0] && getComputedStyle(marked[0]);
      if (
        !underline?.textDecorationLine.includes('underline') ||
        underline.textDecorationStyle !== 'dotted'
      )
        problems['dotted'] = underline && [
          underline.textDecorationLine,
          underline.textDecorationStyle,
        ];
      const bars = lineElements(editor).map((line) => line.classList.contains('rl-bar'));
      if (bars.join() !== 'true,false,false,false') problems['bars'] = bars;
      if (alignedAs(editor, 1).some((a) => a !== 'center'))
        problems['centered'] = alignedAs(editor, 1);
      if (alignedAs(editor, 0).some((a) => a === 'center'))
        problems['others'] = alignedAs(editor, 0);
      const text = editor.view.contentDOM.textContent ?? '';
      if (/align=|<!--|:---:/.test(text)) problems['markers'] = text.slice(0, 120);
      const aligned = linedUp(editor);
      if (aligned.off > 0.5 || aligned.cells.some((n) => n !== 3)) problems['lines-up'] = aligned;
      // The card: a press on the underlined header text.
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
      editor.setViewMode('simple');
      await frames();
      if (editor.view.contentDOM.querySelector('.rl-fmt')) problems['simple-underline'] = 'drawn';
      const simpleBars = lineElements(editor).map((line) => line.classList.contains('rl-bar'));
      if (simpleBars.join() !== 'true,false,false,false') problems['simple-bars'] = simpleBars;
      if (alignedAs(editor, 1).some((a) => a !== 'center'))
        problems['simple-centered'] = alignedAs(editor, 1);
      editor.setViewMode('clean');
      await frames();
      if (lineElements(editor).some((line) => line.classList.contains('rl-bar')))
        problems['clean-bars'] = 'a row has a bar';
      if (alignedAs(editor, 1).some((a) => a !== 'center'))
        problems['clean-centered'] = alignedAs(editor, 1);
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
  editor.setTracking(false);
  editor.reloadDoc(sample);
  console.log(`TABLE-CHECK done ${passed} passed, ${failed} failed`);
}
