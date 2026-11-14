// A comment in a row that moves travels with the row, both ways (format §3.7, "Moving rows"; #371):
// rejecting the move gives the row back at its place with its comments, accepting it leaves them in the
// row at its new place, and none is left behind at the place the row leaves or written twice. Tried on a
// table with no outer pipes, with leading pipes only, with trailing pipes only and with both, on every
// boundary a row can move to, with a range in a cell, a range across two cells and a point, by one person
// and by two, made before the move and after it. Every decision gives the bytes that are expected, every
// state is the same GFM table to micromark, every order of decisions reads alike, and none is refused.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { addHighlight } from './highlights.ts';
import { parse } from './parse.ts';
import { expectCommentsTravel } from './table-move-oracle.ts';
import { tableEdit } from './table-ops.ts';
import { readTables } from './table.ts';
import type { Person } from './types.ts';
import {
  ada,
  blockLeaves,
  bo,
  bodyOf,
  claudeAda,
  context,
  exactly,
  expectEveryOrderAlike,
  expectInOrder,
  expectNoDecisionRefused,
  file,
} from './test-helpers.ts';

const trim = (text: string) => bodyOf(text).replace(/[\r\n]+$/, '');

/** The header, the delimiter row and three rows: the first, a middle one and the last. */
const LINES = ['alpha | b', '-- | --', 'alpha | x y', 'café | x', 'beta | x y'];
const LAYOUTS: Record<string, { lines: string[]; leading: boolean }> = {
  'no outer pipes': { lines: LINES, leading: false },
  'leading pipes only': { lines: LINES.map((line) => `| ${line}`), leading: true },
  'trailing pipes only': { lines: LINES.map((line) => `${line} |`), leading: false },
  'both outer pipes': { lines: LINES.map((line) => `| ${line} |`), leading: true },
};

/**
 * What a note covers in a row, by its cells: a range in the second cell, a range from the end of the
 * first cell into the second, a point in the second, the last character of the second, the start of
 * the first (where a row with no pipe at its start has no place for a marker), the end of the second,
 * the last of the row, and `rows`: from the start of the second cell on into another row (`through`),
 * to the first characters of its first cell.
 */
type Kind = 'cell' | 'across' | 'point' | 'last' | 'start' | 'end' | 'rows';
interface Note {
  kind: Kind;
  by: Person;
  id: string;
  /** A highlight, not a comment. */
  highlight?: boolean;
  /** The row a note of kind `rows` ends in. */
  through?: number;
}

/** The range of a note in `row` of the table of `text`, as offsets of `text`. */
function rangeOf(
  text: string,
  row: number,
  kind: Kind,
  through = row,
): { from: number; to: number } {
  const rows = readTables(text, parse(text))[0]?.rows ?? [];
  const cells = rows[row]?.cells ?? [];
  const [one, two] = [cells[0], cells[1]];
  if (!one || !two) throw new Error(`row ${row} has no two cells`);
  const more = Math.min(2, two.textTo - two.textFrom);
  if (kind === 'cell') return { from: two.textFrom, to: two.textFrom + 1 };
  if (kind === 'across') return { from: one.textTo - 1, to: two.textFrom + 1 };
  if (kind === 'last') return { from: two.textTo - 1, to: two.textTo };
  if (kind === 'start') return { from: one.textFrom, to: one.textFrom + 2 };
  if (kind === 'end') return { from: two.textTo - more, to: two.textTo };
  if (kind === 'rows') {
    const end = rows[through]?.cells[0];
    if (!end) throw new Error(`row ${through} has no cell`);
    return { from: two.textFrom, to: end.textFrom + 2 };
  }
  return { from: two.textFrom + 1, to: two.textFrom + 1 };
}

/** The file with `notes` written on `row`, in order. */
function noted(text: string, row: number, notes: readonly Note[]): string {
  let current = text;
  for (const note of notes) {
    const range = rangeOf(current, row, note.kind, note.through);
    const ctx = context(note.by, [note.id]);
    const { changes } = note.highlight
      ? addHighlight(current, range, ctx)
      : addComment(current, range, 'A note.', ctx);
    current = applyChanges(current, changes);
  }
  return current;
}

