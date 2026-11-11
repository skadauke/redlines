// @vitest-environment happy-dom
// What Return, typing and Backspace cost (design: block editing, "Cost"), measured against main's
// own build. The same file runs in a checkout of main (`REDLINES_COST=record` prints the numbers
// in the form `MAIN` below holds), where the keys are CodeMirror's own; here the keys are the block
// keys. Both go through `runScopeHandlers`, on 16 KB and 150 KB documents with 200 marks, in one
// process, Track Changes on and off. The recorded numbers are scaled by how fast this machine runs
// a fixed piece of work next to the one they were recorded on (`CALIBRATION`), and a key may take
// at most twice what main's takes (plus a millisecond for noise).
import { forceParsing } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { GFM } from '@lezer/markdown';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { trackedFormat } from '@redlines/format';
import { createEditor, type Editor } from '../index.ts';
import { selectedCells } from '../table/cells.ts';
import { tablesOf } from '../table/model.ts';
import { deleteCols, deleteRows, insertCols, moveCols, moveRows } from '../table/ops.ts';
import { idFor, longDocument } from '../test-documents.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const WORDS = 'the quick brown fox jumps over a lazy dog while reviewers read every line twice';

/** A document of about `bytes` bytes, with `marks` of Bo's marks spread over its paragraphs. */
function documentOf(bytes: number, marks: number): string {
  const paragraphs: string[] = [];
  for (let n = 0; paragraphs.join('\n\n').length < bytes; n++) {
    paragraphs.push(n % 12 === 0 ? `## Section ${n}` : `${WORDS} ${n}, with *emphasis* and more.`);
  }
  // Every word a mark can go on, spread evenly over the paragraphs: 200 of them.
  const slots: [number, string][] = [];
  paragraphs.forEach((text, p) => {
    for (const word of ['quick', 'lazy', 'reviewers']) {
      if (text.includes(` ${word} `)) slots.push([p, word]);
    }
  });
  const ids: string[] = [];
  for (let k = 0; k < marks; k++) {
    const [p, word] = slots[Math.floor((k * slots.length) / marks)]!;
    const id = idFor(k);
    ids.push(id);
    paragraphs[p] = paragraphs[p]!.replace(` ${word} `, ` <!--ins ${id}-->${word}<!--/${id}--> `);
  }
  const entries = ids.map((id) => `  ${id}: {by: bo, at: 2026-10-31T09:30Z}\n`).join('');
  return `${paragraphs.join('\n\n')}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries}-->\n`;
}

const press = (view: EditorView, key: string) =>
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, bubbles: true }), 'editor');

const ROUNDS = 20;
const record = process.env['REDLINES_COST'] === 'record';

/** A fixed piece of work, in milliseconds: the yardstick that scales the recorded numbers. */
function calibrate(): number {
  const text = WORDS.repeat(2000);
  const run = () => {
    const start = performance.now();
    let n = 0;
    for (let i = 0; i < 60; i++)
      n += text
        .split(' ')
        .map((w) => w.toUpperCase())
        .join('-').length;
    return performance.now() - start + n * 0;
  };
  run();
  return median([run(), run(), run(), run(), run()]);
}

type Pair = 'return' | 'shift' | 'type';

/** Milliseconds per pair of keys: Return or Shift-Return then Backspace, or a typed letter then
 * Backspace. */
