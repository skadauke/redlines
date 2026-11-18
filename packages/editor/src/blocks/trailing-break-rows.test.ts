// @vitest-environment happy-dom
// Seed 27 of the bare-marker walks, as hand cases (#17): Return at a bare marker, text typed, Return
// again, and a quote's Return at the end of text that another person's insertion ends. A line break
// that a widened replacement of a unit in a container ends in is never written as a blank line the
// file didn't have: every row is held to the suite's invariants, the stray blank line among them.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

describe('a widened replacement that ends in a line break, in a container', () => {
  scriptRows([
    {
      name: 'seed 27: a bare marker, Return, typing, Return',
      doc: '* text note⏎  - gamma⏎* delta text⏎*‸⏎⏎code plan',
      keys: ['Enter', { type: 'a' }, 'Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'seed 27, with the walk starting by Undo',
      doc: '* text note⏎* delta text⏎*‸⏎⏎code plan',
      keys: ['Mod-Shift-z', 'Enter', { type: 'a' }, 'Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'Return at the end of a quote paragraph that ends in another person’s insertion',
      doc: '> A⏎> x <ins>beta delta‸</ins>⏎⏎Next',
      keys: ['Enter'],
      tc: true,
      others: 'bo',
      expect: {},
    },
  ]);
});
