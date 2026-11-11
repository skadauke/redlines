// Aligning columns, tracked and plain, decided in any order and viewed (format §3.7, §3.9, §8): a
// block format change around the table whose `align=` keeps the old delimiter row.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import type { TextChange } from './types.ts';
import { accept, acceptAll, canReject, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { formatChange } from './format-blocks.ts';
import { parse } from './parse.ts';
import { alignLabel } from './table-align.ts';
import { ruleTwo, tableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp, TablePending } from './table-ops.ts';
import { readTables } from './table.ts';
import type { TableAlign } from './table.ts';
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
  problemsOf,
} from './test-helpers.ts';
import { newestView, originalView, reviewView } from './views.ts';

const FRUIT =
  '| Fruit  | Count | Price |\n| :----- | ----- | ----: |\n| Apples | 3     | 1.20  |\n| Pears  | 5     | 0.90  |';
const IDS = ['k3x9', 'w8nn', 'p5qm', 'q6rs'];
const trim = (text: string) => bodyOf(text).replace(/[\r\n]+$/, '');
/** The same body, byte for byte: a file with no pending change has no ledger. */
const same = (a: string, b: string) => expect(trim(a)).toBe(trim(b));
const SPEC = '\\|\\x20:-\\-\\-\\-\\-\\x20\\|\\x20-\\-\\-\\-\\-\\x20\\|\\x20-\\-\\-\\-:\\x20\\|';

type Shape =
  | { kind: 'align'; cols: number[]; align: TableAlign }
  | { kind: 'insertCols'; after: number }
  | { kind: 'deleteCols'; cols: number[] }
  | { kind: 'moveCols'; cols: number[]; to: number }
  | { kind: 'insertRows'; after: number }
  | { kind: 'deleteRows'; rows: number[] }
  | { kind: 'moveRows'; rows: number[]; to: number };

function edit(text: string, shape: Shape, who: typeof ada | null = ada, ids = IDS) {
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  const op = { count: 1, ...shape, table } as TableOp;
  const done = who ? tableEdit(text, op, context(who, ids)) : untrackedTableEdit(text, op);
  return { ...done, after: applyChanges(text, done.changes) };
}
const align = (text: string, cols: number[], to: TableAlign, who = ada, ids = IDS) =>
  edit(text, { kind: 'align', cols, align: to }, who, ids);
const said = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof EditError ? error.message : String(error);
  }
  return 'no error';
};
const aligns = (text: string) => readTables(text, parse(text))[0]?.aligns;