function time(editor: Editor, at: number, pair: Pair): number {
  const { view } = editor;
  const start = performance.now();
  for (let i = 0; i < ROUNDS; i++) {
    view.dispatch({ selection: EditorSelection.cursor(at) });
    if (pair === 'return') press(view, 'Enter');
    else if (pair === 'shift') {
      view.dispatch({ selection: EditorSelection.cursor(at) });
      runScopeHandlers(
        view,
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
        'editor',
      );
    } else
      view.dispatch({
        changes: { from: at, insert: 'x' },
        selection: EditorSelection.cursor(at + 1),
        userEvent: 'input.type',
      });
    press(view, 'Backspace');
  }
  return (performance.now() - start) / ROUNDS;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

/** A timing and the bound it is held to, both taken in the same attempt. */
type Held = { ours: number; limit: number };

/**
 * Holds a timing to its bound as a busy runner allows. A runner slowed for a moment slows the
 * timing and leaves its yardstick (the calibration, or the document's parse), timed before it, as
 * it was. So a first attempt over its bound is taken twice more, each time with its yardstick timed
 * again next to it, and the attempt nearest its own bound is the one held to it.
 */
function held(first: Held, again: () => Held): Held {
  let best = first;
  for (let n = 0; n < 2 && best.ours >= best.limit; n++) {
    const next = again();
    if (next.ours / next.limit < best.ours / best.limit) best = next;
  }
  return best;
}

/**
 * Main's own numbers (`4ca53fc`), milliseconds per pair of keys, on the machine whose calibration
 * is `CALIBRATION`. Keyed `size, Track Changes, where, pair`.
 */
const CALIBRATION = 98.5;
const MAIN: Record<string, number> = {
  '16 KB, Track Changes on, middle, return': 20.33,
  '16 KB, Track Changes on, middle, type': 19.18,
  '16 KB, Track Changes on, end, return': 14.56,
  '16 KB, Track Changes on, end, type': 18.89,
  '16 KB, Track Changes off, middle, return': 10.14,
  '16 KB, Track Changes off, middle, type': 9.83,
  '16 KB, Track Changes off, end, return': 9.89,
  '16 KB, Track Changes off, end, type': 9.75,
  '150 KB, Track Changes on, middle, return': 39.84,
  '150 KB, Track Changes on, middle, type': 39.57,
  '150 KB, Track Changes on, end, return': 37.97,
  '150 KB, Track Changes on, end, type': 39.94,
  '150 KB, Track Changes off, middle, return': 12.5,
  '150 KB, Track Changes off, middle, type': 11.31,
  '150 KB, Track Changes off, end, return': 12.15,
  '150 KB, Track Changes off, end, type': 11.15,
};

// A timing test: it runs when REDLINES_COST is set (`check`, or `record` to write main's numbers),
// as CI's check job does, and is skipped otherwise, since a machine busy with other work can't time it.
describe.skipIf(!process.env['REDLINES_COST'])('the cost of Return, typing and Backspace', () => {
  it.each([
    ['16 KB', 16_000],
    ['150 KB', 150_000],
  ] as const)(
    'costs at most twice what main’s build costs, on %s with 200 marks',
    (size, bytes) => {
      const doc = documentOf(bytes, 200);
      expect((doc.match(/<!--ins /g) ?? []).length).toBe(200);
      const scale = record ? 1 : calibrate() / CALIBRATION;
      for (const tracking of [true, false]) {
        const parent = document.createElement('div');
        document.body.append(parent);
        const editor = createEditor(parent, { doc, author: ada, tracking });
        open.push(editor);
        const text = editor.view.state.doc.toString();
        const middle = text.indexOf('brown fox', text.length >> 1) + 'brown '.length;
        const end = text.indexOf('more.', text.length >> 1) + 'more.'.length;
        for (const [where, at] of [
          ['middle', middle],
          ['end', end],
        ] as const) {
          for (const pair of ['return', 'shift', 'type'] as const) {
            const before = editor.view.state.doc.toString();
            time(editor, at, pair);
            const runs: number[] = [];
            for (let i = 0; i < 7; i++) runs.push(time(editor, at, pair));
            // Main's Backspace takes its own Return back, but its tracked layer may leave marks.
            if (!record && pair !== 'type') {
              expect(editor.view.state.doc.toString(), 'the keys put it back').toBe(before);
            } else if (record) {
              console.log(`changed: ${editor.view.state.doc.length - text.length}`);
            }
            const label = `${size}, Track Changes ${tracking ? 'on' : 'off'}, ${where}, ${pair}`;
            const ours = median(runs);
            if (record && pair === 'shift') continue;
            if (record) {
              console.log(`MAIN ${JSON.stringify(label)}: ${ours.toFixed(2)},`);
              continue;
            }
            // Shift-Return is measured against main's Return, which it replaces at a block's end.
            const main = MAIN[label.replace('shift', 'return')];
            expect(main, `${label}: main's number is recorded`).toBeTypeOf('number');
            const result = held({ ours, limit: 2 * main! * scale + 1 }, () => {
              const limit = 2 * main! * (calibrate() / CALIBRATION) + 1;
              const more: number[] = [];
              for (let i = 0; i < 7; i++) more.push(time(editor, at, pair));
              return { ours: median(more), limit };
            });
            console.log(
              `cost: ${label}: main ${((result.limit - 1) / 2).toFixed(2)} ms, now ${result.ours.toFixed(2)} ms`,
            );
            expect(result.ours, label).toBeLessThan(result.limit);
          }
        }
      }
      if (record) console.log(`CALIBRATION ${calibrate().toFixed(2)}`);
    },
    600_000,
  );
});

// A typed letter and Backspace in a cell of a 300-row table in the long document (tables, Task
// 1.18), measured against main's own build as above. Main draws the table as a widget and its keys
// are CodeMirror's; the numbers are medians of 7 runs of 20 pairs, recorded in the same process as
// `TABLE_CALIBRATION`, on a development Mac.
const TABLE_CALIBRATION = 96.3;
const TABLE_MAIN: Record<string, number> = {
  'Track Changes on, cell, type': 36.81,
  'Track Changes off, cell, type': 14.19,
};

// A timing test too: it runs with REDLINES_COST set, as CI's check job does, since a busy machine
// can't time it.
describe.skipIf(!process.env['REDLINES_COST'])('the cost of a keystroke in a table', () => {
  it('costs at most twice what main’s build costs, in a cell of a 300-row table', () => {
    const { doc } = longDocument({ table: true });
    const scale = record ? 1 : calibrate() / TABLE_CALIBRATION;
    for (const tracking of [true, false]) {
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, { doc, author: ada, tracking });
      open.push(editor);
      const text = editor.view.state.doc.toString();
      const at = text.indexOf('item 150 |') + 'item 150 | 150 | place 150 | the'.length;
      time(editor, at, 'type');
      const runs: number[] = [];
      for (let i = 0; i < 7; i++) runs.push(time(editor, at, 'type'));
      const label = `Track Changes ${tracking ? 'on' : 'off'}, cell, type`;
      const ours = median(runs);
      if (record) {
        console.log(`MAIN ${JSON.stringify(label)}: ${ours.toFixed(2)},`);
        continue;
      }
      const main = TABLE_MAIN[label];
      expect(main, `${label}: main's number is recorded`).toBeTypeOf('number');
      const result = held({ ours, limit: 2 * main! * scale + 1 }, () => {
        const limit = 2 * main! * (calibrate() / TABLE_CALIBRATION) + 1;
        const more: number[] = [];
        for (let i = 0; i < 7; i++) more.push(time(editor, at, 'type'));
        return { ours: median(more), limit };
      });
      console.log(
        `cost: ${label}: main ${((result.limit - 1) / 2).toFixed(2)} ms, now ${result.ours.toFixed(2)} ms`,
      );
      expect(result.ours, label).toBeLessThan(result.limit);
    }
    if (record) console.log(`TABLE_CALIBRATION ${calibrate().toFixed(2)}`);
  }, 600_000);
});

