// A deletion that takes all the text of a bare row's first or last cell (format §3.7, rule 7): the
// neighbouring pipe would become the row's outer pipe and the table would lose a cell, a header one too
// few for the delimiter row. The outer pipe is written plain, in both versions, so that the table reads
// as it did with the cell empty, whether the deletion is tracked or not.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { parse } from './parse.ts';
import { tableEdit } from './table-ops.ts';
import { readTables } from './table.ts';
import { trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import {
  ada,
  blockLeaves,
  bo,
  bodyOf,
  context,
  exactly,
  expectEveryOrderAlike,
  file,
} from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

const BARE = 'x y  | b\n----- | -----\nc | d';
const widths = (text: string) =>
  blockLeaves(text)
    .filter((leaf) => leaf.kind === 'table')
    .map((leaf) => leaf.rows?.map((row) => row.length));
const exact = (text: string) => bodyOf(text).replace(/\s+$/, '');

describe('a plain deletion that empties a bare row’s first or last cell', () => {
  it('leaves the table with its cells: the last cell of the header', () => {
    const text = file(BARE);
    const at = text.indexOf('b');
    const done = applyChanges(text, untrackedEdit(text, { from: at, to: at + 1, insert: '' }));
    expect(exact(done)).toBe('x y  |  |\n----- | -----\nc | d');
    expect(widths(done)).toEqual([[2, 2]]);
  });

  it('leaves the table with its cells: the first cell, and a cell of a body row', () => {
    const text = file(BARE);
    const first = applyChanges(
      text,
      untrackedEdit(text, { from: text.indexOf('x y'), to: text.indexOf('x y') + 3, insert: '' }),
    );
    expect(exact(first)).toBe('|   | b\n----- | -----\nc | d');
    expect(widths(first)).toEqual([[2, 2]]);
    const at = text.indexOf('d');
    const body = applyChanges(text, untrackedEdit(text, { from: at, to: at + 1, insert: '' }));
    expect(exact(body)).toBe('x y  | b\n----- | -----\nc |  |');
    const lone = text.indexOf('c |');
    const head = applyChanges(text, untrackedEdit(text, { from: lone, to: lone + 1, insert: '' }));
    expect(exact(head)).toBe('x y  | b\n----- | -----\n|  | d');
    expect(widths(head)).toEqual([[2, 2]]);
  });

  it('takes the other edits as they are: a part of the cell, a replacement, a row with pipes', () => {
    const text = file(BARE);
    const at = text.indexOf('x y');
    const part = applyChanges(text, untrackedEdit(text, { from: at, to: at + 1, insert: '' }));
    expect(exact(part)).toBe(' y  | b\n----- | -----\nc | d');
    const replaced = applyChanges(text, untrackedEdit(text, { from: at, to: at + 3, insert: 'q' }));
    expect(exact(replaced)).toBe('q  | b\n----- | -----\nc | d');
    const piped = file('| x | b |\n| - | - |\n| c | d |');
    const p = piped.indexOf('x');
    expect(
      exact(applyChanges(piped, untrackedEdit(piped, { from: p, to: p + 1, insert: '' }))),
    ).toBe('|  | b |\n| - | - |\n| c | d |');
  });

  it('is no business of a line that is no row of a table', () => {
    const text = file('A line | with a pipe\n\nElse.');
    const at = text.indexOf('with a pipe');
    const done = applyChanges(
      text,
      untrackedEdit(text, { from: at, to: at + 'with a pipe'.length, insert: '' }),
    );
    expect(exact(done)).toBe('A line | \n\nElse.');
  });

  it('is decided like any move: a bare table with a column move pending', () => {
    const text = file(BARE);
    const table = readTables(text, parse(text))[0]!.from;
    const moved = applyChanges(
      text,
      tableEdit(text, { kind: 'moveCols', table, cols: [0], to: 2 }, context(ada, ['k3x9', 'w8nn']))
        .changes,
    );
    const cell = readTables(moved, parse(moved))[0]!.rows[1]!.cells[1]!;
    const done = applyChanges(
      moved,
      untrackedEdit(moved, { from: cell.textFrom, to: cell.textTo, insert: '' }),
    );
    expect(widths(newestView(done).text)).toEqual([[2, 2]]);
    expect(widths(originalView(done).text)).toEqual([[2, 2]]);
    expect(() => applyChanges(done, rejectAll(done))).not.toThrow();
    expect(() => applyChanges(done, acceptAll(done))).not.toThrow();
    expectEveryOrderAlike('moved, then emptied', done, exactly);
  });
});

describe('a tracked deletion that empties a bare row’s first or last cell', () => {
  it('writes the outer pipe plain, and every order reads the table with the cell empty', () => {
    for (const cell of ['b', 'x y']) {
      const text = file(BARE);
      const at = text.indexOf(cell);
      const done = applyChanges(
        text,
        trackedEdit(text, { from: at, to: at + cell.length, insert: '' }, context(bo, ['b7cd'])),
      );
      expect(parse(done).marks.map((m) => m.kind)).toEqual(['del']);
      expect(widths(newestView(done).text)).toEqual([[2, 2]]);
      expect(widths(originalView(done).text)).toEqual([[2, 2]]);
      expectEveryOrderAlike(`tracked ${cell}`, done, exactly);
      expect(widths(applyChanges(done, acceptAll(done)))).toEqual([[2, 2]]);
      expect(widths(applyChanges(done, rejectAll(done)))).toEqual([[2, 2]]);
    }
  });
});
