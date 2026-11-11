// @vitest-environment happy-dom
// What Return, typing and Backspace cost (design: block editing, "Cost"), measured against main's
// own build. The same file runs in a checkout of main (`REDLINES_COST=record` prints the numbers
// in the form `MAIN` below holds), where the keys are CodeMirror's own; here the keys are the block
// keys. Both go through `runScopeHandlers`, on 16 KB and 150 KB documents with 200 marks, in one
// process, Track Changes on and off. The recorded numbers are scaled by how fast this machine runs
// a fixed piece of work next to the one they were recorded on (`CALIBRATION`), and a key may take
// at most twice what main's takes (plus a millisecond for noise).
import { forceParsing } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';
import { type EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { selectedCells } from '../table/cells.ts';
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
            const bound = 2 * main! * scale + 1;
            console.log(
              `cost: ${label}: main ${(main! * scale).toFixed(2)} ms, now ${ours.toFixed(2)} ms`,
            );
            expect(ours, label).toBeLessThan(bound);
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
      console.log(
        `cost: ${label}: main ${(main! * scale).toFixed(2)} ms, now ${ours.toFixed(2)} ms`,
      );
      expect(ours, label).toBeLessThan(2 * main! * scale + 1);
    }
    if (record) console.log(`TABLE_CALIBRATION ${calibrate().toFixed(2)}`);
  }, 600_000);
});

// A rectangle of cells over the whole of the same table (tables, Stage 2): a selection from the first
// cell to the last (1,500 cells drawn as selected), then the caret back. The selection is no state of
// its own, so this is a selection transaction and the decorations of the cells, and it may cost no
// more than the keystroke does: twice main's pair of keys in a cell, as above.
describe('the cost of a rectangle selection in a table', () => {
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
      console.log(
        `cost: rectangle over the table, ${label}: main's keystroke ${(main! * scale).toFixed(2)} ms, now ${ours.toFixed(2)} ms`,
      );
      expect(ours, label).toBeLessThan(2 * main! * scale + 1);
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
      const without = measure(bare);
      const withPipe = measure(piped);
      console.log(
        `cost: 200-line paragraph, tracked key: no pipe ${without.toFixed(2)} ms, a pipe ${withPipe.toFixed(2)} ms`,
      );
      expect(withPipe).toBeLessThan(2 * without + 1);
    }, 120_000);
  },
);
