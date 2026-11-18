// @vitest-environment happy-dom
// A deep run's finding (#586, list-widen seed 121), as a hand row: a character typed in the
// indentation of a fenced code line inside a list item, which ends the item and its code, is no
// edit that a replacement can hold (its closer would stand in a fence that nothing closes).
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

const LEDGER =
  '⏎⏎<!-- redlines⏎version: 1⏎comments:⏎  k6hg:⏎    by: bo⏎    at: 2026-11-01T10:00Z⏎    text: |-⏎      Why?⏎-->⏎';

describe('list-widen seed 121: typing in the indentation of code inside an item, tracked', () => {
  scriptRows([
    {
      name: 'x at the second column of a code line in an item, with a comment in the item',
      doc: `- one <!--cmt k6hg-->two<!--/k6hg-->⏎⏎  \`\`\`⏎ ‸     code⏎  \`\`\`⏎⏎tail${LEDGER}`,
      keys: [{ type: 'x' }],
      tc: true,
      expect: {
        refusal:
          'This would end the code block it is typed in. Change the code first, or turn off Track Changes.',
      },
    },
  ]);
});

describe('block-move-random seed 65: the last item of a list moves to the end, which is code', () => {
  // The replacement's closer stands on a line of its own after the fence, in the item's indent: the
  // newest view holds that line (blank), where the plain move has none; the reading is the same.
  scriptRows([
    {
      name: 'the first item moves below the second, which ends in a fence, Track Changes on',
      doc: '- ‸one⏎- two⏎⏎  ```⏎  code⏎  ```⏎⏎tail',
      keys: ['Alt-ArrowDown'],
      tc: true,
      expect: {},
    },
    {
      name: 'the same, Track Changes off',
      doc: '- ‸one⏎- two⏎⏎  ```⏎  code⏎  ```⏎⏎tail',
      keys: ['Alt-ArrowDown'],
      tc: false,
      expect: {},
    },
  ]);
});

describe('list-widen seed 166: Return inside indented code of a nested item, before an ordered item', () => {
  scriptRows([
    {
      name: 'Return in the code line, with a comment in the item, Track Changes on',
      doc: `* one <!--cmt k6hg-->two<!--/k6hg-->⏎    - nested⏎⏎          co‸de⏎          more⏎2. next⏎   > quote${LEDGER}`,
      keys: ['Enter'],
      tc: true,
      expect: {
        refusal:
          "A tracked change can't go in indented code in a list item or a quote yet. Turn off Track Changes to edit it.",
      },
    },
  ]);
});
