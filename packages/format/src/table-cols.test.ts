// Columns: inserted, deleted and moved, tracked as Word tracks them or plain, decided in any order and
// viewed (format §3.7, §3.9, §8).
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { encodeValue } from './format-ops.ts';
import { trackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { alignMarkOf } from './table-align.ts';
import { columnChanges, gridOf } from './table-cols.ts';
import type { ColItem } from './table-cols.ts';
import { joinPoints } from './table-rows.ts';
import { ruleTwo, tableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp, TablePending } from './table-ops.ts';
import { readLine, readTables } from './table.ts';
import type { TableRead } from './table.ts';
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
  expectInOrder,
  file,
  thread,
} from './test-helpers.ts';
import { newestView, originalView, reviewView } from './views.ts';

const FRUIT =
  '| Fruit  | Count | Price |\n| ------ | ----- | ----- |\n| Apples | 3     | 1.20  |\n| Pears  | 5     | 0.90  |';
const IDS = ['k3x9', 'w8nn', 'p5qm', 'q6rs'];
const trim = (text: string) => bodyOf(text).replace(/[\r\n]+$/, '');

type Shape =
  | { kind: 'insertCols'; after: number; count?: number }
  | { kind: 'deleteCols'; cols: number[] }
  | { kind: 'moveCols'; cols: number[]; to: number }
  | { kind: 'insertRows'; after: number }
  | { kind: 'deleteRows'; rows: number[] };

function edit(text: string, shape: Shape, who: typeof ada | null = ada, ids = IDS) {
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  const op = { count: 1, ...shape, table } as TableOp;
  const done = who ? tableEdit(text, op, context(who, ids)) : untrackedTableEdit(text, op);
  return { ...done, after: applyChanges(text, done.changes) };
}
const said = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof EditError ? error.message : String(error);
  }
  return 'no error';
};
const columnsOf = (text: string): number[] =>
  (blockLeaves(text).find((leaf) => leaf.kind === 'table')?.rows ?? []).map((row) => row.length);

describe('inserting columns, tracked (format §3.7)', () => {
  const start = file(FRUIT);

  it('writes a cell in every row, the marker in the header’s, in the table’s padding', () => {
    expect(trim(edit(start, { kind: 'insertCols', after: 1 }).after)).toBe(
      [
        '| Fruit  | <!--ins k3x9 col-->     | Count | Price |',
        '| ------ | --- | ----- | ----- |',
        '| Apples |     | 3     | 1.20  |',
        '| Pears  |     | 5     | 0.90  |',
      ].join('\n'),
    );
  });

  it('inserts at the start, in the middle and at the end', () => {
    for (const after of [0, 1, 2, 3]) {
      const done = edit(start, { kind: 'insertCols', after });
      expect(columnsOf(done.after), `after ${after}`).toEqual([4, 4, 4]);
      expect(done.cols).toEqual([after]);
      expect(parse(done.after).ledger.marks['k3x9']).toMatchObject({ by: 'ada' });
      expect(trim(newestView(done.after).text).split('\n')[0]?.split('|').length).toBe(6);
      expect(trim(originalView(done.after).text)).toBe(FRUIT);
    }
  });

  it('follows a table whose rows do not line up: narrow cells', () => {
    const narrow = file('| a | bb |\n| - | - |\n| cc | d |');
    expect(trim(edit(narrow, { kind: 'insertCols', after: 2 }).after)).toBe(
      '| a | bb | <!--ins k3x9 col-->  |\n| - | - | - |\n| cc | d |  |',
    );
  });

  it('puts several columns in one group, each with its own marker', () => {
    const done = edit(start, { kind: 'insertCols', after: 0, count: 2 });
    expect(columnsOf(done.after)).toEqual([5, 5, 5]);
    expect(done.cols).toEqual([0, 1]);
    const { marks } = parse(done.after).ledger;
    expect(marks['w8nn']?.group).toBe('k3x9');
    expect(marks['p5qm']?.group).toBe('k3x9');
  });

  it('writes the file’s own line breaks, and leaves a ragged row ragged', () => {
    const crlf = edit(file(FRUIT.replace(/\n/g, '\r\n')), { kind: 'insertCols', after: 1 });
    expect(bodyOf(crlf.after)).not.toMatch(/(?<!\r)\n/);
    expect(trim(originalView(crlf.after).text)).toBe(FRUIT.replace(/\n/g, '\r\n'));
    const ragged = file('| A | B | C |\n| - | - | - |\n| a1 | b1 |\n| a2 | b2 | c2 | d2 |');
    const done = edit(ragged, { kind: 'insertCols', after: 2 });
    expect(trim(done.after)).toBe(
      [
        '| A | B | <!--ins k3x9 col-->  | C |',
        '| - | - | - | - |',
        '| a1 | b1 |  |',
        '| a2 | b2 |  | c2 | d2 |',
      ].join('\n'),
    );
    expect(trim(originalView(done.after).text)).toBe(trim(ragged));
    const short = edit(ragged, { kind: 'insertCols', after: 3 });
    expect(trim(short.after).split('\n')[2]).toBe('| a1 | b1 |');
  });

  it('gives a row that has no pipe at its edges the pipes it needs', () => {
    const bare = file('Fruit | Count\n--- | ---\nApples | 3');
    const first = edit(bare, { kind: 'insertCols', after: 0 });
    expect(columnsOf(first.after)).toEqual([3, 3]);
    expect(columnsOf(originalView(first.after).text)).toEqual([2, 2]);
    const last = edit(bare, { kind: 'insertCols', after: 2 });
    expect(columnsOf(last.after)).toEqual([3, 3]);
    expect(columnsOf(originalView(last.after).text)).toEqual([2, 2]);
  });

  it('decides in every order, with a text edit in the column', () => {
    const done = edit(start, { kind: 'insertCols', after: 1 }).after;
    const typed = applyChanges(
      done,
      trackedEdit(
        done,
        { from: done.indexOf('Apples') + 9, to: done.indexOf('Apples') + 9, insert: 'Red' },
        context(bo, ['b7cd']),
      ),
    );
    expect(
      parse(typed)
        .marks.map((m) => m.id)
        .sort(),
    ).toEqual(['b7cd', 'k3x9']);
    expectEveryOrderAlike('typed in a new column', typed, exactly);
    // Rejecting the column takes the text typed in it, Bo’s mark and entry with it.
    const rejected = applyChanges(typed, reject(typed, 'k3x9'));
    expect(trim(rejected)).toBe(FRUIT);
    expect(parse(rejected).ledger.marks['b7cd']).toBeUndefined();
    // Accepting leaves Bo’s change pending.
    const accepted = applyChanges(typed, accept(typed, 'k3x9'));
    expect(parse(accepted).marks.map((m) => m.id)).toEqual(['b7cd']);
  });

  it('makes the text its author types in it part of the insertion, with no mark', () => {
    const done = edit(start, { kind: 'insertCols', after: 1 }).after;
    const at = done.indexOf('Apples') + 9;
    const mine = applyChanges(
      done,
      trackedEdit(done, { from: at, to: at, insert: 'Red' }, context(ada, [])),
    );
    expect(parse(mine).marks.map((m) => m.id)).toEqual(['k3x9']);
    expect(trim(mine)).toMatch(/\| Apples \| Red\s+\| 3/);
    expect(trim(applyChanges(mine, rejectAll(mine)))).toBe(FRUIT);
  });

  it('reads alike in every order whoever has a mark in the first and the last cells', () => {
    const rows = edit(start, { kind: 'insertRows', after: 1 }, bo, ['c2dd']).after;
    for (const after of [0, 3]) {
      const both = edit(rows, { kind: 'insertCols', after }).after;
      expectEveryOrderAlike(`row and column at ${after}`, both, exactly);
      expect(columnsOf(both)).toEqual([4, 4, 4, 4]);
    }
    const marked = start
      .replace('| Fruit ', '| <!--cmt c9qf-->Fruit<!--/c9qf--> ')
      .replace('0.90 ', '0.9<!--ins m2bd-->0<!--/m2bd-->');
    const withMarks = file(bodyOf(marked), { m2bd: 'bo' }, [
      '  c9qf:',
      '    by: bo',
      '    at: 2026-10-13T22:40Z',
      '    text: |-',
      '      A note.',
    ]);
    for (const after of [0, 1, 3]) {
      const done = edit(withMarks, { kind: 'insertCols', after }).after;
      expectEveryOrderAlike(`marks at ${after}`, done, exactly);
    }
  });

  it('refuses while a row is deleted or moved or an alignment change is pending, in words', () => {
    const deleted = edit(start, { kind: 'deleteRows', rows: [1] }).after;
    expect(said(() => edit(deleted, { kind: 'insertCols', after: 1 }))).toBe(
      'Accept or reject the row changes in this table first.',
    );
    expect(said(() => edit(deleted, { kind: 'insertCols', after: 1 }, null))).toBe(
      'Accept or reject the row changes in this table first.',
    );
    const above = edit(start, { kind: 'insertRows', after: -1 }).after;
    expect(said(() => edit(above, { kind: 'insertCols', after: 1 }, bo))).toBe(
      'Accept or reject the row changes in this table first.',
    );
    expect(said(() => edit(start, { kind: 'insertCols', after: 9 }))).toBe(
      'There is no such place in this table.',
    );
  });

  it('keeps a pending column’s header when a row would take its place', () => {
    const done = edit(start, { kind: 'insertCols', after: 1 }).after;
    const columns = 'Accept or reject the column changes in this table first.';
    expect(said(() => edit(done, { kind: 'insertRows', after: -1 }, bo))).toBe(columns);
    expect(said(() => edit(done, { kind: 'insertRows', after: -1 }, null))).toBe(columns);
    // A row below is allowed, tracked or not.
    expect(said(() => edit(done, { kind: 'insertRows', after: 0 }, bo))).toBe('no error');
    expect(said(() => edit(done, { kind: 'insertRows', after: 0 }, null))).toBe('no error');
  });

  it('takes the new column’s marker from the views as it takes it from accepting', () => {
    const done = edit(start, { kind: 'insertCols', after: 1 }).after;
    expect(applyChanges(done, acceptAll(done)).replace(/\s+$/, '')).toBe(
      newestView(done).text.replace(/\s+$/, ''),
    );
    expect(trim(newestView(done).text)).toBe(
      [
        '| Fruit  |     | Count | Price |',
        '| ------ | --- | ----- | ----- |',
        '| Apples |     | 3     | 1.20  |',
        '| Pears  |     | 5     | 0.90  |',
      ].join('\n'),
    );
    expect(reviewView(done)).toContain('{>>[k3x9 ada] Inserted column<<}');
  });
});

