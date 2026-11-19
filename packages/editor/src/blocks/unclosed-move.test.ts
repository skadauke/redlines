// @vitest-environment happy-dom
// ⌥↑ on a code block that nothing closes writes its closing fence and moves the block (#1203),
// tracked with Track Changes on, plain with it off.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

describe('⌥↑ on code with no closing fence', () => {
  scriptRows([
    {
      name: 'Track Changes off',
      doc: 'A paragraph above.⏎⏎```js⏎const total = 1;‸⏎',
      keys: ['Alt-ArrowUp'],
      tc: false,
      expect: { file: '```js⏎const total = 1;⏎```⏎⏎A paragraph above.' },
    },
    {
      name: 'Track Changes on',
      doc: 'A paragraph above.⏎⏎```js⏎const total = 1;‸⏎',
      keys: ['Alt-ArrowUp'],
      tc: true,
      expect: {
        caret:
          '<sub A paragraph above.⏎⏎```js⏎const total = 1;⏎>⏎⏎```js⏎const total = 1;‸⏎```⏎⏎A paragraph above.⏎</sub>',
      },
    },
    {
      name: 'in a quote, Track Changes off',
      doc: '> One.⏎>⏎> ```js⏎> x‸⏎',
      keys: ['Alt-ArrowUp'],
      tc: false,
      expect: { file: '> ```js⏎> x⏎> ```⏎>⏎> One.⏎' },
    },
    {
      name: 'the Test Drive’s Unclosed fence.md: no line break at the end, Track Changes off',
      doc: 'A paragraph above.⏎⏎```js⏎const total = items.length;⏎console.log(total);‸',
      keys: ['Alt-ArrowUp'],
      tc: false,
      expect: {
        file: '```js⏎const total = items.length;⏎console.log(total);⏎```⏎⏎A paragraph above.',
      },
    },
    {
      name: 'the same, Track Changes on',
      doc: 'A paragraph above.⏎⏎```js⏎const total = items.length;⏎console.log(total);‸',
      keys: ['Alt-ArrowUp'],
      tc: true,
      expect: {
        caret:
          '<sub A paragraph above.⏎⏎```js⏎const total = items.length;⏎console.log(total);>⏎⏎```js⏎const total = items.length;⏎console.log(total);⏎```‸⏎⏎A paragraph above.⏎</sub>',
      },
    },
    {
      name: 'the only block: nothing to move, nothing written',
      doc: '```js⏎x‸⏎',
      keys: ['Alt-ArrowUp'],
      tc: false,
      expect: { file: '```js⏎x⏎' },
    },
  ]);
});
