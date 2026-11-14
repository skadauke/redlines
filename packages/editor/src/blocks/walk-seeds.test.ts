// @vitest-environment happy-dom
// The walks' findings (`walk.test.ts`, `REDLINES_FUZZ=200`), each as the smallest script that
// shows it. The invariants of the suite are held after every script.
import { describe } from 'vitest';
import { type Script, scriptRows, type Step } from './script.ts';

describe('walk seed 29: an agent’s edit at the very start while the empty paragraph is open', () => {
  scriptRows([
    {
      name: 'prepended, Track Changes off',
      doc: '‸delta *gamma*',
      keys: ['Shift-Enter', { agent: 'The agent wrote this.' }],
      tc: false,
      expect: {
        file: 'The agent wrote this.⏎⏎delta *gamma*',
        caret: 'The agent wrote this.⏎⏎⏎⏎‸delta *gamma*',
      },
    },
    {
      name: 'prepended after taking the first Return back, as the seed has it',
      doc: '‸delta *gamma*',
      keys: [
        'Shift-Enter',
        'Mod-z',
        'Shift-Enter',
        { agent: 'The agent wrote this.' },
        'Shift-ArrowRight',
      ],
      tc: false,
      expect: { file: 'The agent wrote this.⏎⏎delta *gamma*' },
    },
  ]);
});

describe('walk seed 147: a selection that leaves the empty paragraph ends in no hidden text', () => {
  scriptRows([
    {
      name: 'Shift-→ from the empty paragraph after a typed letter, Track Changes on',
      doc: 'alpha‸⏎⏎## text',
      keys: [{ type: 'x' }, 'Shift-Enter', 'Shift-ArrowRight'],
      tc: true,
      expect: { file: 'alpha<ins>x</ins>⏎⏎## text' },
    },
  ]);
});

describe('walk seeds 14 and 170 (lists side by side): the caret ends in no hidden text', () => {
  scriptRows([
    {
      name: 'Backspace after Delete in the first half of a numbered item (seed 14)',
      doc: '2. alpha⏎2. d‸elta plan',
      keys: ['Enter', 'Delete', 'Backspace'],
      tc: true,
      expect: {},
    },
    {
      name: 'Delete at the end of typed text, before the next quoted item (seed 170)',
      doc: '> text⏎> 1) one‸⏎>    more⏎> 1) two',
      keys: [
        { type: 'new words ' },
        'Mod-z',
        'Mod-Shift-z',
        { agent: 'The agent wrote this.' },
        'Delete',
      ],
      tc: true,
      expect: {},
    },
  ]);
});