describe('inserting columns, plain', () => {
  it('writes the cells and no mark, and no ledger entry', () => {
    const done = edit(file(FRUIT), { kind: 'insertCols', after: 1 }, null);
    expect(parse(done.after).marks).toEqual([]);
    expect(columnsOf(done.after)).toEqual([4, 4, 4]);
    expect(trim(done.after).split('\n')[1]).toBe('| ------ | --- | ----- | ----- |');
  });
});

describe('deleting columns, tracked', () => {
  const start = file(FRUIT);

  it('keeps the column below the table after one blank line, its cells top to bottom', () => {
    const done = edit(start, { kind: 'deleteCols', cols: [1] });
    expect(trim(done.after)).toBe(
      [
        '| Fruit  | Price |',
        '| ------ | ----- |',
        '| Apples | 1.20  |',
        '| Pears  | 0.90  |',
        '',
        '<!--del k3x9 col=2  Count \\n -\\-\\-\\-\\- \\n 3     \\n 5     -->',
      ].join('\n'),
    );
    const mark = parse(done.after).marks.find((m) => m.id === 'k3x9');
    expect(mark?.payload).toBe('col=2  Count \n ----- \n 3     \n 5     ');
  });

  it('deletes the first column, the last, and two at once, in one group', () => {
    for (const cols of [[0], [2], [0, 2], [1, 2]]) {
      const done = edit(start, { kind: 'deleteCols', cols });
      expect(columnsOf(done.after), JSON.stringify(cols)).toEqual(Array(3).fill(3 - cols.length));
      expect(trim(originalView(done.after).text)).toBe(FRUIT);
      expect(applyChanges(done.after, rejectAll(done.after)).replace(/\s+$/, '')).toBe(
        originalView(done.after).text.replace(/\s+$/, ''),
      );
    }
    const two = edit(start, { kind: 'deleteCols', cols: [0, 2] });
    const { marks } = parse(two.after).ledger;
    expect(marks['w8nn']?.group).toBe('k3x9');
    expect(marks['p5qm']?.group).toBe('k3x9');
    expect(parse(two.after).marks.map((m) => m.payload?.slice(0, 5))).toEqual(['col=1', 'col=2']);
  });

  it('writes the column back at its place after other columns came and went', () => {
    const one = edit(start, { kind: 'deleteCols', cols: [0] }).after;
    const two = edit(one, { kind: 'insertCols', after: 0 }, bo, ['c2dd']).after;
    const back = applyChanges(two, reject(two, 'k3x9'));
    expect(trim(back)).toContain('| <!--ins c2dd col-->');
    expect(columnsOf(back)).toEqual([4, 4, 4]);
    expectEveryOrderAlike('deleted, then inserted at the start', two, exactly);
  });

  it('reads alike in every order with the other columns deleted and moved', () => {
    const one = edit(start, { kind: 'deleteCols', cols: [1] }).after;
    const seconds: Shape[] = [
      { kind: 'deleteCols', cols: [0] },
      { kind: 'deleteCols', cols: [1] },
      { kind: 'moveCols', cols: [0], to: 2 },
      { kind: 'insertCols', after: 1 },
    ];
    for (const second of seconds) {
      const two = edit(one, second, bo, ['c2dd', 'f3gg']).after;
      expectEveryOrderAlike(JSON.stringify(second), two, exactly);
      expect(trim(applyChanges(two, rejectAll(two)))).toBe(FRUIT);
    }
  });

  it('refuses to delete the last remaining column, with a way out', () => {
    expect(said(() => edit(start, { kind: 'deleteCols', cols: [0, 1, 2] }))).toBe(
      'Delete the table instead.',
    );
    const one = file('| a |\n| - |\n| b |');
    expect(said(() => edit(one, { kind: 'deleteCols', cols: [0] }))).toBe(
      'Delete the table instead.',
    );
  });

  it('removes your own pending column outright, and folds your own marks into the deletion', () => {
    const made = edit(start, { kind: 'insertCols', after: 1 }).after;
    const gone = edit(made, { kind: 'deleteCols', cols: [1] }, ada, ['c2dd']).after;
    expect(trim(gone)).toBe(FRUIT);
    expect(parse(gone).ledger.marks['k3x9']).toBeUndefined();
    // Your own insertion in a cell of a column you delete: the column keeps what it had before it.
    const typed = applyChanges(
      start,
      trackedEdit(
        start,
        { from: start.indexOf('3     '), to: start.indexOf('3     '), insert: 'x' },
        context(ada, ['b7cd']),
      ),
    );
    const deleted = edit(typed, { kind: 'deleteCols', cols: [1] }, ada, ['c2dd']).after;
    expect(parse(deleted).marks.find((m) => m.id === 'c2dd')?.payload).toBe(
      'col=2  Count \n ----- \n 3     \n 5     ',
    );
    expect(trim(originalView(deleted).text)).toBe(FRUIT);
  });

  it('writes the cells with their pending format changes rejected, as the original reads them', () => {
    const bold = applyChanges(
      start,
      trackedFormat(
        start,
        { from: start.indexOf('Apples'), to: start.indexOf('Apples') + 3 },
        { kind: 'inline', format: 'bold', on: true },
        context(ada, ['b7cd']),
      ).changes,
    );
    const done = edit(bold, { kind: 'deleteCols', cols: [0] }, ada, ['c2dd']).after;
    const payload = parse(done).marks.find((m) => m.id === 'c2dd')?.payload ?? '';
    expect(payload).not.toContain('**');
    expect(payload).toContain('Apples');
    expectEveryOrderAlike('a format change in a deleted column', done, exactly);
    expect(trim(originalView(done).text)).toBe(FRUIT);
  });

  it('rule 3: refuses another person’s pending change or insertion in the column', () => {
    const typed = applyChanges(
      start,
      trackedEdit(
        start,
        { from: start.indexOf('3     '), to: start.indexOf('3     '), insert: 'x' },
        context(bo, ['b7cd']),
      ),
    );
    expect(said(() => edit(typed, { kind: 'deleteCols', cols: [1] }))).toBe(
      "Bo Chen's pending change is in this column. Decide it first.",
    );
    // A column that is not theirs can be deleted.
    expect(said(() => edit(typed, { kind: 'deleteCols', cols: [0] }))).toBe('no error');
    const made = edit(start, { kind: 'insertCols', after: 1 }, bo, ['c2dd']).after;
    expect(said(() => edit(made, { kind: 'deleteCols', cols: [1] }))).toBe(
      "Bo Chen's inserted column is pending. Decide it first.",
    );
    const moved = edit(start, { kind: 'moveCols', cols: [0], to: 3 }, bo, ['c2dd', 'f3gg']).after;
    expect(said(() => edit(moved, { kind: 'deleteCols', cols: [2] }))).toBe(
      "Bo Chen's moved column is pending. Decide it first.",
    );
  });

  it('rule 4: a comment in a deleted column becomes a point comment in the cell after, or before for the last', () => {
    const thread = [
      '  c9qf:',
      '    by: bo',
      '    at: 2026-10-13T22:40Z',
      '    text: |-',
      '      A note.',
    ];
    const comment = file(FRUIT.replace('Count', '<!--cmt c9qf-->Count<!--/c9qf-->'), {}, thread);
    const done = edit(comment, { kind: 'deleteCols', cols: [1] }).after;
    expect(trim(done)).toContain('| Fruit  | <!--cmt c9qf-->Price |');
    expect(parse(done).ledger.comments.map((t) => t.id)).toEqual(['c9qf']);
    const last = file(FRUIT.replace('Price', '<!--cmt c9qf-->Price<!--/c9qf-->'), {}, thread);
    const end = edit(last, { kind: 'deleteCols', cols: [2] }).after;
    expect(trim(end)).toContain('| Count<!--cmt c9qf--> |');
    expectInOrder('comment', ['c9qf'], end);
  });

  it('rule 2: refuses with a row deleted or moved, or inserted, and not with columns pending', () => {
    const rows = 'Accept or reject the row changes in this table first.';
    const deleted = edit(start, { kind: 'deleteRows', rows: [1] }).after;
    expect(said(() => edit(deleted, { kind: 'deleteCols', cols: [1] }))).toBe(rows);
    const made = edit(start, { kind: 'insertRows', after: 1 }).after;
    expect(said(() => edit(made, { kind: 'deleteCols', cols: [1] }, bo, ['c2dd']))).toBe(rows);
    // With Track Changes off a pending row insertion is no obstacle.
    expect(said(() => edit(made, { kind: 'deleteCols', cols: [1] }, null))).toBe('no error');
    const col = edit(start, { kind: 'insertCols', after: 1 }).after;
    expect(said(() => edit(col, { kind: 'deleteCols', cols: [0] }, bo, ['c2dd']))).toBe('no error');
  });
});

