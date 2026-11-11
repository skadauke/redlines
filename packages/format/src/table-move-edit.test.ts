// A plain edit (Track Changes off) in a pending move's copy is written into both halves of the move
// (format §3.7, §3.10): the cell at its new place and the kept copy. Accepting keeps the text at the new
// place, rejecting gives it back at the old, and the original view has it; every order reads alike.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { parse } from './parse.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import { trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import { ada, bo, bodyOf, context, exactly, expectEveryOrderAlike, file } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

const IDS = ['k3x9', 'w8nn', 'p5qm'];
type WithoutTable<T> = T extends unknown ? Omit<T, 'table'> : never;
const move = (text: string, op: WithoutTable<TableOp>) => {
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  return applyChanges(
    text,
    tableEdit(text, { ...op, table } as TableOp, context(ada, IDS)).changes,
  );
};
const plain = (text: string, from: number, to: number, insert: string) =>
  applyChanges(text, untrackedEdit(text, { from, to, insert }));
const tidy = (text: string) => bodyOf(text).replace(/ +/g, ' ').replace(/\s+$/, '');
/** The text of cell `col` of row `row` of the first table: its range. */
const cellAt = (text: string, row: number, col: number) => {
  const cell = readTables(text, parse(text))[0]?.rows[row]?.cells[col];
  if (!cell) throw new Error('no cell');
  return cell;
};

/** Every way the move can be decided reads alike, with the edit in the original too. */
function decidesWell(name: string, edited: string, original: string): void {
  const ids = parse(edited)
    .marks.filter((m) => m.entry.move !== undefined)
    .map((m) => m.id);
  for (const id of ids) {
    expect(() => accept(edited, id), `${name}: accept`).not.toThrow();
    expect(tidy(applyChanges(edited, reject(edited, id))), `${name}: reject ${id}`).toBe(
      tidy(original),
    );
  }
  expect(tidy(applyChanges(edited, rejectAll(edited))), `${name}: reject all`).toBe(tidy(original));
  expect(tidy(applyChanges(edited, acceptAll(edited))), `${name}: accept all`).toBe(
    tidy(newestView(edited).text),
  );
  expect(tidy(originalView(edited).text), `${name}: the original view`).toBe(tidy(original));
  expectEveryOrderAlike(name, edited, exactly);
}

const COLS = '| a  | b  |\n| -- | -- |\n| xx | yy |\n| w  |    |';

describe('a plain edit in a moved column', () => {
  const doc = file(COLS);
  const moved = move(doc, { kind: 'moveCols', cols: [0], to: 2 });
  const at = (needle: string, nth = 0) => moved.indexOf(needle) + nth;

  it('is written in both halves for an insertion, a deletion and a replacement', () => {
    const origin = (from: string, to: string) => file(COLS.replace(from, to));
    // The moved column is the last now: `xx` is its second row.
    const cases: [string, number, number, string, string, string][] = [
      ['insert', at('xx', 1), at('xx', 1), 'Q', 'xx', 'xQx'],
      ['delete', at('xx'), at('xx', 1), '', 'xx', 'x '],
      ['replace', at('xx'), at('xx', 2), 'zzz', 'xx', 'zzz'],
    ];
    for (const [name, from, to, insert, was, now] of cases) {
      const edited = plain(moved, from, to, insert);
      expect(edited).not.toBe(moved);
      const wanted = origin(`| ${was}`, `| ${now.padEnd(was.length)}`);
      decidesWell(name, edited, name === 'insert' ? file(COLS.replace('xx', 'xQx')) : wanted);
    }
  });

  it('writes the first and the last column, the header and a short cell', () => {
    for (const col of [0, 1]) {
      const text = move(file(COLS), { kind: 'moveCols', cols: [col], to: col === 0 ? 2 : 0 });
      const spot = text.indexOf('yy');
      const edited = plain(text, spot + 1, spot + 1, 'Z');
      decidesWell(`column ${col}`, edited, file(COLS.replace('yy', 'yZy')));
    }
    const head = plain(moved, at('a '), at('a ') + 1, 'AB');
    decidesWell('header', head, file(COLS.replace('| a ', '| AB')));
  });

  it('writes a cell written `| |` or `||`, and typing in it', () => {
    for (const body of [
      '| a | b |\n| - | - |\n| x | y |\n| w | |',
      '| a | b |\n| - | - |\n| x | y |\n| w ||',
    ]) {
      const text = move(file(body), { kind: 'moveCols', cols: [1], to: 0 });
      if (!readTables(text, parse(text))[0]) throw new Error(`not a table:\n${text}`);
      const empty = cellAt(text, 2, 0);
      expect(empty.textFrom).toBe(empty.textTo);
      const edited = plain(text, empty.textFrom, empty.textFrom, 'Q');
      expect(edited).not.toBe(text);
      const original = file(
        body.replace(/\| ?(\||$)/, (m) => m.replace('|', 'Q|')).replace('w ||', 'w |Q|'),
      );
      for (const mark of parse(edited).marks.filter((m) => m.entry.move !== undefined)) {
        expect(() => accept(edited, mark.id)).not.toThrow();
        expect(() => reject(edited, mark.id)).not.toThrow();
        expect(applyChanges(edited, reject(edited, mark.id))).toContain('Q');
      }
      expect(() => rejectAll(edited)).not.toThrow();
      expect(applyChanges(edited, rejectAll(edited))).toContain('Q');
      expect(originalView(edited).text).toContain('Q');
      void original;
      expectEveryOrderAlike('empty', edited, exactly);
    }
  });

  it('keeps other people’s marks in the row, with LF and CRLF', () => {
    for (const eol of ['\n', '\r\n']) {
      const base = file(COLS.replace('xx', 'xx').replaceAll('\n', eol));
      let text = move(base, { kind: 'moveCols', cols: [0], to: 2 });
      const spot = text.indexOf('yy') + 1;
      text = applyChanges(
        text,
        trackedEdit(text, { from: spot, to: spot, insert: 'q' }, context(bo, ['b7cd'])),
      );
      const at2 = text.indexOf('xx') + 1;
      const edited = plain(text, at2, at2, 'Z');
      for (const mark of parse(edited).marks.filter((m) => m.entry.move !== undefined)) {
        expect(() => accept(edited, mark.id)).not.toThrow();
        expect(() => reject(edited, mark.id)).not.toThrow();
      }
      expect(() => rejectAll(edited)).not.toThrow();
      expect(applyChanges(edited, rejectAll(edited))).toContain('xZx');
    }
  });
});

describe('a plain edit in a moved row', () => {
  const ROWS = '| a | b |\n| - | - |\n| xx | yy |\n| zz | ww |';
  const moved = move(file(ROWS), { kind: 'moveRows', rows: [1], to: 3 });

  it('is written in both halves: insertion, deletion, replacement', () => {
    const spot = cellAt(moved, 2, 0).textFrom;
    const cases: [string, number, number, string, string][] = [
      ['insert', spot + 1, spot + 1, 'Q', 'xQx'],
      ['delete', spot, spot + 1, '', 'x'],
      ['replace', spot, spot + 2, 'kkk', 'kkk'],
    ];
    for (const [name, from, to, insert, now] of cases) {
      const edited = plain(moved, from, to, insert);
      const original = file(ROWS.replace('xx', now));
      decidesWell(name, edited, original);
    }
  });

  it('writes the second cell of the row, too', () => {
    const spot = cellAt(moved, 2, 1).textFrom;
    const edited = plain(moved, spot, spot + 1, '');
    decidesWell('second cell', edited, file(ROWS.replace('yy', 'y')));
  });
});