// The same keystroke in the same cell while a deleted column and an inserted one are pending in the table
// (tables, Stage 3b): the ghosts and the tinted cells are looked for on every update, and must cost what a
// keystroke costs on main (twice it, as the table's own does). A timing test.
describe.skipIf(!process.env['REDLINES_COST'])(
  'the cost of a keystroke in a table with columns pending',
  () => {
    it('costs at most twice what main’s build costs, in a cell of a 300-row table', () => {
      const { doc } = longDocument({ table: true });
      const scale = record ? 1 : calibrate() / TABLE_CALIBRATION;
      for (const tracking of [true, false]) {
        const parent = document.createElement('div');
        document.body.append(parent);
        const editor = createEditor(parent, { doc, author: ada, tracking });
        open.push(editor);
        const { view } = editor;
        forceParsing(view, view.state.doc.length, 10_000);
        const inColumn = (col: number) => tablesOf(view.state)[0]!.rows[150]!.cells[col]!.textFrom;
        // A deleted column and an inserted one (with Track Changes off the columns go as text, so the
        // table is as wide as it was and the cell is the same).
        view.dispatch({ selection: EditorSelection.cursor(inColumn(4)) });
        deleteCols(view);
        view.dispatch({ selection: EditorSelection.cursor(inColumn(1)) });
        insertCols(view, true);
        if (tracking) {
          expect(view.dom.querySelector('.rl-ghost-col')).not.toBeNull();
          expect(view.state.doc.toString()).toMatch(/<!--ins \w+ col-->/);
        }
        const text = view.state.doc.toString();
        const at = text.indexOf('item 150 |') + 'item 150 | 150 | place 150 | the'.length;
        time(editor, at, 'type');
        const runs: number[] = [];
        for (let i = 0; i < 7; i++) runs.push(time(editor, at, 'type'));
        const label = `Track Changes ${tracking ? 'on' : 'off'}, cell, type`;
        const ours = median(runs);
        if (record) continue;
        const main = TABLE_MAIN[label];
        expect(main, `${label}: main's number is recorded`).toBeTypeOf('number');
        const result = held({ ours, limit: 2 * main! * scale + 1 }, () => {
          const limit = 2 * main! * (calibrate() / TABLE_CALIBRATION) + 1;
          const more: number[] = [];
          for (let i = 0; i < 7; i++) more.push(time(editor, at, 'type'));
          return { ours: median(more), limit };
        });
        console.log(
          `cost: columns pending, ${label}: main ${((result.limit - 1) / 2).toFixed(2)} ms, now ${result.ours.toFixed(2)} ms`,
        );
        expect(result.ours, label).toBeLessThan(result.limit);
      }
    }, 600_000);
  },
);

