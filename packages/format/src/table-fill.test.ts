// Typing into a cell that a row doesn't have (format §3.7, "A cell a row lacks"): GFM reads a row
// with fewer cells than the header as having blank cells after its last, and the editor draws them.
// Text typed into one writes the pipes it needs first, plain (rule 7: both versions have them, and
// nothing reads differently), and the text after them, as typing in a cell is written: an insertion
// with Track Changes on, plain text with it off. Judged against micromark's reading of the tables.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { tableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import {
  ada,
  blockLeaves,
  bo,
  bodyOf,
  context,
  expectEveryOrderAlike,
  expectInOrder,
  expectNoDecisionRefused,
  file,
} from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

const ONE_LINE = 'In a table, write a pipe as \\| and a line break as <br>.';
const HEAD = '| a | b | c |\n| --- | --- | --- |\n';
const rowsOf = (text: string) => blockLeaves(text).find((leaf) => leaf.kind === 'table')?.rows;
const exact = (text: string) => bodyOf(text).replace(/\s+$/, '');

/** The op's changes made to `body` as a file: tracked by Ada, or plain. */
function fill(
  body: string,
  row: number,
  col: number,
  typed?: string,
  tracked = true,
  ids: string[] = ['k3x9'],
) {
  const text = file(body);
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  const op: TableOp = {
    kind: 'fillCells',
    table,
    row,
    col,
    ...(typed === undefined ? {} : { text: typed }),
  };
  const done = tracked ? tableEdit(text, op, context(ada, ids)) : untrackedTableEdit(text, op);
  return { text, done, after: applyChanges(text, done.changes) };
}

