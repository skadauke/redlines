// Random tables with other people's marks in their cells, rows and columns pending and alignment
// changes, over which a rectangle of cells is made bold or italic with Track Changes on and off
// (format §3.7, "Cells apart"). Every order of decisions reads alike, all accepted is the newest view
// and all rejected the original one; with no row or column pending, micromark reads each state as
// its newest view. A rectangle is refused or written whole, and a refusal that speaks of a cell
// names it and the person. While an alignment change is pending its mark ends the header's last
// cell, and the original view has its old delimiter row. Some tables hold the unbalanced halves of
// code spans and raw comments, which the scan pairs across the cells and rows of a table, and a bold
// or italic over text that starts with a tag. What the alignment change is not the cause of is left
// out, counted by the mechanism that left it out: a step that leaves a pending mark unread beside a
// half that pairs across cells (#480), a step that hides the file's ledger or brings a hidden one back
// (#483), and a file that fails the same first check without the mark (the file with the mark cut out
// fails the check that the file fails first, as the alignment suite holds it), in a table with a half
// (#480, #483). `REDLINES_FUZZ` sets how many tables (6000
// before a stage merges), and `REDLINES_SEED` the seed.
import { describe, expect, it } from 'vitest';
import { addComment } from './comments.ts';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { trackedFormatRanges, untrackedFormat } from './formatting.ts';
import type { FormatOp } from './formatting.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { tableEdit, untrackedTableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import {
  CheckFailed,
  ada,
  blockLeaves,
  bo,
  bodyOf,
  claudeAda,
  context,
  exactly,
  expectEveryOrderAlike,
  expectInOrder,
  expectPointHolds,
  failsFirstWithout,
  file,
  ledgersRead,
  named,
  pendingPoint,
  unreadMarkers,
} from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import { newestView, originalView } from './views.ts';

// The tags of subscript and superscript are in the body cells, after the words the header takes.
const WORDS = [
  'alpha',
  'b',
  'café',
  'x y',
  '11',
  '',
  'two words',
  'H<sub>2</sub>O',
  '<sup>t u</sup>',
];
const PEOPLE = [ada, bo, claudeAda];
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
  'x7yz',
  'y8za',
];
/** The halves that some cells hold: a backtick, and the opener or the closer of a raw comment, which the scan pairs
 * with another across the cells and the rows of a table. */
const HALVES = ['`', '<!--', '-->'];
const CELL_WORDS =
  /^.+'s .+ is in the cell in (?:the header|row \d+), column \d+\. Accept or reject it first, then format the cell\.$/;

const tablesOf = (text: string) => blockLeaves(text).filter((leaf) => leaf.kind === 'table');

