// Debug only: checks tables in WebKit, where happy-dom can't, because they need a real layout and
// WebKit's own hit-testing and editing: the columns line up, no stray cells, presses land in the cell
// under the pointer (empty cells, a `<br>`, a pipe in a code span), ↑ and ↓ move between cells at the
// same x, WebKit's own typing (`document.execCommand('insertText')`) lands in a cell, an empty cell
// and after a `<br>`, a selection that reaches into a table draws its cells, and a keystroke in a
// 300-row table stays within the budget. Serve the page with `VITE_TABLE_CHECK=1 pnpm dev` (or
// `pnpm tauri dev`, for WKWebView) and open it in WebKit: it reads nothing in a release build.
//
// Each check loads its document and does what a person does, and reports one console line,
// `TABLE-CHECK <name> pass` or `TABLE-CHECK <name> FAIL <json>`, then
// `TABLE-CHECK done <passed> passed, <failed> failed`. A check fails unless the behavior really
// happened: where it found nothing to measure, it says so and fails.

import { EditorSelection } from '@codemirror/state';
import type { Editor, Table, TableCell } from '@redlines/editor';
import { tablesOf } from '@redlines/editor';
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

type Problems = Record<string, unknown> | null;

interface Check {
  name: string;
  run(editor: Editor): Promise<Problems> | Problems;
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
        const color = getComputedStyle(el).backgroundColor;
        const box = el.getBoundingClientRect();
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