// A letter typed and deleted with Track Changes off in a cell of a pending move's copy (tables, Stage 3b):
// the edit is written in both halves of the move (the cell and the kept copy), and must cost what a
// keystroke in any other cell costs on main. A timing test: it runs with REDLINES_COST set, and a run over
// the bound is timed twice more, each time with the calibration, before it fails.
describe.skipIf(!process.env['REDLINES_COST'])('the cost of a keystroke in a moved cell', () => {
  it('costs at most twice what main’s build costs, in a moved column and a moved row', () => {
    const { doc } = longDocument({ table: true });
    const scale = record ? 1 : calibrate() / TABLE_CALIBRATION;
    for (const axis of ['column', 'row'] as const) {
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, { doc, author: ada, tracking: true });
      open.push(editor);
      const { view } = editor;
      forceParsing(view, view.state.doc.length, 10_000);
      const cellOf = (row: number, col: number) => tablesOf(view.state)[0]!.rows[row]!.cells[col]!;
      if (axis === 'column') {
        view.dispatch({ selection: EditorSelection.cursor(cellOf(150, 2).textFrom) });
        moveCols(view, true);
      } else {
        view.dispatch({ selection: EditorSelection.cursor(cellOf(150, 0).textFrom) });
        moveRows(view, true);
      }
      expect(view.state.doc.toString()).toMatch(axis === 'column' ? /col=\d+ / : /row=\d+ /);
      editor.setTracking(false);
      // The copy: the moved column, in row 150, or the moved row, which is row 149 now.
      const target = axis === 'column' ? cellOf(150, 1) : cellOf(149, 1);
      const at = target.textFrom + 1;
      time(editor, at, 'type');
      const label = 'Track Changes off, cell, type';
      const main = TABLE_MAIN[label];
      expect(main, `${label}: main's number is recorded`).toBeTypeOf('number');
      const attempt = (yardstick: number): Held => {
        const runs: number[] = [];
        for (let i = 0; i < 7; i++) runs.push(time(editor, at, 'type'));
        return { ours: median(runs), limit: 2 * main! * yardstick + 1 };
      };
      const result = held(attempt(scale), () => attempt(calibrate() / TABLE_CALIBRATION));
      console.log(
        `cost: moved ${axis}, ${label}: main ${((result.limit - 1) / 2).toFixed(2)} ms, now ${result.ours.toFixed(2)} ms`,
      );
      expect(result.ours, `a moved ${axis}`).toBeLessThan(result.limit);
    }
  }, 600_000);
});

