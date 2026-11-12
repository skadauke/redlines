// Random tables with other people's marks in their cells, rows and columns pending and alignment
// changes, over which a rectangle of cells is made bold or italic with Track Changes on and off
// (format §3.7, "Cells apart"). Every order of decisions reads alike, all accepted is the newest view
// and all rejected the original one; with no row or column pending, micromark reads each state as
// its newest view. A rectangle is refused or written whole, and a refusal that speaks of a cell
// names it and the person. `REDLINES_FUZZ` sets how many tables (6000 before a stage merges), and
// `REDLINES_SEED` the seed.
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
  ada,
  blockLeaves,
  bo,
  claudeAda,
  context,
  exactly,
  expectEveryOrderAlike,
  expectInOrder,
  file,
} from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
import { newestView, originalView } from './views.ts';

const WORDS = ['alpha', 'b', 'café', 'x y', '11', '', 'two words'];
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
              format: pick(['bold', 'italic'] as const),
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
        const threads = parse(text).ledger.comments.map((t) => t.id);
        if (parse(text).marks.length > 0) expectInOrder(label, threads, text);
        let views: string[];
        try {
          views = [newestView(text).text, originalView(text).text];
        } catch (error) {
          throw new Error(`${label}: ${String(error)}\n${text}`, { cause: error });
        }
        for (const view of views) {
          const found = tablesOf(view);
          expect(found, label).toHaveLength(1);
          const wideRow = found[0]?.rows?.[0]?.length;
          expect(
            found[0]?.rows?.every((r) => r.length === wideRow),
            label,
          ).toBe(true);
        }
      }
      if (rectangles === 0) continue;
      const label = `${JSON.stringify(lines)} ${steps.join(' / ')}`;
      const marks = parse(text).marks.filter((mark) => mark.kind !== 'cmt');
      used++;
      if (marks.some((mark) => mark.entry.by !== 'ada' && mark.kind !== 'fmt')) withMarks++;
      const structure = /col-->|col=\d|row-->|row=\d|<!--fmt \w{4} align=/.test(text);
      if (structure) withStructure++;
      if (marks.length <= 5) {
        try {
          expectEveryOrderAlike(label, text, exactly);
          // Not where a person typed over a character of a pending format's syntax (a replacement
          // whose old text is `*`): micromark reads the marked file's `**` otherwise there, whatever
          // made the format change (#299). Take this out when #299 is fixed.
          if (!structure && !/<!--sub \w{4} [^>]*[*_~`]/.test(text)) {
            expectEveryOrderRead(label, text);
          }
        } catch (error) {
          throw new Error(`${String(error)}\n${text}`, { cause: error });
        }
      }
      const left = (after: string) => parse(after).marks.filter((m) => m.kind !== 'cmt');
      let accepted: string;
      try {
        accepted = applyChanges(text, acceptAll(text));
      } catch (error) {
        throw new Error(`${label}: accept all: ${String(error)}\n${text}`, { cause: error });
      }
      expect(left(accepted), `${label}: accept all leaves changes`).toEqual([]);
      const tidy = (view: string) => view.replace(/\s+$/, '');
      expect(tidy(newestView(accepted).text), `${label}: accept all\n${text}`).toBe(
        tidy(newestView(text).text),
      );
      let rejected: string;
      try {
        rejected = applyChanges(text, rejectAll(text));
      } catch (error) {
        throw new Error(
          `${label}: reject all: ${String(error)}\n${text}\nBEFORE:\n${history.at(-1)}`,
          {
            cause: error,
          },
        );
      }
      // A format change that a plain edit has since altered can't be undone and stays (§2.6).
      expect(
        left(rejected).filter((m) => m.kind !== 'fmt'),
        `${label}: reject all leaves changes`,
      ).toEqual([]);
      if (left(rejected).length === 0) {
        expect(tidy(originalView(rejected).text), `${label}: reject all\n${text}`).toBe(
          tidy(originalView(text).text),
        );
      }
    }
    if (process.env['REDLINES_FUZZ_STATS']) {
      console.log(
        `tables ${used}, written ${written}, refused for a cell ${refusedForCell}, with others' marks ${withMarks}, with rows or columns pending ${withStructure}, over more than two cells ${wide}`,
      );
    }
    expect(used).toBeGreaterThan(10);
    expect(written).toBeGreaterThan(used / 3);
    if (fuzzCount(120) >= 1000) {
      expect(refusedForCell).toBeGreaterThan(0);
      expect(withMarks).toBeGreaterThan(used / 8);
      expect(withStructure).toBeGreaterThan(used / 10);
      expect(wide).toBeGreaterThan(used / 10);
    }
  }, 3_600_000);
});
