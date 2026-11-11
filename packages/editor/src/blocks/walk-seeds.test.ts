// @vitest-environment happy-dom
// The walks' findings (`walk.test.ts`, `REDLINES_FUZZ=200`), each as the smallest script that
// shows it. The invariants of the suite are held after every script.
import { describe } from 'vitest';
import { scriptRows, type Step } from './script.ts';

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