describe('deleting columns, plain', () => {
  it('takes the cells out as text, with no deletion and no ledger entry', () => {
    const done = edit(file(FRUIT), { kind: 'deleteCols', cols: [1] }, null);
    expect(trim(done.after)).toBe(
      '| Fruit  | Price |\n| ------ | ----- |\n| Apples | 1.20  |\n| Pears  | 0.90  |',
    );
    expect(parse(done.after).marks).toEqual([]);
    expect(parse(done.after).ledger.marks).toEqual({});
  });

  it('keeps the marker of an inserted row with its row when the first column goes', () => {
    const made = edit(file(FRUIT), { kind: 'insertRows', after: 1 }).after;
    const done = edit(made, { kind: 'deleteCols', cols: [0] }, null).after;
    expect(trim(done)).toContain('| <!--ins k3x9 row-->');
    expectEveryOrderAlike('row and plain column', done, exactly);
  });

  it('takes the deletion of a move with the moved column', () => {
    const moved = edit(file(FRUIT), { kind: 'moveCols', cols: [0], to: 3 }).after;
    const done = edit(moved, { kind: 'deleteCols', cols: [2] }, null).after;
    expect(parse(done).marks).toEqual([]);
    expect(columnsOf(done)).toEqual([2, 2, 2]);
  });

  it('refuses to leave only pending columns, the original having none', () => {
    const made = edit(file('| a | b |\n| - | - |\n| c | d |'), {
      kind: 'insertCols',
      after: 1,
    }).after;
    expect(said(() => edit(made, { kind: 'deleteCols', cols: [0, 2] }, null))).toBe(
      'Accept or reject the column changes in this table first.',
    );
  });
});