describe('typing into a cell the row lacks', () => {
  it('writes the pipes plain and the text as an insertion, in the second missing cell', () => {
    const { text, done, after } = fill(`${HEAD}| 1 |`, 1, 2, 'x');
    expect(exact(after)).toBe(`${HEAD}| 1 | | <!--ins k3x9-->x<!--/k3x9--> |`);
    // The caret is in the insertion, after the typed text.
    expect(done.caret).toBe(after.indexOf('<!--/k3x9-->'));
    expect(exact(newestView(after).text)).toBe(`${HEAD}| 1 | | x |`);
    expect(exact(originalView(after).text)).toBe(`${HEAD}| 1 | |  |`);
    // The pipes are no change: the original reads as the file did.
    expect(rowsOf(originalView(after).text)).toEqual(rowsOf(text));
    expect(rowsOf(newestView(after).text)).toEqual([
      ['a', 'b', 'c'],
      ['1', '', 'x'],
    ]);
    expect(parse(after).marks.map((mark) => mark.kind)).toEqual(['ins']);
    expectInOrder('second missing cell', [], after);
    expectEveryOrderAlike('second missing cell', after);
    // Accepting leaves the text, rejecting a table that reads like the original.
    expect(exact(applyChanges(after, acceptAll(after)))).toBe(`${HEAD}| 1 | | x |`);
    expect(exact(applyChanges(after, rejectAll(after)))).toBe(`${HEAD}| 1 | |  |`);
  });

  it('does the same in the first missing cell', () => {
    const { text, done, after } = fill(`${HEAD}| 1 |`, 1, 1, 'x');
    expect(exact(after)).toBe(`${HEAD}| 1 | <!--ins k3x9-->x<!--/k3x9--> |`);
    expect(done.caret).toBe(after.indexOf('<!--/k3x9-->'));
    expect(exact(originalView(after).text)).toBe(`${HEAD}| 1 |  |`);
    expect(rowsOf(originalView(after).text)).toEqual(rowsOf(text));
    expectEveryOrderAlike('first missing cell', after);
  });

  it('writes plain text with the same bytes, with Track Changes off', () => {
    const tracked = fill(`${HEAD}| 1 |`, 1, 2, 'x');
    const plain = fill(`${HEAD}| 1 |`, 1, 2, 'x', false);
    expect(exact(plain.after)).toBe(`${HEAD}| 1 | | x |`);
    expect(exact(plain.after)).toBe(exact(newestView(tracked.after).text));
    expect(plain.done.caret).toBe(plain.after.indexOf('x') + 1);
    // No mark, no ledger entry.
    expect(parse(plain.after).marks).toEqual([]);
    expect(plain.after.endsWith(plain.text.slice(plain.text.indexOf('\n\n<!-- redlines')))).toBe(
      true,
    );
  });

  it('writes only the pipes when there is no text: plain with Track Changes on and off', () => {
    for (const tracked of [true, false]) {
      const first = fill(`${HEAD}| 1 |`, 1, 1, undefined, tracked);
      expect(exact(first.after)).toBe(`${HEAD}| 1 |  |`);
      // The caret stands in the cell now there, the stop an empty cell has.
      expect(first.done.caret).toBe(
        first.after.indexOf('|  |', first.after.indexOf('| 1 |') + 4) + 2,
      );
      expect(rowsOf(first.after)).toEqual(rowsOf(first.text));
      const second = fill(`${HEAD}| 1 |`, 1, 2, '', tracked);
      expect(exact(second.after)).toBe(`${HEAD}| 1 | |  |`);
      expect(second.done.caret).toBe(second.after.lastIndexOf('|  |') + 2);
      expect(rowsOf(second.after)).toEqual(rowsOf(second.text));
      // Nothing is pending: no mark, and the ledger is as it was.
      expect(parse(second.after).marks).toEqual([]);
      expect(second.after.slice(second.after.indexOf('\n\n<!-- redlines'))).toBe(
        second.text.slice(second.text.indexOf('\n\n<!-- redlines')),
      );
    }
  });

  // The forms a row can have: a leading pipe, a closing pipe, both, neither, or one lone pipe.
  const FORMS: [string, string, number, string, string][] = [
    // [name, row, column, typed, the row after]
    ['a leading and a closing pipe', '| 1 |', 1, 'x', '| 1 | x |'],
    ['a closing pipe and spaces after it', '| 1 |   ', 1, 'x', '| 1 |    x |'],
    ['no leading pipe', '1 | 2 |', 2, 'x', '1 | 2 | x |'],
    ['no closing pipe', '| 1 | 2', 2, 'x', '| 1 | 2 | x'],
    ['neither', '1 | 2', 2, 'x', '1 | 2 | x'],
    ['neither, one cell', '1', 1, 'x', '1 | x'],
    ['no closing pipe, two missing cells in', '| 1', 2, 'x', '| 1 | | x'],
    ['a lone pipe, the first missing cell', '|', 1, 'x', '| | x'],
    ['a lone pipe, the second missing cell', '|', 2, 'x', '| | | x'],
    ['an empty last cell', '| 1 |  |', 2, 'x', '| 1 |  | x |'],
  ];
  for (const [name, row, col, typed, expected] of FORMS) {
    it(`reads the same in every order, and as the table did: ${name}`, () => {
      const text = file(`${HEAD}${row}`);
      for (const tracked of [true, false]) {
        const done = fill(`${HEAD}${row}`, 1, col, typed, tracked);
        const label = `${name}, ${tracked ? 'tracked' : 'plain'}`;
        const newest = tracked ? exact(newestView(done.after).text) : exact(done.after);
        expect(newest, label).toBe(`${HEAD}${expected}`);
        // The cell the text is in, and the cells before it, as micromark reads them.
        const cells = rowsOf(newest)?.[1] ?? [];
        expect(cells[col], label).toBe(typed);
        expect(cells, label).toHaveLength(3);
        if (tracked) {
          // Both versions have the pipes: the original reads as the table did.
          expect(rowsOf(originalView(done.after).text), label).toEqual(rowsOf(text));
          expectInOrder(label, [], done.after);
          expectEveryOrderAlike(label, done.after);
          expect(exact(applyChanges(done.after, acceptAll(done.after))), label).toBe(newest);
          expect(rowsOf(applyChanges(done.after, rejectAll(done.after))), label).toEqual(
            rowsOf(text),
          );
        }
      }
    });
  }

  it('leaves the file’s line breaks as they are, in a CRLF file, and writes none', () => {
    const body = `${HEAD}| 1 |\n| 2 | 3 | 4 |\n\nAfter.`.replaceAll('\n', '\r\n');
    const text = `${body}\r\n`;
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const lines = (s: string) => s.split('\r\n');
    for (const tracked of [true, false]) {
      const op: TableOp = { kind: 'fillCells', table, row: 1, col: 2, text: 'x' };
      const done = tracked
        ? tableEdit(text, op, context(ada, ['k3x9']))
        : untrackedTableEdit(text, op);
      const after = applyChanges(text, done.changes);
      // Every line break the file has is the file's own: a CR and an LF, no more of them.
      expect(after.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      const rows = lines(bodyOf(after)).slice(0, 5);
      expect(rows[2]).toBe(tracked ? '| 1 | | <!--ins k3x9-->x<!--/k3x9--> |' : '| 1 | | x |');
      expect(rows[3]).toBe('| 2 | 3 | 4 |');
      // No line was added or taken away.
      expect(lines(bodyOf(after).replace(/\s+$/, ''))).toHaveLength(lines(body).length);
      if (tracked) {
        const back = applyChanges(after, rejectAll(after));
        expect(back.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
        expect(lines(bodyOf(back))[2]).toBe('| 1 | |  |');
        expect(lines(bodyOf(back))[3]).toBe('| 2 | 3 | 4 |');
      }
    }
    // The pipes alone, too.
    const pipes = untrackedTableEdit(text, { kind: 'fillCells', table, row: 1, col: 1 });
    const written = applyChanges(text, pipes.changes);
    expect(written.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines(bodyOf(written))[2]).toBe('| 1 |  |');
  });

  it('takes a typed pipe as the format does: refused, and the escaped one is no pipe', () => {
    for (const tracked of [true, false]) {
      expect(() => fill(`${HEAD}| 1 |`, 1, 2, 'a|b', tracked)).toThrow(ONE_LINE);
      expect(() => fill(`${HEAD}| 1 |`, 1, 2, 'a\nb', tracked)).toThrow(ONE_LINE);
      const ok = fill(`${HEAD}| 1 |`, 1, 2, 'a\\|b<br>c', tracked);
      expect(exact(newestView(ok.after).text)).toBe(`${HEAD}| 1 | | a\\|b<br>c |`);
      expect(rowsOf(newestView(ok.after).text)?.[1]).toEqual(['1', '', 'a|bc']);
    }
  });

  it('refuses a cell the row has, a row that is none, and a column the table lacks', () => {
    for (const tracked of [true, false]) {
      for (const [row, col] of [
        [1, 0],
        [0, 1],
        [2, 1],
        [1, 3],
        [1, -1],
        [1, 1.5],
      ] as const) {
        expect(() => fill(`${HEAD}| 1 |`, row, col, 'x', tracked), `${row},${col}`).toThrow(
          EditError,
        );
      }
    }
    const text = file(`${HEAD}| 1 |`);
    expect(() =>
      tableEdit(text, { kind: 'fillCells', table: 3, row: 1, col: 1 }, context(ada)),
    ).toThrow('There is no table there.');
  });

  it('writes the text of the author’s own inserted row as part of the row, with no mark', () => {
    const body = `${HEAD}| <!--ins k3x9 row--> 1 |`;
    const text = file(body, { k3x9: 'ada' });
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const done = tableEdit(
      text,
      { kind: 'fillCells', table, row: 1, col: 2, text: 'x' },
      context(ada, ['w8nn']),
    );
    const after = applyChanges(text, done.changes);
    expect(exact(after)).toBe(`${HEAD}| <!--ins k3x9 row--> 1 | | x |`);
    expect(parse(after).marks.map((mark) => mark.id)).toEqual(['k3x9']);
    expectEveryOrderAlike('own inserted row', after);
  });

  it('writes it as a change next to another person’s insertion in the row', () => {
    const body = `${HEAD}| <!--ins b7cd-->1<!--/b7cd--> |`;
    const text = file(body, { b7cd: 'bo' });
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const done = tableEdit(
      text,
      { kind: 'fillCells', table, row: 1, col: 1, text: 'x' },
      context(ada, ['k3x9']),
    );
    const after = applyChanges(text, done.changes);
    expect(exact(newestView(after).text)).toBe(`${HEAD}| 1 | x |`);
    expect(exact(originalView(after).text)).toBe(`${HEAD}|  |  |`);
    expectInOrder('next to bo', [], after);
    expectEveryOrderAlike('next to bo', after);
    expectNoDecisionRefused('next to bo', after);
    expect(bo.handle).toBe('bo');
  });

  describe('in the copy of a row that is moving', () => {
    // Bo moved the short row to the bottom: its copy has a marker, and its old place is kept below.
    const start = file(`${HEAD}| 1 |\n| 2 | 3 | 4 |`);
    const moved = applyChanges(
      start,
      tableEdit(
        start,
        {
          kind: 'moveRows',
          table: readTables(start, parse(start))[0]?.from ?? 0,
          rows: [1],
          to: 3,
        },
        context(bo, ['k3x9', 'w8nn']),
      ).changes,
    );
    const table = readTables(moved, parse(moved))[0]?.from ?? 0;

    it('writes plain text in both halves, so that the move reads alike either way', () => {
      const op: TableOp = { kind: 'fillCells', table, row: 2, col: 1, text: 'x' };
      const after = applyChanges(moved, untrackedTableEdit(moved, op).changes);
      expect(exact(newestView(after).text)).toBe(`${HEAD}| 2 | 3 | 4 |\n| 1 | x |`);
      expect(exact(originalView(after).text)).toBe(`${HEAD}| 1 | x |\n| 2 | 3 | 4 |`);
      expectInOrder('moved, plain', [], after);
      expectEveryOrderAlike('moved, plain', after);
      expectNoDecisionRefused('moved, plain', after);
    });

    it('is refused with Track Changes on, and for the pipes alone, naming the mover', () => {
      // Typed text can be written with Track Changes off, and the words say so; the pipes alone are
      // refused either way, and turning it off would not help.
      const typing =
        "Bo Chen's move of this row is pending. Decide it first, or turn off Track Changes.";
      const pipes = "Bo Chen's move of this row is pending. Decide it first.";
      expect(() =>
        tableEdit(
          moved,
          { kind: 'fillCells', table, row: 2, col: 1, text: 'x' },
          context(ada, ['p5qm']),
        ),
      ).toThrow(typing);
      expect(() =>
        tableEdit(moved, { kind: 'fillCells', table, row: 2, col: 1 }, context(ada)),
      ).toThrow(pipes);
      expect(() => untrackedTableEdit(moved, { kind: 'fillCells', table, row: 2, col: 1 })).toThrow(
        pipes,
      );
      expect(() =>
        tableEdit(
          moved,
          { kind: 'fillCells', table, row: 2, col: 1, text: 'x' },
          context(bo, ['p5qm']),
        ),
      ).toThrow('Your move of this row is pending. Decide it first, or turn off Track Changes.');
      expect(() =>
        tableEdit(moved, { kind: 'fillCells', table, row: 2, col: 1 }, context(bo)),
      ).toThrow('Your move of this row is pending. Decide it first.');
    });

    it('writes it in another short row of the table, in every order', () => {
      const two = file(`${HEAD}| 1 |\n| 5 |\n| 2 | 3 | 4 |`);
      const away = applyChanges(
        two,
        tableEdit(
          two,
          { kind: 'moveRows', table: readTables(two, parse(two))[0]?.from ?? 0, rows: [1], to: 4 },
          context(bo, ['k3x9', 'w8nn']),
        ).changes,
      );
      const first = readTables(away, parse(away))[0]?.from ?? 0;
      const done = tableEdit(
        away,
        { kind: 'fillCells', table: first, row: 1, col: 1, text: 'x' },
        context(ada, ['p5qm']),
      );
      const after = applyChanges(away, done.changes);
      expect(exact(newestView(after).text)).toBe(`${HEAD}| 5 | x |\n| 2 | 3 | 4 |\n| 1 |`);
      expectInOrder('another row', [], after);
      expectEveryOrderAlike('another row', after);
    });
  });

  it('writes it in a table where a column is pending, as typing in a cell of it', () => {
    const body = '| a | <!--ins k3x9 col--> b | c |\n| --- | --- | --- |\n| 1 |';
    const text = file(body, { k3x9: 'bo' });
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const done = tableEdit(
      text,
      { kind: 'fillCells', table, row: 1, col: 2, text: 'x' },
      context(ada, ['w8nn']),
    );
    const after = applyChanges(text, done.changes);
    expect(exact(newestView(after).text)).toContain('| 1 | | x |');
    expectEveryOrderAlike('a pending column', after);
  });

  it('reads the same in every order for random rows, columns and text, tracked or not', () => {
    const random = seeded(2026);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
    const WORDS = ['x', 'two words', ' lead', 'trail ', 'a\\|b', '**b**', '😀', 'é', '<br>'];
    for (let n = 0; n < fuzzCount(60); n++) {
      const columns = 3 + Math.floor(random() * 3);
      const head = `| ${Array.from({ length: columns }, (_, i) => String.fromCharCode(97 + i)).join(' | ')} |`;
      const rule = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
      const have = 1 + Math.floor(random() * (columns - 1));
      const cells = Array.from({ length: have }, (_, i) => (random() < 0.3 ? '' : String(i + 1)));
      // A row with or without its outer pipes (a lone pipe is `|` with an empty cell).
      const lead = random() < 0.7;
      const close = random() < 0.7;
      let row = cells.join(' | ');
      if (lead) row = `| ${row}`;
      if (close) row = `${row} |`;
      if (!lead && !close && have === 1 && cells[0] === '') row = '|';
      const body = `${head}\n${rule}\n${row}`;
      const text = file(body);
      const read = readTables(text, parse(text))[0];
      const miss = read?.rows[1]?.cells.length ?? columns;
      if (!read || miss >= columns) continue;
      const col = miss + Math.floor(random() * (columns - miss));
      const typed = pick(WORDS);
      const label = `${JSON.stringify(row)} col ${col} ${JSON.stringify(typed)}`;
      const results: string[] = [];
      for (const tracked of [true, false]) {
        const op: TableOp = { kind: 'fillCells', table: read.from, row: 1, col, text: typed };
        const done = tracked
          ? tableEdit(text, op, context(ada, ['k3x9']))
          : untrackedTableEdit(text, op);
        const after = applyChanges(text, done.changes);
        const newest = tracked ? newestView(after).text : after;
        results.push(exact(newest));
        const cellsNow = rowsOf(newest)?.[1] ?? [];
        expect(cellsNow, label).toHaveLength(columns);
        // The text is in its column, as micromark reads it, and the cells before it are as they were.
        expect(cellsNow[col]?.replace(/\s+/g, ' ').trim(), label).toBe(
          typed
            .replace(/<br>/g, '')
            .replace(/\\\|/g, '|')
            .replace(/\*\*/g, '')
            .trim()
            .replace(/\s+/g, ' '),
        );
        expect(cellsNow.slice(0, miss), label).toEqual((rowsOf(text)?.[1] ?? []).slice(0, miss));
        if (tracked) {
          expect(rowsOf(originalView(after).text), label).toEqual(rowsOf(text));
          expectInOrder(label, [], after);
          expectEveryOrderAlike(label, after);
        }
      }
      // The same bytes tracked and plain.
      expect(results[0], label).toBe(results[1]);
    }
  });
});
