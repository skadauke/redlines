// @vitest-environment happy-dom
// Return over a selection at the start of a nested first item, Track Changes on (#395): the
// deletion empties the item in the newest view, so the empty item goes in above it with the blank
// line that a break under text needs, as a Return at the start of the item does.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

describe('Return over a selection at the start of a nested first item', () => {
  scriptRows([
    {
      name: 'a bullet under its parent’s text',
      doc: '- plan⏎  - ‸note note⏎  - review',
      keys: ['Shift-ArrowRight', 'Shift-ArrowRight', 'Enter'],
      tc: true,
      expect: { file: '- plan<split>⏎⏎  - ⏎  - <del no>⏎    te note⏎  - review' },
    },
    {
      // `\\` is an escaped backslash, no hard break: the blank line is written (#291).
      name: 'Return at the start of a nested first item under a line that ends in `\\\\`',
      doc: '- plan\\\\⏎  - ‸note⏎  - review',
      keys: ['Enter'],
      tc: true,
      expect: { file: '- plan\\\\<split>⏎⏎  - ⏎  - note⏎  - review' },
    },
    {
      name: 'but a line that ends in a hard break is still refused in words',
      doc: '- plan\\⏎  - ‸note⏎  - review',
      keys: ['Enter'],
      tc: true,
      expect: {
        refusal:
          "A blank line can't be put right after a hard line break while Track Changes is on. Take the hard break out first (Backspace at the start of the next line), or turn Track Changes off.",
      },
    },
    {
      name: 'the same, Track Changes off',
      doc: '- plan⏎  - ‸note note⏎  - review',
      keys: ['Shift-ArrowRight', 'Shift-ArrowRight', 'Enter'],
      tc: false,
      expect: {},
    },
  ]);
});
