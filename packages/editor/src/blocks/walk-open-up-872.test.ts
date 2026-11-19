// @vitest-environment happy-dom
// ⌥↑ on the paragraph that Return just opened (#872): the open block and the caret end at the same
// place, and the Backspace after it and its Undo leave the blank lines the file had.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

describe('Return then ⌥↑ over a list (#872)', () => {
  scriptRows([
    {
      name: 'the issue’s two keys, Track Changes on',
      doc: '     ship delta⏎   - plan plan⏎⏎‸ship text text⏎- delta alpha',
      keys: ['Enter', 'Alt-ArrowUp'],
      tc: true,
      expect: {},
    },
    {
      name: 'and the Backspace after it',
      doc: '     ship delta⏎   - plan plan⏎⏎‸ship text text⏎- delta alpha',
      keys: ['Enter', 'Alt-ArrowUp', 'Backspace'],
      tc: true,
      expect: {},
    },
    {
      name: 'the issue’s document with the list above it',
      doc: '   - plan plan⏎* alpha beta⏎⏎‸ship text text⏎- delta alpha',
      keys: ['Enter', 'Alt-ArrowUp', 'Backspace'],
      tc: true,
      expect: {},
    },
    {
      name: 'the same, Track Changes off',
      doc: '   - plan plan⏎* alpha beta⏎⏎‸ship text text⏎- delta alpha',
      keys: ['Enter', 'Alt-ArrowUp', 'Backspace'],
      tc: false,
      expect: {},
    },
  ]);
});
