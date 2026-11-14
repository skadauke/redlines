import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState, type ChangeSpec } from '@codemirror/state';
import { parse as parseFormat, readTables } from '@redlines/format';
import { GFM } from '@lezer/markdown';
import { describe, expect, it, vi } from 'vitest';
import { buildTables, cellAt, type Table, tablesField, tablesOf } from './model.ts';

const make = (doc: string) =>
  EditorState.create({ doc, extensions: [markdown({ extensions: GFM }), tablesField] });

/** Tables without their identities, which a rebuild gives new. */
const bare = (tables: readonly Table[]) => tables.map((table) => ({ ...table, id: 0 }));

const T = '| a | b |\n| - | :-: |\n| cc | d |\n';

describe('the tables of a state', () => {
  it('reads rows, cells, alignments and the delimiter row', () => {
    const state = make(`Intro.\n\n${T}\nAfter.`);
    const [table] = tablesOf(state);
    expect(table?.columns).toBe(2);
    expect(table?.aligns).toEqual(['', 'center']);
    expect(
      table?.rows.map((r) => r.cells.map((c) => state.sliceDoc(c.textFrom, c.textTo))),
    ).toEqual([
      ['a', 'b'],
      ['cc', 'd'],
    ]);
    expect(state.sliceDoc(table?.delimiter.from, table?.delimiter.to)).toBe('| - | :-: |');
    expect(table?.rows.map((r) => [r.index, r.header])).toEqual([
      [0, true],
      [1, false],
    ]);
    expect(table?.rows[0]?.cells.map((c) => c.col)).toEqual([0, 1]);
  });

  it('has no table for one in a quote or a list item, and reads two apart', () => {
    expect(tablesOf(make('> | a |\n> | - |\n> | b |\n'))).toHaveLength(0);
    expect(tablesOf(make('- | a |\n  | - |\n  | b |\n'))).toHaveLength(0);
    expect(tablesOf(make(`${T}\n${T}`))).toHaveLength(2);
  });

  it('finds the cell of any position, the nearest in a pipe, padding or the delimiter row', () => {
    const state = make(T);
    const at = (pos: number) => {
      const found = cellAt(state, pos);
      return found && [found.row.index, found.cell.col];
    };
    for (let pos = 0; pos <= T.trimEnd().length; pos++) expect(at(pos)).not.toBeNull();
    expect(at(2)).toEqual([0, 0]);
    expect(at(T.indexOf('| b') + 1)).toEqual([0, 1]);
    expect(at(T.indexOf('| -') + 3)).toEqual([0, 1]);
    expect(at(T.indexOf('cc'))).toEqual([1, 0]);
    expect(at(T.indexOf('| d') + 3)).toEqual([1, 1]);
    expect(cellAt(state, T.length)).toBeNull();
    expect(cellAt(make('plain'), 2)).toBeNull();
  });

  it('keeps a ragged row as written', () => {
    const [table] = tablesOf(make('| a | b |\n| - | - |\n| c |\n| d | e | f |\n'));
    expect(table?.rows.map((r) => r.cells.length)).toEqual([2, 1, 3]);
  });
});