describe('walk seed 23 (lists side by side): Return at the start of a nested first item of a loose list, tracked', () => {
  // The empty item goes in above the first one, at the end of the parent item's text, with the one
  // blank line that a split's break holds above it. With Track Changes off a loose list also gets a
  // blank line below the new item; tracked, that second blank line would follow the first, and two
  // in a row were written as two splits, the second a marker line in column 0, which ended the
  // parent item (micromark read the sublist as a list of its own). The list is as loose as it was.
  scriptRows([
    {
      name: 'a nested list with a blank line between its items, Track Changes on (the seed)',
      doc: '* plan beta⏎  * ‸note note⏎⏎  * review gamma⏎',
      keys: ['Enter'],
      tc: true,
      expect: { file: '* plan beta<split>⏎⏎  * ⏎  * note note⏎⏎  * review gamma' },
    },
    {
      name: 'the same list with no blank line between its items writes the same form',
      doc: '* plan beta⏎  * ‸note note⏎  * review gamma⏎',
      keys: ['Enter'],
      tc: true,
      expect: { file: '* plan beta<split>⏎⏎  * ⏎  * note note⏎  * review gamma' },
    },
    {
      // The seed's other keys, Backspace, Delete and Shift-Return over the selection, are refused in
      // words, which the walk allows.
      name: 'the seed’s own text: a continuation line, and a loose sublist with a numbered list in it',
      doc: '* note delta⏎* gamma gamma⏎* plan beta⏎  * ‸note note⏎    note delta⏎  * review gamma⏎    2. code plan⏎       delta alpha⏎⏎    2. delta ship⏎       code text⏎',
      keys: ['Enter', 'Shift-ArrowLeft'],
      tc: true,
      expect: {},
    },
    {
      name: 'a numbered nested list, a blank line between its items',
      doc: '1. plan beta⏎   1. ‸note note⏎⏎   2. review gamma⏎',
      keys: ['Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'in a quote',
      doc: '> * plan beta⏎>   * ‸note note⏎>⏎>   * review gamma⏎',
      keys: ['Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'taken back with ⌘Z, and done again',
      doc: '* plan beta⏎  * ‸note note⏎⏎  * review gamma⏎',
      keys: ['Enter', 'Mod-z', 'Mod-Shift-z'],
      tc: true,
      expect: {},
    },
    {
      name: 'Track Changes off writes the blank line below the new item as well',
      doc: '* plan beta⏎  * ‸note note⏎⏎  * review gamma⏎',
      keys: ['Enter'],
      tc: false,
      expect: { file: '* plan beta⏎⏎  * ⏎⏎  * note note⏎⏎  * review gamma⏎' },
    },
  ]);
});

const FM = '---⏎title: Notes⏎---⏎';
const HEAD = '⏎⏎<!-- redlines⏎version: 1⏎';
const mark = (by: string) => `marks:⏎  k6hg: {by: ${by}, at: 2026-11-01T10:00Z}⏎-->⏎`;
const COMMENT =
  'comments:⏎  k6hg:⏎    by: ada⏎    at: 2026-11-01T10:00Z⏎    text: |-⏎      Why?⏎-->⏎';

describe('walk seed 7 (#257): Return over a selection, with a closer between it and the Return', () => {
  // The Return lands after the closer, so the history can't join it to the deletion by adjacency:
  // the record of Returns must not take it for joined, nor Undo for two steps.
  const rows = (front: string, tail: string) =>
    [
      ['a highlight closer, Track Changes off', 'hl', mark('ada'), false],
      ['a comment closer, Track Changes off', 'cmt', COMMENT, false],
      ['another person’s insertion closer, Track Changes off', 'ins', mark('bo'), false],
      ['a highlight closer, Track Changes on', 'hl', mark('ada'), true],
    ].map(([name, kind, ledger, tc]) => ({
      name: `${name}${tail}`,
      doc: `${front}x <!--${kind} k6hg-->abc‸<!--/k6hg-->${HEAD}${ledger}`,
      keys: ['Shift-ArrowLeft', 'Enter'] satisfies Step[],
      tc: tc as boolean,
      expect: {},
    }));
  scriptRows(rows(FM, ''));
  scriptRows(rows('', ', no front matter'));
  scriptRows([
    {
      name: '⌘Z gives the text back exactly (the invariants redo it, too)',
      doc: `${FM}x <!--hl k6hg-->abc‸<!--/k6hg-->${HEAD}${mark('ada')}`,
      keys: ['Shift-ArrowLeft', 'Enter', 'Mod-z'],
      tc: false,
      expect: { file: `${FM}x <!--hl k6hg-->abc<!--/k6hg-->` },
    },
  ]);
});

describe('walk seed 1326 (#292): Return in front of a pending deletion that starts an item’s text, tracked', () => {
  // Delete at the start of an item's text writes the deletion of its first character as the marker
  // alone after the item's marker, the rest of the text on the next line (format §3.3), which the
  // block reading takes for an HTML block that holds only a marker. Return there opened an empty
  // paragraph inside the item, a blank line in front of the marker, which the file reads as a
  // paragraph of the item and the newest view as text after the list: the newest view read
  // `<li></li>` and a paragraph outside, the file `<li><p>…</p></li>`. It is Return at the start of
  // the item's text: an empty item above, the item keeping its pending deletion.
  scriptRows([
    {
      name: 'the walk: Delete, ←, Return at the start of a numbered item (seed 1326)',
      doc: '1) ship⏎2) ‸alpha delta plan',
      keys: ['Delete', 'ArrowLeft', 'Enter'],
      tc: true,
      expect: { file: '1) ship⏎2) <split>⏎3) <del a>⏎   lpha delta plan' },
    },
    {
      name: 'a bullet item',
      doc: '- ship⏎- ‸alpha delta plan',
      keys: ['Delete', 'ArrowLeft', 'Enter'],
      tc: true,
      expect: { file: '- ship⏎- <split>⏎- <del a>⏎  lpha delta plan' },
    },
    {
      name: 'the item is the first of its list, under text',
      doc: 'Text.⏎⏎- ‸alpha delta plan⏎- beta',
      keys: ['Delete', 'ArrowLeft', 'Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'a nested item',
      doc: '- ship⏎  - ‸alpha delta plan',
      keys: ['Delete', 'ArrowLeft', 'Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'another person’s deletion starts the text',
      doc: '- ship⏎- ‸<del a>lpha delta plan',
      keys: ['Enter'],
      tc: true,
      others: 'bo',
      expect: {},
    },
  ]);
});

describe('walk seed 1141 (#292): Delete over the only character of a paragraph’s first line', () => {
  // The paragraph the Return made starts with `a`, a line of its own, and Delete took the letter and
  // left an empty first line: two blank lines in a row in the file, a stray blank line. The line goes
  // with its break, as the format's own deletion of a whole line does (`<del a⏎>`).
  const rows = (tc: boolean): Script[] => [
    {
      name: `the walk: ←, Return in the word, Delete (seed 1141), Track Changes ${tc ? 'on' : 'off'}`,
      doc: 'note ship⏎===⏎⏎ship ship delta‸⏎ship gamma',
      keys: ['ArrowLeft', 'Enter', 'Delete'],
      tc,
      expect: tc ? {} : { file: 'note ship⏎===⏎⏎ship ship delt⏎⏎ship gamma' },
    },
    {
      name: `Backspace after the letter, Track Changes ${tc ? 'on' : 'off'}`,
      doc: 'one⏎⏎a‸⏎two',
      keys: ['Backspace'],
      tc,
      expect: tc ? { caret: 'one⏎⏎<del a⏎>⏎⏎‸two' } : { file: 'one⏎⏎two', caret: 'one⏎⏎‸two' },
    },
    {
      name: `in an item, and in a quote, Track Changes ${tc ? 'on' : 'off'}`,
      doc: '- ‸a⏎  two⏎⏎> a⏎> three',
      keys: ['Delete'],
      tc,
      expect: tc ? {} : { file: '- two⏎⏎> a⏎> three' },
    },
    {
      name: `a letter that isn’t alone on its line stays the plain edit, Track Changes ${tc ? 'on' : 'off'}`,
      doc: 'one⏎⏎‸ab⏎two',
      keys: ['Delete'],
      tc,
      expect: tc ? {} : { file: 'one⏎⏎b⏎two' },
    },
    {
      name: `⌘Z gives the line back, Track Changes ${tc ? 'on' : 'off'}`,
      doc: 'one⏎⏎‸a⏎two',
      keys: ['Delete', 'Mod-z'],
      tc,
      expect: { file: 'one⏎⏎a⏎two', caret: 'one⏎⏎‸a⏎two' },
    },
  ];
  scriptRows([...rows(false), ...rows(true)]);
});