/** The move of `row` to boundary `to` by Claude: the file with the move pending, and the row's new
 * index. */
function moved(text: string, row: number, to: number): { text: string; index: number } {
  const table = readTables(text, parse(text))[0]?.from ?? 0;
  const done = tableEdit(
    text,
    { kind: 'moveRows', table, rows: [row], to },
    context(claudeAda, ['k3x9', 'w8nn']),
  );
  return { text: applyChanges(text, done.changes), index: done.rows?.[0] ?? 0 };
}

/** The lines of a file's body, apart from the break at its end. */
const linesOf = (text: string) => trim(text).split(/\r?\n/);

/** A row with no pipe at its start is moved with a plain one, in both halves of the move. */
const piped = (line: string) => (/^\|/.test(line) ? line : `| ${line}`);

/** The lines of the table once row `row` has moved to boundary `to`: the header, the delimiter row, and
 * the rows in their new order. */
function movedLines(lines: readonly string[], row: number, to: number): string[] {
  const rows = [lines[0] as string, ...lines.slice(2)];
  const [taken] = rows.splice(row, 1);
  rows.splice(to - (row < to ? 1 : 0), 0, piped(taken as string));
  return [rows[0] as string, lines[1] as string, ...rows.slice(1)];
}

const tables = (text: string) => blockLeaves(text).filter((leaf) => leaf.kind === 'table');

/** Every state is one table of two columns and four rows to micromark, which reads the file as it is,
 * markers and all. */
function expectOneTable(label: string, text: string): void {
  const found = tables(text);
  expect(found, label).toHaveLength(1);
  expect(
    found[0]?.rows?.map((row) => row.length),
    label,
  ).toEqual([2, 2, 2, 2]);
}

/** The markers of a comment or a highlight in the body: its openers and its closers. */
function markersOf(text: string, id: string): [number, number] {
  const body = bodyOf(text);
  const opens = body.split(new RegExp(`<!--(?:cmt|hl) ${id}-->`)).length - 1;
  return [opens, body.split(`<!--/${id}-->`).length - 1];
}

/**
 * Held to every decision of a move of `row` to boundary `to`: `commented` is the table as it is
 * before the move, with the notes on its rows, and `pending` the file with the move made. Rejecting
 * either half, or all, gives `commented` back, the moved row with its plain pipe; accepting gives the
 * rows in their new order; every state has every marker once and reads as the table; every order of
 * decisions reads alike; no decision is refused.
 */
function expectMoveCarriesNotes(
  label: string,
  commented: string,
  pending: string,
  row: number,
  to: number,
  notes: readonly Note[],
): void {
  const lines = linesOf(commented);
  const eol = commented.includes('\r\n') ? '\r\n' : '\n';
  // (the header is row 0 and line 0, the delimiter row line 1, the rows from line 2)
  const back = [...lines];
  back[row === 0 ? 0 : row + 1] = piped(lines[row === 0 ? 0 : row + 1] as string);
  const ahead = movedLines(lines, row, to);
  expectOneTable(`${label}: expected, rejected`, file(back.join(eol)));
  expectOneTable(`${label}: expected, accepted`, file(ahead.join(eol)));
  // The kept copy has no marker of a comment, which is no change.
  for (const line of linesOf(pending).filter((l) => l.startsWith('<!--del '))) {
    expect(line, `${label}: the deleted row`).not.toMatch(/cmt|hl /);
  }
  const through = (changes: ReturnType<typeof accept>) => applyChanges(pending, changes);
  const decided = {
    'accepted by the row': through(accept(pending, 'k3x9')),
    'accepted by the deletion': through(accept(pending, 'w8nn')),
    'accepted all': through(acceptAll(pending)),
    'rejected by the row': through(reject(pending, 'k3x9')),
    'rejected by the deletion': through(reject(pending, 'w8nn')),
    'rejected all': through(rejectAll(pending)),
  };
  for (const [name, text] of Object.entries(decided)) {
    const shown = `${label}: ${name}`;
    expect(linesOf(text), shown).toEqual(name.startsWith('accepted') ? ahead : back);
    expectOneTable(shown, text);
    for (const note of notes) {
      expect(markersOf(text, note.id), `${shown}: the markers of ${note.id}`).toEqual(
        markersOf(commented, note.id),
      );
    }
    expectInOrder(
      shown,
      parse(text).ledger.comments.map((thread) => thread.id),
      text,
    );
  }
  expectEveryOrderAlike(label, pending);
  expectEveryOrderAlike(label, pending, exactly);
  expectNoDecisionRefused(label, pending);
  expectCommentsTravel(label, pending, 2);
}