describe('a position where one cell’s mark ends and the next begins', () => {
  // A cell's mark runs from the pipe in front of it to the next pipe, so the position in front of that
  // pipe ends one mark and starts the next. It is the end of the first cell's text when that has no
  // padding after it (an empty cell with one space or none, `| |` and `||`; text such as `| y|` and
  // `|a|b|`), and then it is that cell's last stop, never the next cell's: its first stop is after its
  // own pipe. Any other position there is the next cell's, as a position in a pipe is.
  const doc = (row: string) => `| a | b | c |\n| - | - | - |\n${row}`;
  const colsAt = (row: string) => {
    const state = make(doc(row));
    const start = doc(row).indexOf(row);
    return (pos: number) => {
      const found = cellAt(state, start + pos);
      return found && [found.row.index, found.cell.col];
    };
  };

  it('belongs to the empty cell with one space of padding, or none, whose text ends there', () => {
    const at = colsAt('| 1 | | x |');
    expect([at(4), at(5), at(6)]).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    // After the next cell's pipe it is the next cell's.
    expect([at(7), at(8)]).toEqual([
      [1, 2],
      [1, 2],
    ]);
    const none = colsAt('| 1 || x |');
    expect([none(4), none(5), none(6)]).toEqual([
      [1, 1],
      [1, 1],
      [1, 2],
    ]);
    expect(colsAt('| | 1 | x |')(2)).toEqual([1, 0]);
    expect(colsAt('| | | x |')(2)).toEqual([1, 0]);
    expect(colsAt('| | | x |')(4)).toEqual([1, 1]);
  });

  it('belongs to a cell whose text has no padding after it', () => {
    const at = colsAt('|a|b|c|');
    expect([at(1), at(2), at(3), at(4), at(5), at(6)]).toEqual([
      [1, 0],
      [1, 0],
      [1, 1],
      [1, 1],
      [1, 2],
      [1, 2],
    ]);
    // What typing one letter into `| |` writes: the cell ends where its text does.
    const typed = colsAt('| 1 | y| x |');
    expect([typed(6), typed(7), typed(8)]).toEqual([
      [1, 1],
      [1, 1],
      [1, 2],
    ]);
  });

  it('is still the next cell’s where the text before it ends earlier, as a pipe and padding are', () => {
    const at = colsAt('| 1 | x |');
    // The end of `1`'s text is its own; the pipe after its padding starts `x`'s mark.
    expect([at(3), at(4), at(5), at(6)]).toEqual([
      [1, 0],
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    const two = colsAt('| 1 |  | x |');
    expect([two(4), two(5), two(6), two(7), two(8)]).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 2],
      [1, 2],
    ]);
  });

  it('is the empty cell’s in a row with no outer pipes', () => {
    const at = colsAt('1 | | x');
    expect([at(2), at(3), at(4), at(5)]).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 2],
    ]);
  });

  it('is no stop of two cells, in every row of cells of every padding, with or without outer pipes', () => {
    // Every cell content of up to two spaces and one letter, in rows with a pipe at each end, at one
    // end and at neither: the places where a cell's text stands never overlap, and `cellAt` gives each
    // position that is one of them to the cell that has it.
    const contents = ['', ' ', '  ', 'a', ' a', 'a ', ' a ', 'ab'];
    let rows = 0;
    for (const lead of [true, false]) {
      for (const trail of [true, false]) {
        for (const x of contents) {
          for (const y of contents) {
            for (const z of contents) {
              const cells = [x, y, z];
              // A cell that is empty and first in a row with no leading pipe is no cell the text can make.
              const row = `${lead ? '|' : ''}${cells.join('|')}${trail ? '|' : ''}`;
              const state = make(doc(row));
              const [table] = tablesOf(state);
              const body = table?.rows[1];
              if (!table || !body) continue;
              rows++;
              for (let pos = body.from; pos <= body.to; pos++) {
                const claimants = body.cells.filter((c) => c.textFrom <= pos && pos <= c.textTo);
                expect(
                  claimants.length,
                  `${JSON.stringify(row)} at ${pos - body.from}`,
                ).toBeLessThanOrEqual(1);
                const found = cellAt(state, pos);
                expect(found?.row, `${JSON.stringify(row)} at ${pos - body.from}`).toBe(body);
                if (claimants[0]) expect(found?.cell, JSON.stringify(row)).toBe(claimants[0]);
              }
            }
          }
        }
      }
    }
    expect(rows).toBeGreaterThan(1000);
  });
});

describe('read from the tree as its parse goes on', () => {
  it('takes in the tables that an edit’s own parse reaches, past where the tree before it ended', () => {
    // A busy machine stops the first parse early, so the tables are read from part of the text. The
    // first edit's parse then goes on to the end in the same transaction: the tables it reaches are
    // not near the edit, and must still be read.
    const doc = `Intro words.\n\n${T}\nMiddle.\n\n| h |\n| - |\n| 1 |\n\n${T}`;
    let now = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
    let state: EditorState;
    try {
      state = make(doc);
    } finally {
      clock.mockRestore();
    }
    expect(syntaxTree(state).length).toBeLessThan(state.doc.length);
    state = state.update({ changes: { from: 0, insert: 'x' } }).state;
    expect(syntaxTree(state).length).toBe(state.doc.length);
    expect(bare(tablesOf(state))).toEqual(bare(buildTables(state)));
    expect(tablesOf(state)).toHaveLength(3);
  });
});