describe('moving columns (format §3.7)', () => {
  const start = file(FRUIT);

  it('writes the column at its new place with the in-row marker, and the old place as a deletion', () => {
    const done = edit(start, { kind: 'moveCols', cols: [0], to: 3 });
    expect(trim(done.after)).toBe(
      [
        '| Count | Price | <!--ins k3x9 col--> Fruit  |',
        '| ----- | ----- | ------ |',
        '| 3     | 1.20  | Apples |',
        '| 5     | 0.90  | Pears  |',
        '',
        '<!--del w8nn col=1  Fruit  \\n -\\-\\-\\-\\-\\- \\n Apples \\n Pears  -->',
      ].join('\n'),
    );
    expect(done.cols).toEqual([2]);
    const { marks } = parse(done.after).ledger;
    expect(marks['k3x9']?.move).toBe('w8nn');
    expect(marks['w8nn']?.move).toBe('k3x9');
  });

  it('moves a column to the start, the middle and the end, and several together', () => {
    for (const [cols, to] of [
      [[2], 0],
      [[0], 2],
      [[1], 3],
      [[0, 1], 3],
      [[1, 2], 0],
    ] as const) {
      const done = edit(start, { kind: 'moveCols', cols: [...cols], to }, ada, [
        ...IDS,
        'c2dd',
        'f3gg',
        'h4jj',
      ]);
      const name = `${cols.join(',')} to ${to}`;
      expect(columnsOf(done.after), name).toEqual([3, 3, 3]);
      expect(trim(originalView(done.after).text), name).toBe(FRUIT);
      expectEveryOrderAlike(name, done.after, exactly);
    }
  });

  it('decides as one change from either half, with accept all and reject all', () => {
    const done = edit(start, { kind: 'moveCols', cols: [0], to: 3 }).after;
    for (const id of ['k3x9', 'w8nn']) {
      expect(trim(applyChanges(done, accept(done, id)))).toBe(trim(newestView(done).text));
      expect(trim(applyChanges(done, reject(done, id)))).toBe(FRUIT);
    }
    expect(parse(applyChanges(done, acceptAll(done))).marks).toEqual([]);
    expect(trim(applyChanges(done, rejectAll(done)))).toBe(FRUIT);
  });

  it('takes another person’s changes along, and what was typed since, both ways', () => {
    const done = edit(start, { kind: 'moveCols', cols: [0], to: 3 }).after;
    const at = done.indexOf('Apples') + 3;
    const typed = applyChanges(
      done,
      trackedEdit(done, { from: at, to: at, insert: 'QQ' }, context(bo, ['b7cd'])),
    );
    expect(trim(applyChanges(typed, reject(typed, 'k3x9')))).toContain('| App<!--ins b7cd-->QQ');
    expectEveryOrderAlike('typed in a moved column', typed, exactly);
    // Another person’s change in the column does not stop the move.
    const bos = applyChanges(
      start,
      trackedEdit(
        start,
        { from: start.indexOf('Apples') + 3, to: start.indexOf('Apples') + 3, insert: 'QQ' },
        context(bo, ['b7cd']),
      ),
    );
    const moved = edit(bos, { kind: 'moveCols', cols: [0], to: 3 }, ada, ['c2dd', 'f3gg']).after;
    expectEveryOrderAlike('a change moved along', moved, exactly);
    expect(trim(originalView(moved).text)).toBe(FRUIT);
  });

  it('comments in a moved column move with it, both ways', () => {
    const thread = [
      '  c9qf:',
      '    by: bo',
      '    at: 2026-10-13T22:40Z',
      '    text: |-',
      '      A note.',
    ];
    const comment = file(FRUIT.replace('Count', '<!--cmt c9qf-->Count<!--/c9qf-->'), {}, thread);
    const done = edit(comment, { kind: 'moveCols', cols: [1], to: 0 }).after;
    expect(trim(done)).toContain('<!--ins k3x9 col--> <!--cmt c9qf-->Count<!--/c9qf-->');
    const back = applyChanges(done, reject(done, 'k3x9'));
    expect(trim(back)).toContain(
      '| Count<!--/c9qf--> |'.replace('| Count', '| <!--cmt c9qf-->Count'),
    );
    expect(parse(back).ledger.comments.map((t) => t.id)).toEqual(['c9qf']);
    expectInOrder('comment in a moved column', ['c9qf'], back);
  });

  it('refuses a move that changes nothing, another person’s inserted column, and a short row', () => {
    expect(said(() => edit(start, { kind: 'moveCols', cols: [1], to: 1 }))).toBe(
      'The columns are already there.',
    );
    expect(said(() => edit(start, { kind: 'moveCols', cols: [1], to: 2 }))).toBe(
      'The columns are already there.',
    );
    const made = edit(start, { kind: 'insertCols', after: 1 }, bo, ['c2dd']).after;
    expect(said(() => edit(made, { kind: 'moveCols', cols: [1], to: 0 }))).toBe(
      "Bo Chen's inserted column is pending. Decide it first.",
    );
    const ragged = file('| A | B |\n| - | - |\n| a |');
    expect(said(() => edit(ragged, { kind: 'moveCols', cols: [0], to: 2 }))).toBe(
      'A row of this table has fewer cells than its header. Fill it in first.',
    );
  });

  it('moves your own pending column plainly, as it is in no original', () => {
    const made = edit(start, { kind: 'insertCols', after: 1 }).after;
    const moved = edit(made, { kind: 'moveCols', cols: [1], to: 0 }, ada, ['c2dd']).after;
    expect(parse(moved).marks.map((m) => m.id)).toEqual(['k3x9']);
    expect(trim(applyChanges(moved, rejectAll(moved)))).toBe(FRUIT);
  });

  it('moves the columns as text with Track Changes off, a pending row marker staying first', () => {
    const plain = edit(start, { kind: 'moveCols', cols: [0], to: 3 }, null);
    expect(parse(plain.after).marks).toEqual([]);
    expect(trim(plain.after).split('\n')[0]).toBe('| Count | Price | Fruit  |');
    const made = edit(start, { kind: 'insertRows', after: 1 }).after;
    const moved = edit(made, { kind: 'moveCols', cols: [2], to: 0 }, null, []).after;
    expect(trim(moved)).toContain('| <!--ins k3x9 row-->');
    expectEveryOrderAlike('row marker, plain move', moved, exactly);
  });

  it('writes plain typing in a moved column into both halves of the move', () => {
    const done = edit(start, { kind: 'moveCols', cols: [0], to: 3 }).after;
    const at = done.indexOf('Apples') + 3;
    const typed = applyChanges(done, untrackedEdit(done, { from: at, to: at, insert: 'QQ' }));
    expect(typed).toContain('AppQQles');
    expect(parse(typed).marks.find((m) => m.payload?.startsWith('col='))?.payload).toContain(
      'AppQQles',
    );
    expect(trim(applyChanges(typed, reject(typed, 'k3x9')))).toContain('| AppQQles');
  });
});

describe('rule 2 for columns', () => {
  const base: TablePending = {
    rowsInserted: false,
    rowsChanged: false,
    colsInserted: false,
    colsChanged: false,
    align: false,
    headerChanged: false,
  };
  const ROWS = 'Accept or reject the row changes in this table first.';
  const ALIGN = 'Accept or reject the alignment change in this table first.';

  it('allows what the table of pairs says, tracked or not', () => {
    for (const tracked of [true, false]) {
      for (const op of ['insertCols', 'deleteCols', 'moveCols'] as const) {
        expect(ruleTwo(op, base, tracked)).toBeNull();
        expect(ruleTwo(op, { ...base, colsInserted: true }, tracked)).toBeNull();
        expect(ruleTwo(op, { ...base, colsChanged: true }, tracked)).toBeNull();
        expect(ruleTwo(op, { ...base, rowsChanged: true }, tracked)).toBe(ROWS);
        expect(ruleTwo(op, { ...base, align: true }, tracked)).toBe(ALIGN);
      }
      expect(ruleTwo('insertCols', { ...base, rowsInserted: true }, tracked)).toBeNull();
    }
    for (const op of ['deleteCols', 'moveCols'] as const) {
      expect(ruleTwo(op, { ...base, rowsInserted: true }, true)).toBe(ROWS);
      expect(ruleTwo(op, { ...base, rowsInserted: true }, false)).toBeNull();
    }
  });
});

