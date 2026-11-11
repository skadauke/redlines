// Random tables, cell edits and operations on rows and columns by three people, with Track Changes on
// and off (format §3.7): every state reads as one GFM table to the oracle, every order of decisions
// reads the same, all accepted is the newest view and all rejected the original's bytes. Cells at the
// edges of a row, other people's marks, format changes and comments are in it. `REDLINES_FUZZ` sets how
// many tables (6000 before a stage merges).
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
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
  everyOrder,
  bodyOf,
  expectEveryOrderAlike,
  expectInOrder,
  file,
} from './test-helpers.ts';
import { addComment } from './comments.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { trackedEdit } from './track.ts';
import { untrackedEdit } from './untracked.ts';
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

function tablesOf(text: string) {
  return blockLeaves(text).filter((leaf) => leaf.kind === 'table');
}

describe('rows and columns, random', () => {
  it('stay one table, read alike in every order, and decide to the newest and the original', () => {
    const random = seeded(Number(process.env['REDLINES_SEED'] ?? 2027));
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    let used = 0;
    let refusals = 0;
    let withColumns = 0;
    let withAlign = 0;
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
        if (parse(text).marks.length > 0) {
          expectInOrder(
            label,
            parse(text).ledger.comments.map((t) => t.id),
            text,
          );
        }
        // The oracle reads the newest and the original as one table, as wide as its header.
        let views: string[];
        try {
          views = [newestView(text).text, originalView(text).text];
        } catch (error) {
          throw new Error(`${label}: ${String(error)}\n${text}`, { cause: error });
        }
        for (const view of views) {
          const found = tablesOf(view);
          expect(found, label).toHaveLength(1);
          const wide = found[0]?.rows?.[0]?.length;
          expect(
            found[0]?.rows?.every((r) => r.length === wide),
            label,
          ).toBe(true);
        }
      }
      // Last, the paragraph below the table with the break in front of it deleted, as a person who removes
      // it writes it (the table's own operations come before it: a table joined to a paragraph is not
      // one that rows and columns are drawn on).
      if (around && random() < 0.5) {
        const view = newestView(text);
        const at = view.text.indexOf('Outro');
        if (
          at > 1 &&
          view.text.slice(at - 2, at) === '\n\n' &&
          view.text.startsWith('Outro words.', at)
        ) {
          const from = view.map.toSource(at - 2, 1);
          const to = Math.max(from, view.map.toSource(at + 'Outro words.'.length, -1));
          const person = pick([ada, bo]);
          try {
            text = applyChanges(
              text,
              pick([true, false])
                ? trackedEdit(text, { from, to, insert: '' }, context(person, ids()))
                : untrackedEdit(text, { from, to, insert: '' }),
            );
            steps.push(`last: delete the break and the paragraph ${from}-${to}`);
          } catch (error) {
            if (!(error instanceof EditError)) throw error;
          }
        }
      }
      const label = `${JSON.stringify(lines)} ${steps.join(' / ')}`;
      const marks = parse(text).marks.length;
      if (marks === 0 || marks > 5) continue;
      used++;
      if (/col-->|col=\d/.test(text)) withColumns++;
      if (/<!--fmt \w{4} align=/.test(text)) withAlign++;
      try {
        expectEveryOrderAlike(label, text, exactly);
      } catch (error) {
        const { outcomes } = everyOrder(text, exactly);
        const lines = [...outcomes]
          .filter(([, r]) => r.size > 1)
          .map(([k, r]) => `${k}: ${[...r].map((x) => JSON.stringify(bodyOf(x))).join('  VS  ')}`);
        throw new Error(`${String(error)}\n${text}\n${lines.join('\n')}`, { cause: error });
      }
      try {
        rejectAll(text);
      } catch (error) {
        throw new Error(`${label}: ${String(error)}\n${text}\nBEFORE LAST:\n${history.at(-1)}`, {
          cause: error,
        });
      }
      // Comments stay (they are decided by no one); every change is gone, and what is left reads as
      // the newest view, or as the original.
      const left = (after: string) => parse(after).marks.filter((m) => m.kind !== 'cmt');
      let accepted: string;
      try {
        accepted = applyChanges(text, acceptAll(text));
      } catch (error) {
        throw new Error(`${label}: accept all: ${String(error)}\n${text}`, { cause: error });
      }
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
    // The comment from above a header without pipes, about one table in twenty, is refused where it ends
    // (a run of the default size draws too few tables to count on one).
    if (fuzzCount(120) >= 1000) expect(refusals).toBeGreaterThan(0);
    expect(withColumns).toBeGreaterThan(used / 4);
    expect(withAlign).toBeGreaterThan(used / 10);
  }, 3_600_000);
});
