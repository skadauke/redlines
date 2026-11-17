// @vitest-environment happy-dom
// Return twice at the end of an item whose marker is followed by two spaces (#464): the first
// Return writes the break and the new line's syntax in an insertion (the second space is its
// text), and the second goes up a level inside it, as with one space.
import { describe } from 'vitest';
import { type Script, scriptRows } from './script.ts';

describe('Return twice after a marker with two spaces (#464)', () => {
  scriptRows(
    [false, true].map((tc): Script => ({
      name: `1. a, nested "-  b", Return twice, Track Changes ${tc ? 'on' : 'off'}`,
      doc: '1. a⏎   -  b‸',
      keys: ['Enter', 'Enter'],
      tc,
      expect: { file: tc ? '1. a⏎   -  b<ins><split>⏎2. </ins>' : '1. a⏎   -  b⏎2. ' },
    })),
  );
});
