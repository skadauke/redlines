import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { tableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import { trackedEdit } from './track.ts';
import {
  ada,
  bo,
  blockLeaves,
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

const FRUIT =
  '| Fruit  | Count |\n| ------ | ----- |\n| Apples | 3     |\n| Pears  | 5     |\n| Plums  | 7     |';
const trim = (text: string) => bodyOf(text).replace(/[\r\n]+$/, '');
const IDS = ['k3x9', 'w8nn', 'p5qm', 'q6rs'];

type Shape =
  | { kind: 'deleteRows'; rows: number[] }
  | { kind: 'moveRows'; rows: number[]; to: number }
  | { kind: 'insertRows'; after: number; count?: number };

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

describe('deleting rows, tracked (format §3.7)', () => {
  it('keeps the row below the table after one blank line, with its position', () => {
    const done = edit(file(FRUIT), { kind: 'deleteRows', rows: [2] });
    expect(trim(done.after)).toBe(
      [
        '| Fruit  | Count |',
        '| ------ | ----- |',
        '| Apples | 3     |',
        '| Plums  | 7     |',
        '',
        '<!--del k3x9 row=2 \\| Pears  \\| 5     \\|-->',
      ].join('\n'),
    );
    expectInOrder('delete', [], done.after);
    expect(parse(done.after).ledger.marks['k3x9']).toEqual({ by: 'ada', at: '2026-10-31T09:00Z' });
    // The caret goes to the row that is now where it was.
    expect(done.after.slice(done.caret, done.caret + 6)).toBe('Plums ');
  });

  it('puts several rows in one group, in order, and rewrites the others’ positions', () => {
    const done = edit(file(FRUIT), { kind: 'deleteRows', rows: [1, 2] });
    const lines = trim(done.after).split('\n');
    expect(lines.slice(-2)).toEqual([
      '<!--del w8nn row=1 \\| Apples \\| 3     \\|-->',
      '<!--del p5qm row=1 \\| Pears  \\| 5     \\|-->',
    ]);
    const marks = parse(done.after).ledger.marks;
    expect(marks['w8nn']?.group).toBe('k3x9');
    expect(marks['p5qm']?.group).toBe('k3x9');
    // A second deletion by someone else, above and below the first.
    const next = edit(done.after, { kind: 'deleteRows', rows: [1] }, bo, ['c2dd']).after;
    expect(trim(next).split('\n').slice(-3)).toEqual([
      '<!--del w8nn row=1 \\| Apples \\| 3     \\|-->',
      '<!--del p5qm row=1 \\| Pears  \\| 5     \\|-->',
      '<!--del c2dd row=1 \\| Plums  \\| 7     \\|-->',
    ]);
    expectEveryOrderAlike('two people', next, exactly);
  });

  it('makes the first body row the header when the header is deleted, delimiter row after it', () => {
    const done = edit(file(FRUIT), { kind: 'deleteRows', rows: [0] });
    expect(trim(done.after)).toBe(
      [
        '| Apples | 3     |',
        '| ------ | ----- |',
        '| Pears  | 5     |',
        '| Plums  | 7     |',
        '',
        '<!--del k3x9 row=0 \\| Fruit  \\| Count \\|-->',
      ].join('\n'),
    );
    expect(trim(applyChanges(done.after, reject(done.after, 'k3x9')))).toBe(FRUIT);
  });

  it('refuses to delete the last remaining row, with a way out', () => {
    const only = file('| a |\n| - |\n| b |');
    expect(said(() => edit(only, { kind: 'deleteRows', rows: [0, 1] }))).toBe(
      'Delete the table instead.',
    );
    expect(said(() => edit(file('| a |\n| - |'), { kind: 'deleteRows', rows: [0] }))).toBe(
      'Delete the table instead.',
    );
  });

  it('writes the file’s own line breaks', () => {
    const done = edit(file(FRUIT.replaceAll('\n', '\r\n')), { kind: 'deleteRows', rows: [2] });
    const body = bodyOf(done.after);
    expect(body.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(body).toContain('| Apples | 3     |\r\n| Plums  | 7     |\r\n\r\n<!--del k3x9 row=2');
    expect(trim(applyChanges(done.after, reject(done.after, 'k3x9')))).toBe(
      FRUIT.replaceAll('\n', '\r\n'),
    );
  });

  it('removes your own pending row outright, and folds your own marks into the deletion', () => {
    const own = file(FRUIT.replace('| Pears ', '| <!--ins m2bd row--> Pears'), { m2bd: 'ada' });
    const gone = edit(own, { kind: 'deleteRows', rows: [2] });
    expect(trim(gone.after)).toBe(FRUIT.replace('| Pears  | 5     |\n', ''));
    expect(parse(gone.after).ledger.marks).toEqual({});
    const typed = file(FRUIT.replace('Pears', 'Pe<!--ins m2bd-->x<!--/m2bd-->ars'), {
      m2bd: 'ada',
    });
    const folded = edit(typed, { kind: 'deleteRows', rows: [2] });
    expect(trim(folded.after)).toContain('<!--del k3x9 row=2 \\| Pears  \\| 5     \\|-->');
    expect(trim(folded.after)).not.toContain('m2bd');
    expect(Object.keys(parse(folded.after).ledger.marks)).toEqual(['k3x9']);
  });

  it('rule 3: refuses another person’s pending change in the row, or their inserted or moved row', () => {
    const inside = file(FRUIT.replace('Pears', 'Pe<!--ins m2bd-->x<!--/m2bd-->ars'), {
      m2bd: 'bo',
    });
    expect(said(() => edit(inside, { kind: 'deleteRows', rows: [2] }))).toBe(
      "Bo Chen's pending change is in this row. Decide it first.",
    );
    const inserted = file(FRUIT.replace('| Pears ', '| <!--ins m2bd row--> Pears'), { m2bd: 'bo' });
    expect(said(() => edit(inserted, { kind: 'deleteRows', rows: [2] }))).toBe(
      "Bo Chen's inserted row is pending. Decide it first.",
    );
    const moved = edit(file(FRUIT), { kind: 'moveRows', rows: [3], to: 1 }, bo, ['m2bd', 'n3cd']);
    expect(said(() => edit(moved.after, { kind: 'deleteRows', rows: [1] }))).toBe(
      "Bo Chen's moved row is pending. Decide it first.",
    );
    // With Track Changes off the rows go, and what was pending in them.
    const plain = edit(inside, { kind: 'deleteRows', rows: [2] }, null);
    expect(trim(plain.after)).toBe(FRUIT.replace('| Pears  | 5     |\n', ''));
    expect(parse(plain.after).ledger.marks).toEqual({});
  });

  it('rule 4: a comment in a deleted row becomes a point comment in the row below, or above for the last', () => {
    const body = FRUIT.replace('Pears', '<!--cmt c9qf-->Pears<!--/c9qf-->');
    const done = edit(file(body, {}, thread('c9qf')), { kind: 'deleteRows', rows: [2] });
    expect(trim(done.after)).toContain('| <!--cmt c9qf-->Plums  | 7     |');
    expect(parse(done.after).ledger.comments.map((t) => t.id)).toEqual(['c9qf']);
    const last = FRUIT.replace('Plums', '<!--cmt c9qf-->Plums<!--/c9qf-->');
    const end = edit(file(last, {}, thread('c9qf')), { kind: 'deleteRows', rows: [3] });
    expect(trim(end.after)).toContain('| Pears  | 5<!--cmt c9qf-->     |');
    expectInOrder('comment', ['c9qf'], end.after);
  });

  it('rule 2: allowed with rows pending, refused with a column deleted or, tracked, inserted', () => {
    const column = `${FRUIT}\n\n<!--del m2bd col=2 \\| Count \\\\n \\| ----- \\\\n \\| 3 \\\\n \\| 5 \\\\n \\| 7-->`;
    expect(said(() => edit(file(column, { m2bd: 'bo' }), { kind: 'deleteRows', rows: [2] }))).toBe(
      'Accept or reject the column changes in this table first.',
    );
    expect(
      said(() => edit(file(column, { m2bd: 'bo' }), { kind: 'deleteRows', rows: [2] }, null)),
    ).toBe('Accept or reject the column changes in this table first.');
    const inserted = file(FRUIT.replace('Count', '<!--ins m2bd col--> Count'), { m2bd: 'bo' });
    expect(said(() => edit(inserted, { kind: 'deleteRows', rows: [2] }))).toBe(
      'Accept or reject the column changes in this table first.',
    );
    expect(said(() => edit(inserted, { kind: 'deleteRows', rows: [2] }, null))).toBe('no error');
  });
});

describe('deleting a row of a table without outer pipes', () => {
  it('keeps the row without the end of a comment that started at the end of the line above', () => {
    const text = file('a | b\n-- | --\n1 | 2\nx | y');
    const at = text.indexOf('x | y');
    const commented = applyChanges(
      text,
      addComment(text, { from: at, to: at + 1 }, 'A note.', context(bo, ['r4st'])).changes,
    );
    // (the comment starts at the end of the row above: a marker can't start a row with no pipe)
    expect(trim(commented)).toContain('1 | 2<!--cmt r4st-->\nx<!--/r4st--> | y');
    const done = edit(commented, { kind: 'deleteRows', rows: [2] });
    expect(trim(done.after)).toContain('<!--del k3x9 row=2 x \\| y-->');
    expect(trim(applyChanges(done.after, rejectAll(done.after)))).toContain('x | y');
    expectEveryOrderAlike('comment across', done.after, exactly);
  });
});

describe('comments at the start of a row of a table without a pipe there', () => {
  const commentedAt = (text: string, find: string) => {
    const at = text.lastIndexOf(find);
    return applyChanges(
      text,
      addComment(text, { from: at, to: at + 1 }, 'A note.', context(bo, ['r4st'])).changes,
    );
  };

  it('rejecting the inserted row above one keeps its comment, written at the end of the row above', () => {
    const text = file('a |\n-- |\n1 |\nx |');
    const inserted = edit(text, { kind: 'insertRows', after: 1 }).after;
    const commented = commentedAt(inserted, 'x |');
    expect(commented).toMatch(/\|<!--cmt r4st-->\nx<!--\/r4st--> \|/);
    const back = applyChanges(commented, reject(commented, 'k3x9'));
    expect(trim(back)).toBe('a |\n-- |\n1<!--cmt r4st--> |\nx<!--/r4st--> |');
  });

  it('refuses to move a row to the top with a comment parked after its closing pipe', () => {
    const text = file('b |\n-- |\nx |\ncafé |\nb |');
    const commented = commentedAt(text, 'b |');
    expect(said(() => edit(commented, { kind: 'moveRows', rows: [2], to: 0 }))).toContain(
      "A comment in this table can't move with this row.",
    );
  });
});

describe('deleting rows, plain', () => {
  it('takes the rows out as text, with no deletion and no ledger entry', () => {
    const done = edit(file(FRUIT), { kind: 'deleteRows', rows: [1, 3] }, null);
    expect(trim(done.after)).toBe('| Fruit  | Count |\n| ------ | ----- |\n| Pears  | 5     |');
    expect(done.after.slice(done.caret, done.caret + 5)).toBe('Pears');
    const header = edit(file(FRUIT), { kind: 'deleteRows', rows: [0] }, null);
    expect(trim(header.after)).toBe(
      FRUIT.replace(
        '| Fruit  | Count |\n| ------ | ----- |\n| Apples | 3     |',
        '| Apples | 3     |\n| ------ | ----- |',
      ),
    );
  });

  it('moves the positions of deletions that are pending, and keeps them in order', () => {
    const body = `${FRUIT}\n\n<!--del g5nb row=3 \\| Kiwi \\| 1 \\|-->`;
    const done = edit(file(body, { g5nb: 'bo' }), { kind: 'deleteRows', rows: [1] }, null);
    expect(trim(done.after)).toContain('<!--del g5nb row=2 \\| Kiwi \\| 1 \\|-->');
    // The last row of a file with a ledger below it, and the last of the deletions' rows.
    const last = edit(file(FRUIT), { kind: 'deleteRows', rows: [3] }, null);
    expect(trim(last.after)).toBe(FRUIT.replace('\n| Plums  | 7     |', ''));
  });
});

describe('moving rows (format §3.7)', () => {
  it('writes the row at its new place with the in-row marker, and the old place below the table', () => {
    const up = edit(file(FRUIT), { kind: 'moveRows', rows: [3], to: 1 });
    expect(trim(up.after)).toBe(
      [
        '| Fruit  | Count |',
        '| ------ | ----- |',
        '| <!--ins k3x9 row--> Plums  | 7     |',
        '| Apples | 3     |',
        '| Pears  | 5     |',
        '',
        '<!--del w8nn row=4 \\| Plums  \\| 7     \\|-->',
      ].join('\n'),
    );
    const marks = parse(up.after).ledger.marks;
    expect(marks['k3x9']?.move).toBe('w8nn');
    expect(marks['w8nn']?.move).toBe('k3x9');
    expect(up.rows).toEqual([1]);
    expectInOrder('move', [], up.after);
    expectEveryOrderAlike('move', up.after, exactly);
  });

  it('moves a row to the top, where it becomes the header, and to the end', () => {
    const top = edit(file(FRUIT), { kind: 'moveRows', rows: [2], to: 0 });
    expect(trim(top.after).split('\n').slice(0, 3)).toEqual([
      '| <!--ins k3x9 row--> Pears  | 5     |',
      '| ------ | ----- |',
      '| Fruit  | Count |',
    ]);
    expect(trim(originalView(top.after).text)).toBe(FRUIT);
    const end = edit(file(FRUIT), { kind: 'moveRows', rows: [1], to: 4 });
    expect(trim(end.after).split('\n').slice(2, 5)).toEqual([
      '| Pears  | 5     |',
      '| Plums  | 7     |',
      '| <!--ins k3x9 row--> Apples | 3     |',
    ]);
    expect(trim(top.after)).toContain('<!--del w8nn row=3 \\| Pears  \\| 5     \\|-->');
  });

  it('refuses a move that changes nothing, and moving another person’s inserted or moved row', () => {
    expect(said(() => edit(file(FRUIT), { kind: 'moveRows', rows: [2], to: 3 }))).toBe(
      'The rows are already there.',
    );
    const inserted = file(FRUIT.replace('| Pears ', '| <!--ins m2bd row--> Pears'), { m2bd: 'bo' });
    expect(said(() => edit(inserted, { kind: 'moveRows', rows: [2], to: 0 }))).toBe(
      "Bo Chen's inserted row is pending. Decide it first.",
    );
  });

  it('moves your own pending row plainly, as it is in no original', () => {
    const own = file(FRUIT.replace('| Pears ', '| <!--ins m2bd row--> Pears'), { m2bd: 'ada' });
    const done = edit(own, { kind: 'moveRows', rows: [2], to: 4 });
    expect(trim(done.after).split('\n').slice(-1)).toEqual([
      '| <!--ins m2bd row--> Pears | 5     |',
    ]);
    expect(Object.keys(parse(done.after).ledger.marks)).toEqual(['m2bd']);
  });

  it('takes another person’s pending changes along, and what was typed since, both ways', () => {
    const typed = file(FRUIT.replace('Plums', 'Plu<!--ins m2bd-->x<!--/m2bd-->ms'), { m2bd: 'bo' });
    const moved = edit(typed, { kind: 'moveRows', rows: [3], to: 1 }).after;
    expect(trim(moved)).toContain('| <!--ins k3x9 row--> Plu<!--ins m2bd-->x<!--/m2bd-->ms ');
    // The deletion half keeps the row as it reads with the change rejected.
    expect(trim(moved)).toContain('<!--del w8nn row=4 \\| Plums  \\| 7     \\|-->');
    // Bo types more in the moved row; rejecting the move takes it back to its place with it.
    const more = moved.replace('Apples | 3     |', 'Apples | 3<!--ins n3cd-->3<!--/n3cd-->     |');
    const withBo = more.replace('  m2bd:', '  n3cd: {by: bo, at: 2026-10-13T22:30Z}\n  m2bd:');
    const back = applyChanges(withBo, reject(withBo, 'k3x9'));
    expect(trim(back)).toContain('| Plu<!--ins m2bd-->x<!--/m2bd-->ms ');
    expect(trim(back).split('\n').slice(2).join('\n')).toMatch(/Apples[^]*Pears[^]*Plu/);
    expectEveryOrderAlike('moved with typing', moved, exactly);
  });

  it('decides a move as one change from either half, and with accept all and reject all', () => {
    const moved = edit(file(FRUIT), { kind: 'moveRows', rows: [3], to: 1 }).after;
    const expectNewest = trim(newestView(moved).text);
    for (const id of ['k3x9', 'w8nn']) {
      const accepted = applyChanges(moved, accept(moved, id));
      expect(trim(accepted)).toBe(expectNewest);
      expect(parse(accepted).ledger.marks).toEqual({});
      const rejected = applyChanges(moved, reject(moved, id));
      expect(trim(rejected)).toBe(FRUIT);
      expect(parse(rejected).ledger.marks).toEqual({});
    }
    expect(trim(applyChanges(moved, acceptAll(moved)))).toBe(expectNewest);
    expect(trim(applyChanges(moved, rejectAll(moved)))).toBe(FRUIT);
  });

  it('rejects a move of a row of a table without outer pipes, in every order (#289)', () => {
    const forms = [
      'a | b\n-- | --\n1 | 2\n3 | 4\n5 | 6',
      'a | b |\n-- | --\n1 | 2 |\n3 | 4 |\n5 | 6 |',
      '| a | b\n| -- | --\n| 1 | 2\n| 3 | 4\n| 5 | 6',
      'a | b\n-- | --\n1 | 2\n| 3 | 4\n5 | 6',
      '| a | b |\n| -- | -- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |',
    ];
    for (const form of forms) {
      const text = file(form);
      const table = readTables(text, parse(text))[0];
      const count = table?.rows.length ?? 0;
      for (let row = 1; row < count; row++) {
        for (let to = 0; to <= count; to++) {
          let moved: string;
          try {
            moved = edit(text, { kind: 'moveRows', rows: [row], to }).after;
          } catch (error) {
            if (error instanceof EditError) continue;
            throw error;
          }
          const label = `${JSON.stringify(form)} row ${row} to ${to}`;
          // The pipe the move wrote in front of a row that had none is plain, and in both halves of
          // the move: rejecting gives the row back at its place, reading as it did.
          const lines = form.split('\n');
          const line = lines[row + 1] ?? '';
          lines[row + 1] = /^\|/.test(line) ? line : `| ${line}`;
          const back = lines.join('\n');
          for (const id of ['k3x9', 'w8nn']) {
            expect(trim(applyChanges(moved, reject(moved, id))), label).toBe(back);
          }
          expect(trim(applyChanges(moved, rejectAll(moved))), label).toBe(back);
          expect(trim(applyChanges(moved, acceptAll(moved))), label).toBe(
            trim(newestView(moved).text),
          );
          const tables = (view: string) =>
            blockLeaves(view).filter((leaf) => leaf.kind === 'table');
          expect(tables(back), label).toEqual(tables(form));
          expectNoDecisionRefused(label, moved);
        }
      }
    }
  });

  it('with Track Changes off moves the rows as text', () => {
    const done = edit(file(FRUIT), { kind: 'moveRows', rows: [1, 2], to: 4 }, null);
    expect(trim(done.after)).toBe(
      '| Fruit  | Count |\n| ------ | ----- |\n| Plums  | 7     |\n| Apples | 3     |\n| Pears  | 5     |',
    );
    expect(done.rows).toEqual([2, 3]);
    const header = edit(file(FRUIT), { kind: 'moveRows', rows: [0], to: 2 }, null);
    expect(trim(header.after)).toBe(
      '| Apples | 3     |\n| ------ | ----- |\n| Fruit  | Count |\n| Pears  | 5     |\n| Plums  | 7     |',
    );
  });
});

describe('deleted and moved rows, decided and viewed', () => {
  const deleted = edit(file(FRUIT), { kind: 'deleteRows', rows: [2] }).after;

  it('accepting removes the deletion line and its blank line; rejecting writes the row back', () => {
    expect(trim(applyChanges(deleted, accept(deleted, 'k3x9')))).toBe(
      FRUIT.replace('| Pears  | 5     |\n', ''),
    );
    expect(trim(applyChanges(deleted, reject(deleted, 'k3x9')))).toBe(FRUIT);
    expect(parse(applyChanges(deleted, accept(deleted, 'k3x9'))).ledger.marks).toEqual({});
  });

  it('writes the row back at its place after other rows changed', () => {
    const more = edit(deleted, { kind: 'insertRows', after: 0 }, bo, ['c2dd']).after;
    const back = trim(applyChanges(more, reject(more, 'k3x9')));
    expect(
      back.split('\n').map((line) => line.replace(/<!--ins \w+ row-->/, '<ins>').split(' ')[1]),
    ).toEqual(['Fruit', '------', '<ins>', 'Apples', 'Pears', 'Plums']);
  });

  it('shows the three views', () => {
    expect(trim(newestView(deleted).text)).toBe(FRUIT.replace('| Pears  | 5     |\n', ''));
    expect(newestView(deleted).text).toBe(`${FRUIT.replace('| Pears  | 5     |\n', '')}\n`);
    expect(originalView(deleted).text).toBe(`${FRUIT}\n`);
    expect(reviewView(deleted)).toBe(
      FRUIT.replace(
        '| Pears  | 5     |',
        '| {--Pears--}  | {--5--}     |{>>[k3x9 ada] Deleted row<<}',
      ) + '\n',
    );
  });

  it('inserts a row above the header, and rejects it', () => {
    const above = edit(file(FRUIT), { kind: 'insertRows', after: -1 });
    expect(trim(above.after).split('\n').slice(0, 4)).toEqual([
      '| <!--ins k3x9 row-->        |       |',
      '| ------ | ----- |',
      '| Fruit  | Count |',
      '| Apples | 3     |',
    ]);
    expect(above.after.slice(above.caret - 7, above.caret)).toBe('row--> ');
    expect(trim(applyChanges(above.after, reject(above.after, 'k3x9')))).toBe(FRUIT);
    expect(trim(applyChanges(above.after, accept(above.after, 'k3x9')))).toContain(
      '|        |       |',
    );
    expectEveryOrderAlike('above', above.after, exactly);
    const plain = edit(file(FRUIT), { kind: 'insertRows', after: -1 }, null);
    expect(trim(plain.after).split('\n').slice(0, 3)).toEqual([
      '|        |       |',
      '| ------ | ----- |',
      '| Fruit  | Count |',
    ]);
  });

  it('is decided with other changes in the file, and comments in a rejected row become points', () => {
    const body = FRUIT.replace(
      '| Pears ',
      '| <!--ins m2bd row--> <!--cmt c9qf-->Pears<!--/c9qf-->',
    );
    const withComment = file(body, { m2bd: 'ada' }, thread('c9qf'));
    const rejected = applyChanges(withComment, reject(withComment, 'm2bd'));
    expect(trim(rejected)).toContain('| <!--cmt c9qf-->Plums  | 7     |');
    expect(parse(rejected).ledger.comments.map((t) => t.id)).toEqual(['c9qf']);
    // Reject all decides a row while row deletions are pending.
    const mix = file(
      `${body}\n\n<!--del g5nb row=2 \\| Kiwi \\| 1 \\|-->`,
      { m2bd: 'ada', g5nb: 'bo' },
      thread('c9qf'),
    );
    const all = applyChanges(mix, rejectAll(mix));
    expect(parse(all).marks.filter((m) => m.kind !== 'cmt')).toEqual([]);
    expect(trim(all)).toContain('| Kiwi | 1 |');
    expect(bo.handle).toBe('bo');
  });
});

describe('the space after an inserted row’s marker', () => {
  it('is taken by accepting whatever follows, so every order of decisions writes the same bytes', () => {
    const ada1 = edit(file(FRUIT), { kind: 'insertRows', after: 1 }).after;
    // Bo types in the empty first cell of Ada's new row.
    const at = ada1.indexOf('row-->') + 'row--> '.length;
    const typed = applyChanges(
      ada1,
      trackedEdit(ada1, { from: at, to: at, insert: 'Q' }, context(bo, ['w8nn'])),
    );
    expectEveryOrderAlike('empty first cell', typed, exactly);
    // Accepted, and then Bo's change rejected, the cell is as wide as the others.
    const accepted = applyChanges(typed, accept(typed, 'k3x9'));
    const both = applyChanges(accepted, reject(accepted, 'w8nn'));
    expect(
      trim(both)
        .split('\n')
        .filter((l) => /^\| +\|/.test(l)),
    ).toEqual(['|        |       |']);
  });

  it('is written after the marker of every new row, in a padded table and a loose one', () => {
    const padded = edit(file(FRUIT), { kind: 'insertRows', after: 1 }).after;
    expect(trim(padded)).toContain('| <!--ins k3x9 row-->        |       |');
    expect(trim(applyChanges(padded, accept(padded, 'k3x9')))).toContain('|        |       |');
    const loose = edit(file('| a | b |\n| - | - |\n| cc | d |'), {
      kind: 'insertRows',
      after: 1,
    }).after;
    expect(trim(loose)).toContain('| <!--ins k3x9 row-->  |  |');
    expect(trim(applyChanges(loose, accept(loose, 'k3x9')))).toContain('\n|  |  |');
  });
});

describe('a pending format change in a moved or deleted row', () => {
  const BOLD =
    '| Fruit  | Count |\n| ------ | ----- |\n| Apples | 3     |\n| <!--fmt m2bd +bold-->**Pears**<!--/m2bd-->  | 5     |\n| Plums  | 7     |';
  const bold = (by: string) => file(BOLD, { m2bd: by });

  it('travels with a moved row, and rejecting the move, the change or both read alike', () => {
    for (const by of ['bo', 'ada']) {
      const moved = edit(bold(by), { kind: 'moveRows', rows: [2], to: 1 }).after;
      expectEveryOrderAlike(`moved, ${by}`, moved, exactly);
      expect(() => rejectAll(moved)).not.toThrow();
      const back = applyChanges(moved, rejectAll(moved));
      expect(trim(back)).toBe(trim(originalView(moved).text));
      expect(trim(back)).toContain('| Pears  |');
      expect(trim(back)).not.toContain('**');
      const one = applyChanges(moved, reject(moved, 'm2bd'));
      expect(() => reject(one, Object.keys(parse(one).ledger.marks)[0] ?? '')).not.toThrow();
    }
  });

  it('is folded into the deletion of your own row: rejecting the deletion gives the row as it was', () => {
    const deleted = edit(bold('ada'), { kind: 'deleteRows', rows: [2] }).after;
    expect(trim(deleted)).toContain('row=2 \\| Pears  \\| 5     \\|');
    expect(trim(deleted)).not.toContain('**');
    const restored = applyChanges(
      deleted,
      reject(deleted, Object.keys(parse(deleted).ledger.marks)[0] ?? ''),
    );
    expect(trim(restored)).toContain('| Pears  | 5     |');
    expect(trim(restored)).not.toContain('**');
    expect(trim(originalView(deleted).text)).toBe(trim(restored));
  });
});
