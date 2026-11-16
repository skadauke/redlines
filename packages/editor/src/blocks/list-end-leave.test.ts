// @vitest-environment happy-dom
// ↑ after Return ends a list (#669): leaving the empty paragraph takes the Returns that made it
// back, and the empty item that the Return ended the list from was one of them, so it came back.
// Now the item goes with them when the Return before made it; one that was in the file is the
// file's, and comes back as it was. (A caret that
// moves up needs layout, which these tests have none of: they read the file.)
import { describe } from 'vitest';
import { type Script, scriptRows } from './script.ts';

/** A Return in an empty nested item goes up a level first: one more Return ends the list. */
const shapes: [string, string, string, number][] = [
  ['a bullet', '- a‸', '- a', 2],
  ['a number', '1. a‸', '1. a', 2],
  ['a box', '- [ ] a‸', '- [ ] a', 2],
  ['a nested bullet', '- a⏎  - b‸', '- a⏎  - b', 3],
  ['a bullet before a paragraph', '- a‸⏎⏎After', '- a⏎⏎After', 2],
];

describe('↑ after Return ends a list (#669)', () => {
  scriptRows(
    shapes.flatMap(([name, doc, file, returns]) =>
      [false, true].map((tc): Script => ({
        name: `${name}, Return to the end of the list then ↑, Track Changes ${tc ? 'on' : 'off'}`,
        doc,
        keys: [...Array.from({ length: returns }, () => 'Enter' as const), 'ArrowUp'],
        tc,
        expect: { file },
      })),
    ),
  );
  // An empty item that was in the file before the Return is the file's: ↑ takes the Return back, and
  // it comes back as it was.
  scriptRows([
    {
      name: 'an empty item that was in the file, Return then ↑, Track Changes off',
      doc: '- a⏎- ‸',
      keys: ['Enter', 'ArrowUp'],
      tc: false,
      expect: { file: '- a⏎- ' },
    },
  ]);
});
