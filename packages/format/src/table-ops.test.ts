import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { pendingOf, ruleTwo, tableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp, TablePending } from './table-ops.ts';
import { readTables } from './table.ts';
import { TIME, ada, blockLeaves, bodyOf, context, expectInOrder, file } from './test-helpers.ts';

const FRUIT = '| Fruit  | Count |\n| ------ | ----- |\n| Apples | 3     |\n| Pears  | 5     |';
const rowsOf = (text: string) => blockLeaves(text).find((leaf) => leaf.kind === 'table')?.rows;

const insert = (
  text: string,
  after: number,
  count = 1,
  ids: string[] = ['k3x9', 'w8nn', 'p5qm'],
  more: Partial<Parameters<typeof context>[2]> = {},
) => {
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  const op: TableOp = { kind: 'insertRows', table, after, count };
  const done = tableEdit(text, op, context(ada, ids, more));
  return { ...done, after: applyChanges(text, done.changes) };
};
const plainInsert = (text: string, after: number, count = 1) => {
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  const done = untrackedTableEdit(text, { kind: 'insertRows', table, after, count });
  return { ...done, after: applyChanges(text, done.changes) };
};

describe('inserting rows, tracked', () => {
  it('writes a row below Apples as format §3.7 shows it, in the table’s padding', () => {
    const text = file(FRUIT);
    const done = insert(text, 1);
    expect(bodyOf(done.after)).toBe(
      [
        '| Fruit  | Count |',
        '| ------ | ----- |',
        '| Apples | 3     |',
        '| <!--ins k3x9 row--> |       |',
        '| Pears  | 5     |',
      ].join('\n'),
    );
    expect(done.after.slice(done.caret - 7, done.caret)).toBe('row--> ');
    expect(done.after[done.caret]).toBe('|');
    expect(parse(done.after).ledger.marks['k3x9']).toEqual({ by: 'ada', at: TIME });
    expectInOrder('row', [], done.after);
  });

  it('writes a row below the last, and below the header', () => {
    const text = file(FRUIT);
    expect(bodyOf(insert(text, 2).after).split('\n').at(-1)).toBe(
      '| <!--ins k3x9 row--> |       |',
    );
    expect(bodyOf(insert(text, 0).after).split('\n')[2]).toBe('| <!--ins k3x9 row--> |       |');
  });

  it('writes the row in a table that is not padded as | a | b |, and gives a bare row a leading pipe', () => {
    const text = file('| a | b |\n| - | - |\n| cc | d |');
    expect(bodyOf(insert(text, 1).after).split('\n').at(-1)).toBe('| <!--ins k3x9 row--> |  |');
    const bare = file('a | b\n--|--\nc | d');
    const done = insert(bare, 1);
    expect(bodyOf(done.after).split('\n').at(-1)).toBe('| <!--ins k3x9 row--> |  |');
  });

  it('writes the file’s own line breaks', () => {
    const text = file(FRUIT.replaceAll('\n', '\r\n'));
    const done = insert(text, 1);
    const body = bodyOf(done.after);
    expect(body.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(body).toContain('| Apples | 3     |\r\n| <!--ins k3x9 row--> |       |\r\n| Pears');
  });

  it('writes a row below the last, above the deletion lines and the ledger', () => {
    const body = `${FRUIT}\n\n<!--del g5nb row=2 \\| Plums \\| 7 \\|-->`;
    const text = file(body, { g5nb: 'bo' });
    const done = insert(text, 2);
    expect(bodyOf(done.after)).toBe(
      `${FRUIT}\n| <!--ins k3x9 row--> |       |\n\n<!--del g5nb row=2 \\| Plums \\| 7 \\|-->`,
    );
    expectInOrder('deletions', [], done.after);
    // Last in the file, before the ledger.
    expect(parse(done.after).ledgerRange?.from).toBeGreaterThan(done.caret);
  });

  it('gives rows made together one group', () => {
    const text = file(FRUIT);
    const done = insert(text, 1, 2);
    const marks = parse(done.after).ledger.marks;
    expect(Object.keys(marks).sort()).toHaveLength(2);
    const groups = Object.values(marks).map((entry) => entry.group);
    expect(groups[0]).toBeDefined();
    expect(groups[0]).toBe(groups[1]);
    expect(bodyOf(done.after).match(/<!--ins \w{4} row-->/g)).toHaveLength(2);
    // One row has none.
    const single = insert(text, 1, 1).after;
    expect(Object.values(parse(single).ledger.marks)[0]?.group).toBeUndefined();
  });

  it('leaves marks and ledger in order, and the header the same', () => {
    for (const [name, text, after] of [
      ['middle', file(FRUIT), 1],
      ['last', file(FRUIT), 2],
      ['header', file(FRUIT), 0],
      ['two', file(FRUIT), 1],
    ] as const) {
      const done = insert(text, after, name === 'two' ? 2 : 1);
      expectInOrder(name, [], done.after);
      const reject = [...done.after.matchAll(/<!--ins (\w{4}) row-->/g)];
      expect(reject.length).toBeGreaterThan(0);
      for (const rows of [rowsOf(done.after)]) expect(rows?.[0]).toEqual(['Fruit', 'Count']);
    }
  });
});

describe('inserting rows, plain', () => {
  it('writes an empty row with no marker and no ledger entry', () => {
    const text = file(FRUIT, {});
    const done = plainInsert(text, 1);
    expect(bodyOf(done.after)).toBe(
      FRUIT.replace('| Apples | 3     |\n', '| Apples | 3     |\n|        |       |\n'),
    );
    expect(Object.keys(parse(done.after).ledger.marks)).toEqual([]);
    expect(rowsOf(done.after)?.[2]).toEqual(['', '']);
    expect(done.after.slice(0, done.caret).endsWith('\n| ')).toBe(true);
  });

  it('writes several rows, in a CRLF file', () => {
    const done = plainInsert(file(FRUIT.replaceAll('\n', '\r\n')), 2, 2);
    expect(rowsOf(done.after)?.map((row) => row.length)).toEqual([2, 2, 2, 2, 2]);
    expect(bodyOf(done.after).replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });
});

describe('rule 2: rows and columns don’t change together', () => {
  const base: TablePending = {
    rowsInserted: false,
    rowsChanged: false,
    colsInserted: false,
    colsChanged: false,
    align: false,
  };
  const COLUMNS = 'Accept or reject the column changes in this table first.';

  it('allows inserting rows with columns inserted or none pending, and refuses with columns deleted or moved', () => {
    for (const tracked of [true, false]) {
      expect(ruleTwo('insertRows', base, tracked)).toBeNull();
      expect(ruleTwo('insertRows', { ...base, colsInserted: true }, tracked)).toBeNull();
      expect(ruleTwo('insertRows', { ...base, colsChanged: true }, tracked)).toBe(COLUMNS);
      // Pending row changes and an alignment change allow any row change.
      expect(ruleTwo('insertRows', { ...base, rowsInserted: true }, tracked)).toBeNull();
      expect(ruleTwo('insertRows', { ...base, rowsChanged: true }, tracked)).toBeNull();
      expect(ruleTwo('insertRows', { ...base, align: true }, tracked)).toBeNull();
    }
  });

  it('reads what is pending in a table', () => {
    const body =
      '| a | <!--ins k3x9 col--> b |\n| - | - |\n| <!--ins w8nn row--> x | y |\n\n' +
      '<!--del g5nb row=1 \\| z \\| w \\|-->\n<!--del m2bd col=1 \\| a \\\\n \\| - \\\\n \\| x-->';
    const text = file(body, { k3x9: 'bo', w8nn: 'bo', g5nb: 'bo', m2bd: 'bo' });
    const parsed = parse(text);
    const [table] = readTables(text, parsed);
    expect(table && pendingOf(table, parsed)).toEqual({
      rowsInserted: true,
      rowsChanged: true,
      colsInserted: true,
      colsChanged: true,
      align: false,
    });
    const quiet = file(FRUIT);
    const [plain] = readTables(quiet, parse(quiet));
    expect(plain && pendingOf(plain, parse(quiet))).toEqual(base);
  });

  it('refuses the operation, tracked and not, with a column pending deleted', () => {
    const body = `${FRUIT}\n\n<!--del m2bd col=2 \\| Count \\\\n \\| ----- \\\\n \\| 3 \\\\n \\| 5-->`;
    const text = file(body, { m2bd: 'bo' });
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const op: TableOp = { kind: 'insertRows', table, after: 1, count: 1 };
    expect(() => tableEdit(text, op, context(ada, ['k3x9']))).toThrow(
      'Accept or reject the column changes in this table first.',
    );
    expect(() => untrackedTableEdit(text, op)).toThrow(EditError);
  });
});