/** Sets of notes on one row: one person's, and two people's. */
const SETS: Record<string, Note[]> = {
  'a range in a cell': [{ kind: 'cell', by: ada, id: 'c9qf' }],
  'a range across two cells': [{ kind: 'across', by: ada, id: 'c9qf' }],
  'a point': [{ kind: 'point', by: ada, id: 'c9qf' }],
  'a range at the end of the row': [{ kind: 'end', by: bo, id: 'c9qf' }],
  'a highlight across two cells': [{ kind: 'across', by: ada, id: 'c9qf', highlight: true }],
  'two people, across two cells and the last of the second': [
    { kind: 'across', by: ada, id: 'c9qf' },
    { kind: 'last', by: bo, id: 'd4rs' },
  ],
  'two people, a point and a range in a cell': [
    { kind: 'point', by: claudeAda, id: 'c9qf' },
    { kind: 'cell', by: ada, id: 'd4rs' },
  ],
  'two people, the same range': [
    { kind: 'cell', by: ada, id: 'c9qf' },
    { kind: 'cell', by: claudeAda, id: 'd4rs' },
  ],
};

describe('a comment in a row that moves (#371)', () => {
  it('is given back in the restored row, and the delimiter row stays a delimiter row', () => {
    // The first report: a table with no pipe at the row starts; Ada and Claude comment in the cells of
    // the last row; Claude moves that row to the first boundary; the move is rejected. It wrote both
    // comments' openers after the delimiter row (`-- | --<!--cmt d4rs--><!--cmt c9qf-->`), kept their
    // markers in the restored row as well, and the file no longer read as a table.
    const text = file(['alpha | b', '-- | --', 'alpha | x y', 'café | x', 'x | x y'].join('\n'));
    const both = noted(text, 3, [
      { kind: 'cell', by: ada, id: 'd4rs' },
      { kind: 'end', by: claudeAda, id: 'c9qf' },
    ]);
    const row = 'x | <!--cmt d4rs-->x<!--/d4rs--><!--cmt c9qf--> y<!--/c9qf-->';
    expect(trim(both)).toBe(`alpha | b\n-- | --\nalpha | x y\ncafé | x\n${row}`);
    const pending = moved(both, 3, 1).text;
    const back = `alpha | b\n-- | --\nalpha | x y\ncafé | x\n| ${row}`;
    for (const id of ['k3x9', 'w8nn']) {
      expect(trim(applyChanges(pending, reject(pending, id))), id).toBe(back);
    }
    expect(trim(applyChanges(pending, rejectAll(pending)))).toBe(back);
    expectOneTable('rejected', applyChanges(pending, rejectAll(pending)));
    expectEveryOrderAlike('the first report', pending, exactly);
    expectNoDecisionRefused('the first report', pending);
  });

  for (const [layout, { lines, leading }] of Object.entries(LAYOUTS)) {
    describe(`in a table with ${layout}`, () => {
      for (const [what, notes] of Object.entries(SETS)) {
        it(`travels with the row both ways: ${what}, made before the move and after it`, () => {
          let cases = 0;
          for (const row of [1, 2, 3]) {
            for (let to = 0; to <= 4; to++) {
              if (to === row || to === row + 1) continue;
              for (const when of ['before', 'after'] as const) {
                const label = `${layout}, row ${row} to ${to}, ${what}, ${when}`;
                const base = file(lines.join('\n'));
                // The table with its notes where the row is now, which the rejected move gives back.
                const commented = noted(base, row, notes);
                let pending: string;
                if (when === 'before') pending = moved(commented, row, to).text;
                else {
                  const one = moved(base, row, to);
                  pending = noted(one.text, one.index, notes);
                }
                expectMoveCarriesNotes(label, commented, pending, row, to, notes);
                cases++;
              }
            }
          }
          expect(cases).toBe(18);
        }, 60_000);
      }

      it('travels with the row both ways: a range at the start of the first cell', () => {
        // (a row with no pipe at its start has no place for a marker there: a comment on its first word
        // is refused beside a move, as the last test says)
        const notes: Note[] = [{ kind: 'start', by: ada, id: 'c9qf' }];
        let cases = 0;
        for (const row of [1, 2, 3]) {
          for (let to = 0; to <= 4; to++) {
            if (to === row || to === row + 1) continue;
            const base = file(lines.join('\n'));
            // After the move the row has its pipe, in every layout, and the comment has a place in it.
            const one = moved(base, row, to);
            const withPipe = lines.map((line, at) => (at === row + 1 ? piped(line) : line));
            expectMoveCarriesNotes(
              `${layout}, row ${row} to ${to}, a range at the start, after`,
              noted(file(withPipe.join('\n')), row, notes),
              noted(one.text, one.index, notes),
              row,
              to,
              notes,
            );
            cases++;
            // Before the move, only where the row has a pipe at its start.
            if (!leading) continue;
            const commented = noted(base, row, notes);
            expectMoveCarriesNotes(
              `${layout}, row ${row} to ${to}, a range at the start, before`,
              commented,
              moved(commented, row, to).text,
              row,
              to,
              notes,
            );
            cases++;
          }
        }
        expect(cases).toBe(leading ? 18 : 9);
      }, 60_000);

      it('travels with the row both ways: a highlight that runs from one row into another, made first', () => {
        // A highlight across rows is made while no row is pending, and a move beside it is not refused for
        // it, as one beside a comment across rows is (#289). A move that would put its end in front of
        // its start is refused when it is made; every other move is decided in every order, and the end
        // in the moving row goes with the row.
        const refusal = (run: () => unknown) => {
          try {
            run();
          } catch (error) {
            return error;
          }
          return undefined;
        };
        let made = 0;
        let refused = 0;
        for (let first = 0; first <= 3; first++) {
          for (let last = first + 1; last <= 3; last++) {
            const notes: Note[] = [
              { kind: 'rows', by: ada, id: 'h4jj', highlight: true, through: last },
            ];
            const commented = noted(file(lines.join('\n')), first, notes);
            for (let row = 0; row <= 3; row++) {
              for (let to = 0; to <= 4; to++) {
                if (to === row || to === row + 1) continue;
                const label = `${layout}, a highlight from row ${first} into row ${last}, row ${row} to ${to}`;
                // The rows after the move: does the highlight's end come in front of its start?
                const others = [0, 1, 2, 3].filter((index) => index !== row);
                const at = to - (row < to ? 1 : 0);
                const order = [...others.slice(0, at), row, ...others.slice(at)];
                if (order.indexOf(first) > order.indexOf(last)) {
                  const error = refusal(() => moved(commented, row, to));
                  expect(error, label).toBeInstanceOf(EditError);
                  expect((error as EditError).code, label).toBe('would-hide-marks');
                  refused++;
                  continue;
                }
                expectMoveCarriesNotes(
                  label,
                  commented,
                  moved(commented, row, to).text,
                  row,
                  to,
                  notes,
                );
                made++;
              }
            }
          }
        }
        expect([made, refused]).toEqual([52, 20]);
      }, 60_000);
    });
  }

  it('leaves the comments of the rows beside the moved row where they are', () => {
    // A decision writes some row again to put the moved one back, and which one is no matter to the
    // text: the notes of every row stay with it, the header's too.
    const notes: Note[] = [
      { kind: 'cell', by: ada, id: 'c9qf' },
      { kind: 'across', by: bo, id: 'd4rs' },
      { kind: 'point', by: claudeAda, id: 'f3gg' },
      { kind: 'last', by: ada, id: 'h4jj', highlight: true },
    ];
    let cases = 0;
    for (const [layout, { lines }] of Object.entries(LAYOUTS)) {
      const base = file(lines.join('\n'));
      // One note on each row, the header first.
      let commented = base;
      notes.forEach((note, row) => {
        commented = noted(commented, row, [note]);
      });
      for (const row of [1, 2, 3]) {
        for (let to = 0; to <= 4; to++) {
          if (to === row || to === row + 1) continue;
          const label = `${layout}, a note on every row, row ${row} to ${to}`;
          expectMoveCarriesNotes(label, commented, moved(commented, row, to).text, row, to, notes);
          cases++;
        }
      }
    }
    expect(cases).toBe(36);
  }, 60_000);

  it('is decided in every order beside another person’s move, each with comments', () => {
    let cases = 0;
    for (const [layout, { lines }] of Object.entries(LAYOUTS)) {
      let base = file(lines.join('\n'));
      const ids = ['c9qf', 'd4rs', 'f3gg'];
      for (const row of [1, 2, 3]) {
        base = noted(base, row, [
          { kind: row === 2 ? 'across' : 'cell', by: ada, id: ids[row - 1] as string },
        ]);
      }
      const table = readTables(base, parse(base))[0]?.from ?? 0;
      for (const [one, first] of [
        [1, 3],
        [3, 1],
        [2, 0],
        [1, 4],
      ] as const) {
        const done = tableEdit(
          base,
          { kind: 'moveRows', table, rows: [one], to: first },
          context(claudeAda, ['k3x9', 'w8nn']),
        );
        const text = applyChanges(base, done.changes);
        for (const [two, second] of [
          [2, 0],
          [3, 1],
          [1, 3],
          [2, 4],
        ] as const) {
          let both: string;
          try {
            const result = tableEdit(
              text,
              { kind: 'moveRows', table, rows: [two], to: second },
              context(bo, ['p5qm', 'q6rs']),
            );
            both = applyChanges(text, result.changes);
          } catch (error) {
            // (a row that is another person's pending move can't be moved)
            if (error instanceof EditError) continue;
            throw error;
          }
          const label = `${layout}, row ${one} to ${first}, then row ${two} to ${second}`;
          expectEveryOrderAlike(label, both);
          expectEveryOrderAlike(label, both, exactly);
          expectNoDecisionRefused(label, both);
          expectCommentsTravel(label, both, 2);
          cases++;
        }
      }
    }
    expect(cases).toBeGreaterThan(40);
  }, 60_000);

  it('travels with a row of a file whose lines break with CR and LF', () => {
    let cases = 0;
    for (const [layout, { lines }] of Object.entries(LAYOUTS)) {
      const base = noted(file(lines.join('\r\n')).replace(/(?<!\r)\n/g, '\r\n'), 3, [
        { kind: 'across', by: ada, id: 'c9qf' },
        { kind: 'last', by: bo, id: 'd4rs' },
      ]);
      for (const to of [0, 1, 2]) {
        const label = `${layout}, CRLF, row 3 to ${to}`;
        expectMoveCarriesNotes(label, base, moved(base, 3, to).text, 3, to, [
          { kind: 'across', by: ada, id: 'c9qf' },
          { kind: 'last', by: bo, id: 'd4rs' },
        ]);
        cases++;
      }
    }
    expect(cases).toBe(12);
  });

  it('is refused when the move is made, in words, beside a comment on the first word of a row with no pipe there', () => {
    // The opener of such a comment is at the end of the row above: the comment crosses the line break,
    // and a move beside it could be accepted but not rejected (#289).
    for (const layout of ['no outer pipes', 'trailing pipes only']) {
      const { lines } = LAYOUTS[layout] as (typeof LAYOUTS)[string];
      const text = noted(file(lines.join('\n')), 3, [{ kind: 'start', by: ada, id: 'c9qf' }]);
      expect(() => moved(text, 2, 0), layout).toThrow(
        "Ada Lovelace's comment runs from one row of this table into the next. Delete or resolve it first, or turn off Track Changes.",
      );
    }
  });
});