// A rectangle of cells over the whole of the same table (tables, Stage 2): a selection from the first
// cell to the last (1,500 cells drawn as selected), then the caret back. The selection is no state of
// its own, so this is a selection transaction and the decorations of the cells, and it may cost no
// more than the keystroke does: twice main's pair of keys in a cell, as above. A timing test: it runs
// with REDLINES_COST set.
describe.skipIf(!process.env['REDLINES_COST'])(
  'the cost of a rectangle selection in a table',
  () => {
    it('costs at most twice what main’s keystroke costs, over a 300-row table', () => {
      const { doc } = longDocument({ table: true });
      const scale = record ? 1 : calibrate() / TABLE_CALIBRATION;
      for (const tracking of [true, false]) {
        const parent = document.createElement('div');
        document.body.append(parent);
        const editor = createEditor(parent, { doc, author: ada, tracking });
        open.push(editor);
        const { view } = editor;
        forceParsing(view, view.state.doc.length, 10_000);
        view.dispatch({ selection: EditorSelection.cursor(0) });
        const text = view.state.doc.toString();
        const first = text.indexOf('| item 0 |') + 2;
        const last = text.indexOf('owner', text.indexOf('| item 299 |')) + 'owner'.length + 2;
        const round = () => {
          const start = performance.now();
          for (let i = 0; i < ROUNDS; i++) {
            view.dispatch({ selection: EditorSelection.range(first, last) });
            view.dispatch({ selection: EditorSelection.cursor(first) });
          }
          return (performance.now() - start) / ROUNDS;
        };
        view.dispatch({ selection: EditorSelection.range(first, last) });
        expect(selectedCells(view.state)).toHaveLength(1500);
        view.dispatch({ selection: EditorSelection.cursor(first) });
        round();
        const runs: number[] = [];
        for (let i = 0; i < 7; i++) runs.push(round());
        const label = `Track Changes ${tracking ? 'on' : 'off'}, cell, type`;
        const ours = median(runs);
        if (record) continue;
        const main = TABLE_MAIN[label];
        expect(main, `${label}: main's number is recorded`).toBeTypeOf('number');
        const result = held({ ours, limit: 2 * main! * scale + 1 }, () => {
          const limit = 2 * main! * (calibrate() / TABLE_CALIBRATION) + 1;
          const more: number[] = [];
          for (let i = 0; i < 7; i++) more.push(round());
          return { ours: median(more), limit };
        });
        console.log(
          `cost: rectangle over the table, ${label}: main's keystroke ${((result.limit - 1) / 2).toFixed(2)} ms, now ${result.ours.toFixed(2)} ms`,
        );
        expect(result.ours, label).toBeLessThan(result.limit);
      }
    }, 600_000);
  },
);

// A row moved in the same table (tables, Stage 3a): the row in the middle one place up and back. A move
// is one command, not a keystroke: the format plans it and the editor reads and draws the table again
// (the whole table's layout is rebuilt when its shape changes), so it is held to what the document's own
// parse costs, as the long-document tests hold an update, but with more of it: a move measures about
// 5 times the parse with Track Changes on (the format plans it in about 14 ms, with the views the
// placement checks read, and the editor reads and draws the table again in about 19) and 4 times with
// it off, where an update is bound to 2; the bound is 6 parses and two milliseconds for noise. With Track Changes on, the table has a deleted row, whose ghost is drawn and looked for on
// every update. A timing test: it runs with REDLINES_COST set, and a run over the bound is timed twice
// more, each time with the parse, before it fails.
const MOVE_PARSES = 6;

function parseTime(doc: string): number {
  const runs: number[] = [];
  for (let i = 0; i < 6; i++) {
    const start = performance.now();
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [markdown({ extensions: [GFM] })] }),
      parent: document.body,
    });
    forceParsing(view, doc.length, 10_000);
    if (i > 0) runs.push(performance.now() - start);
    view.destroy();
  }
  return median(runs);
}

describe.skipIf(!process.env['REDLINES_COST'])('the cost of moving a row in a table', () => {
  it('costs at most 6 times the document’s parse, in a 300-row table', () => {
    const { doc } = longDocument({ table: true });
    for (const tracking of [true, false]) {
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, { doc, author: ada, tracking });
      open.push(editor);
      const { view } = editor;
      forceParsing(view, view.state.doc.length, 10_000);
      const at = (item: number) => view.state.doc.toString().indexOf(`item ${item} |`) + 2;
      if (tracking) {
        view.dispatch({ selection: EditorSelection.cursor(at(20)) });
        deleteRows(view);
        expect(view.dom.querySelector('.rl-ghost')).not.toBeNull();
      }
      const pair = () => {
        const start = performance.now();
        for (let i = 0; i < 4; i++) {
          view.dispatch({ selection: EditorSelection.cursor(at(150)) });
          moveRows(view, true);
          view.dispatch({ selection: EditorSelection.cursor(at(150)) });
          moveRows(view, false);
        }
        return (performance.now() - start) / 8;
      };
      pair();
      const attempt = (): Held => {
        const limit = MOVE_PARSES * parseTime(view.state.doc.toString()) + 2;
        const runs: number[] = [];
        for (let i = 0; i < 5; i++) runs.push(pair());
        return { ours: median(runs), limit };
      };
      const result = held(attempt(), attempt);
      console.log(
        `cost: row move, Track Changes ${tracking ? 'on' : 'off'}: bound ${result.limit.toFixed(2)} ms, now ${result.ours.toFixed(2)} ms`,
      );
      expect(result.ours, `Track Changes ${tracking ? 'on' : 'off'}`).toBeLessThan(result.limit);
    }
  }, 600_000);
});

