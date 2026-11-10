import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type ChangeSpec } from '@codemirror/state';
import { GFM } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { buildTables, cellAt, tablesField, tablesOf } from './model.ts';

const make = (doc: string) =>
  EditorState.create({ doc, extensions: [markdown({ extensions: GFM }), tablesField] });

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

  it('equals a full rebuild after random edits of every kind', () => {
    const random = seeded(5);
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
    for (let run = 0; run < Number(process.env['REDLINES_FUZZ'] ? 1000 : 40); run++) {
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
          tablesOf(state),
          `run ${run} step ${step} ${JSON.stringify(state.doc.toString())}`,
        ).toEqual(rebuilt);
      }
    }
  });

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
    expect(after).toEqual(buildTables(next));
  });

  it('makes a table when its delimiter row is typed, and loses it when a pipe goes', () => {
    let state = make('| a |\n| b |\n');
    expect(tablesOf(state)).toHaveLength(0);
    state = state.update({ changes: { from: 5, insert: '\n| - |' } }).state;
    expect(tablesOf(state)).toHaveLength(1);
    state = state.update({ changes: { from: 7, to: 8 } }).state;
    expect(tablesOf(state)).toEqual(buildTables(state));
  });
});
