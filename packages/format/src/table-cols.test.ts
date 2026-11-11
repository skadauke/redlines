// Columns: inserted, deleted and moved, tracked as Word tracks them or plain, decided in any order and
// viewed (format §3.7, §3.9, §8).
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { trackedFormat } from './formatting.ts';
import { parse } from './parse.ts';
import { ruleTwo, tableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp, TablePending } from './table-ops.ts';
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
  expectInOrder,
  file,
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
