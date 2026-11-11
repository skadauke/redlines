// What a change builds again in the tables' drawing: only the rows it touches, and a table whose
// shape it changes; and that what is kept is what a build from nothing makes.
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { type ChangeSpec, EditorState, type TransactionSpec } from '@codemirror/state';
import { GFM } from '@lezer/markdown';
import type { RangeSet, RangeValue } from '@codemirror/state';
import { WidgetType } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { layoutOf, layoutOfState, layoutStats, tableLayout } from './layout.ts';
import { tablesOf } from './model.ts';
import { atomsOfState, stopAtoms, tableStops } from './stops.ts';

const make = (doc: string) => {
  const state = EditorState.create({
    doc,
    // The caret away from the tables: a transaction that moves it onto a stop is made twice.
    selection: { anchor: doc.length },
    extensions: [markdown({ extensions: GFM }), tableLayout(), tableStops()],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  // Parsed to the end: the tables are read from the whole tree.
  return state.update({}).state;
};

/**
 * `state.update(spec).state` with the clock held still. CodeMirror gives an update's parse 20 ms, and a
 * busy machine can run out of it, leaving the tables past that point unread until a later update. Held,
 * the parse reaches the end, as it does on an idle machine.
 */
function settled(state: EditorState, spec: TransactionSpec): EditorState {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  try {
    return state.update(spec).state;
  } finally {
    clock.mockRestore();
  }
}

/** A set as data: where each range is and what it is. */
function dump(set: RangeSet<RangeValue>): string[] {
  const out: string[] = [];
  for (const cursor = set.iter(); cursor.value; cursor.next()) {
    const json = JSON.stringify(cursor.value, (_key, value: unknown) =>
      value instanceof WidgetType ? { widget: value.constructor.name } : value,
    );
    out.push(`${cursor.from}-${cursor.to} ${json}`);
  }
  return out;
}

function expectKept(state: EditorState, where: string) {
  const full = layoutOf(state);
  const kept = layoutOfState(state);
  expect(dump(kept.wrappers), `wrappers ${where}`).toEqual(dump(full.wrappers));
  expect(dump(kept.decorations), `decorations ${where}`).toEqual(dump(full.decorations));
  expect(dump(kept.cells), `cells ${where}`).toEqual(dump(full.cells));
  expect(dump(atomsOfState(state)), `atoms ${where}`).toEqual(dump(stopAtoms(state)));
}

const T = '| a | b |\n| - | :-: |\n| cc | d<br>e |\n| [x](u) | |\n';

describe('the layout and the stops, kept up to date', () => {
  const seeded = (seed: number) => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  it.each([1, 2, 3])(
    'equal what a build from nothing makes, after random edits (seed %i)',
    (seed) => {
      const random = seeded(seed);
      const pick = <X>(xs: readonly X[]): X => xs[Math.floor(random() * xs.length)] as X;
      const pieces = [
        'x',
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
        '<!--ins k3x9 row-->',
        '<!--/k3x9-->',
        'ab',
        '| q | r | s |\n',
      ];
      const doc0 = `Intro words.\n\n${T}\nMiddle.\n\n| h |\n| - |\n| 1 |\n| 2 |\n\n${T}`;
      for (let run = 0; run < Number(process.env['REDLINES_FUZZ'] ?? 150); run++) {
        let state = make(doc0);
        expectKept(state, 'start');
        for (let step = 0; step < 20; step++) {
          const len = state.doc.length;
          const from = Math.floor(random() * (len + 1));
          const to = Math.min(len, from + (random() < 0.5 ? 0 : Math.floor(random() * 4)));
          const changes: ChangeSpec[] = [{ from, to, insert: random() < 0.2 ? '' : pick(pieces) }];
          if (random() < 0.3) {
            const at = Math.floor(random() * (len + 1));
            if (at < from - 1 || at > to + 1) changes.push({ from: at, insert: 'q' });
          }
          state = settled(state, { changes });
          expectKept(state, `run ${run} step ${step} ${JSON.stringify(state.doc.toString())}`);
        }
      }
    },
    120_000,
  );
});

describe('what a change builds again', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => `| r${i} | v${i} | w${i} |`);
  const big = ['| a | b | c |', '| - | - | - |', ...rows(300)].join('\n');
  const doc = `Intro.\n\n${big}\n\nMiddle.\n\n${T}\nEnd.`;

  const built = (state: EditorState, changes: ChangeSpec) => {
    layoutStats.rows = 0;
    const next = settled(state, { changes });
    const rows = layoutStats.rows;
    expectKept(next, JSON.stringify(changes));
    return { next, rows };
  };

  it('builds the row typed in, and no other', () => {
    const state = make(doc);
    expect(tablesOf(state)).toHaveLength(2);
    const at = doc.indexOf('r150') + 2;
    const { rows: count } = built(state, { from: at, insert: 'x' });
    expect(count).toBe(1);
    // Nothing is built for text outside the tables.
    expect(built(state, { from: doc.indexOf('Middle'), insert: 'x' }).rows).toBe(0);
    // A caret move builds nothing either.
    layoutStats.rows = 0;
    state.update({ selection: { anchor: at } });
    expect(layoutStats.rows).toBe(0);
  });

  it('keeps the drawing of the rows and tables it does not touch', () => {
    const state = make(doc);
    const before = layoutOfState(state);
    const { next } = built(state, { from: doc.indexOf('r150') + 2, insert: 'x' });
    const after = layoutOfState(next);
    const values = (set: RangeSet<RangeValue>, from: number, to: number) => {
      const found: RangeValue[] = [];
      set.between(from, to, (_a, _b, value) => void found.push(value));
      return found;
    };
    // A row above the typing, a row below it, and the other table (which the text moved).
    const row10 = doc.indexOf('r10 ');
    const [above] = values(before.cells, row10, row10 + 2);
    expect(above).toBeDefined();
    expect(values(after.cells, row10, row10 + 2)[0]).toBe(above);
    const second = doc.indexOf('| a | b |\n| - | :-:');
    const [other] = values(before.decorations, second, second + 1);
    expect(other).toBeDefined();
    expect(values(after.decorations, second + 1, second + 2)[0]).toBe(other);
  });

  it('builds a table whose shape changes, and no other', () => {
    const state = make(doc);
    const first = tablesOf(state)[0]!;
    // A row added: the table, whole.
    const added = built(state, { from: first.to, insert: '\n| n1 | n2 | n3 |' });
    expect(added.rows).toBe(first.rows.length + 1);
    // A line break written in a row splits it into two rows: the table.
    const split = built(state, { from: doc.indexOf('r150') + 2, insert: '\n' });
    expect(split.rows).toBeGreaterThan(300);
    expect(split.rows).toBeLessThan(310);
    // The delimiter row typed in: the table, whole.
    const delimiter = built(state, { from: doc.indexOf('| - | - | - |') + 2, insert: ':' });
    expect(delimiter.rows).toBe(first.rows.length);
    // The small table gets only its own rows.
    const second = tablesOf(state)[1]!;
    const small = built(state, { from: second.to, insert: '\n| z | z |' });
    expect(small.rows).toBe(second.rows.length + 1);
  });

  it('builds a table that is new, whole, and takes out one that is gone', () => {
    const state = make(doc);
    const made = built(state, { from: 0, insert: '| n |\n| - |\n| 1 |\n\n' });
    expect(made.rows).toBe(2);
    expect(tablesOf(made.next)).toHaveLength(3);
    const first = tablesOf(state)[0]!;
    const gone = built(state, { from: first.from, to: first.to });
    expect(gone.rows).toBe(0);
    expect(tablesOf(gone.next)).toHaveLength(1);
  });
});