// A column moved in the same table (tables, Stage 3b): the third column one place left and back. A
// column is a cell in each of the 301 lines, so a move writes every line, and the editor reads and
// draws the table again; it is held to the document's parse as a row move is, with a bound found
// the same way: a column move measures about 7 times the parse (the format plans it in about 13 ms,
// and the editor writes it as one change, since 301 scattered changes made the syntax tree read the
// table 301 times, 130 ms, and draws it again in about 17), so the bound is 10 parses and two
// milliseconds. With Track Changes on, the table has a deleted column, whose ghosts (a cell in every
// row) are drawn and looked for on every update. A timing test: it runs with REDLINES_COST set, and a
// run over the bound is timed twice more, each time with the parse, before it fails.
const COLUMN_PARSES = 10;

describe.skipIf(!process.env['REDLINES_COST'])('the cost of moving a column in a table', () => {
  it('costs at most 10 times the document’s parse, in a 300-row table', () => {
    const { doc } = longDocument({ table: true });
    for (const tracking of [true, false]) {
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, { doc, author: ada, tracking });
      open.push(editor);
      const { view } = editor;
      forceParsing(view, view.state.doc.length, 10_000);
      const inColumn = (col: number) => {
        const table = tablesOf(view.state)[0]!;
        return table.rows[150]!.cells[col]!.textFrom;
      };
      if (tracking) {
        view.dispatch({ selection: EditorSelection.cursor(inColumn(4)) });
        deleteCols(view);
        expect(view.dom.querySelector('.rl-ghost-col')).not.toBeNull();
      }
      const pair = () => {
        const start = performance.now();
        for (let i = 0; i < 4; i++) {
          view.dispatch({ selection: EditorSelection.cursor(inColumn(2)) });
          moveCols(view, true);
          view.dispatch({ selection: EditorSelection.cursor(inColumn(1)) });
          moveCols(view, false);
        }
        return (performance.now() - start) / 8;
      };
      pair();
      const attempt = (): Held => {
        const limit = COLUMN_PARSES * parseTime(view.state.doc.toString()) + 2;
        const runs: number[] = [];
        for (let i = 0; i < 5; i++) runs.push(pair());
        return { ours: median(runs), limit };
      };
      const result = held(attempt(), attempt);
      console.log(
        `cost: column move, Track Changes ${tracking ? 'on' : 'off'}: bound ${result.limit.toFixed(2)} ms, now ${result.ours.toFixed(2)} ms`,
      );
      expect(result.ours, `Track Changes ${tracking ? 'on' : 'off'}`).toBeLessThan(result.limit);
    }
  }, 600_000);
});

// A tracked key in a hand-wrapped paragraph of 200 lines, in a file that has a table somewhere (so
// a pipe is in the text): the format asks whether a table row can be pipe-less here, and must answer
// from the paragraph and not from every table of the file. At most twice the same key in the same
// paragraph in a file with no pipe at all (plus a millisecond).
describe.skipIf(!process.env['REDLINES_COST'])(
  'the cost of a tracked key in a long paragraph',
  () => {
    it('is not more for a file that has a pipe', () => {
      const paragraph = Array.from({ length: 200 }, (_, n) => `${WORDS} line ${n}`).join('\n');
      const table = '| a | b |\n| - | - |\n| 1 | 2 |';
      const bare = `${paragraph}\n\nAfter.\n`;
      const piped = `${table}\n\n${paragraph}\n\nAfter.\n`;
      const measure = (doc: string) => {
        const parent = document.createElement('div');
        document.body.append(parent);
        const editor = createEditor(parent, { doc, author: ada, tracking: true });
        open.push(editor);
        const at = editor.view.state.doc.toString().indexOf('line 100') + 'line 100'.length;
        time(editor, at, 'type');
        const runs: number[] = [];
        for (let i = 0; i < 7; i++) runs.push(time(editor, at, 'type'));
        return median(runs);
      };
      const attempt = (): Held => {
        const without = measure(bare);
        return { ours: measure(piped), limit: 2 * without + 1 };
      };
      const result = held(attempt(), attempt);
      console.log(
        `cost: 200-line paragraph, tracked key: no pipe ${((result.limit - 1) / 2).toFixed(2)} ms, a pipe ${result.ours.toFixed(2)} ms`,
      );
      expect(result.ours).toBeLessThan(result.limit);
    }, 120_000);
  },
);

