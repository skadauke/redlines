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

describe('walk seed 150: ⌥↑ on the first row of a table, with a deletion in it', () => {
  const table = '| a | b |⏎| - | - |⏎| plan | code‸ |';
  scriptRows([
    {
      name: 'Backspace in the cell, then the row moves up above the header row, Track Changes on',
      doc: `One.⏎⏎${table}⏎⏎* alpha`,
      keys: ['Backspace', 'Alt-ArrowUp'],
      tc: true,
      expect: {},
    },
    {
      name: 'Tab to the next cell, Backspace over its whole text, ⌥↑ (the seed)',
      doc: `One.⏎⏎| a | b |⏎| - | - |⏎| ‸plan | code |⏎⏎* alpha`,
      keys: ['Tab', 'Backspace', 'Alt-ArrowUp'],
      tc: true,
      expect: {},
    },
    {
      name: 'the same with no key before it',
      doc: `One.⏎⏎${table}⏎⏎* alpha`,
      keys: ['Alt-ArrowUp'],
      tc: true,
      expect: {},
    },
    {
      name: 'the row moves down, with a deletion in it',
      doc: `One.⏎⏎| a | b |⏎| - | - |⏎| plan | code‸ |⏎| x | y |⏎⏎* alpha`,
      keys: ['Backspace', 'Alt-ArrowDown'],
      tc: true,
      expect: {},
    },
  ]);
});

describe('walk seed 159: ⌥↓, Return, then Tab on an item with a sublist', () => {
  // The item the move wrote is the author's own pending insertion, so Tab edits its text and writes
  // no mark; under the empty item that Return left (its pending split on its line, a blank line
  // between) the file would read the item as nested and the text as not. Tab says why it does
  // nothing, and the item stays where it was.
  const reason =
    "This item can't go under the empty item above it: Markdown ends an empty item at a blank line, so the file would read it as nested and the text as not. Type in that item first.";
  scriptRows([
    {
      name: 'the seed’s lists, cut to the items around it',
      doc: '1. delta plan⏎+ ‸alpha review⏎  - plan ship⏎⏎+ text alpha⏎  1) beta review⏎⏎  1) review plan⏎',
      keys: ['Alt-ArrowDown', 'Enter', 'Tab'],
      tc: true,
      expect: { refusal: reason },
    },
    {
      name: 'cut to two items',
      doc: '+ ‸alpha review⏎  - plan ship⏎⏎+ text alpha⏎',
      keys: ['Alt-ArrowDown', 'Enter', 'Tab'],
      tc: true,
      expect: { refusal: reason },
    },
  ]);
});
