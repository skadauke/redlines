import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
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
  bodyOf,
  context,
  expectEveryOrderAlike,
  expectInOrder,
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