describe('aligning a column, tracked (format §3.7)', () => {
  const start = file(FRUIT);

  it('writes a format change around the table with the old delimiter row, and the new one', () => {
    expect(trim(align(start, [1], 'center').after)).toBe(
      [
        `<!--fmt k3x9 align=${SPEC}-->`,
        '',
        '| Fruit  | Count | Price |',
        '| :----- | :---: | ----: |',
        '| Apples | 3     | 1.20  |',
        '| Pears  | 5     | 0.90  |',
        '',
        '<!--/k3x9-->',
      ].join('\n'),
    );
  });

  it('is a clean file, with its entry in the ledger', () => {
    const done = align(start, [1], 'center').after;
    expect(problemsOf(parse(done))).toEqual([]);
    expect(parse(done).ledger.marks['k3x9']).toMatchObject({ by: 'ada' });
    expect(aligns(done)).toEqual(['left', 'center', 'right']);
    expect(blockLeaves(done).filter((leaf) => leaf.kind === 'table')).toHaveLength(1);
  });

  it('writes the file’s own line breaks', () => {
    const crlf = start.replace(/\n/g, '\r\n');
    const done = align(crlf, [0, 2], 'center').after;
    expect(done.replace(/\r\n/g, '')).not.toContain('\n');
    expect(trim(done)).toContain('\r\n\r\n<!--/k3x9-->');
    same(applyChanges(done, reject(done, 'k3x9')), crlf);
    same(
      applyChanges(done, accept(done, 'k3x9')),
      crlf.replace(':-----', ':----:').replace('| ----: |', '| :---: |'),
    );
  });

  it('gives every byte back when rejected, and none else when accepted', () => {
    for (const cols of [[0], [1], [2], [0, 1, 2]]) {
      const done = align(start, cols, 'center').after;
      same(applyChanges(done, reject(done, 'k3x9')), start);
      const accepted = applyChanges(done, accept(done, 'k3x9'));
      expect(parse(accepted).marks).toEqual([]);
      expect(trim(accepted)).toBe(trim(newestView(done).text));
      expect(trim(applyChanges(done, rejectAll(done)))).toBe(FRUIT);
      expect(trim(applyChanges(done, acceptAll(done)))).toBe(trim(newestView(done).text));
      expect(trim(originalView(done).text)).toBe(FRUIT);
    }
  });

  it('keeps each cell as wide as it was, and writes the colons the alignment asks for', () => {
    const rows = (to: TableAlign) =>
      trim(newestView(align(start, [0, 1, 2], to).after).text).split('\n')[1];
    expect(rows('left')).toBe('| :----- | :---- | :---- |');
    expect(rows('center')).toBe('| :----: | :---: | :---: |');
    expect(rows('right')).toBe('| -----: | ----: | ----: |');
    expect(rows('')).toBe('| ------ | ----- | ----- |');
    // A cell of one dash grows by the colons.
    const narrow = file('| a | b |\n|-|-|\n| c | d |');
    expect(trim(newestView(align(narrow, [0], 'center').after).text).split('\n')[1]).toBe(
      '|:-:|-|',
    );
  });

  it('works in a table with no padding and no pipe at its edges', () => {
    const bare = file('a | b\n--|--\nc | d');
    const done = align(bare, [1], 'right').after;
    expect(aligns(done)).toEqual(['', 'right']);
    same(applyChanges(done, reject(done, 'k3x9')), bare);
    expectEveryOrderAlike('bare', done, exactly);
  });

  it('is written between the blocks around the table, and takes nothing of them', () => {
    const body = `Before it.\n\n${FRUIT}\n\nAfter it.\n\n${FRUIT.replace('Fruit', 'Veg')}`;
    const text = file(body);
    const done = align(text, [1], 'center').after;
    expect(problemsOf(parse(done))).toEqual([]);
    expect(trim(done).startsWith('Before it.\n\n<!--fmt k3x9')).toBe(true);
    expect(trim(done)).toContain('0.90  |\n\n<!--/k3x9-->\n\nAfter it.');
    same(applyChanges(done, reject(done, 'k3x9')), text);
    expect(trim(applyChanges(done, accept(done, 'k3x9')))).toBe(trim(newestView(done).text));
    // The other table is untouched.
    const second = readTables(done, parse(done))[1];
    expect(second?.aligns).toEqual(['left', '', 'right']);
    expectEveryOrderAlike('between blocks', done, exactly);
  });

  it('works for a table that starts the file', () => {
    const only = file(FRUIT);
    const done = align(only, [0], 'right').after;
    expect(done.startsWith('<!--fmt k3x9 align=')).toBe(true);
    same(applyChanges(done, reject(done, 'k3x9')), only);
  });

  it('names the change by the columns it changed, in a card and in the review view', () => {
    const done = align(start, [1], 'center').after;
    const parsed = parse(done);
    const mark = parsed.marks[0];
    expect(mark && formatChange(parsed, mark)).toEqual([
      { kind: 'align', columns: [{ col: 1, name: 'Count', now: 'center', was: '' }] },
    ]);
    expect(alignLabel([{ col: 0, name: 'Fruit', now: 'center', was: 'left' }])).toBe(
      'column Fruit centered (was left)',
    );
    expect(reviewView(done)).toContain(
      '| Pears  | 5     | 0.90  |\n\n{>>[k3x9 ada] Formatted: column Count centered (was default)<<}',
    );
    expect(reviewView(done)).not.toContain('align=');
    expect(canReject(parsed, parsed.marks[0]!)).toBe(true);
  });

  it('changes your own pending change in place, and takes it away when the old alignments are back', () => {
    const one = align(start, [1], 'center').after;
    const two = align(one, [0], 'right', ada, ['m5nn']).after;
    expect(parse(two).marks.map((m) => m.id)).toEqual(['k3x9']);
    expect(aligns(two)).toEqual(['right', 'center', 'right']);
    same(applyChanges(two, reject(two, 'k3x9')), start);
    const back = align(two, [0], 'left', ada, ['m5nn']).after;
    expect(aligns(back)).toEqual(['left', 'center', 'right']);
    const undone = align(back, [1], '', ada, ['m5nn']).after;
    // The old alignments are back: the change is gone, with the old row as it was written.
    same(undone, start);
    expect(parse(undone).marks).toEqual([]);
  });

  it('refuses another person’s pending alignment change, naming them', () => {
    const one = align(start, [1], 'center').after;
    expect(said(() => align(one, [0], 'right', bo, ['c2dd']))).toBe(
      "Ada Lovelace's alignment change is pending. Decide it first.",
    );
    expect(said(() => align(start, [0], 'left', ada))).toBe(
      'The columns are already aligned that way.',
    );
  });

  it('is refused while a column is pending, in words, and allowed with any row pending', () => {
    const cols = edit(start, { kind: 'insertCols', after: 1 }, bo, ['c2dd']).after;
    expect(said(() => align(cols, [0], 'center'))).toBe(
      'Accept or reject the column changes in this table first.',
    );
    const moved = edit(start, { kind: 'moveCols', cols: [0], to: 3 }, bo, ['c2dd', 'f3gg']).after;
    expect(said(() => align(moved, [0], 'center'))).toBe(
      'Accept or reject the column changes in this table first.',
    );
    const deleted = edit(start, { kind: 'deleteCols', cols: [1] }, bo, ['c2dd']).after;
    expect(said(() => align(deleted, [0], 'center'))).toBe(
      'Accept or reject the column changes in this table first.',
    );
    for (const shape of [
      { kind: 'insertRows', after: 1 },
      { kind: 'deleteRows', rows: [2] },
      { kind: 'moveRows', rows: [1], to: 3 },
    ] satisfies Shape[]) {
      const rows = edit(start, shape, bo, ['c2dd', 'f3gg']).after;
      const done = align(rows, [1], 'center').after;
      expect(aligns(done)).toEqual(['left', 'center', 'right']);
      expectEveryOrderAlike(`${shape.kind} pending`, done, exactly);
      expect(trim(applyChanges(done, rejectAll(done)))).toBe(trim(originalView(done).text));
    }
  });

  it('refuses every column operation while it is pending', () => {
    const done = align(start, [1], 'center').after;
    for (const shape of [
      { kind: 'insertCols', after: 1 },
      { kind: 'deleteCols', cols: [1] },
      { kind: 'moveCols', cols: [0], to: 2 },
    ] satisfies Shape[]) {
      expect(said(() => edit(done, shape, bo, ['c2dd', 'f3gg']))).toBe(
        'Accept or reject the alignment change in this table first.',
      );
    }
  });

  it('puts the deletion lines in front of its closer, rows deleted before or after it', () => {
    const rows = edit(start, { kind: 'deleteRows', rows: [2] }, bo, ['c2dd']).after;
    const done = align(rows, [1], 'center').after;
    expect(trim(done)).toMatch(/\|\n\n<!--del c2dd row=2 [^\n]*-->\n\n<!--\/k3x9-->$/);
    expect(applyChanges(done, reject(done, 'k3x9'))).toBe(rows);
    // The other order: the row deleted under an alignment change that is pending already.
    const first = align(start, [1], 'center').after;
    const second = edit(first, { kind: 'deleteRows', rows: [2] }, bo, ['c2dd']).after;
    expect(second).toBe(done.replace('k3x9: {by: ada', 'k3x9: {by: ada'));
    for (const id of ['k3x9', 'c2dd']) {
      for (const decide of [accept, reject]) {
        const one = applyChanges(second, decide(second, id));
        expect(problemsOf(parse(one))).toEqual([]);
      }
    }
    expectEveryOrderAlike('deletion under a change', second, exactly);
    // Both rejected: the deletion line and the closer go, the table is as it was.
    const all = applyChanges(second, rejectAll(second));
    expect(trim(all)).toBe(FRUIT);
  });

  it('decides in every order with a text edit in a cell of the table', () => {
    const done = align(start, [1], 'center').after;
    const at = done.indexOf('Apples') + 3;
    const typed = applyChanges(
      done,
      trackedEdit(done, { from: at, to: at, insert: 'QQ' }, context(bo, ['b7cd'])),
    );
    expect(
      parse(typed)
        .marks.map((m) => m.id)
        .sort(),
    ).toEqual(['b7cd', 'k3x9']);
    expectEveryOrderAlike('typed in a cell', typed, exactly);
    const rejected = applyChanges(typed, reject(typed, 'k3x9'));
    expect(trim(rejected)).toContain('| App<!--ins b7cd-->QQ<!--/b7cd-->les | 3');
    expect(aligns(rejected)).toEqual(['left', '', 'right']);
    // The first and the last cell of the table, and the header.
    for (const word of ['Fruit', '0.90', 'Count']) {
      const to = done.indexOf(word) + word.length;
      const edited = applyChanges(
        done,
        trackedEdit(done, { from: to, to, insert: 'Z' }, context(bo, ['b7cd'])),
      );
      expectEveryOrderAlike(`typed after ${word}`, edited, exactly);
    }
  });

  it('reads alike in every order whatever is deleted or typed in the paragraph below the table', () => {
    const text = file(`${FRUIT}\n\nOutro words.\n\nMore.`);
    const one = align(text, [1], 'center').after;
    const view = newestView(one);
    const at = view.text.indexOf('Outro words.');
    const end = at + 'Outro words.'.length;
    // Written as the editor writes them: from the newest view, mapped into the file.
    const shapes: [string, number, number, string][] = [
      ['the paragraph', at, end, ''],
      ['the break and the paragraph', at - 2, end, ''],
      ['the word Outro', at, at + 5, ''],
      ['the break and the word', at - 2, at + 5, ''],
      ['typing at its end', end, end, 'q'],
      ['a new paragraph after it', end, end, '\n\nNew.'],
      ['typing at its start', at, at, 'q'],
    ];
    let checked = 0;
    for (const who of [bo, ada]) {
      for (const [name, a, b, insert] of shapes) {
        const from = view.map.toSource(a, 1);
        const to = Math.max(from, view.map.toSource(b, -1));
        let edited: string;
        try {
          edited = applyChanges(
            one,
            trackedEdit(one, { from, to, insert }, context(who, ['c2dd', 'f3gg', 'h4jj'])),
          );
        } catch (error) {
          if (error instanceof EditError) continue;
          throw error;
        }
        checked++;
        expectEveryOrderAlike(`${who.handle}: ${name}`, edited, exactly);
        // Both decided as the views say: the alignment kept, the edit kept, or both undone.
        const all = (decide: (t: string) => TextChange[]) => {
          try {
            return applyChanges(edited, decide(edited));
          } catch (error) {
            throw new Error(`${who.handle}: ${name}: ${String(error)}\n${edited}`, {
              cause: error,
            });
          }
        };
        expect(trim(all(acceptAll)), `${name}: accept all`).toBe(trim(newestView(edited).text));
        expect(trim(all(rejectAll)), `${name}: reject all`).toBe(trim(originalView(edited).text));
        expect(trim(originalView(edited).text), `${name}: original`).toBe(trim(text));
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it('rejects all, and accepts all, with the header moved and a row put above it under the change', () => {
    // One decision writes the delimiter row after the new first row, the next takes it away with the
    // row that moves back: the two come to one change and no delimiter row is left in the table.
    const centered = file('| x y  |\n| :---: |\n| b    |\n| alpha |\n| 11   |');
    const one = align(centered, [0], '').after;
    const moved = edit(one, { kind: 'moveRows', rows: [0], to: 2 }, ada, ['w8nn', 'p5qm']).after;
    const text = edit(moved, { kind: 'insertRows', after: -1 }, bo, ['q6rs']).after;
    const rejected = applyChanges(text, rejectAll(text));
    expect(trim(rejected)).toBe(trim(centered));
    expect(trim(applyChanges(text, acceptAll(text)))).toBe(trim(newestView(text).text));
    expectEveryOrderAlike('header moved, row above it', text, exactly);
  });

  it('is one change with the rest of a group, and takes a note', () => {
    const table = readTables(start, parse(start))[0]?.from ?? 0;
    const done = applyChanges(
      start,
      tableEdit(
        start,
        { kind: 'align', table, cols: [1], align: 'center' },
        context(ada, ['k3x9'], { group: 'g5nb', note: 'Numbers read better centered.' }),
      ).changes,
    );
    expect(parse(done).ledger.marks['k3x9']).toMatchObject({
      group: 'g5nb',
      note: 'Numbers read better centered.',
    });
  });

  it('leaves the markers in the table’s other readings: Simple and Clean see no marker', () => {
    const done = align(start, [1], 'center').after;
    expect(newestView(done).text).not.toContain('<!--');
    expect(originalView(done).text).not.toContain('<!--');
    expectInOrder('after', [], done);
  });
});

describe('aligning a column with Track Changes off (format §3.10)', () => {
  const start = file(FRUIT);

  it('changes the delimiter row alone, no marks and no ledger', () => {
    const done = align(start, [1], 'center', null as never).after;
    expect(done).toBe(start.replace('| ----- |', '| :---: |'));
    expect(parse(done).marks).toEqual([]);
  });

  it('is refused where the columns are as asked, and for a column the table has not', () => {
    expect(said(() => edit(start, { kind: 'align', cols: [0], align: 'left' }, null))).toBe(
      'The columns are already aligned that way.',
    );
    expect(said(() => edit(start, { kind: 'align', cols: [3], align: 'left' }, null))).toBe(
      'There is no such column in this table.',
    );
    expect(said(() => edit(start, { kind: 'align', cols: [], align: 'left' }, null))).toBe(
      'There is no such column in this table.',
    );
  });

  it('is written in the old row of a pending change too, so that rejecting it keeps what was done', () => {
    const pending = align(start, [1], 'center').after;
    const plain = edit(pending, { kind: 'align', cols: [0], align: 'right' }, null).after;
    expect(aligns(plain)).toEqual(['right', 'center', 'right']);
    // Rejected, the old row comes back with the plain change in it; the original has it too.
    const rejected = applyChanges(plain, reject(plain, 'k3x9'));
    expect(aligns(rejected)).toEqual(['right', '', 'right']);
    expect(trim(originalView(plain).text)).toBe(trim(rejected));
    expectEveryOrderAlike('plain under a change', plain, exactly);
    // The plain change that brings the old alignments back leaves nothing to decide.
    const same = edit(pending, { kind: 'align', cols: [1], align: '' }, null).after;
    expect(parse(same).marks).toEqual([]);
    expect(aligns(same)).toEqual(['left', '', 'right']);
  });

  it('is written in both halves of a pending move of the column', () => {
    const moved = edit(start, { kind: 'moveCols', cols: [2], to: 0 }, bo, ['c2dd', 'f3gg']).after;
    const plain = edit(moved, { kind: 'align', cols: [0], align: 'center' }, null).after;
    const copy = parse(plain).marks.find((m) => m.payload?.startsWith('col='));
    expect(copy?.payload).toContain(':---:');
    expect(aligns(plain)?.[0]).toBe('center');
    // Rejected, the column goes back to its place with the new alignment; accepted it keeps it.
    const back = applyChanges(plain, reject(plain, 'c2dd'));
    expect(aligns(back)).toEqual(['left', '', 'center']);
    expect(aligns(applyChanges(plain, accept(plain, 'c2dd')))).toEqual(['center', 'left', '']);
    expect(aligns(originalView(plain).text)).toEqual(['left', '', 'center']);
    expectEveryOrderAlike('plain under a move', plain, exactly);
  });

  it('is allowed beside a pending inserted or deleted column, and reads alike', () => {
    const inserted = edit(start, { kind: 'insertCols', after: 1 }, bo, ['c2dd']).after;
    const deleted = edit(start, { kind: 'deleteCols', cols: [1] }, bo, ['c2dd']).after;
    for (const text of [inserted, deleted]) {
      const plain = edit(text, { kind: 'align', cols: [0], align: 'center' }, null).after;
      expect(aligns(plain)?.[0]).toBe('center');
      expectEveryOrderAlike('plain beside a column', plain, exactly);
    }
  });

  it('is typed text like any other with Track Changes off: typing in a cell under a change', () => {
    const pending = align(start, [1], 'center').after;
    const at = pending.indexOf('Apples') + 3;
    const typed = applyChanges(pending, untrackedEdit(pending, { from: at, to: at, insert: 'QQ' }));
    expect(parse(typed).marks.map((m) => m.id)).toEqual(['k3x9']);
    expect(trim(applyChanges(typed, reject(typed, 'k3x9')))).toContain('| AppQQles');
    expectEveryOrderAlike('plain typing under a change', typed, exactly);
  });
});

describe('rule 5 in ruleTwo', () => {
  const none: TablePending = {
    rowsInserted: false,
    rowsChanged: false,
    colsInserted: false,
    colsChanged: false,
    align: false,
  };
  const COLUMNS = 'Accept or reject the column changes in this table first.';
  const ALIGN = 'Accept or reject the alignment change in this table first.';

  it('refuses an alignment change tracked while a column is pending, and allows the rest', () => {
    for (const key of ['colsInserted', 'colsChanged'] as const) {
      expect(ruleTwo('align', { ...none, [key]: true }, true)).toBe(COLUMNS);
      // With Track Changes off it is written in both halves, or in the one that is there.
      expect(ruleTwo('align', { ...none, [key]: true }, false)).toBeNull();
    }
    for (const key of ['rowsInserted', 'rowsChanged', 'align'] as const) {
      for (const tracked of [true, false]) {
        expect(ruleTwo('align', { ...none, [key]: true }, tracked)).toBeNull();
      }
    }
  });

  it('refuses every column operation, and no row operation, while it is pending', () => {
    for (const op of ['insertCols', 'deleteCols', 'moveCols'] as const) {
      for (const tracked of [true, false]) {
        expect(ruleTwo(op, { ...none, align: true }, tracked)).toBe(ALIGN);
      }
    }
    for (const op of ['insertRows', 'deleteRows', 'moveRows'] as const) {
      expect(ruleTwo(op, { ...none, align: true }, true)).toBeNull();
    }
  });
});
