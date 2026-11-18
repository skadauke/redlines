// The cost of placing a comment or a highlight in a long reviewed document: 500 pending changes, half of them
// in tables (#376). A comment outside a table needs no check of decisions, and one in a table checks only the
// decisions of the tables its range touches. Timing runs only with REDLINES_COST=check, as the other cost tests.
import { describe, expect, it } from 'vitest';
import { addComment } from './comments.ts';
import { addHighlight } from './highlights.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';

const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = 'bcdfghjkmnpqrstvwxz23456789';
const ids = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `${FIRST[Math.floor(i / 729) % FIRST.length]}${REST[Math.floor(i / 27) % 27]}${REST[i % 27]}b`,
  );

function manuscript(): { text: string; inTable: number; outside: number } {
  const all = ids(500);
  const marks: Record<string, string> = {};
  for (const id of all) marks[id] = 'bo';
  let next = 0;
  const parts: string[] = [];
  for (let t = 0; t < 5; t++) {
    const rows = ['| a | b |', '| --- | --- |'];
    for (let r = 0; r < 50; r++) rows.push(`| <!--ins ${all[next++]} row--> x${r} | y${r} |`);
    parts.push(rows.join('\n'));
  }
  for (let p = 0; p < 250; p++) {
    const id = all[next++];
    parts.push(`Paragraph ${p} has <!--ins ${id}-->new text<!--/${id}--> in it.`);
  }
  const text = file(parts.join('\n\n') + '\n', marks);
  const body = bodyOf(text);
  return { text, inTable: body.indexOf('x7') + 1, outside: body.indexOf('Paragraph 100') + 3 };
}

const check = process.env['REDLINES_COST'] === 'check';

describe('placing a comment among 500 pending changes, half of them in tables', () => {
  const { text, inTable, outside } = manuscript();
  const time = (run: () => unknown) => {
    run();
    const start = performance.now();
    for (let i = 0; i < 3; i++) run();
    return (performance.now() - start) / 3;
  };
  it('places a comment in a table cell and outside any table', () => {
    const a = addComment(text, { from: inTable, to: inTable + 2 }, 'n', context(ada, ['q6rs']));
    const b = addComment(text, { from: outside, to: outside + 4 }, 'n', context(ada, ['q7rs']));
    expect(a.changes.length).toBeGreaterThan(0);
    expect(b.changes.length).toBeGreaterThan(0);
  });
  it.skipIf(!check)('takes little time', () => {
    const inside = time(() =>
      addComment(text, { from: inTable, to: inTable + 2 }, 'n', context(ada, ['q6rs'])),
    );
    const apart = time(() =>
      addComment(text, { from: outside, to: outside + 4 }, 'n', context(ada, ['q7rs'])),
    );
    const marked = time(() =>
      addHighlight(text, { from: inTable, to: inTable + 2 }, context(ada, ['q8rs'])),
    );
    process.stderr.write(
      `settle cost: in a table ${inside.toFixed(1)} ms, outside ${apart.toFixed(1)} ms, highlight ${marked.toFixed(1)} ms\n`,
    );
    expect(inside).toBeLessThan(150);
    expect(apart).toBeLessThan(50);
    expect(marked).toBeLessThan(150);
  });
});
