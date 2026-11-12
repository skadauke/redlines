// A pending bold change in a table, a row move, and a typed edit at the end of the bold (#280, #295).
// The typed text is written as a change of the closing `**` too, whose old text then holds the `**`
// of the format change. Rejecting the format change first would leave that `**` in the old text, and
// rejecting the edit would write it back as text; where the row is the move's inserted row, the
// original view leaves the row out and could not see it. Every order of decisions reads alike,
// judged exactly (and against micromark): the format change is decided after the edit, which is
// said in words, wherever the row is.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { addComment } from './comments.ts';
import { trackedFormat } from './formatting.ts';
import { tableEdit } from './table-ops.ts';
import { trackedEdit } from './track.ts';
import {
  ada,
  blockLeaves,
  bo,
  claudeAda,
  context,
  exactly,
  everyOrder,
  expectEveryOrderAlike,
  file,
} from './test-helpers.ts';
import type { Person } from './types.ts';

const bold = (text: string, from: number, to: number, who: Person, id: string) =>
  applyChanges(
    text,
    trackedFormat(
      text,
      { from, to },
      { kind: 'inline', format: 'bold', on: true },
      context(who, [id]),
    ).changes,
  );

const move = (text: string, rows: number[], to: number, who: Person, ids: string[]) =>
  applyChanges(
    text,
    tableEdit(text, { kind: 'moveRows', table: 0, rows, to }, context(who, ids)).changes,
  );

/** `typed` typed in `after`, `where` characters from the start of `find` in the body. */
const type = (
  text: string,
  find: string,
  where: number,
  typed: string,
  who: Person,
  id: string,
) => {
  const at = text.indexOf(find) + where;
  return applyChanges(
    text,
    trackedEdit(text, { from: at, to: at, insert: typed }, context(who, [id, 'x7yz', 'y8za'])),
  );
};

const refused = (text: string, id: string, how: typeof accept | typeof reject): string | null => {
  try {
    how(text, id);
    return null;
  } catch (error) {
    if (error instanceof EditError) return error.message;
    throw error;
  }
};

describe('a typed edit at the end of a bold change, in a row that a move writes', () => {
  // Seed 3 of table-rows-random: leading pipes only.
  const seed3 = () => {
    let t = file('| alpha | alpha\n| -- | --\n| alpha | café\n| b | café\n| 11 | 11\n| x y | x\n');
    t = bold(t, 3, 6, ada, 'p5qm');
    t = move(t, [0], 4, ada, ['h4jj', 'd8fg']);
    t = type(t, 'lph**', 5, 'q', claudeAda, 'k3x9');
    return type(t, 'alpha', 2, 'q', bo, 'g9hj');
  };
  // Seed 2026 of table-cols-random: pipes at both edges, the bold change by Bo.
  const seed2026 = () => {
    let t = file(
      '| café | café |\n| :-: | -: |\n| alpha | café |\n| café | café |\n| 11 | 11 |\n| x y | alpha |\n',
    );
    t = bold(t, 32, 34, bo, 'm5nn');
    t = move(t, [1], 5, ada, ['k3x9', 'b7cd']);
    return type(t, 'lp**', 4, 'q', ada, 'p5qm');
  };
  // #280: Bo types `q` against Ada's bold `x` in a cell that goes on, and a row moves.
  const shape280 = () => {
    let t = file('| x y | z |\n| - | - |\n| a | b |\n| c | d |\n');
    t = bold(t, 2, 3, ada, 'p5qm');
    t = move(t, [0], 3, ada, ['h4jj', 'd8fg']);
    return type(t, 'x**', 3, 'q', bo, 'g9hj');
  };

  it.each([
    ['seed 3 of the row suite', seed3],
    ['seed 2026 of the column suite', seed2026],
    ['#280: Bo types at the end of the bold', shape280],
  ])('%s: every order of decisions reads alike', (label, make) => {
    const text = make();
    expectEveryOrderAlike(label, text, exactly);
    // (and each way of reading it is one table to micromark, as wide as the header)
    const { outcomes } = everyOrder(text, exactly);
    expect(outcomes.size, label).toBeGreaterThan(1);
    for (const [, reads] of outcomes) {
      for (const read of reads) {
        const tables = blockLeaves(read).filter((leaf) => leaf.kind === 'table');
        expect(tables, label).toHaveLength(1);
      }
    }
  });

  it('refuses to reject the bold change while the edit in its row is undecided, with words', () => {
    for (const make of [seed3, seed2026]) {
      const text = make();
      const message = refused(text, make === seed3 ? 'p5qm' : 'm5nn', reject);
      expect(message).toMatch(/Decide the changes next to it first/);
    }
  });

  it('keeps every other decision possible', () => {
    const text = seed3();
    expect(refused(text, 'p5qm', accept)).toBeNull();
    expect(refused(text, 'k3x9', reject)).toBeNull();
    expect(refused(text, 'h4jj', accept)).toBeNull();
    expect(refused(text, 'h4jj', reject)).toBeNull();
  });

  it('refuses nothing else: a bold change in a moved row, or an edit inside it, is decided freely', () => {
    let t = file('| x y | z |\n| - | - |\n| a | b |\n| c | d |\n');
    t = bold(t, 2, 3, ada, 'p5qm');
    t = move(t, [0], 3, ada, ['h4jj', 'd8fg']);
    // Bold with the move pending, and nothing typed.
    for (const how of [accept, reject]) expect(refused(t, 'p5qm', how)).toBeNull();
    // A letter typed inside the bold, or in the cell beside it, is written as a plain insertion.
    for (const [find, where] of [
      ['**x', 2],
      [' y |', 2],
    ] as const) {
      const typed = type(t, find, where, 'q', bo, 'g9hj');
      if (find === '**x') expect(typed).toContain('<!--ins g9hj-->');
      for (const how of [accept, reject]) expect(refused(typed, 'p5qm', how)).toBeNull();
      expectEveryOrderAlike(find, typed, exactly);
    }
  });

  it('writes a comment on the bold of a moved row as before', () => {
    let t = file('| x y | z |\n| - | - |\n| a | b |\n| c | d |\n');
    t = bold(t, 2, 3, ada, 'p5qm');
    t = move(t, [0], 3, ada, ['h4jj', 'd8fg']);
    const at = t.indexOf('**x') + 2;
    t = applyChanges(
      t,
      addComment(t, { from: at, to: at + 1 }, 'A note.', context(bo, ['c2dd'])).changes,
    );
    expectEveryOrderAlike('comment', t, exactly);
  });
});
