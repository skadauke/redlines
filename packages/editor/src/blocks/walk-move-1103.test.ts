// @vitest-environment happy-dom
// A block move that leaves a bare marker (an empty item) under a line of text, where it can't start
// a list (#1103), each walk seed as the smallest script that shows it.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

describe('an empty item moved to the top of a list under text (#1103)', () => {
  scriptRows([
    {
      name: 'seed 284: Delete empties the last item, ⌥↑ moves it first',
      doc: 'tags:⏎- a⏎- ‸b',
      keys: ['Delete', 'Alt-ArrowUp'],
      tc: false,
      expect: {},
    },
    {
      name: 'seed 63: ⌥↓ moves the first item after the empty one, numbered',
      doc: 'delta⏎ 1. gamma‸⏎ 2. ',
      keys: ['Alt-ArrowDown'],
      tc: false,
      expect: {},
    },
    {
      name: 'the empty item moved up under text, Track Changes on',
      doc: 'tags:⏎- a⏎- ‸b',
      keys: ['Delete', 'Alt-ArrowUp'],
      tc: true,
      expect: {},
    },
    {
      name: 'a list in front matter, spaces after the marker',
      doc: '---⏎tags:⏎- a⏎- ‸b⏎---⏎⏎text',
      keys: ['Tab', 'Backspace', 'Alt-ArrowUp'],
      tc: false,
      expect: {},
    },
    {
      name: 'in a quote',
      doc: '> tags:⏎> - a⏎> - ‸b',
      keys: ['Delete', 'Alt-ArrowUp'],
      tc: false,
      expect: {},
    },
    {
      name: 'the same, bulleted, Track Changes on',
      doc: 'delta⏎- gamma‸⏎- ',
      keys: ['Alt-ArrowDown'],
      tc: true,
      expect: {},
    },
  ]);
});

const LEDGER =
  '⏎⏎<!-- redlines⏎version: 1⏎marks:⏎  cggm: {by: ada, at: 2026-11-01T10:00Z}⏎  gd5s: {by: ada, at: 2026-11-01T10:00Z}⏎comments:⏎  qb7g:⏎    by: bo⏎    at: 2026-11-01T10:00Z⏎    text: |-⏎      Why?⏎-->⏎';

describe('the walks’ reductions (#1103)', () => {
  scriptRows([
    {
      name: 'seed 284: an item of a front matter list, Tab, Backspace, Tab, Delete, ⌥↑',
      doc: '---⏎tags:⏎- ‸b⏎...',
      keys: ['Tab', 'Backspace', 'Tab', 'Delete', 'Alt-ArrowUp'],
      tc: false,
      expect: {},
    },
    {
      name: 'seed 63: ⌥↓, ←, ⌥↑, typing, Tab in a sublist',
      doc: '* delta beta delta delta beta⏎   1. text plan delta⏎     review gamma‸⏎   2. alpha plan code',
      keys: ['Alt-ArrowDown', 'ArrowLeft', 'Alt-ArrowUp', { type: 'new words ' }, 'Tab'],
      tc: false,
      expect: {
        refusal: "The first item of a list can't be indented: there is no item to put it under.",
      },
    },
    {
      name: 'seed 57: ⌥↑, Return, Shift-Tab, typing, Tab; Track Changes on',
      doc: '* note delta beta review text code note⏎         delta delta delta delta review⏎<div>⏎    code beta‸',
      keys: ['Alt-ArrowUp', 'Enter', 'Shift-Tab', { type: 'x' }, 'Tab'],
      tc: true,
      expect: {},
    },
    {
      name: 'seed 35: Return, ⌥↑ on an item with marks, an empty item below',
      doc:
        '1. ‸delta <!--cmt qb7g-->foo**a-b**baz <!--hl cggm-->éclair<!--/cggm--><!--/qb7g--> <!--del gd5s éclair-->⏎2. ' +
        LEDGER,
      keys: ['Enter', 'Alt-ArrowUp'],
      tc: false,
      expect: {},
    },
    {
      name: 'seed 300: ⌥↑, →, Tab, Delete, Tab over a fence',
      doc: '```⏎```⏎* ship plan delta⏎  > delta alpha text beta⏎          ```⏎    3. ship alpha review delta plan⏎```⏎    text ship gamma‸',
      keys: ['Alt-ArrowUp', 'ArrowRight', 'Tab', 'Delete', 'Tab'],
      tc: false,
      expect: {},
    },
  ]);
});
