// @vitest-environment happy-dom
// The walks' findings (`walk.test.ts`, `REDLINES_FUZZ=200`), each as the smallest script that
// shows it. The invariants of the suite are held after every script.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

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
