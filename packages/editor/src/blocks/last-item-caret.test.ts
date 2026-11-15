// @vitest-environment happy-dom
// Tab, Shift-Tab and Return at the end of the last item of a list, with a block after the list
// (#508). With Track Changes on, the tracked layer writes a closer at the caret, and the closer and
// the line breaks after it make one hidden range: the caret was taken to its far end, the start of
// the next block, and the letters typed next went there. After the key the caret stays in the
// item, and three letters land right after the item's text (or in the new item).
import { describe, expect, it } from 'vitest';
import { runScript } from './script.ts';

const AFTER: Record<string, string> = {
  'a paragraph': 'Next block.',
  'a list of another kind': '1. first',
  'a heading': '# Heading',
  'a code block': '```⏎code⏎```',
  'a table': '| a | b |⏎| - | - |⏎| 1 | 2 |',
};

const KEYS = [
  { key: 'Tab' as const, doc: '- one⏎- two‸', want: /two(?:<ins>)?abc‸/ },
  { key: 'Shift-Tab' as const, doc: '- one⏎  - two‸', want: /two(?:<ins>)?abc‸/ },
  { key: 'Enter' as const, doc: '- one⏎- two‸', want: /⏎- (?:<ins>)?abc‸/ },
];

describe('the caret after Tab, Shift-Tab and Return at the last item of a list', () => {
  for (const { key, doc, want } of KEYS) {
    for (const [shape, text] of Object.entries(AFTER)) {
      for (const tc of [false, true]) {
        it(`${key} before ${shape}, Track Changes ${tc ? 'on' : 'off'}: letters go in the item`, () => {
          const result = runScript({
            name: `${key} ${shape}`,
            doc: `${doc}⏎⏎${text}`,
            keys: [key, { type: 'abc' }],
            tc,
            expect: {},
          });
          const caret = result.caret;
          expect(caret, caret).toMatch(want);
          // Nothing was typed at the start of the block after the list.
          expect(caret.replace(/<\/?ins>/g, '')).not.toContain(`abc${text.slice(0, 4)}`);
        });
      }
    }
  }
});