// Tab on an item of a list under review, in a list numbered 1, 2, 3 and in a bulleted one, with 20
// pending changes in the items below it (format §2.6, rule 6): a numbered item with a number other
// than 1 reads the lines above it, and the marks of the items below must not be tried for it, nor
// read again once for each of them. At most twice the bulleted list's time (plus a millisecond).
describe.skipIf(!process.env['REDLINES_COST'])('the cost of Tab in a numbered list', () => {
  it('is at most twice what it is in a bulleted list, with 20 pending changes below', () => {
    const ids = Array.from(
      { length: 20 },
      (_, i) => `k${'bcdfghjkmnpqrstvwxz'[i % 19]}${'ab'[Math.floor(i / 19)]}x9`,
    );
    const list = (numbered: boolean) => {
      const rows = [
        numbered ? '1. one' : '- one',
        numbered ? '2. two' : '- two',
        ...ids.map(
          (id, i) =>
            `${numbered ? `${i + 3}.` : '-'} item ${i} <!--ins ${id}-->new <!--/${id}-->words`,
        ),
      ];
      const marks = ids.map((id) => `  ${id}: {by: bo, at: 2026-10-13T22:30Z}\n`).join('');
      return `${rows.join('\n')}\n\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo}\n  ada: {name: Ada}\nmarks:\n${marks}-->\n`;
    };
    const tab = (text: string) => {
      const at = text.indexOf('two');
      const start = performance.now();
      trackedFormat(
        text,
        { from: at, to: at },
        { kind: 'indent', by: 1 },
        {
          author: ada,
          time: '2026-10-31T09:00Z',
          random: (n) => crypto.getRandomValues(new Uint8Array(n)),
        },
      );
      return performance.now() - start;
    };
    const measure = (text: string) => {
      for (let i = 0; i < 5; i++) tab(text);
      const runs: number[] = [];
      for (let i = 0; i < 15; i++) runs.push(tab(text));
      return median(runs);
    };
    const attempt = (): Held => {
      const bulleted = measure(list(false));
      return { ours: measure(list(true)), limit: 2 * bulleted + 1 };
    };
    const result = held(attempt(), attempt);
    console.log(
      `cost: Tab with 20 changes below: bulleted ${((result.limit - 1) / 2).toFixed(2)} ms, numbered ${result.ours.toFixed(2)} ms`,
    );
    expect(result.ours).toBeLessThan(result.limit);
  }, 120_000);
});

// A typed letter and Backspace in the middle of a fenced code block of 200 lines, in a document with
// paragraphs around it (Stage 6, format rule 9). With Track Changes on the first key replaces the
// block whole, and the keys after it edit the newest code, which the block's own pending substitution
// holds. Each case is held to what the long-document tests hold an update to: twice the document's
// markdown parse and two milliseconds for noise (`bound`, as in `preview/long-document.test.ts`).
// A timing test: it runs with REDLINES_COST set, and a run over the bound is timed twice more, each
// time with the parse, before it fails.
const bound = (parse: number) => 2 * parse + 2;

function codeDocument(lines = 200): string {
  const paragraph = (n: number) => `${WORDS} ${n}, with *emphasis* and more.`;
  const code = Array.from(
    { length: lines },
    (_, n) => `  const value${n} = compute(${n}, 'text ${n}'); // line ${n}`,
  );
  return [
    ...Array.from({ length: 6 }, (_, n) => paragraph(n)),
    ['```ts', ...code, '```'].join('\n'),
    ...Array.from({ length: 6 }, (_, n) => paragraph(n + 6)),
  ].join('\n\n');
}

