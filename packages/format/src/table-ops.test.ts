import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import {
  accept,
  acceptAll,
  acceptMarks,
  isDecidable,
  reject,
  rejectAll,
  rejectMarks,
} from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import {
  pendingOf,
  rewritePositions,
  ruleTwo,
  tableEdit,
  untrackedTableEdit,
} from './table-ops.ts';
import type { TableOp, TablePending } from './table-ops.ts';
import { readTables } from './table.ts';
import {
  TIME,
  ada,
  blockLeaves,
  bo,
  bodyOf,
  context,
  exactly,
  expectEveryOrderAlike,
  expectInOrder,
  expectNoDecisionRefused,
  file,
  thread,
} from './test-helpers.ts';
import { newestView, originalView, reviewView } from './views.ts';

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
        '| <!--ins k3x9 row-->        |       |',
        '| Pears  | 5     |',
      ].join('\n'),
    );
    expect(done.after.slice(done.caret - 7, done.caret)).toBe('row--> ');
    expect(done.after.slice(done.caret, done.caret + 6)).toBe('      ');
    expect(parse(done.after).ledger.marks['k3x9']).toEqual({ by: 'ada', at: TIME });
    expectInOrder('row', [], done.after);
  });

  it('writes a row below the last, and below the header', () => {
    const text = file(FRUIT);
    expect(bodyOf(insert(text, 2).after).split('\n').at(-1)).toBe(
      '| <!--ins k3x9 row-->        |       |',
    );
    expect(bodyOf(insert(text, 0).after).split('\n')[2]).toBe(
      '| <!--ins k3x9 row-->        |       |',
    );
  });

  it('writes the row in a table that is not padded as | a | b |, and gives a bare row a leading pipe', () => {
    const text = file('| a | b |\n| - | - |\n| cc | d |');
    expect(bodyOf(insert(text, 1).after).split('\n').at(-1)).toBe('| <!--ins k3x9 row-->  |  |');
    const bare = file('a | b\n--|--\nc | d');
    const done = insert(bare, 1);
    expect(bodyOf(done.after).split('\n').at(-1)).toBe('| <!--ins k3x9 row-->  |  |');
  });

  it('writes the file’s own line breaks', () => {
    const text = file(FRUIT.replaceAll('\n', '\r\n'));
    const done = insert(text, 1);
    const body = bodyOf(done.after);
    expect(body.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(body).toContain(
      '| Apples | 3     |\r\n| <!--ins k3x9 row-->        |       |\r\n| Pears',
    );
  });

  it('writes a row below the last, above the deletion lines and the ledger', () => {
    const body = `${FRUIT}\n\n<!--del g5nb row=2 \\| Plums \\| 7 \\|-->`;
    const text = file(body, { g5nb: 'bo' });
    const done = insert(text, 2);
    expect(bodyOf(done.after)).toBe(
      `${FRUIT}\n| <!--ins k3x9 row-->        |       |\n\n<!--del g5nb row=2 \\| Plums \\| 7 \\|-->`,
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

/** The body of a file, with no line break at its end. */
const trimmed = (text: string) => bodyOf(text).replace(/[\r\n]+$/, '');

describe('deciding and viewing an inserted row (format §3.7, §8)', () => {
  const ROW = '| <!--ins k3x9 row--> Plums | 7     |';
  const BODY = `| Fruit  | Count |\n| ------ | ----- |\n| Apples | 3     |\n${ROW}\n| Pears  | 5     |`;
  const text = file(BODY, { k3x9: 'ada' });
  const decide = (source: string, how: typeof accept, id: string) =>
    applyChanges(source, how(source, id));

  it('accepting takes the marker and the space after it; rejecting takes the row', () => {
    expect(trimmed(decide(text, accept, 'k3x9'))).toBe(BODY.replace('<!--ins k3x9 row--> ', ''));
    expect(trimmed(decide(text, reject, 'k3x9'))).toBe(FRUIT);
    expect(parse(decide(text, accept, 'k3x9')).ledger.marks).toEqual({});
    expect(parse(decide(text, reject, 'k3x9')).ledger.marks).toEqual({});
  });

  it('decides a row at the end of the table, the last in a file, and in CRLF', () => {
    const last = file(`${FRUIT}\n| <!--ins k3x9 row--> Plums | 7     |`, { k3x9: 'ada' });
    expect(trimmed(decide(last, reject, 'k3x9'))).toBe(FRUIT);
    expect(trimmed(decide(last, accept, 'k3x9'))).toBe(`${FRUIT}\n| Plums | 7     |`);
    const crlf = file(BODY.replaceAll('\n', '\r\n'), { k3x9: 'ada' }).replace(/\r\r/g, '\r');
    expect(trimmed(decide(crlf, reject, 'k3x9'))).toBe(FRUIT.replaceAll('\n', '\r\n'));
    expect(trimmed(decide(crlf, accept, 'k3x9'))).toBe(
      BODY.replace('<!--ins k3x9 row--> ', '').replaceAll('\n', '\r\n'),
    );
  });

  it('accepting a row written empty gives the cells the table’s widths back', () => {
    const empty = insert(file(FRUIT), 1).after;
    expect(trimmed(decide(empty, accept, 'k3x9'))).toBe(
      FRUIT.replace('| Apples | 3     |\n', '| Apples | 3     |\n|        |       |\n'),
    );
    expect(trimmed(decide(empty, reject, 'k3x9'))).toBe(FRUIT);
    const loose = insert(file('| a | b |\n| - | - |\n| cc | d |'), 1).after;
    expect(trimmed(decide(loose, accept, 'k3x9'))).toBe(
      '| a | b |\n| - | - |\n| cc | d |\n|  |  |',
    );
  });

  it('rejects two rows of one group together, and one at a time', () => {
    const two = insert(file(FRUIT), 1, 2).after;
    const ids = Object.keys(parse(two).ledger.marks);
    expect(trimmed(applyChanges(two, rejectMarks(two, ids)))).toBe(FRUIT);
    const keep = trimmed(applyChanges(two, acceptMarks(two, ids)));
    expect(keep.split('\n')).toHaveLength(6);
    expect(keep).not.toContain('<!--');
    expect(trimmed(applyChanges(two, rejectAll(two)))).toBe(FRUIT);
    expect(trimmed(applyChanges(two, acceptAll(two)))).toBe(keep);
    const [first] = ids;
    const one = decide(two, reject, first ?? '');
    expect(trimmed(one).split('\n')).toHaveLength(5);
    expect(Object.keys(parse(one).ledger.marks)).toHaveLength(1);
  });

  it('rejecting a row takes another person’s pending changes in it along, accepting leaves them', () => {
    const body = `${BODY.replace('Plums', 'Plu<!--ins m2bd-->x<!--/m2bd-->ms')}`;
    const held = file(body, { k3x9: 'ada', m2bd: 'bo' });
    const rejected = decide(held, reject, 'k3x9');
    expect(trimmed(rejected)).toBe(FRUIT);
    expect(parse(rejected).ledger.marks).toEqual({});
    const accepted = decide(held, accept, 'k3x9');
    expect(trimmed(accepted)).toContain('| Plu<!--ins m2bd-->x<!--/m2bd-->ms | 7     |');
    expect(Object.keys(parse(accepted).ledger.marks)).toEqual(['m2bd']);
  });

  it('rejects a row that holds a comment, which becomes a point comment in the row below', () => {
    const body = BODY.replace('Plums', '<!--cmt c9qf-->Plums<!--/c9qf-->');
    const withComment = file(body, { k3x9: 'ada' }, thread('c9qf'));
    const rejected = decide(withComment, reject, 'k3x9');
    expect(trimmed(rejected)).toContain('| <!--cmt c9qf-->Pears  | 5     |');
    expect(parse(rejected).ledger.comments.map((t) => t.id)).toEqual(['c9qf']);
    expect(trimmed(decide(withComment, accept, 'k3x9'))).toContain('| <!--cmt c9qf-->Plums');
  });

  describe('with row deletions pending in the table', () => {
    const DELETED = '<!--del g5nb row=2 \\| Kiwi \\| 1 \\|-->';
    const held = file(`${BODY}\n\n${DELETED}`, { k3x9: 'ada', g5nb: 'bo' });

    it('rejects and accepts the row', () => {
      const rejected = decide(held, reject, 'k3x9');
      expect(trimmed(rejected)).toContain('<!--del g5nb row=2 ');
      expect(trimmed(decide(held, accept, 'k3x9'))).toContain('| Plums | 7     |');
      expect(() => rejectMarks(held, ['k3x9'])).not.toThrow();
    });

    it('lets rejectAll and acceptAll decide the row and the deletion', () => {
      const other = '<!--ins m2bd-->Zucchini<!--/m2bd-->';
      const text = file(`${other}\n\n${BODY}\n\n${DELETED}`, {
        k3x9: 'ada',
        g5nb: 'bo',
        m2bd: 'ada',
      });
      const after = applyChanges(text, rejectAll(text));
      expect(parse(after).marks).toEqual([]);
      expect(trimmed(after)).toContain('| Kiwi | 1 |');
      expect(trimmed(after)).not.toContain('Zucchini');
      const kept = applyChanges(text, acceptAll(text));
      expect(parse(kept).marks).toEqual([]);
      expect(trimmed(kept)).not.toContain('Kiwi');
    });
  });

  it('keeps the header and the delimiter row when the only body row is rejected', () => {
    const only = file('| a |\n| - |\n| <!--ins k3x9 row--> b |', { k3x9: 'ada' });
    expect(trimmed(decide(only, reject, 'k3x9'))).toBe('| a |\n| - |');
    expect(trimmed(decide(only, accept, 'k3x9'))).toBe('| a |\n| - |\n| b |');
  });

  it('makes the old header the header again when a new one is rejected', () => {
    const header = file('| <!--ins k3x9 row--> New | N |\n| --- | --- |\n| a | b |\n| c | d |', {
      k3x9: 'ada',
    });
    expect(trimmed(decide(header, reject, 'k3x9'))).toBe('| a | b |\n| --- | --- |\n| c | d |');
    expect(trimmed(decide(header, accept, 'k3x9'))).toBe(
      '| New | N |\n| --- | --- |\n| a | b |\n| c | d |',
    );
    expect(trimmed(originalView(header).text)).toBe('| a | b |\n| --- | --- |\n| c | d |');
  });

  it('moves the positions of deleted rows as the rows around them move', () => {
    const deleted = (n: number, id: string) => `<!--del ${id} row=${n} \\| Kiwi \\| 1 \\|-->`;
    const lines = [2, 3, 4].map((n, i) => deleted(n, ['g5nb', 'h6nb', 'j7nb'][i] ?? ''));
    const doc = file(`${FRUIT}\n\n${lines.join('\n')}`, { g5nb: 'bo', h6nb: 'bo', j7nb: 'bo' });
    const table = readTables(doc, parse(doc))[0];
    expect(table?.deletions.map((d) => d.position)).toEqual([2, 3, 4]);
    if (!table) return;
    // A row inserted at index 2 moves the deletions below it down, and takes them back up.
    const down = trimmed(applyChanges(doc, rewritePositions(doc, table, 2, 1)));
    expect(down.match(/row=(\d)/g)).toEqual(['row=2', 'row=4', 'row=5']);
    const up = trimmed(applyChanges(doc, rewritePositions(doc, table, 2, -1)));
    expect(up.match(/row=(\d)/g)).toEqual(['row=2', 'row=2', 'row=3']);
    // Inserting a row writes them.
    const done = insert(doc, 1).after;
    expect(trimmed(done).match(/row=(\d)/g)).toEqual(['row=2', 'row=4', 'row=5']);
    expect(trimmed(done)).toContain('\\| Kiwi \\| 1 \\|-->');
    const above = insert(doc, 2).after;
    expect(trimmed(above).match(/row=(\d)/g)).toEqual(['row=2', 'row=3', 'row=5']);
  });

  it('shows the three views: newest without the marker, original without the row, review in CriticMarkup', () => {
    expect(newestView(text).text).toBe(`${BODY.replace('<!--ins k3x9 row--> ', '')}\n`);
    expect(originalView(text).text).toBe(`${FRUIT}\n`);
    expect(reviewView(text)).toBe(
      [
        '| Fruit  | Count |',
        '| ------ | ----- |',
        '| Apples | 3     |',
        '| {++Plums++} | {++7++}     |{>>[k3x9 ada] Inserted row<<}',
        '| Pears  | 5     |',
        '',
      ].join('\n'),
    );
    // An empty cell is left as it is.
    const empty = file('| a | b |\n| - | - |\n| <!--ins k3x9 row--> | 5 |', { k3x9: 'ada' });
    expect(reviewView(empty)).toBe(
      '| a | b |\n| - | - |\n| | {++5++} |{>>[k3x9 ada] Inserted row<<}\n',
    );
    // Another person's change in the row is named as ever.
    const held = file(BODY.replace('Plums', 'Plu<!--ins m2bd-->x<!--/m2bd-->ms'), {
      k3x9: 'ada',
      m2bd: 'bo',
    });
    expect(reviewView(held)).toContain('[m2bd bo]');
    expect(reviewView(held)).toContain('[k3x9 ada] Inserted row');
  });

  it('never nests another person’s change in the row’s inserted text', () => {
    const ledger = { k3x9: 'ada', m2bd: 'bo', n3cd: 'bo' } as const;
    const inserted = file(BODY.replace('Plums', 'Plu<!--ins m2bd-->x<!--/m2bd-->ms'), ledger);
    expect(reviewView(inserted)).toContain(
      '| {++Plu++}{++x++}[m2bd bo]{++ms++} | {++7++}     |{>>[k3x9 ada] Inserted row<<}',
    );
    const deleted = file(BODY.replace('Plums', 'Plu<!--del m2bd gone-->ms'), ledger);
    expect(reviewView(deleted)).toContain('| {++Plu++}{--gone--}[m2bd bo]{++ms++} |');
    // A change at either edge of the cell, and two in one cell.
    const edges = file(
      BODY.replace('Plums', '<!--ins m2bd-->x<!--/m2bd-->Plu<!--ins n3cd-->y<!--/n3cd-->'),
      ledger,
    );
    expect(reviewView(edges)).toContain('| {++x++}[m2bd bo]{++Plu++}{++y++}[n3cd bo] |');
    // No change opens inside another's markers, in a row or not.
    for (const doc of [inserted, deleted, edges]) {
      const view = reviewView(doc).split('\n');
      for (const line of view) expect(line).not.toMatch(/\{\+\+[^}]*\{(\+\+|--|~~|==)/);
    }
  });

  it('is decidable, and counted as a change by accept all and reject all', () => {
    const mark = parse(text).marks.find((m) => m.id === 'k3x9');
    expect(mark && isDecidable(mark)).toBe(true);
    // A column's marker is, as a row's.
    const col = file('| a | <!--ins k3x9 col--> b |\n| - | - |\n| c | d |', { k3x9: 'ada' });
    const colMark = parse(col).marks.find((m) => m.id === 'k3x9');
    expect(colMark && isDecidable(colMark)).toBe(true);
    expect(parse(applyChanges(col, acceptAll(col))).marks).toEqual([]);
  });

  it('reads the same in every order of three people’s rows and a text insertion beside them', () => {
    const body = [
      '| Fruit  | Count |',
      '| ------ | ----- |',
      '| Apples | 3<!--ins m2bd-->3<!--/m2bd-->     |',
      '| <!--ins k3x9 row--> Plums | 7     |',
      '| <!--ins w8nn row--> Figs | 2     |',
      '| <!--ins p5qm row--> Limes | 9     |',
      '| Pears  | 5     |',
    ].join('\n');
    const many = file(body, { k3x9: 'ada', w8nn: 'bo', p5qm: 'ada', m2bd: 'bo' });
    expectEveryOrderAlike('rows', many);
    expectEveryOrderAlike('rows exactly', many, (source) => source.replace(/\s+$/, ''));
  });
});

// Deleting a table (format §3.4, §3.7 rule 6): a whole-block deletion of the table, its pending
// changes folded in, or refused when they are another person's; its comments become points.
describe('deleting a whole table (format §3.7, rule 6)', () => {
  const around = (table: string) => `Intro.\n\n${table}\n\nAfter.`;
  const IDS = ['k3x9', 'w8nn', 'p5qm', 'q6rs'];
  const pending = (name: string) => `${name}'s pending change is in this table. Decide it first.`;
  const said = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return error instanceof EditError ? error.message : String(error);
    }
    return 'no error';
  };

  function remove(text: string, who: typeof ada | null = ada, ids = IDS) {
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const op: TableOp = { kind: 'deleteTable', table };
    const done = who ? tableEdit(text, op, context(who, ids)) : untrackedTableEdit(text, op);
    return { ...done, after: applyChanges(text, done.changes) };
  }
  type Shape<T> = T extends unknown ? Omit<T, 'table'> : never;
  /** `text` after an operation on its table by `who`: a table with something pending in it. */
  function made(text: string, op: Shape<TableOp>, who = bo, ids = ['m2bd', 'n3cd']) {
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const done = tableEdit(text, { ...op, table }, context(who, ids));
    return applyChanges(text, done.changes);
  }

  const plainTable = file(around(FRUIT));
  /** Tables with one thing pending in them, by the person `by`, in each kind that a table has. */
  const pendingBy = (by: 'bo' | 'ada'): Record<string, string> => {
    const who = by === 'bo' ? bo : ada;
    const inline = (cell: string) => file(around(FRUIT.replace('Pears', cell)), { m2bd: by });
    return {
      'a cell edit': inline('Pe<!--ins m2bd-->x<!--/m2bd-->ars'),
      'a deleted text in a cell': inline('P<!--del m2bd e-->ars'),
      'a replaced text in a cell': inline('<!--sub m2bd Pears-->Pairs<!--/m2bd-->'),
      'a format change in a cell': inline('<!--fmt m2bd +bold-->**Pears**<!--/m2bd-->'),
      'an inserted row': made(plainTable, { kind: 'insertRows', after: 1, count: 1 }, who),
      'a moved row': made(plainTable, { kind: 'moveRows', rows: [2], to: 1 }, who),
      'a deleted row': made(plainTable, { kind: 'deleteRows', rows: [2] }, who),
      'an inserted column': made(plainTable, { kind: 'insertCols', after: 1, count: 1 }, who),
      'a moved column': made(plainTable, { kind: 'moveCols', cols: [0], to: 2 }, who),
      'a deleted column': made(plainTable, { kind: 'deleteCols', cols: [1] }, who),
      'an alignment change': made(plainTable, { kind: 'align', cols: [1], align: 'center' }, who, [
        'm2bd',
      ]),
    };
  };

  it('is one block deletion in front of the block after the table, the table its payload', () => {
    const done = remove(file(around(FRUIT)));
    const marks = parse(done.after).marks;
    expect(marks.map((mark) => [mark.id, mark.kind])).toEqual([['k3x9', 'del']]);
    // The table and the break after it (format §3.4), as it reads.
    expect(marks[0]?.payload).toBe(`${FRUIT}\n\n`);
    expect(trimmed(done.after)).toMatch(/^Intro\.\n\n<!--del k3x9 [^]*-->\n\nAfter\.$/);
    expect(parse(done.after).ledger.marks).toEqual({ k3x9: { by: 'ada', at: TIME } });
    expectInOrder('table', [], done.after);
    // The caret goes to the text that follows the table.
    expect(done.after.slice(done.caret, done.caret + 6)).toBe('After.');
  });

  it('reads in the three views, and is decided in every order, rejecting gives every byte back', () => {
    const text = file(around(FRUIT));
    const done = remove(text);
    expect(newestView(done.after).text).toBe('Intro.\n\nAfter.\n');
    expect(originalView(done.after).text).toBe(`${around(FRUIT)}\n`);
    expect(reviewView(done.after)).toBe(`Intro.\n\n{--${FRUIT}\n\n--}[k3x9 ada]After.\n`);
    expect(trimmed(applyChanges(done.after, accept(done.after, 'k3x9')))).toBe('Intro.\n\nAfter.');
    expect(trimmed(applyChanges(done.after, reject(done.after, 'k3x9')))).toBe(around(FRUIT));
    expect(trimmed(applyChanges(done.after, rejectAll(done.after)))).toBe(trimmed(text));
    expect(blockLeaves(newestView(done.after).text).some((leaf) => leaf.kind === 'table')).toBe(
      false,
    );
    expect(rowsOf(originalView(done.after).text)).toEqual(rowsOf(text));
    expectEveryOrderAlike('table', done.after, exactly);
    expectNoDecisionRefused('table', done.after);
  });

  it('is behind the block above when the table ends the text, and alone when it is all of it', () => {
    const last = remove(file(`Intro.\n\n${FRUIT}`));
    expect(parse(last.after).marks[0]?.payload).toBe(`\n\n${FRUIT}`);
    expect(trimmed(last.after)).toMatch(/^Intro\.<!--del k3x9 [^]*-->$/);
    expect(newestView(last.after).text).toBe('Intro.\n');
    expect(last.after.slice(last.caret - 6, last.caret)).toBe('Intro.');
    expectEveryOrderAlike('last', last.after, exactly);
    expect(trimmed(applyChanges(last.after, reject(last.after, 'k3x9')))).toBe(
      `Intro.\n\n${FRUIT}`,
    );

    const first = remove(file(`${FRUIT}\n\nAfter.`));
    expect(parse(first.after).marks[0]?.payload).toBe(`${FRUIT}\n\n`);
    expect(first.after.slice(first.caret, first.caret + 6)).toBe('After.');
    expect(newestView(first.after).text).toBe('After.\n');
    expectEveryOrderAlike('first', first.after, exactly);

    const only = remove(file(FRUIT));
    expect(parse(only.after).marks[0]?.payload).toBe(FRUIT);
    expect(newestView(only.after).text).toBe('\n');
    expect(only.caret).toBe(0);
    expect(trimmed(applyChanges(only.after, reject(only.after, 'k3x9')))).toBe(FRUIT);
    expectEveryOrderAlike('only', only.after, exactly);
  });

  it('deletes the table it is asked for, among tables and other blocks', () => {
    const two = file(`One.\n\n${FRUIT}\n\nTwo.\n\n| z |\n| - |\n| y |\n\nThree.`);
    const second = readTables(two, parse(two))[1]?.from ?? 0;
    const done = tableEdit(two, { kind: 'deleteTable', table: second }, context(ada, ['k3x9']));
    const after = applyChanges(two, done.changes);
    expect(parse(after).marks[0]?.payload).toBe('| z |\n| - |\n| y |\n\n');
    expect(newestView(after).text).toContain(`${FRUIT}\n\nTwo.\n\nThree.`);
    expect(said(() => tableEdit(two, { kind: 'deleteTable', table: 3 }, context(ada, IDS)))).toBe(
      'There is no table there.',
    );
    expectEveryOrderAlike('two tables', after, exactly);
  });

  it('keeps every character of cells with escaped pipes, code spans, links, emoji and ragged rows', () => {
    const odd = [
      '| a \\| b | `x\\|y` | [link](http://example.org/a_b) |',
      '| --- | --- | --- |',
      '| 👍🏽 | é | ![img](pic.png) |',
      '| short |',
      '| 1 | 2 | 3 | 4 |',
    ].join('\n');
    const text = file(around(odd));
    expect(readTables(text, parse(text))).toHaveLength(1);
    const done = remove(text);
    expect(parse(done.after).marks[0]?.payload).toBe(`${odd}\n\n`);
    expect(trimmed(applyChanges(done.after, reject(done.after, 'k3x9')))).toBe(around(odd));
    expectEveryOrderAlike('odd cells', done.after, exactly);
    expect(trimmed(remove(text, null).after)).toBe('Intro.\n\nAfter.');
  });

  it('is not held up by another person’s change in the text around it or in another table', () => {
    const other = FRUIT.replace('Fruit', 'Veg').replace(
      'Pears',
      'Pe<!--ins m2bd-->x<!--/m2bd-->ars',
    );
    const text = file(`Af<!--ins n3cd-->x<!--/n3cd-->ter.\n\n${FRUIT}\n\n${other}\n\nEnd.`, {
      m2bd: 'bo',
      n3cd: 'bo',
    });
    const done = remove(text);
    expect(
      parse(done.after)
        .marks.map((mark) => mark.id)
        .sort(),
    ).toEqual(['k3x9', 'm2bd', 'n3cd']);
    expect(rowsOf(newestView(done.after).text)?.[0]).toEqual(['Veg', 'Count']);
    expectEveryOrderAlike('around', done.after, exactly);
  });

  it('writes the file’s own line breaks', () => {
    const crlf = file(around(FRUIT).replaceAll('\n', '\r\n'));
    const done = remove(crlf);
    const body = bodyOf(done.after);
    expect(body.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(trimmed(applyChanges(done.after, reject(done.after, 'k3x9')))).toBe(
      around(FRUIT).replaceAll('\n', '\r\n'),
    );
    expectEveryOrderAlike('crlf', done.after, exactly);
    const plain = remove(crlf, null);
    expect(trimmed(plain.after)).toBe('Intro.\r\n\r\nAfter.');
  });

  it('deletes a table whose rows have no outer pipes, with no pipe to stand a marker at', () => {
    for (const table of [
      'Fruit | Count\n--- | ---\nApples | 3',
      'Fruit | Count |\n--- | --- |\nApples | 3 |',
      '| Fruit | Count\n| --- | ---\n| Apples | 3',
    ]) {
      const text = file(around(table));
      const done = remove(text);
      expect(parse(done.after).marks[0]?.payload, table).toBe(`${table}\n\n`);
      expectEveryOrderAlike(table, done.after, exactly);
      expect(trimmed(applyChanges(done.after, reject(done.after, 'k3x9'))), table).toBe(
        around(table),
      );
      expect(trimmed(remove(text, null).after), table).toBe('Intro.\n\nAfter.');
    }
  });

  it('keeps apart the paragraphs around a table that starts in the line under one', () => {
    const text = file(`Intro.\n${FRUIT}\n\nAfter.`);
    expect(readTables(text, parse(text))).toHaveLength(1);
    // The blank line after the table stays: the paragraphs would be one without it.
    expect(trimmed(remove(text, null).after)).toBe('Intro.\n\nAfter.');
    // A tracked deletion there has no form, and is refused, whole.
    expect(() => remove(text)).toThrow(EditError);
  });

  describe('another person’s pending change stays theirs', () => {
    for (const [name, text] of Object.entries(pendingBy('bo'))) {
      it(`refuses ${name} of Bo’s, with Track Changes on, naming him`, () => {
        expect(said(() => remove(text))).toBe(pending('Bo Chen'));
        // Nothing is written: the refusal comes before any change.
        expect(parse(text).marks.length).toBeGreaterThan(0);
      });
    }

    for (const [name, text] of Object.entries(pendingBy('ada'))) {
      it(`refuses ${name} of Ada’s when Bo deletes the table`, () => {
        expect(said(() => remove(text, bo))).toBe(pending('Ada Lovelace'));
      });
    }

    it('is not refused for another person’s comment, which is no change', () => {
      const text = file(
        around(FRUIT.replace('Pears', '<!--cmt c9qf-->Pears<!--/c9qf-->')),
        {},
        thread('c9qf', 'bo'),
      );
      expect(said(() => remove(text))).toBe('no error');
    });

    it('is refused for a pending change that holds the table, as it is for one in it', () => {
      const text = file(`Intro.\n\n<!--ins m2bd-->\n\n${FRUIT}\n\n<!--/m2bd-->\n\nAfter.`, {
        m2bd: 'bo',
      });
      expect(readTables(text, parse(text))).toHaveLength(1);
      expect(said(() => remove(text))).toBe(pending('Bo Chen'));
    });

    it('names Bo for his change when Ada’s own row is pending beside it', () => {
      const text = file(
        around(
          FRUIT.replace('| Pears ', '| <!--ins m2bd row--> Pears').replace(
            'Apples',
            'App<!--ins n3cd-->x<!--/n3cd-->les',
          ),
        ),
        { m2bd: 'ada', n3cd: 'bo' },
      );
      expect(said(() => remove(text))).toBe(pending('Bo Chen'));
    });
  });

  describe('your own pending changes fold into the deletion', () => {
    const own = pendingBy('ada');
    for (const [name, text] of Object.entries(own)) {
      it(`undoes ${name} of your own in the payload, as rejecting it would`, () => {
        const done = remove(text);
        const marks = parse(done.after).marks;
        // The one deletion, and nothing else of the table's marks: they are folded into it.
        expect(marks.map((mark) => mark.kind)).toEqual(['del']);
        expect(marks[0]?.payload).toBe(`${FRUIT}\n\n`);
        expect(Object.keys(parse(done.after).ledger.marks)).toEqual([marks[0]?.id]);
        // The original is as it was; the newest has no table.
        expect(originalView(done.after).text).toBe(originalView(text).text);
        expect(newestView(done.after).text).toBe('Intro.\n\nAfter.\n');
        expectInOrder(name, [], done.after);
        expectEveryOrderAlike(name, done.after, exactly);
        expect(trimmed(applyChanges(done.after, reject(done.after, marks[0]?.id ?? '')))).toBe(
          around(FRUIT),
        );
      });
    }

    it('removes your own pending row outright, and its ledger entry', () => {
      const text = made(plainTable, { kind: 'insertRows', after: 1, count: 1 }, ada, ['m2bd']);
      expect(parse(text).ledger.marks['m2bd']).toBeDefined();
      const done = remove(text);
      expect(parse(done.after).ledger.marks['m2bd']).toBeUndefined();
      expect(trimmed(done.after)).not.toContain('row-->');
    });

    it('takes your own deletion lines in, so that their rows are in the table it keeps', () => {
      const text = made(plainTable, { kind: 'deleteRows', rows: [1, 2] }, ada, [
        'm2bd',
        'n3cd',
        'p5qm',
      ]);
      expect(trimmed(text)).toContain('<!--del n3cd row=');
      const done = remove(text);
      expect(trimmed(done.after)).not.toContain('row=');
      expect(parse(done.after).marks[0]?.payload).toBe(`${FRUIT}\n\n`);
      expect(rowsOf(originalView(done.after).text)).toEqual(rowsOf(plainTable));
    });

    it('is a table that your own insertion holds: the table goes from its text, which stays pending', () => {
      const FIRST = `Intro.\n\n<!--ins m2bd-->\n\nNew words.<!--split n3cd-->\n\n${FRUIT}\n\n<!--/m2bd-->\n\nAfter.`;
      const AFTER = `Intro.\n\n<!--ins m2bd-->\n\n${FRUIT}\n\nMore words.<!--/m2bd-->\n\nAfter.`;
      for (const body of [FIRST, AFTER]) {
        const text = file(body, { m2bd: 'ada', n3cd: 'ada' });
        expect(readTables(text, parse(text))).toHaveLength(1);
        const done = remove(text);
        // No deletion: the table's text was your own, and is taken out of it.
        expect(parse(done.after).marks.map((mark) => mark.kind)).not.toContain('del');
        expect(parse(done.after).marks.some((mark) => mark.id === 'm2bd')).toBe(true);
        expect(readTables(done.after, parse(done.after))).toHaveLength(0);
        expect(newestView(done.after).text).toContain(
          body.includes('New') ? 'New words.' : 'More words.',
        );
        expect(newestView(done.after).text).not.toContain('Fruit');
        expect(originalView(done.after).text).toBe(originalView(text).text);
        expectInOrder('own insertion', [], done.after);
        expectEveryOrderAlike('own insertion', done.after, exactly);
      }
    });

    it('refuses a change of yours that runs from the table into the text around it, which would take both', () => {
      const text = file(
        `Intro <!--ins m2bd-->words.\n\n${FRUIT.replace('Apples', 'Ap<!--/m2bd-->ples')}\n\nAfter.`,
        { m2bd: 'ada' },
      );
      expect(readTables(text, parse(text))).toHaveLength(1);
      expect(said(() => remove(text))).toBe(pending('Ada Lovelace'));
      expect(said(() => remove(text, bo))).toBe(pending('Ada Lovelace'));
    });

    it('is a table that is only your own pending insertion: it goes with no trace', () => {
      const text = file(`Intro.\n\n<!--ins m2bd-->\n\n${FRUIT}\n\n<!--/m2bd-->\n\nAfter.`, {
        m2bd: 'ada',
      });
      const done = remove(text);
      expect(parse(done.after).marks).toEqual([]);
      expect(parse(done.after).ledger.marks).toEqual({});
      expect(newestView(done.after).text).toBe(originalView(text).text);
      expect(originalView(done.after).text).toBe(originalView(text).text);
    });
  });

  describe('its comments become point comments where it was', () => {
    const commented = (by: string, where = around) =>
      file(
        where(FRUIT.replace('Pears', '<!--cmt c9qf-->Pears<!--/c9qf-->')),
        {},
        thread('c9qf', by),
      );

    it('puts a point at the start of the text of the block after it, whoever’s the thread is', () => {
      for (const by of ['ada', 'bo']) {
        const done = remove(commented(by));
        expectInOrder(by, ['c9qf'], done.after);
        const parsed = parse(done.after);
        const point = parsed.marks.find((mark) => mark.id === 'c9qf');
        const deletion = parsed.marks.find((mark) => mark.id === 'k3x9');
        expect(point?.kind).toBe('cmt');
        // A point: no closer, no text in the table, after the deletion's marker and before the text.
        expect(point?.segments.map((segment) => segment.close)).toEqual([undefined]);
        expect(point?.segments[0]?.open.from).toBeGreaterThanOrEqual(
          deletion?.segments[0]?.open.to ?? Infinity,
        );
        expect(deletion?.payload).toBe(`${FRUIT}\n\n`);
        expect(parsed.ledger.comments.find((t) => t.id === 'c9qf')?.by).toBe(by);
        expect(newestView(done.after).text).toBe('Intro.\n\nAfter.\n');
        expect(trimmed(applyChanges(done.after, accept(done.after, 'k3x9')))).toBe(
          'Intro.\n\n<!--cmt c9qf-->\n\nAfter.',
        );
        expect(trimmed(applyChanges(done.after, reject(done.after, 'k3x9')))).toBe(
          `Intro.\n\n${FRUIT}\n\n<!--cmt c9qf-->\n\nAfter.`,
        );
        expectEveryOrderAlike(by, done.after, exactly);
      }
    });

    it('puts it at the end of the text of the block before it when the table ends the text', () => {
      const done = remove(commented('ada', (table) => `Intro.\n\n${table}`));
      expectInOrder('last', ['c9qf'], done.after);
      expect(trimmed(done.after)).toMatch(/^Intro\.<!--cmt c9qf--><!--del k3x9 [^]*-->$/);
      expect(trimmed(applyChanges(done.after, accept(done.after, 'k3x9')))).toBe(
        'Intro.<!--cmt c9qf-->',
      );
      expect(trimmed(applyChanges(done.after, reject(done.after, 'k3x9')))).toBe(
        `Intro.<!--cmt c9qf-->\n\n${FRUIT}`,
      );
    });

    it('makes one point of a comment that runs over several rows, and keeps the order of many', () => {
      const body = FRUIT.replace('Apples', '<!--cmt c9qf-->Apples')
        .replace('Pears ', 'Pears<!--/c9qf-->')
        .replace('| 3 ', '| <!--cmt d4rs-->3<!--/d4rs-->');
      const text = file(around(body), {}, [...thread('c9qf', 'bo'), ...thread('d4rs', 'ada')]);
      const done = remove(text);
      expectInOrder('rows', ['c9qf', 'd4rs'], done.after);
      const points = parse(done.after).marks.filter((mark) => mark.kind === 'cmt');
      expect(points.map((mark) => mark.id)).toEqual(['c9qf', 'd4rs']);
      expect(points.every((mark) => mark.segments.every((s) => s.close === undefined))).toBe(true);
      const accepted = applyChanges(done.after, accept(done.after, 'k3x9'));
      expect(parse(accepted).marks.map((mark) => mark.id)).toEqual(['c9qf', 'd4rs']);
      expect(newestView(accepted).text).toBe('Intro.\n\nAfter.\n');
    });

    it('is in the table for a comment on a header with no pipe at its start, opened on the line above', () => {
      const table = 'Fruit | Count\n-- | --\nApples | 3';
      const bare = file(around(table));
      const at = bare.indexOf('Fruit');
      const text = applyChanges(
        bare,
        addComment(bare, { from: at, to: at + 5 }, 'A note.', context(bo, ['c9qf'])).changes,
      );
      // Its opener is alone on the line above the table, which it starts as a block.
      expect(trimmed(text)).toContain('<!--cmt c9qf-->\n\nFruit');
      const done = remove(text);
      expectInOrder('header', ['c9qf'], done.after);
      const point = parse(done.after).marks.find((mark) => mark.id === 'c9qf');
      expect(point?.segments.map((segment) => segment.close)).toEqual([undefined]);
      expect(newestView(done.after).text).toBe('Intro.\n\nAfter.\n');
      expect(parse(done.after).marks.find((mark) => mark.id === 'k3x9')?.payload).toBe(
        `${table}\n\n`,
      );
      expect(trimmed(applyChanges(done.after, reject(done.after, 'k3x9')))).toBe(
        `Intro.\n\n${table}\n\n<!--cmt c9qf-->\n\nAfter.`,
      );
      expectEveryOrderAlike('header', done.after, exactly);
      expect(trimmed(remove(text, null).after)).toBe('Intro.\n\n<!--cmt c9qf-->\n\nAfter.');
    });

    it('loses only the part in the table of a comment with a part that stays', () => {
      const text = file(
        around(FRUIT.replace('Pears', '<!--cmt c9qf-->Pears<!--/c9qf-->')).replace(
          'Intro.',
          '<!--cmt c9qf-->Intro.<!--/c9qf-->',
        ),
        {},
        thread('c9qf', 'bo'),
      );
      const done = remove(text);
      expectInOrder('part', ['c9qf'], done.after);
      const mark = parse(done.after).marks.find((m) => m.id === 'c9qf');
      expect(mark?.segments).toHaveLength(1);
      expect(trimmed(done.after)).toContain('<!--cmt c9qf-->Intro.<!--/c9qf-->');
    });

    it('lets a highlight go, which has no point form, with its ledger entry', () => {
      const text = file(around(FRUIT.replace('Pears', '<!--hl h4jj-->Pears<!--/h4jj-->')), {
        h4jj: 'bo',
      });
      const done = remove(text);
      expect(parse(done.after).marks.map((mark) => mark.id)).toEqual(['k3x9']);
      expect(Object.keys(parse(done.after).ledger.marks)).toEqual(['k3x9']);
      expect(parse(done.after).marks[0]?.payload).toBe(`${FRUIT}\n\n`);
      expectEveryOrderAlike('highlight', done.after, exactly);
    });

    it('refuses a comment that runs from the table into the text around it, naming its author', () => {
      const words = (name: string) =>
        `${name}'s comment runs from this table into the text next to it. Delete it first, or turn off Track Changes.`;
      const above = file(
        `Intro <!--cmt c9qf-->words.\n\n${FRUIT.replace('Pears', 'Pears<!--/c9qf-->')}\n\nAfter.`,
        {},
        thread('c9qf', 'bo'),
      );
      expect(said(() => remove(above))).toBe(words('Bo Chen'));
      const below = file(
        `Intro.\n\n${FRUIT.replace('Pears', '<!--cmt c9qf-->Pears')}\n\nAfter <!--/c9qf-->words.`,
        {},
        thread('c9qf', 'ada'),
      );
      expect(said(() => remove(below))).toBe(words('Ada Lovelace'));
      // A comment that holds the whole table, with no marker in it, is not in the table.
      const over = file(
        `Intro <!--cmt c9qf-->words.\n\n${FRUIT}\n\nAfter <!--/c9qf-->words.`,
        {},
        thread('c9qf', 'bo'),
      );
      const done = remove(over);
      expectInOrder('over', ['c9qf'], done.after);
      expect(parse(done.after).marks.find((m) => m.id === 'c9qf')?.segments).toHaveLength(1);
    });

    it('refuses when the only text next to the table is code, which holds no point', () => {
      const body = `${FRUIT.replace('Pears', '<!--cmt c9qf-->Pears<!--/c9qf-->')}\n\n\`\`\`\ncode\n\`\`\``;
      expect(said(() => remove(file(body, {}, thread('c9qf', 'bo'))))).toBe(
        "Bo Chen's comment is in this table, and no text next to it can keep it. Delete the comment first, or turn off Track Changes.",
      );
    });

    it('refuses when no text is there to keep the point, and says to delete the comment', () => {
      const only = file(
        FRUIT.replace('Pears', '<!--cmt c9qf-->Pears<!--/c9qf-->'),
        {},
        thread('c9qf', 'bo'),
      );
      expect(said(() => remove(only))).toBe(
        "Bo Chen's comment is in this table, and no text next to it can keep it. Delete the comment first, or turn off Track Changes.",
      );
      // With Track Changes off the table goes as text and the comment keeps a point.
      const plain = remove(only, null);
      expect(trimmed(plain.after)).toBe('<!--cmt c9qf-->');
      expect(parse(plain.after).ledger.comments.map((t) => t.id)).toEqual(['c9qf']);
    });
  });

  describe('with Track Changes off', () => {
    it('takes the table and the blank line after it out as text', () => {
      const done = remove(file(around(FRUIT)), null);
      expect(trimmed(done.after)).toBe('Intro.\n\nAfter.');
      expect(done.after.slice(done.caret, done.caret + 6)).toBe('After.');
      expect(parse(done.after).marks).toEqual([]);
      const last = remove(file(`Intro.\n\n${FRUIT}`), null);
      expect(trimmed(last.after)).toBe('Intro.');
      expect(last.after.slice(last.caret - 6, last.caret)).toBe('Intro.');
      expect(trimmed(remove(file(`${FRUIT}\n\nAfter.`), null).after)).toBe('After.');
      expect(trimmed(remove(file(FRUIT), null).after)).toBe('');
    });

    it('is what accepting the tracked deletion leaves', () => {
      for (const body of [around(FRUIT), `Intro.\n\n${FRUIT}`, `${FRUIT}\n\nAfter.`]) {
        const text = file(body);
        const tracked = remove(text);
        const accepted = applyChanges(tracked.after, accept(tracked.after, 'k3x9'));
        expect(trimmed(accepted), body).toBe(trimmed(remove(text, null).after));
      }
    });

    it('takes what was pending in it with it, anyone’s, and its deletion lines and ledger entries', () => {
      for (const by of ['bo', 'ada'] as const) {
        for (const [name, text] of Object.entries(pendingBy(by))) {
          const done = remove(text, null);
          expect(trimmed(done.after), `${by} ${name}`).toBe('Intro.\n\nAfter.');
          expect(parse(done.after).marks, `${by} ${name}`).toEqual([]);
          expect(parse(done.after).ledger.marks, `${by} ${name}`).toEqual({});
        }
      }
    });

    it('keeps a comment of the table as a point where it was', () => {
      const text = file(
        around(FRUIT.replace('Pears', '<!--cmt c9qf-->Pears<!--/c9qf-->')),
        {},
        thread('c9qf', 'bo'),
      );
      const done = remove(text, null);
      expect(trimmed(done.after)).toBe('Intro.\n\n<!--cmt c9qf-->\n\nAfter.');
      expectInOrder('plain comment', ['c9qf'], done.after);
      const last = remove(
        file(
          `Intro.\n\n${FRUIT.replace('Pears', '<!--cmt c9qf-->Pears<!--/c9qf-->')}`,
          {},
          thread('c9qf', 'bo'),
        ),
        null,
      );
      expect(trimmed(last.after)).toBe('Intro.<!--cmt c9qf-->');
    });
  });

  it('is allowed whatever is pending, for rule 2 asks nothing of a deletion of the table', () => {
    const all: TablePending = {
      rowsInserted: true,
      rowsChanged: true,
      colsInserted: true,
      colsChanged: true,
      align: true,
    };
    for (const tracked of [true, false]) expect(ruleTwo('deleteTable', all, tracked)).toBeNull();
  });
});
