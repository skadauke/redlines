// @vitest-environment happy-dom
// Walk seeds of the Stage 2 walks that were ⌥↑ and ⌥↓ block moves (#1052), each as a hand row.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

const LEDGER =
  '⏎⏎<!-- redlines⏎version: 1⏎comments:⏎  k6hg:⏎    by: bo⏎    at: 2026-11-01T10:00Z⏎    text: |-⏎      Why?⏎-->⏎';

const TWO =
  '⏎⏎<!-- redlines⏎version: 1⏎comments:⏎  k6hg:⏎    by: bo⏎    at: 2026-11-01T10:00Z⏎    text: |-⏎      Why?⏎  k6hj:⏎    by: bo⏎    at: 2026-11-01T10:00Z⏎    text: |-⏎      No⏎-->⏎';

describe('walk seed 134: ⌥↓ then ⌥↑ over an item that holds a comment', () => {
  const doc = `1. ‸alpha <!--cmt k6hg-->delta<!--/k6hg--> x⏎2. beta${LEDGER}`;
  scriptRows([
    {
      name: 'a comment inside the item (the reduction), Track Changes off',
      doc,
      keys: ['Alt-ArrowDown', 'Alt-ArrowUp'],
      tc: false,
      expect: {},
    },
    {
      name: 'a comment in the item the run passes: that item moves, ⌥↓',
      doc: `1. ‸alpha x⏎2. beta <!--cmt k6hg-->delta<!--/k6hg--> y${LEDGER}`,
      keys: ['Alt-ArrowDown'],
      tc: false,
      expect: {
        file: '2. beta <!--cmt k6hg-->delta<!--/k6hg--> y⏎1. alpha x',
      },
    },
    {
      name: 'a comment in each of the two items',
      doc: `1. ‸alpha <!--cmt k6hg-->x<!--/k6hg-->⏎2. beta <!--cmt k6hj-->delta<!--/k6hj--> y${TWO}`,
      keys: ['Alt-ArrowDown', 'Alt-ArrowUp'],
      tc: false,
      expect: {},
    },
  ]);
});