describe.skipIf(!process.env['REDLINES_COST'])('the cost of a keystroke in code', () => {
  const doc = codeDocument();

  /** Milliseconds per typed letter and Backspace in the middle of the code. `fresh`: the file is
   * the one it started from before each pair, so that the letter is the first key in the block. */
  function codeTime(editor: Editor, fresh: boolean): number {
    const { view } = editor;
    const rounds = fresh ? 10 : ROUNDS;
    let total = 0;
    for (let i = 0; i < rounds; i++) {
      // The file as it started (a reload keeps Track Changes on, as `setDoc` does not).
      if (fresh) editor.reloadDoc(doc);
      // The last one: a substitution's payload, in its marker, has the line too.
      const at = view.state.doc.toString().lastIndexOf('line 100') + 'line 1'.length;
      view.dispatch({ selection: EditorSelection.cursor(at) });
      const start = performance.now();
      view.dispatch({
        changes: { from: at, insert: 'x' },
        selection: EditorSelection.cursor(at + 1),
        userEvent: 'input.type',
      });
      press(view, 'Backspace');
      total += performance.now() - start;
    }
    return total / rounds;
  }

  it.each([
    ['Track Changes on, with the substitution made', true, false],
    ['Track Changes off', false, false],
  ] as const)(
    'is at most twice the document’s parse plus 2 ms: %s',
    (label, tracking, fresh) => {
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, { doc, author: ada, tracking });
      open.push(editor);
      forceParsing(editor.view, editor.view.state.doc.length, 10_000);
      expect(editor.view.state.doc.toString()).toContain('line 100');
      // The case with the substitution made starts with the first key made.
      if (tracking && !fresh) codeTime(editor, true);
      codeTime(editor, fresh);
      const attempt = (): Held => {
        const limit = bound(parseTime(doc));
        const runs: number[] = [];
        for (let i = 0; i < 7; i++) runs.push(codeTime(editor, fresh));
        return { ours: median(runs), limit };
      };
      const result = held(attempt(), attempt);
      console.log(
        `cost: code, ${label}: bound ${result.limit.toFixed(2)} ms, now ${result.ours.toFixed(2)} ms`,
      );
      if (tracking) {
        const marks = (editor.view.state.doc.toString().match(/<!--sub /g) ?? []).length;
        expect(marks, 'one substitution for the block').toBe(1);
      }
      expect(result.ours, label).toBeLessThan(result.limit);
    },
    120_000,
  );
});

describe.skipIf(!process.env['REDLINES_COST'])('the cost of the first key in code', () => {
  /** Milliseconds per typed letter and Backspace, the file as it started before each pair: in the
   * middle of the code (`where` finds it), or in a paragraph. */
  function pair(editor: Editor, doc: string, find: (text: string) => number): number {
    const { view } = editor;
    let total = 0;
    const rounds = 10;
    for (let i = 0; i < rounds; i++) {
      editor.reloadDoc(doc);
      const at = find(view.state.doc.toString());
      view.dispatch({ selection: EditorSelection.cursor(at) });
      const start = performance.now();
      view.dispatch({
        changes: { from: at, insert: 'x' },
        selection: EditorSelection.cursor(at + 1),
        userEvent: 'input.type',
      });
      press(view, 'Backspace');
      total += performance.now() - start;
    }
    return total / rounds;
  }

  it.each([200, 2000])(
    'is at most twice a key in a paragraph of the same document, plus 1 ms: %i lines',
    (lines) => {
      const doc = codeDocument(lines);
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, { doc, author: ada, tracking: true });
      open.push(editor);
      forceParsing(editor.view, editor.view.state.doc.length, 10_000);
      const inCode = (text: string) => text.lastIndexOf('line 100') + 'line 1'.length;
      const inParagraph = (text: string) => text.indexOf('quick brown', 100) + 'quick '.length;
      pair(editor, doc, inCode);
      pair(editor, doc, inParagraph);
      // The paragraph key is timed beside the code key, so that a slow moment slows both.
      const attempt = (): Held => {
        const code: number[] = [];
        const paragraph: number[] = [];
        for (let i = 0; i < 7; i++) {
          code.push(pair(editor, doc, inCode));
          paragraph.push(pair(editor, doc, inParagraph));
        }
        return { ours: median(code), limit: 2 * median(paragraph) + 1 };
      };
      const result = held(attempt(), attempt);
      console.log(
        `cost: first key in code, ${lines} lines: bound ${result.limit.toFixed(2)} ms (twice a paragraph key plus 1), now ${result.ours.toFixed(2)} ms`,
      );
      pair(editor, doc, inCode);
      expect(editor.view.state.doc.toString()).toContain('<!--sub ');
      expect(result.ours, `${lines} lines`).toBeLessThan(result.limit);
    },
    300_000,
  );
});
