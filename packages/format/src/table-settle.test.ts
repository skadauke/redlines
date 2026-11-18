// A comment or a highlight beside a pending change of a table never makes a decision of it impossible
// (#376, #396): swept over the operations on rows and columns, bare and piped tables, and ranges of the
// newest view, each ending where an editor puts it.
import { expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { addHighlight } from './highlights.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import { readTables } from './table.ts';
import { ada, bo, context, expectNoDecisionRefused, file } from './test-helpers.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { newestView } from './views.ts';

type W<T> = T extends unknown ? Omit<T, 'table'> : never;
const LINES = ['red | Apples | x', '--- | --- | ---', 'a b | c d | e f', 'g h | i j | k l'];
const LAYOUTS: Record<string, string[]> = {
  bare: LINES,
  piped: LINES.map((l) => `| ${l} |`),
};
const OPS: [string, W<TableOp>][] = [
  ['insRow', { kind: 'insertRows', after: 1, count: 1 }],
  ['delRow', { kind: 'deleteRows', rows: [1] }],
  ['delRow2', { kind: 'deleteRows', rows: [2] }],
  ['moveRow', { kind: 'moveRows', rows: [1], to: 3 }],
  ['insCol', { kind: 'insertCols', after: 1, count: 1 }],
  ['delCol', { kind: 'deleteCols', cols: [1] }],
  ['delCol0', { kind: 'deleteCols', cols: [0] }],
  ['moveCol', { kind: 'moveCols', cols: [0], to: 2 }],
  ['align', { kind: 'align', cols: [1], align: 'right' }],
];
it(
  'leaves every decision of a table change possible beside a comment or a highlight, wherever it ends',
  { timeout: 600_000 },
  () => {
    const fails: Record<string, number> = {};
    const samples: Record<string, string> = {};
    let total = 0;
    for (const lines of Object.values(LAYOUTS)) {
      const base = file(lines.join('\n') + '\n\nAfter.\n');
      for (const [opName, op] of OPS) {
        let pending: string;
        try {
          const table = readTables(base, parse(base))[0]?.from ?? 0;
          pending = applyChanges(
            base,
            tableEdit(base, { ...op, table }, context(bo, ['n3pq', 'r4st', 't5vw', 'v6xz']))
              .changes,
          );
        } catch {
          continue;
        }
        const view = newestView(pending);
        const b = view.text;
        const step = 5;
        for (let vfrom = 0; vfrom < b.length; vfrom += step) {
          for (const vto of [vfrom + 1, vfrom + 9, vfrom + 30]) {
            if (vto > b.length) continue;
            const from = view.map.toSource(vfrom, 1);
            const to = Math.max(from, view.map.toSource(vto, -1));
            for (const kind of ['comment', 'highlight']) {
              let text: string;
              try {
                const c =
                  kind === 'comment'
                    ? addComment(pending, { from, to }, 'n', context(ada, ['q6rs'])).changes
                    : addHighlight(pending, { from, to }, context(ada, ['q6rs'])).changes;
                text = applyChanges(pending, c);
              } catch (e) {
                if (!(e instanceof EditError)) throw e;
                continue;
              }
              total++;
              try {
                expectNoDecisionRefused('s', text);
                expectEveryOrderRead('s', text);
              } catch (e) {
                const key = `${opName} ${kind} ${String(e)
                  .split('\n')[0]!
                  .replace(/after \[.*?\]/, '')
                  .slice(0, 90)}`;
                fails[key] = (fails[key] ?? 0) + 1;
                samples[key] ??=
                  `${from}-${to} ${String(e).split('\n')[0]!.slice(0, 160)}\n${text.replace(/\n<!-- redlines[\s\S]*/, '')}`;
              }
            }
          }
        }
      }
    }
    expect(fails, JSON.stringify(samples, null, 1)).toEqual({});
    expect(total).toBeGreaterThan(500);
  },
);