describe('columns, decided and viewed', () => {
  it('shows the views of deleted and moved columns', () => {
    const deleted = edit(file(FRUIT), { kind: 'deleteCols', cols: [1] }).after;
    expect(trim(newestView(deleted).text).split('\n')[0]).toBe('| Fruit  | Price |');
    expect(trim(newestView(deleted).text)).not.toContain('del');
    expect(reviewView(deleted)).toContain('{--Count--}{>>[k3x9 ada] Deleted column<<}');
    expect(reviewView(deleted)).toContain('{--3--}');
    const moved = edit(file(FRUIT), { kind: 'moveCols', cols: [0], to: 3 }).after;
    const review = reviewView(moved);
    expect(review).toContain('{++Fruit++}{>>[k3x9 ada] Moved column from column 1<<}');
    expect(review).toContain('{--Fruit--}{>>[w8nn ada] Moved column to column 3<<}');
  });

  it('is decided with other changes in the file, and comments in a rejected column become points', () => {
    const made = edit(file(FRUIT.replace('Pears', '<!--cmt c9qf-->Pears<!--/c9qf-->')), {
      kind: 'insertCols',
      after: 1,
    }).after;
    const rejected = applyChanges(made, reject(made, 'k3x9'));
    expect(trim(rejected)).toBe(FRUIT.replace('Pears', '<!--cmt c9qf-->Pears<!--/c9qf-->'));
    const all = applyChanges(made, acceptAll(made));
    expect(parse(all).marks.filter((m) => m.kind !== 'cmt')).toEqual([]);
  });
});

describe('a comment that starts above a table without pipes at its edges', () => {
  const BARE = 'Fruit | Count | Price\n--- | --- | ---\nApples | 3 | 1\nPears | 5 | 2';
  const thread = [
    '  c9qf:',
    '    by: ada',
    '    at: 2026-10-13T22:40Z',
    '    text: |-',
    '      A note.',
  ];
  /** The comment on `Fruit`, with its start on a line of its own above the table. */
  const commented = () => {
    const base = file(BARE, {}, thread);
    const at = base.indexOf('Fruit');
    return applyChanges(base, [
      { from: at, to: at, insert: '<!--cmt c9qf-->\n\n' },
      { from: at + 5, to: at + 5, insert: '<!--/c9qf-->' },
    ]);
  };

  it('is refused for a column move or deletion it ends in, naming its author', () => {
    const text = commented();
    expect(parse(text).marks.some((m) => m.id === 'c9qf')).toBe(true);
    const words =
      "Ada Lovelace's comment starts above this table and ends in this column. Delete it first, or turn off Track Changes.";
    expect(said(() => edit(text, { kind: 'moveCols', cols: [0], to: 3 }))).toBe(words);
    expect(said(() => edit(text, { kind: 'deleteCols', cols: [0] }))).toBe(words);
  });

  it('allows the operation on any other column, and with Track Changes off', () => {
    const text = commented();
    expect(said(() => edit(text, { kind: 'moveCols', cols: [1], to: 3 }))).toBe('no error');
    expect(said(() => edit(text, { kind: 'deleteCols', cols: [2] }))).toBe('no error');
    const moved = edit(text, { kind: 'moveCols', cols: [0], to: 3 }, null).after;
    expect(parse(moved).marks.filter((m) => m.kind !== 'cmt')).toEqual([]);
    expectInOrder('comment', ['c9qf'], moved);
    const deleted = edit(text, { kind: 'deleteCols', cols: [0] }, null).after;
    expect(parse(deleted).ledger.comments.map((t) => t.id)).toEqual(['c9qf']);
    expectInOrder('comment', ['c9qf'], deleted);
  });

  it('writes a column back into a row that a decision left as one pipe', () => {
    // The other cell of a row of two went with a deleted column; accepting the deletion of the text that
    // is left leaves the row as a pipe alone, which stands for one empty cell and takes the column back.
    const bare = file('a | b\n--|--\nc | d\ne | f');
    const gone = edit(bare, { kind: 'deleteCols', cols: [0] }).after;
    const at = gone.indexOf('| f') + 2;
    const typed = applyChanges(
      gone,
      trackedEdit(gone, { from: at, to: at + 1, insert: '' }, context(ada, ['f3gg'])),
    );
    const kept = applyChanges(typed, accept(typed, 'f3gg'));
    expect(trim(kept)).toContain('| \n\n<!--del');
    const back = applyChanges(kept, reject(kept, 'k3x9'));
    expect(columnsOf(back)).toEqual([2, 2, 2]);
    expect(trim(back)).toContain('e |');
    expectEveryOrderAlike('a row left as a pipe', typed, exactly);
  });

  it('writes nothing into a row that is one pipe when it inserts a column: rejecting gives every byte back', () => {
    // Bare, piped and padded tables, LF and CRLF, tracked and plain: 12 combinations.
    const styles = {
      bare: 'a | b\n--|--\n|\nc | d',
      piped: '| a | b |\n| - | - |\n|\n| c | d |',
      padded: '| a   | b   |\n| --- | --- |\n|\n| c   | d   |',
    };
    let checked = 0;
    for (const body of Object.values(styles)) {
      for (const crlf of [false, true]) {
        const start = file(crlf ? body.replace(/\n/g, '\r\n') : body);
        for (const who of [ada, null]) {
          const after = edit(start, { kind: 'insertCols', after: 1 }, who).after;
          checked++;
          // The lone row is as it was, in the file and in both views.
          const lone = (text: string) =>
            bodyOf(text)
              .split(/\r?\n/)
              .filter((l) => l.trim() === '|');
          expect(lone(after), `${who ? 'tracked' : 'plain'}, ${crlf ? 'CRLF' : 'LF'}`).toEqual([
            '|',
          ]);
          if (who) {
            const rejected = applyChanges(after, rejectAll(after));
            expect(trim(rejected), 'rejected').toBe(trim(start));
            expect(trim(originalView(after).text)).toBe(trim(start));
          }
        }
      }
    }
    expect(checked).toBe(12);
  });
});

