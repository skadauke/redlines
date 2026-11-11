import { describe, expect, it } from 'vitest';
import { suggestReplace } from './agent.ts';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { diffTables, ROWS_AND_COLUMNS } from './table-diff.ts';
import {
  claudeAda,
  bodyOf,
  context,
  expectEveryOrderAlike,
  exactly,
  expectInOrder,
  file,
} from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

const T = (...rows: string[]) => ['| Fruit | Count |', '| ----- | ----- |', ...rows].join('\n');
const APPLES = '| Apples | 3 |';
const PEARS = '| Pears | 5 |';
const PLUMS = '| Plums | 7 |';
const ctx = (ids = ['k3x9', 'w8nn', 'p5qm', 'q6rs', 'c2dd', 'f3gg']) => context(claudeAda, ids);
const run = (body: string, from: string, to: string, marks: Record<string, string> = {}) => {
  const text = file(`Intro.\n\n${body}\n\nAfter.`, marks);
  const done = suggestReplace(text, from, to, ctx());
  return { text, after: applyChanges(text, done.changes), done };
};

describe('diffTables', () => {
  it('finds an added, a removed, a moved and a changed row', () => {
    const add = diffTables(T(APPLES), T(APPLES, PEARS));
    expect(add && 'ops' in add && add.ops).toEqual([
      { kind: 'insertRows', table: 0, after: 1, count: 1, texts: [['Pears', '5']] },
    ]);
    const del = diffTables(T(APPLES, PEARS), T(PEARS));
    expect(del && 'ops' in del && del.ops).toEqual([{ kind: 'deleteRows', table: 0, rows: [1] }]);
    const move = diffTables(T(APPLES, PEARS, PLUMS), T(PLUMS, APPLES, PEARS));
    expect(move && 'ops' in move && move.ops).toEqual([
      { kind: 'moveRows', table: 0, rows: [3], to: 1 },
    ]);
    const change = diffTables(T(APPLES, PEARS), T(APPLES, '| Pears | 6 |', PLUMS));
    expect(change && 'ops' in change && change.cells).toEqual([
      { row: 2, column: 1, from: '5', to: '6' },
    ]);
  });

  it('says nothing for one cell changed, and for columns alone, and refuses both together', () => {
    expect(diffTables(T(APPLES), T('| Apples | 4 |'))).toBeNull();
    expect(
      diffTables(T(APPLES), '| Fruit | Count | Color |\n| - | - | - |\n| Apples | 3 | red |'),
    ).toBeNull();
    expect(
      diffTables(
        T(APPLES),
        '| Fruit | Count | Color |\n| - | - | - |\n| Apples | 3 | red |\n| Pears | 5 | green |',
      ),
    ).toEqual({ refused: ROWS_AND_COLUMNS });
  });
});

describe('an agent’s str_replace over a table', () => {
  it('adds a row as a row insertion, with its cells', () => {
    const { after, text } = run(T(APPLES), T(APPLES), T(APPLES, PEARS));
    expect(bodyOf(after)).toContain('| Apples | 3 |\n| <!--ins k3x9 row--> Pears | 5 |');
    expectInOrder('added', [], after);
    expect(newestView(after).text.trim()).toBe(`Intro.\n\n${T(APPLES, PEARS)}\n\nAfter.`);
    expect(bodyOf(applyChanges(after, rejectAll(after))).trim()).toBe(bodyOf(text).trim());
    expect(parse(after).ledger.marks['k3x9']?.by).toBe('claude-ada');
  });

  it('removes a row as a row deletion, and a reordered row as a move', () => {
    const del = run(T(APPLES, PEARS), T(APPLES, PEARS), T(APPLES));
    expect(bodyOf(del.after)).toContain('<!--del k3x9 row=2 \\| Pears \\| 5 \\|-->');
    expect(originalView(del.after).text).toBe(originalView(del.text).text);
    const move = run(T(APPLES, PEARS, PLUMS), T(APPLES, PEARS, PLUMS), T(PLUMS, APPLES, PEARS));
    expect(
      parse(move.after)
        .marks.map((m) => m.kind)
        .sort(),
    ).toEqual(['del', 'ins']);
    expect(newestView(move.after).text).toContain(
      T(PLUMS, APPLES, PEARS).replace('| Fruit', '| Fruit'),
    );
    expectEveryOrderAlike('move', move.after, exactly);
  });

  it('writes a row added and a cell changed in one group, as word marks in the cell', () => {
    const { after } = run(
      T(APPLES, PEARS),
      T(APPLES, PEARS),
      T(APPLES, '| Pears | 6 |', PLUMS),
    );
    const marks = parse(after).marks;
    expect(marks.map((m) => m.kind).sort()).toEqual(['ins', 'sub']);
    expect(bodyOf(after)).toMatch(/<!--ins \w{4} row--> Plums \| 7 \|/);
    expect(newestView(after).text.trim()).toBe(
      `Intro.\n\n${T(APPLES, '| Pears | 6 |', PLUMS)}\n\nAfter.`,
    );
    expectEveryOrderAlike('row and cell', after, exactly);
    expect(applyChanges(after, acceptAll(after))).toContain('| Plums | 7 |');
  });

  it('works in a CRLF file', () => {
    const text = file(
      `Intro.\r\n\r\n${T(APPLES).replaceAll('\n', '\r\n')}\r\n\r\nAfter.`,
    ).replaceAll(/\r?\n/g, '\r\n');
    const done = suggestReplace(
      text,
      T(APPLES).replaceAll('\n', '\r\n'),
      T(APPLES, PEARS).replaceAll('\n', '\r\n'),
      ctx(),
    );
    const after = applyChanges(text, done.changes);
    expect(bodyOf(after)).toContain('| Apples | 3 |\r\n| <!--ins k3x9 row--> Pears | 5 |');
    expect(bodyOf(after).replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it('refuses rows and columns changed together, and writes an edit in one cell as before', () => {
    const text = file(`${T(APPLES)}`);
    expect(() =>
      suggestReplace(
        text,
        T(APPLES),
        '| Fruit | Count | Color |\n| - | - | - |\n| Apples | 3 | red |\n| Pears | 5 | green |',
        ctx(),
      ),
    ).toThrow(new EditError(ROWS_AND_COLUMNS, 'no-legal-placement'));
    const cell = suggestReplace(text, T(APPLES), T('| Apples | 4 |'), ctx());
    expect(applyChanges(text, cell.changes)).toContain('<!--sub');
    expect(accept).toBeDefined();
  });
});
