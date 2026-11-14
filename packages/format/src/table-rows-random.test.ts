// Random tables, cell edits and row operations by three people, with Track Changes on and off
// (format §3.7): every state reads as one GFM table to the oracle, every order of decisions reads the
// same, all accepted is the newest view and all rejected the original's bytes. Each table ends by
// being deleted whole, by one of the three or plain, alone in the file and among paragraphs: refused
// exactly when another person's change is in it, and otherwise the same in every order. A comment
// inside a row that moves, in every pipe layout, travels with the row both ways (#371).
// `REDLINES_FUZZ` sets how many tables (6000 before a stage merges).
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
/** Who deletes the table at the end of each table's story, in turn; `plain` is no one, Track Changes off. */
const ENDERS = ['ada', 'bo', 'claude-ada', 'plain'] as const;

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

/** The text without the blank lines at its end. */
const tidy = (view: string) => view.replace(/\s+$/, '');

/**
 * Deletes the table of `text` whole (format §3.7, rule 6), by `who`, or plain with none, alone in the
 * file and among paragraphs, and holds what comes of it to the rule: with Track Changes on it is
 * refused exactly when another person's change is in the table (a comment alone in the file has no
 * place), and otherwise the newest view has no table, the original is as it was, every order of
 * decisions reads alike and accepting or rejecting all gives the newest and the original; with it off
 * both views lose the table and no change is left.
 */
function expectWholeTableDeleted(
  text: string,
  who: (typeof PEOPLE)[number] | undefined,
  ids: () => string[],
  label: string,
): void {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const cut = parse(text).ledgerRange?.from ?? text.length;
  const table = text.slice(0, cut).replace(/[\r\n]+$/, '');
  const among = `Intro.${eol}${eol}${table}${eol}${eol}After.${text.slice(cut)}`;
  for (const [shape, body] of [
    ['alone', text],
    ['among', among],
  ] as const) {
    const found = readTables(body, parse(body))[0];
    if (!found) continue;
    const tag = `${label} / delete the table ${shape}, ${who?.handle ?? 'plain'}`;
    const op: TableOp = { kind: 'deleteTable', table: found.from };
    const parsed = parse(body);
    const other = parsed.marks.find(
      (mark) => mark.kind !== 'cmt' && mark.kind !== 'hl' && mark.entry.by !== who?.handle,
    );
    const comments = parsed.marks.some((mark) => mark.kind === 'cmt');
    let after: string;
    try {
      const done = who ? tableEdit(body, op, context(who, ids())) : untrackedTableEdit(body, op);
      after = applyChanges(body, done.changes);
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      // Refused, and every refusal says why: another person's change, or no place for a comment,
      // or a change of the table's own that can't be undone with it (rejecting it leaves a file
      // that no longer reads as the table, which the decision's own rules do for a comment in a
      // moved row of a table without a pipe at its start).
      const named = parsed.ledger.people.find((p) => p.handle === other?.entry.by)?.name;
      const pending = /'s pending change is in this table\. Decide it first\.$/.test(error.message);
      if (who && other)
        expect(error.message, tag).toBe(
          `${named}'s pending change is in this table. Decide it first.`,
        );
      else if (pending) {
        const undone = applyChanges(body, rejectAll(body));
        expect(readTables(undone, parse(undone)), `${tag}: ${error.message}`).toHaveLength(0);
      } else {
        expect(who !== undefined && shape === 'alone' && comments, `${tag}: ${error.message}`).toBe(
          true,
        );
        expect(error.message, tag).toMatch(
          /comment is in this table, and no text next to it can keep it\./,
        );
      }
      continue;
    }
    expect(
      who !== undefined && other !== undefined,
      `${tag}: allowed, with ${other?.id} pending`,
    ).toBe(false);
    const remaining = shape === 'alone' ? '' : `Intro.${eol}${eol}After.`;
    // (a file with no mark keeps the ledger it had, which no edit writes)
    if (parse(after).marks.length > 0) {
      expectInOrder(
        tag,
        parse(after).ledger.comments.map((thread) => thread.id),
        after,
      );
    }
    expect(tablesOf(newestView(after).text), tag).toHaveLength(0);
    expect(tidy(newestView(after).text), tag).toBe(remaining);
    if (!who) {
      expect(tablesOf(originalView(after).text), tag).toHaveLength(0);
      expect(tidy(originalView(after).text), tag).toBe(remaining);
      expect(
        parse(after).marks.filter((mark) => mark.kind !== 'cmt'),
        tag,
      ).toEqual([]);
      continue;
    }
    expect(originalView(after).text, tag).toBe(originalView(body).text);
    expect(tablesOf(originalView(after).text), tag).toHaveLength(1);
    expectEveryOrderAlike(tag, after, exactly);
    // Accepting everything leaves the newest view, rejecting everything the original.
    const accepted = applyChanges(after, acceptAll(after));
    expect(tidy(newestView(accepted).text), `${tag}: accept all`).toBe(remaining);
    const rejected = applyChanges(after, rejectAll(after));
    expect(tidy(newestView(rejected).text), `${tag}: reject all`).toBe(
      tidy(originalView(body).text),
    );
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
      // The table deleted whole, which ends every table's story: by each of the people in turn, with the
      // ids shuffled by a stream of its own. Nothing here draws from the stream that makes the tables, so
      // the tables after this one are the ones they were (a `REDLINES_SEED` that found one still does).
      const aside = seeded(seed * 1000 + n);
      const ender = ENDERS[n % ENDERS.length];
      expectWholeTableDeleted(
        text,
        PEOPLE.find((p) => p.handle === ender),
        () => [...POOL].sort(() => aside() - 0.5),
        label,
      );
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