// The mark of an alignment change ends the last cell of its table's header (format §3.7, #281), and every
// rewrite of the columns keeps it there: a cell that leaves loses it with its unit, a cell that moves with its
// content, a cell that stops being the last has it taken off, and the cell that is last afterwards, kept,
// moved or new, has it written at the end of its text, in front of its padding. The files that hold both a
// column change and the mark, as a merge leaves them, are decided in `table-align.test.ts`.
describe('the mark of an alignment change, through a rewrite of the columns (format §3.7, #281)', () => {
  const OLD = encodeValue('| - | - | - |');
  const MARK = `<!--fmt k3x9 align=${OLD}-->`;
  const keep = (...cols: number[]): ColItem[] => cols.map((src) => ({ src }));
  const moving = (src: number): ColItem => ({ src, moving: true });
  /** A new column: `head` in the header's cell, `dash` in the delimiter row's, `body` in the others. */
  const fresh = (head: string, body = ' y ', dash = ' - '): ColItem => ({
    text: (line) => (line === 0 ? head : line === 1 ? dash : body),
  });
  /** The lines of a table, with `MARK` where `@@` stands. */
  const T = (...lines: string[]) => lines.join('\n').replace('@@', MARK);
  const SIMPLE = T('| a | b | c@@ |', '| - | - | - |', '| 1 | 2 | 3 |');
  const CLEAN = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |';
  const doc = (body: string, marks: Record<string, string> = {}, threads: string[] = []) =>
    file(body, { ...marks, k3x9: 'ada' }, threads);
  /** The changes that give the table of `body` the columns `final`, with the mark as `gridOf` finds it
   * (and as `text` says, when it is given), and the table they leave. */
  function rewrite(
    body: string,
    final: ColItem[],
    text?: string,
    marks = {},
    threads: string[] = [],
  ) {
    const source = doc(body, marks, threads);
    const parsed = parse(source);
    const table = readTables(source, parsed)[0] as TableRead;
    const grid = gridOf(source, table, parsed);
    const marked =
      text !== undefined && grid.alignMark
        ? { ...grid, alignMark: { ...grid.alignMark, text } }
        : grid;
    const changes = joinPoints(columnChanges(source, marked, final));
    return { changes, after: trim(applyChanges(source, changes)) };
  }
  const after = (body: string, final: ColItem[]) => rewrite(body, final).after;

  it('is found by `gridOf` from the parse of the file, and by nothing without it', () => {
    const source = doc(SIMPLE);
    const parsed = parse(source);
    const table = readTables(source, parsed)[0] as TableRead;
    const from = source.indexOf('<!--fmt');
    expect(gridOf(source, table).alignMark).toBeNull();
    expect(gridOf(source, table, parsed).alignMark).toEqual({
      range: { from, to: from + MARK.length },
      text: MARK,
    });
    // A table with no mark, and the range form that another tool wrote, have none to keep.
    const plain = file('| a | b |\n| - | - |\n| 1 | 2 |');
    const read = parse(plain);
    expect(gridOf(plain, readTables(plain, read)[0] as TableRead, read).alignMark).toBeNull();
    const span = file(`${MARK}\n\n${CLEAN}\n\n<!--/k3x9-->`, { k3x9: 'ada' });
    const spanned = parse(span);
    const wide = readTables(span, spanned)[0] as TableRead;
    expect(alignMarkOf(spanned, wide)).toBeDefined();
    expect(gridOf(span, wide, spanned).alignMark).toBeNull();
  });

  it('stays where it is while the last column stays the last, and changes nothing', () => {
    expect(rewrite(SIMPLE, keep(0, 1, 2)).changes).toEqual([]);
    // A column in front of it, or taken out from before it, leaves it alone.
    expect(after(SIMPLE, [fresh(' x '), ...keep(0, 1, 2)])).toBe(
      T('| x | a | b | c@@ |', '| - | - | - | - |', '| y | 1 | 2 | 3 |'),
    );
    expect(after(SIMPLE, [...keep(0, 1), fresh(' x '), ...keep(2)])).toBe(
      T('| a | b | x | c@@ |', '| - | - | - | - |', '| 1 | 2 | y | 3 |'),
    );
    expect(after(SIMPLE, keep(0, 2))).toBe(T('| a | c@@ |', '| - | - |', '| 1 | 3 |'));
    expect(after(SIMPLE, keep(1, 2))).toBe(T('| b | c@@ |', '| - | - |', '| 2 | 3 |'));
    expect(after(SIMPLE, [moving(0), ...keep(1, 2)])).toBe(SIMPLE);
  });

  it('has a one-line grid with no mark rewritten as any line is, which is how a row kept in a mark is', () => {
    // The old delimiter row that a mark holds goes through the same columns as the table's own.
    const spec = '| ----- | ----- | ----- |';
    const source = doc(SIMPLE);
    const table = readTables(source, parse(source))[0] as TableRead;
    const grid = {
      ...gridOf(source, table),
      lines: [readLine(spec, 0, spec.length)],
      rowMarkers: [null],
    };
    const done = (final: ColItem[]) =>
      applyChanges(spec, joinPoints(columnChanges(spec, grid, final)));
    expect(done(keep(0, 2))).toBe('| ----- | ----- |');
    expect(done([...keep(0, 1, 2), { text: () => ' --- ' }])).toBe(
      '| ----- | ----- | ----- | --- |',
    );
    expect(done([...keep(1, 2), moving(0)])).toBe('| ----- | ----- | ----- |');
  });

  it('is replaced in place when the text a caller gives is not the one that stands there', () => {
    const NEW = '<!--fmt k3x9 align=\\|\\x20-\\x20\\|-->';
    expect(rewrite(SIMPLE, keep(0, 1, 2), NEW).after).toBe(
      T('| a | b | c@@ |', '| - | - | - |', '| 1 | 2 | 3 |').replace(MARK, NEW),
    );
    expect(rewrite(SIMPLE, keep(0, 1, 2), MARK).changes).toEqual([]);
    // Taken from another cell, it is the new text that is written.
    expect(rewrite(SIMPLE, keep(0, 1), NEW).after).toBe(
      T('| a | b@@ |', '| - | - |', '| 1 | 2 |').replace(MARK, NEW),
    );
  });

  it('goes to the cell that is last when the last column goes, whichever cells are left', () => {
    expect(after(SIMPLE, keep(0, 1))).toBe(T('| a | b@@ |', '| - | - |', '| 1 | 2 |'));
    expect(after(SIMPLE, keep(0))).toBe(T('| a@@ |', '| - |', '| 1 |'));
    expect(after(SIMPLE, keep(1))).toBe(T('| b@@ |', '| - |', '| 2 |'));
    // The mark is one, whichever cell it ends.
    for (const final of [keep(0), keep(1), keep(0, 1), keep(0, 2), keep(1, 2)]) {
      expect(after(SIMPLE, final).split('<!--fmt')).toHaveLength(2);
    }
  });

  it('goes into a new last column, and into one that is moved to the end', () => {
    expect(after(SIMPLE, [...keep(0, 1, 2), fresh(' x ')])).toBe(
      T('| a | b | c | x@@ |', '| - | - | - | - |', '| 1 | 2 | 3 | y |'),
    );
    expect(after(SIMPLE, [...keep(1, 2), moving(0)])).toBe(
      T('| b | c | a@@ |', '| - | - | - |', '| 2 | 3 | 1 |'),
    );
    expect(after(SIMPLE, [...keep(0, 2), moving(1)])).toBe(
      T('| a | c | b@@ |', '| - | - | - |', '| 1 | 3 | 2 |'),
    );
    // Moved from the end, the column leaves the mark to the cell that is last now.
    expect(after(SIMPLE, [moving(2), ...keep(0, 1)])).toBe(
      T('| c | a | b@@ |', '| - | - | - |', '| 3 | 1 | 2 |'),
    );
    expect(after(SIMPLE, [...keep(1), moving(0), ...keep(2)])).toBe(
      T('| b | a | c@@ |', '| - | - | - |', '| 2 | 1 | 3 |'),
    );
  });

  it('is written in an empty new last cell after the first space of its padding', () => {
    expect(after(SIMPLE, [...keep(0, 1, 2), fresh('   ', '   ')])).toBe(
      T('| a | b | c | @@  |', '| - | - | - | - |', '| 1 | 2 | 3 |   |'),
    );
    expect(after(SIMPLE, [...keep(0, 1, 2), fresh('', '', '-')])).toBe(
      T('| a | b | c |@@|', '| - | - | - |-|', '| 1 | 2 | 3 ||'),
    );
  });

  it('stands after the marks that end the text of the cell that is last, in front of its padding', () => {
    const point = T('| a | b<!--cmt c9qf--> | c@@ |', '| - | - | - |', '| 1 | 2 | 3 |');
    const found = rewrite(point, keep(0, 1), undefined, {}, thread('c9qf'));
    expect(found.after).toBe(T('| a | b<!--cmt c9qf-->@@ |', '| - | - |', '| 1 | 2 |'));
    const padded = T('| a | b   | c@@ |', '| - | --- | - |', '| 1 | 2   | 3 |');
    expect(after(padded, keep(0, 1))).toBe(T('| a | b@@   |', '| - | --- |', '| 1 | 2   |'));
    expect(after(padded, [...keep(0, 1, 2), fresh(' x   ')])).toBe(
      T('| a | b   | c | x@@   |', '| - | --- | - | - |', '| 1 | 2   | 3 | y |'),
    );
  });

  it('holds an empty last cell the mark alone, and passes it to the cell that is last', () => {
    const alone = T('| a | b | @@ |', '| - | - | - |', '| 1 | 2 | 3 |');
    expect(after(alone, keep(0, 1))).toBe(T('| a | b@@ |', '| - | - |', '| 1 | 2 |'));
    expect(after(alone, keep(1, 2))).toBe(T('| b | @@ |', '| - | - |', '| 2 | 3 |'));
    expect(after(alone, [...keep(0, 1), moving(2)]).split('<!--fmt')).toHaveLength(2);
    expect(after(alone, [moving(2), ...keep(0, 1)])).toBe(
      T('|  | a | b@@ |', '| - | - | - |', '| 3 | 1 | 2 |'),
    );
    // It leaves its cell empty, and a new last cell has it.
    expect(after(alone, [...keep(0, 1, 2), fresh(' x ')])).toBe(
      T('| a | b |  | x@@ |', '| - | - | - | - |', '| 1 | 2 | 3 | y |'),
    );
    // In a header with no closing pipe, or no leading one, the mark alone is a cell.
    const open = T('| a | b | @@', '| --- | --- | ---', '| 1 | 2 | 3');
    expect(after(open, keep(0, 1))).toBe(T('| a | b@@ |', '| --- | --- |', '| 1 | 2 |'));
    expect(after(open, keep(1, 2))).toBe(T('| b | @@', '| --- | ---', '| 2 | 3'));
    const bare = T('a | b | @@', '--- | --- | ---', '1 | 2 | 3');
    expect(after(bare, keep(0, 1))).toBe(T('a | b@@ |', '--- | --- |', '1 | 2 |'));
    expect(after(bare, keep(1, 2))).toBe(T('| b | @@', '| --- | ---', '| 2 | 3'));
  });

  it('writes the closing pipe of a row without one after the mark', () => {
    const bare = T('a | b | c@@', '--- | --- | ---', '1 | 2 | 3');
    expect(after(bare, keep(0, 1))).toBe(T('a | b@@ |', '--- | --- |', '1 | 2 |'));
    expect(after(bare, keep(1, 2))).toBe(T('| b | c@@', '| --- | ---', '| 2 | 3'));
    expect(after(bare, [...keep(0, 1, 2), fresh(' x ', ' y ', ' --- ')])).toBe(
      T('a | b | c| x@@ |', '--- | --- | ---| --- |', '1 | 2 | 3| y |'),
    );
    expect(after(bare, [...keep(1, 2), moving(0)])).toBe(
      T('| b | c|a@@ |', '| --- | ---|--- |', '| 2 | 3|1 |'),
    );
    // Spaces after the mark stay after it where it stays, and go with the cell that holds them.
    const open = T('| a | b | c@@  ', '| --- | --- | ---', '| 1 | 2 | 3');
    expect(after(open, keep(1, 2))).toBe(T('| b | c@@  ', '| --- | ---', '| 2 | 3'));
    expect(after(open, keep(0, 1))).toBe(T('| a | b@@ |', '| --- | --- |', '| 1 | 2 |'));
    const headless = T('a | b | c@@ |', '--- | --- | --- |', '1 | 2 | 3 |');
    expect(after(headless, keep(0, 1))).toBe(T('a | b@@ |', '--- | --- |', '1 | 2 |'));
    expect(after(headless, [moving(2), ...keep(0, 1)])).toBe(
      T('| c |a | b@@ |', '| --- |--- | --- |', '| 3 |1 | 2 |'),
    );
  });

  it('writes it before the pipe of a table with no padding', () => {
    const compact = T('|a|b|c@@|', '|-|-|-|', '|1|2|3|');
    expect(after(compact, keep(0, 1))).toBe(T('|a|b@@|', '|-|-|', '|1|2|'));
    expect(after(compact, keep(0, 2))).toBe(T('|a|c@@|', '|-|-|', '|1|3|'));
    expect(after(compact, [...keep(0, 1, 2), fresh('x', 'y', '-')])).toBe(
      T('|a|b|c|x@@|', '|-|-|-|-|', '|1|2|3|y|'),
    );
    expect(after(compact, [moving(2), ...keep(0, 1)])).toBe(T('|c|a|b@@|', '|-|-|-|', '|3|1|2|'));
  });

  it('is written in the file’s own line breaks', () => {
    const crlf = SIMPLE.replace(/\n/g, '\r\n');
    expect(after(crlf, keep(0, 1))).toBe(
      T('| a | b@@ |', '| - | - |', '| 1 | 2 |').replace(/\n/g, '\r\n'),
    );
    expect(after(crlf, [...keep(1, 2), moving(0)])).toBe(
      T('| b | c | a@@ |', '| - | - | - |', '| 2 | 3 | 1 |').replace(/\n/g, '\r\n'),
    );
  });

  it('stays out of the first cell, where the marker of an inserted row stands', () => {
    const marked = T('| <!--ins r2dd row--> a | b@@ |', '| - | - |', '| 1 | 2 |');
    const marks = { r2dd: 'bo' };
    // The marker moves to the new first cell, and the mark stays at the end of the last.
    expect(rewrite(marked, keep(1), undefined, marks).after).toBe(
      T('| <!--ins r2dd row--> b@@ |', '| - |', '| 2 |'),
    );
    expect(rewrite(marked, keep(0), undefined, marks).after).toBe(
      T('| <!--ins r2dd row--> a@@ |', '| - |', '| 1 |'),
    );
    expect(rewrite(marked, [moving(1), ...keep(0)], undefined, marks).after).toBe(
      T('| <!--ins r2dd row--> b | a@@ |', '| - | - |', '| 2 | 1 |'),
    );
    // One column is left, moved: the marker and the mark are written into its cell, the marker first.
    expect(rewrite(marked, [moving(1)], undefined, marks).after).toBe(
      T('| <!--ins r2dd row--> b@@ |', '| - |', '| 2 |'),
    );
    expect(rewrite(marked, [fresh(' x '), ...keep(0, 1)], undefined, marks).after).toBe(
      T('| <!--ins r2dd row--> x | a | b@@ |', '| - | - | - |', '| y | 1 | 2 |'),
    );
    // The marker and the mark of an empty cell: the marker first, and the mark after it.
    const empty = T('| <!--ins r2dd row--> a | @@ |', '| - | - |', '| 1 | 2 |');
    expect(rewrite(empty, keep(1), undefined, marks).after).toBe(
      T('| <!--ins r2dd row--> @@ |', '| - |', '| 2 |'),
    );
    // Both are written into one empty cell, where the mark stood in a cell that goes.
    const both = T('| <!--ins r2dd row--> a | b@@ |  |', '| - | - | - |', '| 1 | 2 | 3 |');
    expect(rewrite(both, keep(2), undefined, marks).after).toBe(
      T('| <!--ins r2dd row--> @@ |', '| - |', '| 3 |'),
    );
  });

  it('stays in its own row when a merge left it in a row below the header', () => {
    const below = T('| a | b | c |', '| - | - | - |', '| 1 | 2 | 3@@ |');
    expect(after(below, keep(0, 1))).toBe(T('| a | b |', '| - | - |', '| 1 | 2@@ |'));
    expect(after(below, [...keep(0, 1, 2), fresh(' x ')])).toBe(
      T('| a | b | c | x |', '| - | - | - | - |', '| 1 | 2 | 3 | y@@ |'),
    );
    expect(after(below, keep(0, 2))).toBe(T('| a | c |', '| - | - |', '| 1 | 3@@ |'));
  });

  it('is brought to the end of the header when a merge left it in a cell that is not the last', () => {
    const middle = T('| a | b@@ | c |', '| - | - | - |', '| 1 | 2 | 3 |');
    expect(after(middle, keep(0, 1))).toBe(T('| a | b@@ |', '| - | - |', '| 1 | 2 |'));
    expect(after(middle, keep(0, 2))).toBe(T('| a | c@@ |', '| - | - |', '| 1 | 3 |'));
    expect(after(middle, keep(0, 1, 2))).toBe(SIMPLE);
  });

  it('writes the file it writes without the mark, with the mark once at the end of the last header cell', () => {
    const random = seeded(Number(process.env['REDLINES_SEED'] ?? 281));
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const styles: Record<string, (cells: string[]) => string> = {
      padded: (cells) => `| ${cells.join(' | ')} |`,
      compact: (cells) => `|${cells.join('|')}|`,
      bare: (cells) => cells.join(' | '),
      open: (cells) => `| ${cells.join(' | ')}`,
      lead: (cells) => `${cells.join(' | ')} |`,
    };
    let used = 0;
    let older = 0;
    for (let n = 0; n < fuzzCount(300); n++) {
      const width = 2 + Math.floor(random() * 3);
      const style = pick(Object.keys(styles));
      const line = styles[style] as (cells: string[]) => string;
      const eol = random() < 0.25 ? '\r\n' : '\n';
      const padded = style !== 'compact';
      // The header's cells: words, some empty in the middle, one ended by a comment point, and the last a
      // word or nothing, the mark alone.
      const lastEmpty = random() < 0.15;
      const comment = Math.floor(random() * width);
      const heads = Array.from({ length: width }, (_, c) => {
        const empty = c > 0 && c < width - 1 && random() < 0.2;
        const word =
          empty || (c === width - 1 && lastEmpty) ? '' : 'abcdefg'[c] + pick(['', 'xyz']);
        return c === comment && random() < 0.3 && word !== '' ? `${word}<!--cmt c9qf-->` : word;
      });
      const spaces = style === 'open' && random() < 0.4 ? '  ' : '';
      const header = line([...heads.slice(0, width - 1), `${heads[width - 1]}@@${spaces}`]);
      const dashes = Array.from({ length: width }, () => (padded ? '---' : '-'));
      const rows = Array.from({ length: 1 + Math.floor(random() * 2) }, (_, r) =>
        line(Array.from({ length: width }, (_, c) => `${r + 1}${c + 1}`)),
      );
      const lines = [header, line(dashes), ...rows].join(eol);
      const threads = lines.includes('c9qf') ? thread('c9qf') : [];
      // The columns afterwards: some of them go, some move, some are new.
      const order = Array.from({ length: width }, (_, c) => c).filter(() => random() < 0.7);
      if (order.length === 0) order.push(Math.floor(random() * width));
      const moved = order.filter(() => random() < 0.25);
      const final: ColItem[] = order.filter((c) => !moved.includes(c)).map((src) => ({ src }));
      for (const src of moved) {
        final.splice(Math.floor(random() * (final.length + 1)), 0, { src, moving: true });
      }
      for (let extra = Math.floor(random() * 3); extra > 0; extra--) {
        const word = random() < 0.2 ? '' : 'nw';
        final.splice(Math.floor(random() * (final.length + 1)), 0, {
          text: (k) => (k === 1 ? (padded ? ' --- ' : '-') : padded ? ` ${word} ` : word),
        });
      }
      const label = JSON.stringify({
        lines,
        final: final.map((item) => ('src' in item ? `${item.src}${item.moving ? '>' : ''}` : '+')),
      });
      const run = (text: string, keepMark: boolean): string | undefined => {
        const read = parse(text);
        const table = readTables(text, read)[0];
        if (!table) return undefined;
        const grid = gridOf(text, table, keepMark ? read : undefined);
        try {
          return applyChanges(text, joinPoints(columnChanges(text, grid, final)));
        } catch (error) {
          // A rewrite that fails with no mark in the file fails the same, and is older than the mark.
          if (!keepMark && error instanceof RangeError) return undefined;
          throw new Error(`${label}: ${String(error)}`, { cause: error });
        }
      };
      const without = run(file(lines.replace('@@', ''), {}, threads), false);
      if (without === undefined) {
        older++;
        continue;
      }
      const result = run(file(lines.replace('@@', MARK), { k3x9: 'ada' }, threads), true) as string;
      used++;
      // The mark once, and nothing else different from what the rewrite does without it.
      expect(bodyOf(result).split('<!--fmt'), label).toHaveLength(2);
      expect(bodyOf(result).replace(MARK, ''), label).toBe(bodyOf(without));
      // Markdown reads the table as it reads it without the mark, and the mark ends its header.
      expect(JSON.stringify(blockLeaves(result)), label).toBe(JSON.stringify(blockLeaves(without)));
      const read = parse(result);
      const table = readTables(result, read)[0];
      if (!table || !readTables(without, parse(without))[0]) continue;
      const mark = alignMarkOf(read, table);
      expect(mark?.segments[0]?.open.from, label).toBe(table.rows[0]?.cells.at(-1)?.textTo);
    }
    expect(used).toBeGreaterThan(fuzzCount(300) / 2);
    expect(older).toBeLessThan(fuzzCount(300) / 10);
  });
});
