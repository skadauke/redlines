// Random tables, cell edits and row operations by three people, with Track Changes on and off
// (format §3.7): every state reads as one GFM table to the oracle, every order of decisions reads the
// same, all accepted is the newest view and all rejected the original's bytes. A comment inside a row
// that moves, in every pipe layout, travels with the row both ways (#371). `REDLINES_FUZZ` sets how
// many tables (6000 before a stage merges).
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { expectCommentsTravel } from './table-move-oracle.ts';
import { tableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import {
  ada,
  blockLeaves,
  bo,
  claudeAda,
  context,
  exactly,
  everyOrder,
  bodyOf,
  expectEveryOrderAlike,
  expectNoDecisionRefused,
  expectInOrder,
  file,
} from './test-helpers.ts';
import { addComment } from './comments.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import { newestView, originalView } from './views.ts';

const WORDS = ['alpha', 'b', 'café', 'x y', '11', ''];
const PEOPLE = [ada, bo, claudeAda];

function tablesOf(text: string) {
  return blockLeaves(text).filter((leaf) => leaf.kind === 'table');
}

const POOL = [
  'k3x9',
  'w8nn',
  'p5qm',
  'q6rs',
  'c2dd',
  'f3gg',
  'h4jj',
  'm5nn',
  'b7cd',
  'd8fg',
  'g9hj',
  'j2kl',
  'n3pq',
  'r4st',
  't5vw',
  'v6xz',
];

/** What a comment of the dedicated step covers: inside one cell, across two, or a point. */
type NoteKind = 'cell' | 'across' | 'point';

/**
 * A comment, or two by two people, inside one row of the table `initial`, and that row moved to a
 * boundary of the table by a third person, with the comments made before the move or after it, in
 * whatever pipe layout the table has (#371). The move is decided in every order: every state keeps
 * the comments with their row, every order reads alike, no decision is refused, and, where the
 * comments came first, rejecting the move gives back the table as it was, comments and all, the row
 * with the plain pipe that a row without one is moved with. Returns false where an operation is
 * refused (a comment that starts a row with no pipe at its start, say, beside a move).
 */
function notedMove(
  initial: string,
  columns: number,
  lead: boolean,
  random: () => number,
  label: string,
): boolean {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const ids = () => [...POOL].sort(() => random() - 0.5);
  const first = readTables(initial, parse(initial))[0];
  if (!first) return false;
  const rows = first.rows.length;
  const row = Math.floor(random() * rows);
  const to = Math.floor(random() * (rows + 1));
  const mover = pick(PEOPLE);
  const before = random() < 0.5;
  const notes = Array.from({ length: 1 + Math.floor(random() * 2) }, () => ({
    who: pick(PEOPLE),
    kind: pick<NoteKind>(['cell', 'across', 'point']),
    cell: Math.floor(random() * columns),
    roll: random(),
  }));
  const note = (text: string, at: number): string | null => {
    let current = text;
    for (const { who, kind, cell, roll } of notes) {
      const cells = readTables(current, parse(current))[0]?.rows[at]?.cells.slice(0, columns) ?? [];
      // (a comment on the first cell of the header of a table with no leading pipe starts on a line
      // of its own above the table: another rule's case, drawn in the column suites)
      const one = at === 0 && !lead && cell === 0 ? 1 : cell;
      const here = cells[one];
      const next = cells[one + 1];
      if (!here || (kind === 'across' && !next)) return null;
      const size = here.textTo - here.textFrom;
      const start = here.textFrom + Math.floor(roll * (size + (kind === 'point' ? 1 : 0)));
      const range =
        kind === 'point'
          ? { from: start, to: start }
          : kind === 'across'
            ? {
                from: Math.max(here.textFrom, here.textTo - 1),
                to: Math.min(next?.textTo ?? 0, (next?.textFrom ?? 0) + 1),
              }
            : { from: start, to: Math.min(here.textTo, start + 1 + Math.floor(roll * 3)) };
      if (kind !== 'point' && range.from === range.to) return null;
      current = applyChanges(
        current,
        addComment(current, range, 'A note.', context(who, ids())).changes,
      );
    }
    return current;
  };
  try {
    const op = (table: number): TableOp => ({ kind: 'moveRows', table, rows: [row], to });
    const tableAt = (text: string) => readTables(text, parse(text))[0]?.from ?? 0;
    let commented: string | null = before ? note(initial, row) : initial;
    if (commented === null) return false;
    const done = tableEdit(commented, op(tableAt(commented)), context(mover, ids()));
    let text = applyChanges(commented, done.changes);
    if (!before) {
      commented = note(text, done.rows?.[0] ?? 0);
      if (commented === null) return false;
      text = commented;
    }
    expectInOrder(
      label,
      parse(text).ledger.comments.map((thread) => thread.id),
      text,
    );
    expectEveryOrderAlike(label, text, exactly);
    expectNoDecisionRefused(label, text);
    expectCommentsTravel(label, text, columns);
    if (before) {
      // The comments first: the move rejected is the table as it was, the moved row with its pipe.
      const eol = initial.includes('\r\n') ? '\r\n' : '\n';
      const lines = bodyOf(commented)
        .replace(/[\r\n]+$/, '')
        .split(eol);
      const at = row === 0 ? 0 : row + 1;
      const moved = lines[at] ?? '';
      lines[at] = /^\|/.test(moved) ? moved : `| ${moved}`;
      expect(bodyOf(applyChanges(text, rejectAll(text))).replace(/[\r\n]+$/, ''), label).toBe(
        lines.join(eol),
      );
    }
    return true;
  } catch (error) {
    if (error instanceof EditError) return false;
    throw error;
  }
}

describe('rows, random', () => {
  it('stay one table, read alike in every order, and decide to the newest and the original', () => {
    // (`REDLINES_SEED` draws other tables, for a longer hunt)
    const seed = Number(process.env['REDLINES_SEED'] ?? 2026);
    const random = seeded(seed);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    let used = 0;
    // The pipe layouts that a comment in a moved row has been tried in, and how often.
    const noted = new Map<string, number>();
    for (let n = 0; n < fuzzCount(120); n++) {
      const columns = 1 + Math.floor(random() * 3);
      // Half the tables have no outer pipes, or one of them (#289); a table of one column needs
      // a pipe at one end, and `- | -` would be a list item, so a bare delimiter row is `--`.
      const lead = random() < 0.5;
      const trail = columns === 1 && !lead ? true : random() < 0.5;
      // (An empty cell at a bare edge would read as the pipe of that edge.)
      const row = (cells: string[]) => {
        const filled = cells.map((c, i) =>
          c === '' && ((i === 0 && !lead) || (i === cells.length - 1 && !trail)) ? 'x' : c,
        );
        return `${lead ? '| ' : ''}${filled.join(' | ')}${trail ? ' |' : ''}`.replace(/ {2}/g, ' ');
      };
      const dash = lead && trail ? '-' : '--';
      const lines = [
        row(Array.from({ length: columns }, () => pick(WORDS.slice(0, 4)))),
        row(Array.from({ length: columns }, () => dash)),
      ];
      for (let i = 0; i < 2 + Math.floor(random() * 3); i++) {
        lines.push(row(Array.from({ length: columns }, () => pick(WORDS))));
      }
      let text = file(lines.join(random() < 0.2 ? '\r\n' : '\n'));
      if (lines.length && text.includes('\r\n')) text = text.replace(/(?<!\r)\n/g, '\r\n');
      const initial = text;
      const steps: string[] = [];
      const ids = () => [...POOL].sort(() => random() - 0.5);
      for (let step = 0; step < 2 + Math.floor(random() * 3); step++) {
        const table = readTables(text, parse(text))[0];
        if (!table) break;
        const who = pick(['ada', 'bo', 'claude-ada', 'plain'] as const);
        const rows = table.rows.length;
        const kind = pick(['insert', 'delete', 'move', 'cell', 'cell', 'bold', 'comment'] as const);
        let op: TableOp | null = null;
        let edit: { from: number; to: number; insert: string } | null = null;
        let over: { from: number; to: number; kind: 'bold' | 'comment' } | null = null;
        if (kind === 'insert') {
          op = {
            kind: 'insertRows',
            table: table.from,
            after: Math.floor(random() * (rows + 1)) - 1,
            count: 1 + Math.floor(random() * 2),
          };
        } else if (kind === 'delete') {
          op = { kind: 'deleteRows', table: table.from, rows: [Math.floor(random() * rows)] };
        } else if (kind === 'move') {
          op = {
            kind: 'moveRows',
            table: table.from,
            rows: [Math.floor(random() * rows)],
            to: Math.floor(random() * (rows + 1)),
          };
        } else if (kind === 'bold' || kind === 'comment') {
          // A format change or a comment on the text of a cell, or on a stretch of it.
          const target = pick(table.rows);
          const cell = pick(target.cells.slice(0, columns));
          if (cell.textTo - cell.textFrom < 1) continue;
          // (a comment on the first cell of the header of a table with no leading pipe starts on a
          // line of its own above the table: another rule's case, drawn in the column suites)
          if (kind === 'comment' && !lead && target.header) continue;
          const from = cell.textFrom + Math.floor(random() * (cell.textTo - cell.textFrom));
          over = { from, to: Math.min(cell.textTo, from + 1 + Math.floor(random() * 3)), kind };
        } else {
          const target = pick(table.rows);
          const cell = pick(target.cells.slice(0, columns));
          const from = cell.textFrom + Math.floor(random() * (cell.textTo - cell.textFrom + 1));
          edit = { from, to: from, insert: pick(['q', 'é', 'ab']) };
        }
        steps.push(`${who} ${JSON.stringify(op ?? edit ?? over)}`);
        const person = PEOPLE.find((p) => p.handle === who);
        try {
          let changes;
          if (op) {
            changes = (
              who === 'plain'
                ? untrackedTableEdit(text, op)
                : tableEdit(text, op, context(person ?? ada, ids()))
            ).changes;
          } else if (over) {
            const ctxFor = context(person ?? ada, ids());
            if (over.kind === 'bold') {
              changes =
                who === 'plain'
                  ? untrackedFormat(text, over, { kind: 'inline', format: 'bold', on: true })
                  : trackedFormat(text, over, { kind: 'inline', format: 'bold', on: true }, ctxFor)
                      .changes;
            } else if (who !== 'plain') {
              changes = addComment(text, over, 'A note.', ctxFor).changes;
            }
          } else if (edit) {
            changes =
              who === 'plain'
                ? untrackedEdit(text, edit)
                : trackedEdit(text, edit, context(person ?? ada, ids()));
          }
          text = applyChanges(text, changes ?? []);
        } catch (error) {
          if (error instanceof EditError) continue;
          throw error;
        }
        const label = `${JSON.stringify(lines)} ${steps.join(' / ')}`;
        if (parse(text).marks.length > 0) {
          expectInOrder(
            label,
            parse(text).ledger.comments.map((t) => t.id),
            text,
          );
        }
        // The oracle reads the newest and the original as one table, as wide as the header.
        for (const view of [newestView(text).text, originalView(text).text]) {
          const found = tablesOf(view);
          expect(found, label).toHaveLength(1);
          expect(
            found[0]?.rows?.every((r) => r.length === columns),
            label,
          ).toBe(true);
        }
      }
      // A comment inside a row that moves, drawn apart from the steps above so that every layout has
      // it (#371): the row's own comments, and its move, decided in every order.
      const layout = `${lead ? 'leading' : 'no leading'} pipe, ${trail ? 'trailing' : 'no trailing'} pipe`;
      const phase = seeded(seed * 100003 + n);
      if (notedMove(initial, columns, lead, phase, `${JSON.stringify(lines)} noted move`)) {
        noted.set(layout, (noted.get(layout) ?? 0) + 1);
      }
      const label = `${JSON.stringify(lines)} ${steps.join(' / ')}`;
      const marks = parse(text).marks.length;
      if (marks === 0 || marks > 5) continue;
      used++;
      try {
        expectEveryOrderAlike(label, text, exactly);
      } catch (error) {
        const { outcomes } = everyOrder(text, exactly);
        const lines = [...outcomes]
          .filter(([, r]) => r.size > 1)
          .map(([k, r]) => `${k}: ${[...r].map((x) => JSON.stringify(bodyOf(x))).join('  VS  ')}`);
        throw new Error(`${String(error)}\n${text}\n${lines.join('\n')}`, { cause: error });
      }
      // Every decision of a move, in a table without outer pipes, is possible in every order,
      // where moves are all that is pending (#289).
      const pending = Object.values(parse(text).ledger.marks);
      const movesOnly = pending.length > 0 && pending.every((m) => m.move !== undefined);
      if (!(lead && trail) && movesOnly) expectNoDecisionRefused(label, text);
      // The comments in the rows that move stay with them, whatever order the moves are decided in.
      if (movesOnly) expectCommentsTravel(label, text, columns);
      try {
        rejectAll(text);
      } catch (error) {
        throw new Error(`${label}: ${String(error)}\n${text}`, { cause: error });
      }
      // Comments stay (they are decided by no one); every change is gone, and what is left reads as
      // the newest view, or as the original.
      const left = (after: string) => parse(after).marks.filter((m) => m.kind !== 'cmt');
      const accepted = applyChanges(text, acceptAll(text));
      expect(left(accepted), `${label}: accept all leaves changes`).toEqual([]);
      const tidy = (view: string) => view.replace(/\s+$/, '');
      expect(tidy(newestView(accepted).text), `${label}: accept all`).toBe(
        tidy(newestView(text).text),
      );
      const rejected = applyChanges(text, rejectAll(text));
      // A format change that a plain edit has since altered can't be undone and stays (format §2.6).
      expect(
        left(rejected).filter((m) => m.kind !== 'fmt'),
        `${label}: reject all leaves changes`,
      ).toEqual([]);
      if (left(rejected).length === 0) {
        expect(tidy(originalView(rejected).text), `${label}: reject all`).toBe(
          tidy(originalView(text).text),
        );
      }
    }
    expect(used).toBeGreaterThan(10);
    // Every pipe layout has had comments in a moved row, with the usual number of tables or more.
    if (fuzzCount(120) >= 120) {
      expect([...noted.keys()].sort()).toEqual([
        'leading pipe, no trailing pipe',
        'leading pipe, trailing pipe',
        'no leading pipe, no trailing pipe',
        'no leading pipe, trailing pipe',
      ]);
      expect(Math.min(...noted.values())).toBeGreaterThanOrEqual(3);
    }
  }, 3_600_000);
});
