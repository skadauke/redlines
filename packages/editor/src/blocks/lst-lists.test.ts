// @vitest-environment happy-dom
// Lists and the block keys: lane LST of Epic #930 (#446, #433, #463). Each row is held to every
// invariant of the suite (`list-reads`, `render`, Undo, ...), with Track Changes off and on.
import { describe } from 'vitest';
import { type Script, scriptRows, type Step } from './script.ts';

const ABSORBED =
  "This item can't go up a level: the line after it would read as part of its text, since a number other than 1, an empty item or an underline can't start a block right under text. Put a blank line between them first.";

const both = (
  name: string,
  doc: string,
  keys: Step[],
  off: Script['expect'],
  on: Script['expect'],
): Script[] => [
  { name: `${name}, Track Changes off`, doc, keys, tc: false, expect: off },
  { name: `${name}, Track Changes on`, doc, keys, tc: true, expect: on },
];

describe('#446: a numbered line or an empty marker under an item is a list of its own', () => {
  scriptRows([
    ...both(
      'Backspace at the first item above `2. two`',
      'Text.⏎⏎- ‸one⏎2. two',
      ['Backspace'],
      { file: 'Text.⏎⏎one⏎⏎2. two' },
      { newest: 'Text.⏎⏎one⏎⏎2. two' },
    ),
    ...both(
      'Backspace at the first item above an empty item',
      'Text.⏎⏎- ‸one⏎- ',
      ['Backspace'],
      { file: 'Text.⏎⏎one⏎⏎- ' },
      { newest: 'Text.⏎⏎one⏎⏎- ' },
    ),
    ...both(
      'Backspace at a nested first item above an empty item: refused, in words (the line stays an item)',
      '- a⏎  - ‸one⏎  - ',
      ['Backspace'],
      { refusal: ABSORBED },
      { refusal: ABSORBED },
    ),
    ...both(
      'Backspace at the first item of a quote above `2. two`',
      '> Text.⏎>⏎> - ‸one⏎> 2. two',
      ['Backspace'],
      { file: '> Text.⏎>⏎> one⏎>⏎> 2. two' },
      { newest: '> Text.⏎>⏎> one⏎>⏎> 2. two' },
    ),
  ]);
});

describe('#463: an item inside a quote inside an item stays open, out of the file', () => {
  scriptRows(
    both(
      'Return, Tab at the end of `- > - one`',
      '- > - one‸⏎⏎Para.',
      ['Enter', 'Tab'],
      { file: '- > - one⏎⏎Para.' },
      { file: '- > - one⏎⏎Para.' },
    ),
  );
});

const EMPTIED_CHILD =
  "This item can't be outdented while the item after it is changed: a pending change empties that item in some readings, and right under this text it would turn the text into a heading. Accept or reject that change first.";

describe('#433: an item is not outdented in front of an item that a pending change empties', () => {
  scriptRows([
    ...both(
      "Shift-Tab before Bo's deletion of all the next item's text",
      '- a⏎  - ‸one⏎  - <del two>',
      ['Shift-Tab'],
      { refusal: EMPTIED_CHILD },
      { refusal: EMPTIED_CHILD },
    ),
    ...both(
      "Shift-Tab before Bo's insertion of all the next item's text",
      '- a⏎  - ‸one⏎  - <ins>two</ins>',
      ['Shift-Tab'],
      { refusal: EMPTIED_CHILD },
      { refusal: EMPTIED_CHILD },
    ),
    ...both(
      'Shift-Tab before an item that no change touches',
      '- a⏎  - ‸one⏎  - two',
      ['Shift-Tab'],
      {},
      {},
    ),
  ]);
});