describe('kept as the text changes', () => {
  /** A seeded generator. */
  const seeded = (seed: number) => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Seeds 1 to 3 found a table kept over what the tree reads as a setext heading (an edit on the
  // line after a table), each within 1,700 runs: they run in full, by default.
  it.each([1, 2, 3, 5])(
    'equals a full rebuild after random edits of every kind (seed %i)',
    (seed) => {
      const random = seeded(seed);
      const pick = <X>(xs: readonly X[]): X => xs[Math.floor(random() * xs.length)] as X;
      const pieces = [
        'x',
        'é',
        '|',
        '\\',
        '\n',
        ' ',
        '<br>',
        '\n\n',
        '| z |',
        '\n| - |',
        '- ',
        '> ',
        'ab',
      ];
      const doc0 = `Intro words.\n\n${T}\nMiddle.\n\n| h |\n| - |\n| 1 |\n| 2 |\n\n${T}`;
      for (let run = 0; run < Number(process.env['REDLINES_FUZZ'] ?? 2000); run++) {
        let state = make(doc0);
        for (let step = 0; step < 25; step++) {
          const len = state.doc.length;
          const from = Math.floor(random() * (len + 1));
          const to = Math.min(len, from + (random() < 0.5 ? 0 : Math.floor(random() * 4)));
          const changes: ChangeSpec[] = [{ from, to, insert: random() < 0.2 ? '' : pick(pieces) }];
          if (random() < 0.3) {
            // A second change, before or after, as a tracked edit and its ledger make.
            const at = Math.floor(random() * (len + 1));
            if (at < from - 1 || at > to + 1) changes.push({ from: at, insert: 'q' });
          }
          state = state.update({ changes }).state;
          // The syntax tree is finished, as the editor's parse worker does, and the tables follow it.
          ensureSyntaxTree(state, state.doc.length, 5000);
          state = state.update({}).state;
          const rebuilt = buildTables(state);
          expect(
            bare(tablesOf(state)),
            `run ${run} step ${step} ${JSON.stringify(state.doc.toString())}`,
          ).toEqual(bare(rebuilt));
        }
      }
    },
    300_000,
  );

  it('reads one row again for typing in it, and keeps the tables it does not touch as they are', () => {
    const state = make(`${T}\nWords.\n\n${T}`);
    const before = tablesOf(state);
    const at = state.doc.toString().indexOf('cc') + 1;
    const next = state.update({ changes: { from: at, insert: 'x' } }).state;
    const after = tablesOf(next);
    expect(after[0]?.rows[0]).toBe(before[0]?.rows[0]);
    expect(after[0]?.rows[1]).not.toBe(before[0]?.rows[1]);
    expect(after[0]?.rows[1]?.cells[0]?.textTo).toBe(
      at + 2 + 0 + (before[0]?.rows[1]?.cells[0]?.textTo ?? 0) - at - 1 + 0,
    );
    expect(after[1]?.from).toBe((before[1]?.from ?? 0) + 1);
    expect(bare(after)).toEqual(bare(buildTables(next)));
  });

  it('makes a table when its delimiter row is typed, and loses it when a pipe goes', () => {
    let state = make('| a |\n| b |\n');
    expect(tablesOf(state)).toHaveLength(0);
    state = state.update({ changes: { from: 5, insert: '\n| - |' } }).state;
    expect(tablesOf(state)).toHaveLength(1);
    state = state.update({ changes: { from: 7, to: 8 } }).state;
    expect(bare(tablesOf(state))).toEqual(bare(buildTables(state)));
  });

  it('keeps a table’s identity as the text above and in it changes, and gives a new table its own', () => {
    let state = make(`${T}\nWords.\n\n${T}`);
    const [first, second] = tablesOf(state);
    expect(first?.id).not.toBe(second?.id);
    const edit = (changes: ChangeSpec) => {
      state = state.update({ changes }).state;
      return tablesOf(state);
    };
    // Typing in a cell, a line above, a row added to the first table, and the second one after it.
    expect(
      edit({ from: state.doc.toString().indexOf('cc') + 1, insert: 'x' }).map((t) => t.id),
    ).toEqual([first?.id, second?.id]);
    expect(edit({ from: 0, insert: 'A line.\n\n' }).map((t) => t.id)).toEqual([
      first?.id,
      second?.id,
    ]);
    const end = tablesOf(state)[0]!.to;
    expect(edit({ from: end, insert: '\n| 9 | 9 |' }).map((t) => t.id)).toEqual([
      first?.id,
      second?.id,
    ]);
    // A table made above both is new; the others keep theirs; one that is unmade takes its id away.
    const made = edit({ from: 0, insert: '| n |\n| - |\n| 1 |\n\n' });
    expect(made).toHaveLength(3);
    expect(made.slice(1).map((t) => t.id)).toEqual([first?.id, second?.id]);
    expect([first?.id, second?.id]).not.toContain(made[0]?.id);
    const gone = edit({ from: 0, to: 7 });
    expect(gone.map((t) => t.id)).toEqual([first?.id, second?.id]);
  });

  it('drops the tables that text above them makes code, as the tree has it', () => {
    // A fence opened above the tables below it makes them code.
    let state = make(`Intro.\n\n${T}\nMiddle.\n\n${T}`);
    expect(tablesOf(state)).toHaveLength(2);
    state = state.update({ changes: { from: 0, insert: '```\n' } }).state;
    ensureSyntaxTree(state, state.doc.length, 5000);
    state = state.update({}).state;
    expect(bare(tablesOf(state))).toEqual(bare(buildTables(state)));
    expect(tablesOf(state)).toHaveLength(0);
  });
});

describe('a table indented by up to three spaces', () => {
  for (const indent of [0, 1, 2, 3]) {
    it(`is found in the tree, so an edit elsewhere rebuilds no table (indent ${indent})`, () => {
      const pad = ' '.repeat(indent);
      const first = `${pad}| a | b |\n${pad}| - | - |\n${pad}| cc | d |\n`;
      const doc = `${first}\nBetween.\n\n${T}`;
      const state = make(doc);
      ensureSyntaxTree(state, doc.length, 5000);
      const before = tablesOf(state.update({}).state);
      expect(before).toHaveLength(2);
      // A keystroke in the second table's cell.
      const at = doc.lastIndexOf('cc') + 1;
      let next = state.update({ changes: { from: at, insert: 'x' } }).state;
      ensureSyntaxTree(next, next.doc.length, 5000);
      next = next.update({}).state;
      const after = tablesOf(next);
      expect(after).toHaveLength(2);
      // The first table is the one it was, moved with the text and not read again.
      expect(after[0]).toBe(before[0]);
    });
  }
});

describe('the tables of a state against the format reader (#290)', () => {
  it('has the tables, rows and cells the format reads, over random leading whitespace', () => {
    let seed = 290;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const white = () => {
      let out = '';
      for (let n = Math.floor(random() * 6); n > 0; n--) out += random() < 0.35 ? '\t' : ' ';
      return out;
    };
    for (let n = 0; n < 1500; n++) {
      const bareTable = random() < 0.5;
      const wrap = (line: string) => (bareTable ? line : `| ${line} |`);
      const lines = [wrap('h0 | h1'), wrap('--- | :-:')];
      for (let r = Math.floor(random() * 4); r > 0; r--) lines.push(wrap('c0 | c1'));
      const doc = lines.map((line) => `${random() < 0.4 ? '' : white()}${line}`).join('\n');
      const mine = tablesOf(make(doc)).map((t) =>
        t.rows.map((r) => r.cells.map((c) => doc.slice(c.textFrom, c.textTo))),
      );
      const format = readTables(doc, parseFormat(doc)).map((t) =>
        t.rows.map((r) => r.cells.map((c) => doc.slice(c.textFrom, c.textTo))),
      );
      expect(mine, JSON.stringify(doc)).toEqual(format);
    }
  });
});
