import { describe, expect, it } from 'vitest';
import { file } from './test-helpers.ts';
import { originalRowText } from './table-ops.ts';
import { readTables } from './table.ts';
import { parse } from './parse.ts';

const ROWS = 300;
const L = 'bcdfghjkmnpqrstvwxz';
const idOf = (prefix: string, i: number) =>
  `${prefix}${L[Math.floor(i / 361) % 19]}${L[Math.floor(i / 19) % 19]}${L[i % 19]}`;
const ids = Array.from({ length: ROWS }, (_, i) => idOf('b', i));
const body = [
  '| a | b |',
  '| - | - |',
  ...ids.map((id, i) => `| row ${i} | ${i}<!--ins ${id}-->x<!--/${id}--> |`),
].join('\n');
const text = file(body, Object.fromEntries(ids.map((id) => [id, 'ada'])));

describe('the original text of the rows of a table in which every row holds a pending change', () => {

  // A timing test: it runs with REDLINES_COST set, as the other cost tests do.
  it.skipIf(!process.env['REDLINES_COST'])(
    'costs at most 10 times a parse, for all 300 rows',
    () => {
      const time = (run: () => void) => {
        const start = performance.now();
        run();
        return performance.now() - start;
      };
      const parseCost = Math.min(...Array.from({ length: 3 }, () => time(() => parse(text))));
      const cost = Math.min(
        ...Array.from({ length: 3 }, () => {
          // A text of its own each time: the view built for the last one is not reused.
          const fresh = `${text}\n`;
          return time(() => {
            const read = parse(fresh);
            for (const row of readTables(fresh, read)[0]!.rows) originalRowText(fresh, read, row);
          });
        }),
      );
      expect(cost).toBeLessThan(parseCost * 10);
    },
  );
});
