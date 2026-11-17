// @vitest-environment happy-dom
// Lane F3 (Epic #537): tracked writes in list items that read otherwise than the view (#583, #615)
// or by the order of decisions (#605).

import { describe } from 'vitest';
import { scriptRows } from './script.ts';

describe('#615: Return at the start of a lazy line of a loose item', () => {
  scriptRows([
    {
      name: 'Track Changes on, no pending change',
      doc: '* a a⏎⏎* a a⏎‸review a',
      keys: ['Enter'],
      tc: true,
      expect: { newest: '* a a⏎⏎* a a⏎⏎* review a' },
    },
  ]);
});

describe('#605: Tab then Return in an item', () => {
  scriptRows([
    {
      name: 'a quoted numbered item',
      doc: '> 2. a a⏎> 2. a a⏎>    ‸alpha a',
      keys: ['Tab', 'Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'a numbered item',
      doc: '1. a a⏎1. a a⏎   ‸review a',
      keys: ['Tab', 'Enter'],
      tc: true,
      expect: {},
    },
  ]);
});

describe('#583: a block start typed into an empty item', () => {
  scriptRows([
    { name: '--- in a bare item', doc: '- one⏎-‸', keys: [{ type: ' ---' }], tc: true, expect: {} },
    {
      name: 'a nested marker in a bare item',
      doc: '- one⏎-‸',
      keys: [{ type: ' - a' }],
      tc: true,
      expect: {},
    },
    {
      name: 'a nested number in a bare item',
      doc: '- one⏎-‸',
      keys: [{ type: ' 1. a' }],
      tc: true,
      expect: {},
    },
    {
      name: '--- in an empty item',
      doc: '- one⏎- ‸',
      keys: [{ type: '---' }],
      tc: true,
      expect: { newest: '- one⏎- ---⏎' },
    },
  ]);
});