describe('a rectangle of cells made bold or italic, random', () => {
  it('reads alike in every order of decisions, and decides to the newest and the original', () => {
    const random = seeded(Number(process.env['REDLINES_SEED'] ?? 2028));
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    let used = 0;
    let written = 0;
    let refusedForCell = 0;
    let withMarks = 0;
    let withStructure = 0;
    let wide = 0;
    // The tables that end with an alignment change pending and a rectangle written, the rectangles written while one
    // was pending, the tables that hold halves of code spans or comments, and those left out, by the mechanism that
    // left them out, none of them the alignment change's: a step that left a pending mark unread beside a half that
    // pairs across cells (#480), a step that hid the file's ledger or brought a hidden one back (#483), a file that
    // fails the same first check without its mark in a table with a half (#480 and #483, by check).
    let withAlignAndRect = 0;
    let rectsBesideAlign = 0;
    let withHalves = 0;
    let olderUnread = 0;
    let olderLedger = 0;
    let olderControl = 0;
    const olderBy = new Map<string, number>();
    const olderFor = (failed: unknown) => {
      const check = failed instanceof CheckFailed ? failed.check : 'unnamed';
      olderBy.set(check, (olderBy.get(check) ?? 0) + 1);
    };
    for (let n = 0; n < fuzzCount(120); n++) {
      const columns = 1 + Math.floor(random() * 3);
      const padded = random() < 0.4;
      const grid = [
        Array.from({ length: columns }, () => pick(WORDS.slice(0, 4)).trim() || 'h'),
        Array.from({ length: columns }, () => '-'),
        ...Array.from({ length: 2 + Math.floor(random() * 3) }, () =>
          Array.from({ length: columns }, () => pick(WORDS)),
        ),
      ];
      // One table in five holds one or two unbalanced halves, in the header or the body.
      const halves = random() < 0.2;
      if (halves) {
        for (let k = 1 + Math.floor(random() * 2); k > 0; k--) {
          const row = grid[random() < 0.4 ? 0 : 2 + Math.floor(random() * (grid.length - 2))];
          const at = Math.floor(random() * columns);
          if (row) row[at] = `${row[at] ?? ''}${pick(HALVES)}`;
        }
      }
      const widths = Array.from({ length: columns }, (_, c) =>
        Math.max(3, ...grid.map((r) => (r[c] ?? '').length)),
      );
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
        return `|${shown.map((cell) => ` ${cell} `.replace(/ {2}$/, ' ')).join('|')}|`;
      });
      const crlf = random() < 0.2;
      const around = random() < 0.4;
      const gap = '\n\n';
      let text = file(
        around ? `Intro words.${gap}${lines.join('\n')}${gap}Outro words.` : lines.join('\n'),
      );
      if (crlf) text = text.replace(/\n/g, '\r\n');
      const steps: string[] = [];
      const history: string[] = [];
      const ids = () => [...POOL].sort(() => random() - 0.5);
      let rectangles = 0;
      let abandoned = false;
      for (let step = 0; step < 2 + Math.floor(random() * 3); step++) {
        const table = readTables(text, parse(text))[0];
        if (!table) break;
        const who = pick(['ada', 'bo', 'claude-ada', 'plain'] as const);
        const person = PEOPLE.find((p) => p.handle === who);
        const rows = table.rows.length;
        const width = table.aligns.length;
        const kind = pick([
          'cell',
          'cell',
          'cell',
          'comment',
          'insert',
          'delete',
          'move',
          'insertCol',
          'deleteCol',
          'moveCol',
          'align',
          'rect',
          'rect',
          'rect',
          'rect',
        ] as const);
        steps.push(`${who} ${kind}`);
        try {
          let changes: { from: number; to: number; insert: string }[] = [];
          if (kind === 'rect') {
            const r0 = Math.floor(random() * rows);
            const r1 = Math.min(rows - 1, r0 + Math.floor(random() * 3));
            const c0 = Math.floor(random() * width);
            const c1 = Math.min(width - 1, c0 + Math.floor(random() * 2));
            const ranges = [];
            for (let r = r0; r <= r1; r++) {
              for (let c = c0; c <= c1; c++) {
                const cell = table.rows[r]?.cells[c];
                if (cell && cell.textFrom < cell.textTo) {
                  ranges.push({ from: cell.textFrom, to: cell.textTo });
                }
              }
            }
            if (ranges.length === 0) continue;
            const op: FormatOp = {
              kind: 'inline',
              format: pick(['bold', 'italic', 'sub', 'sup'] as const),
              on: true,
            };
            steps.push(`[${ranges.length} cells ${op.format}]`);
            if (who === 'plain') {
              // One after the other from the last, as the editor does with Track Changes off.
              let current = text;
              for (const range of ranges.toReversed()) {
                const made = untrackedFormat(current, range, op, { author: ada });
                current = applyChanges(current, made);
              }
              history.push(text);
              if (pendingPoint(text)) rectsBesideAlign++;
              text = current;
              rectangles++;
              continue;
            }
            const done = trackedFormatRanges(text, ranges, op, context(person ?? ada, ids()));
            changes = done.changes;
            if (done.changes.length > 0) {
              written++;
              rectangles++;
              if (ranges.length > 2) wide++;
              if (pendingPoint(text)) rectsBesideAlign++;
            }
          } else if (kind === 'cell') {
            const target = table.rows[Math.floor(random() * rows)];
            const cell = target?.cells[Math.floor(random() * width)];
            if (!cell) continue;
            const size = cell.textTo - cell.textFrom;
            const from = cell.textFrom + Math.floor(random() * (size + 1));
            const mode = size === 0 ? 'insert' : pick(['insert', 'delete', 'replace'] as const);
            const to =
              mode === 'insert' ? from : Math.min(cell.textTo, from + 1 + Math.floor(random() * 3));
            const edit = { from, to, insert: mode === 'delete' ? '' : pick(['q', 'é', 'ab']) };
            changes =
              who === 'plain'
                ? untrackedEdit(text, edit)
                : trackedEdit(text, edit, context(person ?? ada, ids()));
          } else if (kind === 'comment') {
            const target = table.rows[Math.floor(random() * rows)];
            const cell = target?.cells[Math.floor(random() * width)];
            if (!cell || cell.textTo - cell.textFrom < 1 || who === 'plain') continue;
            changes = addComment(
              text,
              { from: cell.textFrom, to: Math.min(cell.textTo, cell.textFrom + 2) },
              'A note.',
              context(person ?? ada, ids()),
            ).changes;
          } else {
            let op: TableOp;
            const cols = [Math.floor(random() * width)];
            if (kind === 'insert') {
              op = {
                kind: 'insertRows',
                table: table.from,
                after: Math.floor(random() * (rows + 1)) - 1,
                count: 1,
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
                count: 1,
              };
            } else if (kind === 'deleteCol') {
              op = { kind: 'deleteCols', table: table.from, cols };
            } else if (kind === 'moveCol') {
              op = {
                kind: 'moveCols',
                table: table.from,
                cols,
                to: Math.floor(random() * (width + 1)),
              };
            } else {
              op = {
                kind: 'align',
                table: table.from,
                cols,
                align: pick(['left', 'center', 'right', ''] as const),
              };
            }
            changes = (
              who === 'plain'
                ? untrackedTableEdit(text, op)
                : tableEdit(text, op, context(person ?? ada, ids()))
            ).changes;
          }
          history.push(text);
          text = applyChanges(text, changes);
        } catch (error) {
          if (error instanceof EditError) {
            if (CELL_WORDS.test(error.message)) refusedForCell++;
            else if (/in the cell/.test(error.message)) {
              throw new Error(`a refusal that names a cell, in other words: ${error.message}`, {
                cause: error,
              });
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
          const threads = parse(state).ledger.comments.map((t) => t.id);
          if (parse(state).marks.length > 0) {
            named('the comments are out of order', () => expectInOrder(label, threads, state));
          }
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
            const wideRow = found[0]?.rows?.[0]?.length;
            named("a view's rows are not as wide as its header", () =>
              expect(
                found[0]?.rows?.every((r) => r.length === wideRow),
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
        expectPointHolds(label, text);
      }
      if (abandoned) continue;
      if (rectangles === 0) continue;
      const label = `${JSON.stringify(lines)} ${steps.join(' / ')}`;
      const marks = parse(text).marks.filter((mark) => mark.kind !== 'cmt');
      used++;
      if (marks.some((mark) => mark.entry.by !== 'ada' && mark.kind !== 'fmt')) withMarks++;
      const structure = /col-->|col=\d|row-->|row=\d|<!--fmt \w{4} align=/.test(text);
      if (structure) withStructure++;
      if (/<!--fmt \w{4} align=/.test(text)) withAlignAndRect++;
      if (halves) withHalves++;
      const finals = (state: string) => {
        if (marks.length <= 5) {
          named('the orders of decisions differ', () => {
            try {
              expectEveryOrderAlike(label, state, exactly);
            } catch (error) {
              throw new Error(`${String(error)}\n${state}`, { cause: error });
            }
          });
          if (!structure) {
            named('an order reads otherwise than its view', () => {
              try {
                expectEveryOrderRead(label, state);
              } catch (error) {
                throw new Error(`${String(error)}\n${state}`, { cause: error });
              }
            });
          }
        }
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
          expect(tidy(newestView(accepted).text), `${label}: accept all\n${state}`).toBe(
            tidy(newestView(state).text),
          ),
        );
        const rejected = named('rejecting all is refused', () => {
          try {
            return applyChanges(state, rejectAll(state));
          } catch (error) {
            throw new Error(
              `${label}: reject all: ${String(error)}\n${state}\nBEFORE:\n${history.at(-1)}`,
              { cause: error },
            );
          }
        });
        // A format change that a plain edit has since altered can't be undone and stays (§2.6).
        named('rejecting all leaves changes', () =>
          expect(
            left(rejected).filter((m) => m.kind !== 'fmt'),
            `${label}: reject all leaves changes`,
          ).toEqual([]),
        );
        if (left(rejected).length === 0) {
          named('rejecting all is not the original view', () =>
            expect(tidy(originalView(rejected).text), `${label}: reject all\n${state}`).toBe(
              tidy(originalView(state).text),
            ),
          );
        }
      };
      try {
        finals(text);
      } catch (error) {
        // The same first check fails without the alignment change, in a table with a lone half: older than the change. In a table with a half the mechanisms are those of the steps above seen in
        // what a check reads (#483: a ledger that a lone `<!--` hides; #480: a half that pairs across cells and hides a
        // pending change), and, seen at the default size, a bold whose delimiter another change cut (#299, #265), which a
        // half does not make; Counted by the check that failed. A control that
        // passes, or that fails another check first, is no excuse: the mark made it fail.
        if (!(halves && failsFirstWithout(error, text, finals))) throw error;
        olderControl++;
        olderFor(error);
      }
    }
    const older = olderUnread + olderLedger + olderControl;
    if (process.env['REDLINES_FUZZ_STATS']) {
      const byCheck = [...olderBy].map(([check, count]) => `${check} ${count}`).join(', ');
      console.log(
        `tables ${used}, written ${written}, refused for a cell ${refusedForCell}, with others' marks ${withMarks}, with rows or columns pending ${withStructure}, over more than two cells ${wide}, with an alignment change pending ${withAlignAndRect} (${rectsBesideAlign} rectangles written beside one), with halves ${withHalves}, left out as older ${older} (a step left a pending mark unread beside a half, #480: ${olderUnread}; a step hid the ledger or brought a hidden one back, #483: ${olderLedger}; the same first check fails without the mark, in a table with a half, #480 and #483: ${olderControl}${byCheck === '' ? '' : ` (${byCheck})`})`,
      );
    }
    expect(used).toBeGreaterThan(10);
    expect(written).toBeGreaterThan(used / 3);
    // An alignment change and a rectangle meet: tables end with one pending after a rectangle, and rectangles are
    // written while one is. (Held at the default size and at 300 tables, as at 1500.)
    expect(withAlignAndRect).toBeGreaterThan(0);
    expect(rectsBesideAlign).toBeGreaterThan(0);
    expect(withHalves).toBeGreaterThan(0);
    // What is left out as older is a part of the tables that hold halves, which are one in five of them all.
    expect(older).toBeLessThan(used / 4);
    if (fuzzCount(120) >= 1000) {
      expect(refusedForCell).toBeGreaterThan(0);
      expect(withMarks).toBeGreaterThan(used / 8);
      expect(withStructure).toBeGreaterThan(used / 10);
      expect(wide).toBeGreaterThan(used / 10);
    }
  }, 3_600_000);
});
