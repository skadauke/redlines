// Random tables, cell edits and operations on rows and columns by three people, with Track Changes on
// and off (format §3.7): every state reads as one GFM table to the oracle, every order of decisions
// reads the same, all accepted is the newest view and all rejected the original's bytes. Cells at the
// edges of a row, other people's marks, format changes and comments are in it, and so are alignment
// changes (a point mark at the end of the header's last cell, #281): while one is pending the mark ends
// the header's last cell, in every state, and the original view has its old delimiter row. Some tables
// hold the unbalanced halves of code spans and raw comments, which the scan pairs across the cells and
// rows of a table. What the alignment change is not the cause of is left out, counted by the mechanism
// that left it out: a step that leaves a pending mark unread beside a half that pairs across cells
// (#480), a step that hides the file's ledger or brings a hidden one back (#483), and a file that fails
// the same first check without the mark (the file with the mark cut out fails the check that the file
// fails first, as the alignment suite holds it). A merge can leave a column change and an alignment
// change together, which no operation writes: Ada's mark is joined by hand to the columns that are
// pending (but no move), and every decision but the rejection of the mark is possible in every order,
// but those that the same state refuses without the mark (#477: a table keeps one column), and the one
// that would hide the mark between two backticks or the halves of a comment, which is refused in words
// and is possible once the mark is accepted. `REDLINES_FUZZ` sets how many tables (6000 before a stage
// merges), `REDLINES_SEED` the seed, and `REDLINES_FUZZ_STATS` prints the counts.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { encodeValue } from './format-ops.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { isAlignPoint } from './table-align.ts';
import { tableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import {
  CheckFailed,
  TIME,
  ada,
  blockLeaves,
  bo,
  claudeAda,
  context,
  exactly,
  everyOrder,
  bodyOf,
  expectEveryOrderAlike,
  expectInOrder,
  expectNoDecisionRefused,
  expectPointHolds,
  failsFirstWithout,
  file,
  ledgersRead,
  named,
  pendingPoint,
  problemsOf,
  unreadMarkers,
  withoutPoints,
} from './test-helpers.ts';
import { addComment } from './comments.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import type { MarkRange } from './types.ts';
import { newestView, originalView } from './views.ts';

const THREAD = [
  '  c9qf:',
  '    by: ada',
  '    at: 2026-10-13T22:40Z',
  '    text: |-',
  '      A note.',
];
const ABOVE =
  /^.+'s comment starts above this table and ends in this column\. Delete it first, or turn off Track Changes\.$/;
const WORDS = ['alpha', 'b', 'café', 'x y', '11', ''];
const PEOPLE = [ada, bo, claudeAda];
/** The ids that an operation draws, in an order of the test's own. */
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
/** The halves that some cells hold: a backtick, and the opener or the closer of a raw comment, which the scan pairs
 * with another across the cells and the rows of a table. */
const HALVES = ['`', '<!--', '-->'];
/** The words of a decision that would hide other changes in code or an HTML comment. */
const HIDES =
  /^This decision would hide other changes in code or an HTML comment, where they would no longer be read\./;
/** The refusal of rejecting an alignment change whose table has not the columns of its old row. */
const LOST =
  /^This alignment change can't be rejected, because its table no longer has the columns it had\./;
/** The refusal of a decision that would change the original text, which a rejection keeps: the words of the views
 * check that every decision is held to. Rejecting an alignment change may be refused in them, with a column change
 * pending, and in no other state (the one decision of a merge that may be refused, with `LOST`). */
const KEPT =
  /^This decision would change the original text, because a marker that goes lets the text next to it be read otherwise\./;

/** Whether a mark is a column change: an inserted column or a deleted one. */
const isColumnMark = (mark: MarkRange) =>
  (mark.kind === 'ins' && mark.payload === 'col') ||
  (mark.kind === 'del' && /^col=/.test(mark.payload ?? ''));

function tablesOf(text: string) {
  return blockLeaves(text).filter((leaf) => leaf.kind === 'table');
}

/** The file with an entry more in its ledger, in the file's own line breaks. */
const withEntry = (text: string, id: string, by: string) =>
  text.replace(
    /marks:(\r?\n)/,
    (_, eol: string) => `marks:${eol}  ${id}: {by: ${by}, at: ${TIME}}${eol}`,
  );

/**
 * A merge: the table with Ada's alignment change joined to the column changes that are pending in it, by hand,
 * her mark at the end of the header's last cell and its old row the delimiter row of the original view. Undefined
 * where no column change is pending, one is a move (no allowed operation writes a move and an alignment change
 * together), an alignment change is pending already, the header is itself an inserted row, or the scan does not
 * read the mark where it stands (a half of a code span or a comment that it is paired with takes it in).
 */
function mergedWithMark(text: string): string | undefined {
  const parsed = parse(text);
  if (parsed.marks.some(isAlignPoint)) return undefined;
  const header = readTables(text, parsed)[0]?.rows[0];
  const last = header?.cells.at(-1);
  if (!header || !last || header.insertion) return undefined;
  const columns = parsed.marks.filter(isColumnMark);
  if (columns.length === 0 || columns.some((mark) => mark.entry.move !== undefined))
    return undefined;
  let old: string;
  try {
    const original = originalView(text).text;
    const table = readTables(original, parse(original))[0];
    if (!table) return undefined;
    old = original.slice(table.delimiter.from, table.delimiter.to);
  } catch (error) {
    if (error instanceof EditError) return undefined;
    throw error;
  }
  const mark = `<!--fmt k3x9 align=${encodeValue(old)}-->`;
  const merged = withEntry(
    text.slice(0, last.textTo) + mark + text.slice(last.textTo),
    'k3x9',
    'ada',
  );
  const read = parse(merged);
  if (!read.marks.some(isAlignPoint) || problemsOf(read).length > 0) return undefined;
  return merged;
}

/** Whether the original view of a file can't be read: its table has no column of the original left (an inserted
 * column pending, every other one deleted and accepted), and `originalView` throws (#477). */
function noOriginal(text: string): boolean {
  try {
    originalView(text);
    return false;
  } catch (error) {
    if (error instanceof EditError) return true;
    throw error;
  }
}

/**
 * Decides the changes of a merge one at a time in every order. In every state the alignment change is read once, with
 * its entry, and ends the header's last cell, until it is decided, and deciding another change leaves it so; every
 * decision is possible but four sorts, each counted. The rejection of the alignment change is refused while the table
 * has columns that its old row has not (never excused by the file without it, whose rules the alignment change does
 * not share), and, in the words of the views check, where the old row written back would change the original text: the
 * row has the cells of the columns the table had when the merge was made, and a column change pending (or decided
 * since) leaves the original view with other columns than the file's, so the decision is refused only in a state that
 * has a column change pending, as the same words are in no other. A decision of another change that the same state has
 * without the alignment change is older than it (a table keeps at least one column, so the last column that is not
 * deleted is not rejected with the rest of them gone). A decision that brings a backtick or the half of a comment back,
 * and would hide the alignment change between it and another (the one it is paired with) in code or a comment, is
 * refused in the words of every change that a decision would hide (#376), and is possible once the alignment change is
 * accepted: the mark is never written where it is not read. A state with no original view to read is left out (#477).
 */
function expectMergeDecided(label: string, text: string) {
  const seen = new Set<string>();
  let lost = 0;
  let kept = 0;
  let hidden = 0;
  let without = 0;
  let noOriginals = 0;
  const walk = (current: string, path: string) => {
    if (seen.has(current) || noOriginal(current)) return;
    seen.add(current);
    named('the alignment change is not kept', () =>
      expectPointHolds(`${label} [${path}]`, current, false),
    );
    const point = pendingPoint(current)?.id;
    for (const { id, kind } of parse(current).marks) {
      if (kind === 'cmt' || kind === 'hl') continue;
      for (const [how, decide] of [
        ['accept', accept],
        ['reject', reject],
      ] as const) {
        let next: string;
        try {
          next = applyChanges(current, decide(current, id));
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
          if (id === point && how === 'reject' && LOST.test(error.message)) {
            lost++;
            continue;
          }
          // The views check's words excuse the rejection of the mark only beside a column change: the old row and the
          // original view differ in their columns there, and nowhere else.
          if (
            id === point &&
            how === 'reject' &&
            KEPT.test(error.message) &&
            parse(current).marks.some(isColumnMark)
          ) {
            kept++;
            continue;
          }
          // A state with no alignment change left (it was accepted, which writes what cutting the mark out does) or
          // that refuses the same decision without it: the refusal is older than the change.
          if (id !== point) {
            let alsoRefused = point === undefined;
            if (!alsoRefused) {
              const bare = withoutPoints(current);
              try {
                // The decision, made without the alignment change, leaves a table with no column of its original: its
                // original view can't be read, and a file that may hold indented code refuses the decision, as the mark's
                // `\x20` makes this one (#477).
                const plain = applyChanges(bare, decide(bare, id));
                alsoRefused = noOriginal(plain);
                if (alsoRefused) noOriginals++;
              } catch (again) {
                if (!(again instanceof EditError)) throw again;
                alsoRefused = true;
              }
            }
            if (alsoRefused) {
              without++;
              continue;
            }
          }
          if (point !== undefined && id !== point && HIDES.test(error.message)) {
            // The decision is possible with the alignment change accepted first: it is the mark that it would hide.
            let possible = true;
            try {
              const first = applyChanges(current, accept(current, point));
              decide(first, id);
            } catch (again) {
              if (!(again instanceof EditError)) throw again;
              possible = false;
            }
            if (possible) {
              hidden++;
              continue;
            }
          }
          // The same state without the alignment change does not refuse it, so no control can say that it is older.
          throw new CheckFailed(
            'a decision is refused beside the alignment change',
            new Error(
              `${label}: ${how} ${id} is refused after [${path}]: ${error.message}\n${current}`,
              { cause: error },
            ),
          );
        }
        // Deciding another change leaves the alignment change pending, and read: the mark survives a column that
        // leaves, where a scan that pairs the halves of code spans and comments across the cells could hide it.
        if (point !== undefined && id !== point) {
          named('the alignment change is not kept', () =>
            expect(
              pendingPoint(next)?.id,
              `${label}: ${how} ${id} leaves the alignment change read, after [${path}]\n${next}`,
            ).toBe(point),
          );
        }
        walk(next, `${path} ${how} ${id}`);
      }
    }
  };
  walk(text, '');
  return { states: seen.size, lost, kept, hidden, without, noOriginals };
}

describe('rows and columns, random', () => {
  it('stay one table, read alike in every order, and decide to the newest and the original', () => {
    const random = seeded(Number(process.env['REDLINES_SEED'] ?? 2027));
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    let used = 0;
    let refusals = 0;
    let withColumns = 0;
    let withAlign = 0;
    // The tables that hold halves of code spans or comments, and the same with an alignment change pending at the end;
    // those left out, by the mechanism that left them out, none of them the alignment change's: a step that left a
    // pending mark unread beside a half that pairs across cells (#480), a step that hid the file's ledger or brought a
    // hidden one back (#483), and a file that fails the same first check without its mark (by check, the merges
    // apart); the merges drawn, the states they were decided in, and the rejections of the mark that they refused.
    let withHalves = 0;
    let halvesWithAlign = 0;
    let olderUnread = 0;
    let olderLedger = 0;
    let olderControl = 0;
    let olderMerges = 0;
    const olderBy = new Map<string, number>();
    const olderFor = (failed: unknown) => {
      const check = failed instanceof CheckFailed ? failed.check : 'unnamed';
      olderBy.set(check, (olderBy.get(check) ?? 0) + 1);
    };
    let merges = 0;
    let mergeStates = 0;
    let mergeLost = 0;
    let mergeKept = 0;
    let mergeHidden = 0;
    let mergeWithout = 0;
    let mergeNoOriginals = 0;
    let mergesWithHalves = 0;
    const refusedWithout = { count: 0 };
    for (let n = 0; n < fuzzCount(120); n++) {
      const columns = 1 + Math.floor(random() * 3);
      const bare = columns > 1 && random() < 0.15;
      const padded = random() < 0.5;
      const cellsOf = (words: () => string) => Array.from({ length: columns }, words);
      const grid = [
        cellsOf(() => pick(WORDS.slice(0, 4)).trim() || 'h'),
        cellsOf(() => '-'),
        ...Array.from({ length: 2 + Math.floor(random() * 3) }, () =>
          cellsOf(() => pick(bare ? WORDS.filter((word) => word !== '') : WORDS)),
        ),
      ];
      // One table in five holds one to three unbalanced halves, in the header or the body: a backtick, the opener of a
      // raw comment or its closer, which the scan pairs with another across the cells and the rows of the table.
      const halves = random() < 0.2;
      if (halves) {
        for (let k = 1 + Math.floor(random() * 3); k > 0; k--) {
          const row = grid[random() < 0.4 ? 0 : 2 + Math.floor(random() * (grid.length - 2))];
          const at = Math.floor(random() * columns);
          if (row) row[at] = `${row[at] ?? ''}${pick(HALVES)}`;
        }
      }
      const widths = Array.from({ length: columns }, (_, c) =>
        Math.max(3, ...grid.map((r) => (r[c] ?? '').length)),
      );
      // The delimiter row says each column's alignment, as written by hand or by a formatter.
      const ALIGNS = [undefined, undefined, 'left', 'center', 'right'] as const;
      const aligned = Array.from({ length: columns }, () => pick(ALIGNS));
      const dashes = (c: number, width: number) => {
        const how = aligned[c];
        const colons =
          (how === 'left' || how === 'center' ? 1 : 0) +
          (how === 'center' || how === 'right' ? 1 : 0);
        return `${how === 'left' || how === 'center' ? ':' : ''}${'-'.repeat(Math.max(1, width - colons))}${how === 'center' || how === 'right' ? ':' : ''}`;
      };
      const lines = grid.map((cells, r) => {
        const shown = cells.map((cell, c) =>
          padded
            ? r === 1
              ? dashes(c, widths[c] ?? 3)
              : cell.padEnd(widths[c] ?? 3)
            : r === 1
              ? dashes(c, 1)
              : cell,
        );
        const joined = shown.map((cell) => ` ${cell} `.replace(/ {2}$/, ' ')).join('|');
        return bare ? joined.trim() : `|${joined}|`;
      });
      const joined = lines.join(random() < 0.2 ? '\r\n' : '\n');
      // A comment that starts on a line of its own above a header without pipes, and ends after the
      // first character of its first cell: a column operation on that column is refused (format 3.7).
      // Paragraphs above and below the table, which other people's changes (and the same person's) reach:
      // a closer of an alignment change stands between the table and the paragraph below it.
      const around = random() < 0.5;
      const above = !around && bare && random() < 1 / 3;
      const gap = joined.includes('\r\n') ? '\r\n\r\n' : '\n\n';
      let text = above
        ? file(joined, {}, THREAD)
        : file(around ? `Intro words.${gap}${joined}${gap}Outro words.` : joined);
      if (above) {
        const eol = joined.includes('\r\n') ? '\r\n' : '\n';
        text = applyChanges(text, [
          { from: 0, to: 0, insert: `<!--cmt c9qf-->${eol}${eol}` },
          { from: 1, to: 1, insert: '<!--/c9qf-->' },
        ]);
      }
      if (lines.length && text.includes('\r\n')) text = text.replace(/(?<!\r)\n/g, '\r\n');
      const steps: string[] = [];
      const history: string[] = [];
      let abandoned = false;
      const pool = [
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
      const ids = () => [...pool].sort(() => random() - 0.5);
      for (let step = 0; step < 2 + Math.floor(random() * 3); step++) {
        const table = readTables(text, parse(text))[0];
        if (!table) break;
        const who = pick(['ada', 'bo', 'claude-ada', 'plain'] as const);
        const rows = table.rows.length;
        const kind = pick([
          'insert',
          'delete',
          'move',
          'insertCol',
          'insertCol',
          'deleteCol',
          'deleteCol',
          'moveCol',
          'moveCol',
          'align',
          'align',
          'align',
          'outside',
          'outside',
          'cell',
          'cell',
          'bold',
          'comment',
        ] as const);
        const width = table.aligns.length;
        // Rows without pipes at their edges are for the column operations here: the row operations
        // write their marks in front of a pipe.
        if (bare && ['insert', 'delete', 'move'].includes(kind)) continue;
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
        } else if (kind === 'insertCol') {
          op = {
            kind: 'insertCols',
            table: table.from,
            after: Math.floor(random() * (width + 1)),
            count: 1 + Math.floor(random() * 2),
          };
        } else if (kind === 'deleteCol') {
          const first = Math.floor(random() * width);
          const cols = random() < 0.2 ? [first, Math.floor(random() * width)] : [first];
          op = { kind: 'deleteCols', table: table.from, cols };
        } else if (kind === 'moveCol') {
          const first = Math.floor(random() * width);
          const cols = random() < 0.2 ? [first, Math.floor(random() * width)] : [first];
          op = {
            kind: 'moveCols',
            table: table.from,
            cols,
            to: Math.floor(random() * (width + 1)),
          };
        } else if (kind === 'outside') {
          // Typing, deleting or breaking in a paragraph beside the table, found in the newest view.
          const view = newestView(text);
          const word = pick(['Intro', 'Outro'] as const);
          const at = view.text.indexOf(word);
          if (at === -1) continue;
          const end = at + word.length;
          const mode = pick(['delete', 'type', 'new'] as const);
          let a = at;
          let b = end;
          let insert = '';
          if (mode === 'type') {
            a = b = end;
            insert = 'q';
          } else if (mode === 'new') {
            a = b = word === 'Intro' ? at : end;
            insert = word === 'Intro' ? 'New.\n\n' : '\n\nNew.';
          }
          const from = view.map.toSource(a, 1);
          const to = Math.max(from, view.map.toSource(b, -1));
          edit = { from, to, insert };
        } else if (kind === 'align') {
          const first = Math.floor(random() * width);
          const cols = random() < 0.3 ? [first, Math.floor(random() * width)] : [first];
          op = {
            kind: 'align',
            table: table.from,
            cols,
            align: pick(['left', 'center', 'right', ''] as const),
          };
        } else if (kind === 'bold' || kind === 'comment') {
          // A format change or a comment on the text of a cell, or on a stretch of it.
          const target = pick(table.rows);
          const cell = pick(target.cells.slice(0, width));
          if (cell.textTo - cell.textFrom < 1) continue;
          const from = cell.textFrom + Math.floor(random() * (cell.textTo - cell.textFrom));
          over = { from, to: Math.min(cell.textTo, from + 1 + Math.floor(random() * 3)), kind };
        } else {
          const target = pick(table.rows);
          const cell = pick(target.cells.slice(0, width));
          // Typing, deleting and replacing, in cells with text and in empty ones.
          const size = cell.textTo - cell.textFrom;
          const from = cell.textFrom + Math.floor(random() * (size + 1));
          const mode = size === 0 ? 'insert' : pick(['insert', 'delete', 'replace'] as const);
          const to =
            mode === 'insert' ? from : Math.min(cell.textTo, from + 1 + Math.floor(random() * 3));
          edit = { from, to, insert: mode === 'delete' ? '' : pick(['q', 'é', 'ab']) };
        }
        // A tracked move or deletion of a column that a comment from above the table ends in: the suite's
        // own comment, or one it added to a first cell of a header without pipes, whose start goes on a
        // line above the table too.
        let shouldRefuse = false;
        if (who !== 'plain' && op && (op.kind === 'moveCols' || op.kind === 'deleteCols')) {
          for (const comment of parse(text).marks) {
            if (comment.kind !== 'cmt') continue;
            for (const segment of comment.segments) {
              const end = segment.close;
              if (!end || segment.open.from >= table.from) continue;
              const row = table.rows.find((r) => r.from <= end.from && end.from <= r.to);
              const column = row?.cells.findIndex(
                (c, i, all) => c.from <= end.from && (end.from < c.to || i === all.length - 1),
              );
              if (column !== undefined && column !== -1 && op.cols.includes(column)) {
                shouldRefuse = true;
              }
            }
          }
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
          history.push(text);
          text = applyChanges(text, changes ?? []);
          if (shouldRefuse) {
            throw new Error(
              `a ${op?.kind} over the comment's column was written:\n${history.at(-1)}`,
            );
          }
        } catch (error) {
          if (error instanceof EditError) {
            if (ABOVE.test(error.message)) {
              expect(
                shouldRefuse,
                `refused for a column it does not end in: ${steps.join(' / ')}`,
              ).toBe(true);
              refusals++;
            }
            continue;
          }
          throw error;
        }
        const label = `${JSON.stringify(lines)} ${steps.join(' / ')}`;
        const prev = history.at(-1) ?? '';
        // An alignment change that is pending no longer is gone with its marker: an operation took it away, and did
        // not leave it where the scan would not read it, with its entry lost.
        const was = pendingPoint(prev);
        if (was && !pendingPoint(text)) {
          expect(
            bodyOf(text),
            `${label}: the alignment change is gone with its marker`,
          ).not.toContain(`<!--fmt ${was.id} `);
        }
        // A lone backtick or half of a raw comment pairs with another across the cells and the rows of a table and hides
        // what stands between them, so the file as the scan reads it is not the one that an operation wrote. Two
        // mechanisms, each older than the alignment change (the mark is held to be read, above), each ends the story
        // of the table at the step that shows it, counted:
        // - #483: a lone `<!--` hides the file's ledger: a tracked row or column operation loses it or writes a second
        //   one, and a deletion that takes the half away revives a stale one (the count of ledgers read changes);
        // - #480: a lone backtick or comment half that pairs across cells leaves a pending mark unread (a plain column
        //   deletion or move writes what the half hides, and a change is lost with its entry).
        if (halves && ledgersRead(text) !== ledgersRead(prev)) {
          olderLedger++;
          abandoned = true;
          break;
        }
        if (halves && unreadMarkers(text) > unreadMarkers(prev)) {
          olderUnread++;
          abandoned = true;
          break;
        }
        const sound = (state: string) => {
          if (parse(state).marks.length > 0) {
            named('the comments are out of order', () =>
              expectInOrder(
                label,
                parse(state).ledger.comments.map((t) => t.id),
                state,
              ),
            );
          }
          // The oracle reads the newest and the original as one table, as wide as its header.
          const views = named("a view can't be read", () => {
            try {
              return [newestView(state).text, originalView(state).text];
            } catch (error) {
              throw new Error(`${label}: ${String(error)}\n${state}`, { cause: error });
            }
          });
          for (const view of views) {
            const found = tablesOf(view);
            named('a view is not a table', () => expect(found, label).toHaveLength(1));
            const wide = found[0]?.rows?.[0]?.length;
            named("a view's rows are not as wide as its header", () =>
              expect(
                found[0]?.rows?.every((r) => r.length === wide),
                label,
              ).toBe(true),
            );
          }
        };
        try {
          sound(text);
        } catch (error) {
          // A state that fails the same first check without the alignment change, in a table with a lone half, is
          // older than the change. The two mechanisms above, seen in what a check reads, are most of it: a ledger that
          // a lone `<!--` hides reads as a file with no entries (#483), and a half that pairs across cells hides a pending
          // change from a view (#480). Counted by the check that failed. The table's story ends here. A control that
          // passes, or that fails another check first, is no excuse: the mark made it fail.
          if (halves && failsFirstWithout(error, text, sound)) {
            olderControl++;
            olderFor(error);
            abandoned = true;
            break;
          }
          throw error;
        }
        // While an alignment change is pending its mark ends the header's last cell, whatever was done to the
        // columns, the rows and the cells, and the original view has its old delimiter row.
        expectPointHolds(label, text);
      }
      if (abandoned) continue;
      const label = `${JSON.stringify(lines)} ${steps.join(' / ')}`;
      const marks = parse(text).marks.length;
      // A merge, in a quarter of the tables and in most of those with halves, where the scan pairs them across the
      // cells that a column leaves and the cells it comes to: Ada's alignment change joined by hand to the column
      // changes pending in this one, decided in every order. Every decision but the rejection of the mark is possible.
      if (random() < (halves ? 0.8 : 0.25)) {
        const merged = mergedWithMark(text);
        if (merged && parse(merged).marks.length <= 6) {
          const checks = (state: string) => {
            named('the orders of decisions differ', () =>
              expectEveryOrderAlike(`${label} (merged)`, state, exactly),
            );
            return expectMergeDecided(`${label} (merged)`, state);
          };
          try {
            const walked = checks(merged);
            merges++;
            if (halves) mergesWithHalves++;
            mergeStates += walked.states;
            mergeLost += walked.lost;
            mergeKept += walked.kept;
            mergeHidden += walked.hidden;
            mergeWithout += walked.without;
            mergeNoOriginals += walked.noOriginals;
          } catch (error) {
            // The merge fails the same first check without the mark (the orders of decisions differ), in a table with a lone
            // half whose pairing across cells hides a change, or a ledger (#480, #483, as above): older than the change.
            // The decision that the walk finds refused beside the mark, and the mark not kept, are the mark's, and no
            // control excuses them.
            const control = (state: string) => {
              named('the orders of decisions differ', () =>
                expectEveryOrderAlike(label, state, exactly),
              );
              named('a decision is refused', () => expectNoDecisionRefused(label, state));
            };
            if (!(halves && failsFirstWithout(error, merged, control))) throw error;
            olderMerges++;
          }
        }
      }
      if (marks === 0 || marks > 5) continue;
      used++;
      if (/col-->|col=\d/.test(text)) withColumns++;
      if (/<!--fmt \w{4} align=/.test(text)) withAlign++;
      if (halves) withHalves++;
      if (halves && /<!--fmt \w{4} align=/.test(text)) halvesWithAlign++;
      const finals = (state: string) => {
        // What failed, with the outcomes of the orders that differ, for the one who reads the failure.
        const detailed = (error: unknown) => {
          const { outcomes } = everyOrder(state, exactly);
          const lines = [...outcomes]
            .filter(([, r]) => r.size > 1)
            .map(
              ([k, r]) => `${k}: ${[...r].map((x) => JSON.stringify(bodyOf(x))).join('  VS  ')}`,
            );
          return new Error(`${String(error)}\n${state}\n${lines.join('\n')}`, { cause: error });
        };
        named('the orders of decisions differ', () => {
          try {
            expectEveryOrderAlike(label, state, exactly);
          } catch (error) {
            throw detailed(error);
          }
        });
        // With an alignment change pending, every single decision is possible in every order.
        if (/<!--fmt \w{4} align=/.test(state)) {
          named('a decision is refused', () => {
            try {
              expectNoDecisionRefused(label, state, { unlessWithout: true, refusedWithout });
            } catch (error) {
              throw detailed(error);
            }
          });
        }
        named('rejecting all is refused', () => {
          try {
            rejectAll(state);
          } catch (error) {
            throw new Error(
              `${label}: ${String(error)}\n${state}\nBEFORE LAST:\n${history.at(-1)}`,
              { cause: error },
            );
          }
        });
        // Comments stay (they are decided by no one); every change is gone, and what is left reads as
        // the newest view, or as the original.
        const left = (after: string) => parse(after).marks.filter((m) => m.kind !== 'cmt');
        const accepted = named('accepting all is refused', () => {
          try {
            return applyChanges(state, acceptAll(state));
          } catch (error) {
            throw new Error(`${label}: accept all: ${String(error)}\n${state}`, { cause: error });
          }
        });
        named('accepting all leaves changes', () =>
          expect(left(accepted), `${label}: accept all leaves changes`).toEqual([]),
        );
        const tidy = (view: string) => view.replace(/\s+$/, '');
        named('accepting all is not the newest view', () =>
          expect(tidy(newestView(accepted).text), `${label}: accept all`).toBe(
            tidy(newestView(state).text),
          ),
        );
        const rejected = named('rejecting all is refused', () =>
          applyChanges(state, rejectAll(state)),
        );
        // A format change that a plain edit has since altered can't be undone and stays (format §2.6).
        named('rejecting all leaves changes', () =>
          expect(
            left(rejected).filter((m) => m.kind !== 'fmt'),
            `${label}: reject all leaves changes`,
          ).toEqual([]),
        );
        if (left(rejected).length === 0) {
          named('rejecting all is not the original view', () =>
            expect(tidy(originalView(rejected).text), `${label}: reject all`).toBe(
              tidy(originalView(state).text),
            ),
          );
        }
      };
      try {
        finals(text);
      } catch (error) {
        // The same first check fails without the alignment change, in a table with a lone half: older than the change.
        // The mechanisms are those of the steps above seen in what a check reads (#483: a ledger that a lone `<!--`
        // hides; #480: a half that pairs across cells and hides a pending change, so that a decision that would bring a
        // half back is refused in the words of a change it would hide, #376). Counted by the check that failed. A
        // control that passes, or that fails another check first, is no excuse: the mark made it fail.
        if (!(halves && failsFirstWithout(error, text, finals))) throw error;
        olderControl++;
        olderFor(error);
      }
    }
    const older = olderUnread + olderLedger + olderControl;
    if (process.env['REDLINES_FUZZ_STATS']) {
      const byCheck = [...olderBy].map(([check, count]) => `${check} ${count}`).join(', ');
      console.log(
        `tables ${used}, with columns pending ${withColumns}, with an alignment change pending ${withAlign}, with halves ${withHalves} (${halvesWithAlign} with an alignment change), left out as older ${older} (a step left a pending mark unread beside a half, #480: ${olderUnread}; a step hid the ledger or brought a hidden one back, #483: ${olderLedger}; the same first check fails without the mark, #480 and #483: ${olderControl}${byCheck === '' ? '' : ` (${byCheck})`}), merges left out the same way ${olderMerges}, merges ${merges} (${mergesWithHalves} in a table with halves, ${mergeStates} states, ${mergeLost + mergeKept} rejections of the mark refused (${mergeLost} for columns that its old row has not, ${mergeKept} for the original text beside a column change pending), ${mergeHidden} decisions refused for hiding the mark in code, ${mergeWithout} refused without the mark too, ${mergeNoOriginals} of them for a table with no column of its original left, #477), decisions refused that the file without its alignment change refuses too ${refusedWithout.count}`,
      );
    }
    expect(used).toBeGreaterThan(10);
    // The comment from above a header without pipes, about one table in twenty, is refused where it ends
    // (a run of the default size draws too few tables to count on one).
    if (fuzzCount(120) >= 1000) expect(refusals).toBeGreaterThan(0);
    expect(withColumns).toBeGreaterThan(used / 4);
    expect(withAlign).toBeGreaterThan(used / 10);
    expect(withHalves).toBeGreaterThan(0);
    expect(merges).toBeGreaterThan(0);
    expect(mergesWithHalves).toBeGreaterThan(0);
    // (an alignment change pending in a table with halves is drawn about one table in thirty)
    if (fuzzCount(120) >= 300) expect(halvesWithAlign).toBeGreaterThan(0);
    // What is left out as older is a part of the tables that hold halves, which are one in five of them all.
    expect(older).toBeLessThan(used / 4);
  }, 3_600_000);

  it('keeps the mark at the end of the header of a bare table through plain column operations and typing there', () => {
    // A table with no pipe at the edge of any row, with an alignment change of Ada's pending from the start, so that
    // the mark stands at the line's end of the header, and plain column operations and cells edited at the end of its
    // last cell, tracked and plain, come after it. Drawn apart from the suite above, whose tables have a mark only
    // where an alignment is drawn: here every table has one. The mark ends the header's last cell, and the original
    // view has its old delimiter row, after every step, and every order of decisions reads alike.
    const random = seeded(Number(process.env['REDLINES_SEED'] ?? 2030));
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const wanted = fuzzCount(60);
    let used = 0;
    let withAlign = 0;
    let operations = 0;
    let typed = 0;
    let gone = 0;
    const refusedWithout = { count: 0 };
    for (let n = 0; n < wanted; n++) {
      const columns = 2 + Math.floor(random() * 2);
      const padded = random() < 0.5;
      const eol = random() < 0.2 ? '\r\n' : '\n';
      const words = Array.from({ length: columns }, () =>
        pick(['alpha', 'b', 'café', 'x y', '11']),
      );
      const body = Array.from({ length: 2 }, () =>
        Array.from({ length: columns }, () => pick(['alpha', 'b', 'café', 'x y', '11', 'z'])),
      );
      const widths = Array.from({ length: columns }, (_, c) =>
        Math.max(3, words[c]?.length ?? 0, ...body.map((r) => r[c]?.length ?? 0)),
      );
      const row = (cells: string[]) =>
        cells
          .map((cell, c) => (padded ? cell.padEnd(widths[c] ?? 3) : cell))
          .join(' | ')
          .trimEnd();
      const delimiter = Array.from({ length: columns }, (_, c) =>
        pick(['---', ':--', '--:', ':-:']).padEnd(padded ? (widths[c] ?? 3) : 3, '-'),
      ).join(' | ');
      const lines = [row(words), delimiter, ...body.map(row)];
      let text = file(lines.join(eol));
      if (eol === '\r\n') text = text.replace(/(?<!\r)\n/g, '\r\n');
      const steps: string[] = [];
      const ids = () => [...POOL].sort(() => random() - 0.5);
      const tableOf = () => readTables(text, parse(text))[0];
      const first = tableOf();
      if (!first) continue;
      // Ada aligns one or two columns, tracked: the mark is written at the end of the header.
      const cols = random() < 0.4 ? [0, columns - 1] : [Math.floor(random() * columns)];
      try {
        const op: TableOp = {
          kind: 'align',
          table: first.from,
          cols,
          align: pick(['left', 'center', 'right'] as const),
        };
        steps.push(`ada ${JSON.stringify(op)}`);
        text = applyChanges(text, tableEdit(text, op, context(ada, ids())).changes);
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        continue;
      }
      if (pendingPoint(text) === undefined) continue;
      used++;
      for (let step = 0; step < 2 + Math.floor(random() * 3); step++) {
        const table = tableOf();
        const last = table?.rows[0]?.cells.at(-1);
        if (!table || !last) break;
        const before = text;
        const width = table.aligns.length;
        const kind = pick([
          'insertCols',
          'deleteCols',
          'moveCols',
          'typePlain',
          'typeTracked',
          'deleteEnd',
          'replaceEnd',
        ] as const);
        steps.push(kind);
        try {
          if (kind === 'insertCols' || kind === 'deleteCols' || kind === 'moveCols') {
            const op: TableOp =
              kind === 'insertCols'
                ? {
                    kind,
                    table: table.from,
                    after: Math.floor(random() * (width + 1)),
                    count: 1 + Math.floor(random() * 2),
                  }
                : kind === 'deleteCols'
                  ? { kind, table: table.from, cols: [Math.floor(random() * width)] }
                  : {
                      kind,
                      table: table.from,
                      cols: [Math.floor(random() * width)],
                      to: Math.floor(random() * (width + 1)),
                    };
            text = applyChanges(text, untrackedTableEdit(text, op).changes);
            operations++;
          } else {
            // Typing, deleting and replacing at the end of the last header cell: in front of the mark.
            const who = pick([ada, bo, claudeAda]);
            const insert = pick(['q', 'é', 'ab']);
            const size = last.textTo - last.textFrom;
            const edit =
              kind === 'typePlain' || kind === 'typeTracked'
                ? { from: last.textTo, to: last.textTo, insert }
                : {
                    from: last.textTo - Math.min(size, 1 + Math.floor(random() * 2)),
                    to: last.textTo,
                    insert: kind === 'replaceEnd' ? insert : '',
                  };
            const plain = kind === 'typePlain' || random() < 0.3;
            text = applyChanges(
              text,
              plain ? untrackedEdit(text, edit) : trackedEdit(text, edit, context(who, ids())),
            );
            typed++;
          }
        } catch (error) {
          if (error instanceof EditError) continue;
          throw error;
        }
        const label = `${JSON.stringify(lines)} ${steps.join(' / ')}`;
        const held = pendingPoint(before);
        if (held && !pendingPoint(text)) {
          // An operation that makes the old and the new alignment the same takes the change away, with its marker.
          expect(bodyOf(text), `${label}: gone with its marker`).not.toContain(
            `<!--fmt ${held.id} `,
          );
          gone++;
        }
        expectPointHolds(label, text);
      }
      const label = `${JSON.stringify(lines)} ${steps.join(' / ')}`;
      if (pendingPoint(text) !== undefined) withAlign++;
      if (parse(text).marks.length > 5) continue;
      expectEveryOrderAlike(label, text, exactly);
      expectNoDecisionRefused(label, text, { unlessWithout: true, refusedWithout });
      const left = (after: string) => parse(after).marks.filter((m) => m.kind !== 'cmt');
      const accepted = applyChanges(text, acceptAll(text));
      expect(left(accepted), `${label}: accept all leaves changes`).toEqual([]);
      const tidy = (view: string) => view.replace(/\s+$/, '');
      expect(tidy(newestView(accepted).text), `${label}: accept all`).toBe(
        tidy(newestView(text).text),
      );
      const rejected = applyChanges(text, rejectAll(text));
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
    if (process.env['REDLINES_FUZZ_STATS']) {
      console.log(
        `bare tables ${used}, with the change pending at the end ${withAlign}, plain column operations ${operations}, edits at the end of the header ${typed}, changes taken away by an operation ${gone}, decisions refused that the file without its alignment change refuses too ${refusedWithout.count}`,
      );
    }
    // (about half the tables are drawn with a change that is written: the alignment drawn is the one the table has already
    // in one case of four, and a header that a marker can't follow is refused)
    expect(used).toBeGreaterThan(wanted / 3);
    expect(withAlign).toBeGreaterThan(used / 2);
    expect(operations).toBeGreaterThan(used / 2);
    expect(typed).toBeGreaterThan(used / 2);
  }, 120_000);
});
