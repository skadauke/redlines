import { describe, expect, it } from 'vitest';
import { parse } from './parse.ts';
import { file } from './test-helpers.ts';

const L = 'bcdfghjkmnpqrstvwxz';
const idOf = (i: number) =>
  `m${L[Math.floor(i / 6859) % 19]}${L[Math.floor(i / 361) % 19]}${L[Math.floor(i / 19) % 19]}${L[i % 19]}`;

/** A file whose ledger holds `count` marks, none of them in the body (a reader keeps them all). */
function withMarks(count: number, salt = 0): string {
  const ids = Array.from({ length: count }, (_, i) => idOf(i));
  // A name of its own each time: the YAML of the last ledgers read is kept, and a read of the
  // same text again costs nothing.
  return file('Hello world.', Object.fromEntries(ids.map((id) => [id, 'ada']))).replace(
    'Ada Lovelace',
    `Ada ${salt}`,
  );
}

const time = (run: () => void) => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

describe('reading a ledger of many marks', () => {
  it('rejects a key that a map holds twice', () => {
    const text = file('Hello', { aaaa: 'ada' }).replace('  aaaa: ', '  aaaa: {by: ada}\n  aaaa: ');
    expect(parse(text).warnings.map((w) => w.message)).toEqual([
      'The ledger is not valid YAML: Map keys must be unique',
    ]);
  });

  // A timing test: it runs with REDLINES_COST set, as the other cost tests do.
  it.skipIf(!process.env['REDLINES_COST'])(
    'costs time linear in the marks: 40,000 take at most 8 times what 10,000 take',
    { timeout: 60_000 },
    () => {
      // The yaml package's own check for repeated keys compared every key with every one before
      // it: 12 s for 20,000 marks.
      parse(withMarks(1_000)); // warm up
      let salt = 1;
      const small = Math.min(
        ...Array.from({ length: 3 }, () => {
          const text = withMarks(10_000, salt++);
          return time(() => parse(text));
        }),
      );
      const large = Math.min(
        ...Array.from({ length: 2 }, () => {
          const text = withMarks(40_000, salt++);
          return time(() => parse(text));
        }),
      );
      expect(large).toBeLessThan(small * 8);
    },
  );
});
