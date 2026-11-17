// Accepting typing inside a pending moved row (#475, format §3.7, "Moving rows"): the typing travels
// with the row, so rejecting the move, from either half, sends the row back with it, and the decisions
// read alike in every order. The kept copy below the table, which the original view reads at the old
// place, is written again by the accept, so that no decision is refused.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptMarks, reject, rejectAll } from './decide.ts';
import { parse } from './parse.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import { trackedEdit } from './track.ts';
import {
  ada,
  bo,
  bodyOf,
  context,
  exactly,
  expectEveryOrderAlike,
  expectNoDecisionRefused,
  file,
} from './test-helpers.ts';
import { originalView } from './views.ts';

type WithoutTable<T> = T extends unknown ? Omit<T, 'table'> : never;
const move = (text: string, op: WithoutTable<TableOp>) => {
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  return applyChanges(
    text,
    tableEdit(text, { ...op, table }, context(ada, ['k3x9', 'w8nn', 'p5qm'])).changes,
  );
};
const typeAt = (text: string, from: number, to: number, insert: string) =>
  applyChanges(
    text,
    trackedEdit(text, { from, to, insert }, context(bo, ['t1aa', 't2bb', 't3cc'])),
  );
const trim = (text: string) => bodyOf(text).replace(/\s+$/, '');
/** The ids of the marks that are halves of a move (`halves`), or the others. */
const idsWhere = (text: string, halves: boolean) =>
  parse(text)
    .marks.filter((m) => (m.entry.move !== undefined) === halves)
    .map((m) => m.id);
const first = (ids: string[]): string => {
  const [id] = ids;
  if (id === undefined) throw new Error('no mark');
  return id;
};
const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |';
const WANTED = trim(file('| a | b |\n| - | - |\n| 1q | 2 |\n| 3 | 4 |'));

describe('accepting typing in a pending moved row (#475)', () => {
  const up = move(file(TABLE), { kind: 'moveRows', rows: [1], to: 0 });
  const at = up.indexOf(' 1 | 2') + 2;
  const typed = typeAt(up, at, at, 'q');

  it('rejecting the move, from either half, gives the row back with the typing in it', () => {
    const accepted = applyChanges(typed, accept(typed, first(idsWhere(typed, false))));
    for (const id of idsWhere(accepted, true)) {
      expect(trim(applyChanges(accepted, reject(accepted, id))), `reject ${id}`).toBe(WANTED);
    }
    // The original view, which rejecting everything gives, is the same.
    expect(trim(originalView(accepted).text)).toBe(WANTED);
    expect(trim(applyChanges(accepted, rejectAll(accepted)))).toBe(WANTED);
  });

  it('reads the same in every order: accept the typing then reject the move, or the reverse', () => {
    const half = first(idsWhere(typed, true));
    const a = applyChanges(typed, accept(typed, first(idsWhere(typed, false))));
    const typingFirst = applyChanges(a, reject(a, half));
    const b = applyChanges(typed, reject(typed, half));
    const moveFirst = applyChanges(b, accept(b, first(idsWhere(b, false))));
    expect(trim(moveFirst)).toBe(WANTED);
    expect(trim(typingFirst)).toBe(WANTED);
    expectEveryOrderAlike('typed in a moved row', typed, exactly);
    expectNoDecisionRefused('typed in a moved row', typed);
  });

  it('holds for typing that deletes or replaces, in either cell, and for a row moved down', () => {
    const cell = up.indexOf('| 2 |') + 2;
    const cases: [string, number, number, string][] = [
      ['a replacement', at - 1, at, 'Z'],
      ['a deletion', at - 1, at, ''],
      ['an insertion in the second cell', cell, cell, 'x'],
    ];
    for (const [name, from, to, insert] of cases) {
      const edited = typeAt(up, from, to, insert);
      expect(edited, name).not.toBe(up);
      const accepted = applyChanges(edited, accept(edited, first(idsWhere(edited, false))));
      const rejected = idsWhere(accepted, true).map((id) =>
        trim(applyChanges(accepted, reject(accepted, id))),
      );
      expect(rejected, `${name}: both halves`).toHaveLength(2);
      expect(rejected[0], `${name}: both halves read alike`).toBe(rejected[1]);
      expect(rejected[0], `${name}: the original view`).toBe(trim(originalView(accepted).text));
      expectEveryOrderAlike(name, edited, exactly);
      expectNoDecisionRefused(name, edited);
    }
    const down = move(file(TABLE), { kind: 'moveRows', rows: [0], to: 2 });
    const spot = down.lastIndexOf('1 | 2') + 1;
    const edited = typeAt(down, spot, spot, 'q');
    expectEveryOrderAlike('moved down', edited, exactly);
    expectNoDecisionRefused('moved down', edited);
    const accepted = applyChanges(edited, accept(edited, first(idsWhere(edited, false))));
    for (const id of idsWhere(accepted, true)) {
      expect(trim(applyChanges(accepted, reject(accepted, id)))).toBe(WANTED);
    }
  });

  it('writes the kept copy again when the same call accepts another move', () => {
    const base = file('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |');
    const once = move(base, { kind: 'moveRows', rows: [1], to: 0 });
    const both = applyChanges(
      once,
      tableEdit(
        once,
        {
          kind: 'moveRows',
          rows: [3],
          to: 0,
          table: readTables(once, parse(once))[0]?.from ?? 0,
        },
        context(ada, ['p5qm', 'p6rn', 'p7st']),
      ).changes,
    );
    const spot = both.indexOf(' 1 | 2') + 2;
    const typed = typeAt(both, spot, spot, 'q');
    // The typing's own move is the one that is not decided: it is the other row's copy that goes.
    const typing = first(idsWhere(typed, false));
    const other = parse(typed).marks.find(
      (m) => m.kind === 'ins' && m.entry.move !== undefined && m.id === 'p5qm',
    );
    expect(other).toBeDefined();
    const accepted = applyChanges(typed, acceptMarks(typed, [typing, 'p5qm']));
    const left = idsWhere(accepted, true);
    expect(left).toHaveLength(2);
    for (const id of left) {
      const text = trim(applyChanges(accepted, reject(accepted, id)));
      expect(text).toContain('| 1q | 2 |');
    }
    expectEveryOrderAlike('two moves', typed, exactly);
    expectNoDecisionRefused('two moves', typed);
  });
});
