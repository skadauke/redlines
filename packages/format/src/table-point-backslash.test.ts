// A comment's point that a decision writes (format §3.7, rule 4) is not written right after a backslash,
// where the backslash would escape its marker and the file would read otherwise than its newest view
// (#476): it goes in front of the backslash, the comment moves by one character, and nothing is
// escaped or added. Every order of decisions reads alike, judged by micromark.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { parse } from './parse.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { ada, bodyOf, context, expectNoDecisionRefused, file, thread } from './test-helpers.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import { newestView } from './views.ts';

const trim = (text: string) => bodyOf(text).replace(/\s+$/, '');

/** The issue's file: Bo's inserted column `c2dd`, with Bo's comment `c9qf` in a cell of it, after a
 * column whose text ends in a backslash. */
const ISSUE = file(
  [
    '| Fruit | Count\\ | <!--ins c2dd col--> <!--cmt c9qf-->New<!--/c9qf--> |',
    '| ----- | ----- | --- |',
    '| Apples | 3 |  |',
  ].join('\n'),
  { c2dd: 'bo' },
  thread('c9qf', 'bo', 'A note.'),
);

describe('a comment point a decision writes goes in front of a backslash (#476)', () => {
  it('rejecting the inserted column puts the point before the backslash, and the file reads as the newest view', () => {
    const after = applyChanges(ISSUE, reject(ISSUE, 'c2dd'));
    expect(trim(after).split('\n')[0]).toBe('| Fruit | Count<!--cmt c9qf-->\\ |');
    // The text of the cell is the newest view's, a backslash at the end.
    expect(newestView(after).text).toContain('| Fruit | Count\\ |');
    expect(parse(after).marks.map((m) => m.id)).toContain('c9qf');
  });

  it('is the same in every order of decisions, and no decision is refused', () => {
    expectNoDecisionRefused('backslash before the point', ISSUE);
    expectEveryOrderRead('backslash before the point', ISSUE);
  });

  it('keeps a backslash that is itself escaped, and an escaped pair, where the marker is not escaped', () => {
    for (const [cell, written] of [
      ['Count\\\\', 'Count\\\\<!--cmt c9qf-->'],
      ['Count\\\\\\', 'Count\\\\<!--cmt c9qf-->\\'],
    ] as const) {
      const text = ISSUE.replace('Count\\', cell);
      const after = applyChanges(text, reject(text, 'c2dd'));
      expect(trim(after).split('\n')[0], cell).toBe(`| Fruit | ${written} |`);
      expectEveryOrderRead(cell, text);
    }
  });

  it('holds when the column that leaves is deleted by a person', () => {
    // Ada deletes the column that Bo's comment is in, tracked; accepting it writes the point.
    const text = file(
      [
        '| Fruit | Count\\ | New <!--cmt c9qf-->x<!--/c9qf--> |',
        '| ----- | ----- | --- |',
        '| Apples | 3 |  |',
      ].join('\n'),
      {},
      thread('c9qf', 'bo', 'A note.'),
    );
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const op = { kind: 'deleteCols', cols: [2], table } as TableOp;
    const made = applyChanges(
      text,
      tableEdit(text, op, context(ada, ['d4ee', 'd5ff', 'd6gg', 'd7hh', 'd8ii'])).changes,
    );
    for (const id of parse(made)
      .marks.filter((m) => m.kind === 'del')
      .map((m) => m.id)) {
      const accepted = applyChanges(made, accept(made, id));
      expect(trim(accepted).split('\n')[0]).toBe('| Fruit | Count<!--cmt c9qf-->\\ |');
    }
    expectNoDecisionRefused('deleted column', made);
    expectEveryOrderRead('deleted column', made);
  });

  it('holds for the point of a comment in a row that leaves, below a row that ends in a backslash', () => {
    const text = file(
      [
        '| Fruit | Count\\ |',
        '| ----- | ----- |',
        '| Apples | <!--cmt c9qf-->3<!--/c9qf--> |',
      ].join('\n'),
      {},
      thread('c9qf', 'bo', 'A note.'),
    );
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const op = { kind: 'deleteRows', rows: [1], table } as TableOp;
    const made = applyChanges(text, tableEdit(text, op, context(ada, ['d4ee', 'd5ff'])).changes);
    const del = parse(made).marks.find((m) => m.kind === 'del');
    expect(del).toBeDefined();
    const accepted = applyChanges(made, accept(made, del?.id ?? ''));
    expect(trim(accepted)).toContain('| Fruit | Count<!--cmt c9qf-->\\ |');
    expectNoDecisionRefused('deleted row', made);
    expectEveryOrderRead('deleted row', made);
  });
});
