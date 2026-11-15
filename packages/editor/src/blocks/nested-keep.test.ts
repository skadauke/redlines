// @vitest-environment happy-dom
// What is nested in a list item stays a list when the item's marker or indentation goes (#604).
// Backspace at the start of the first item of a list took its marker away and left the items nested
// under it where they stood, four columns in or more: micromark reads `note⏎    - a` as one
// paragraph of two lines, and the file held an item line that no reader sees as an item (the
// `list-reads` invariant). Shift-Tab in indented code took the four columns that make it code, and
// the list that followed it, which the code's item held, stood under a paragraph. A person expects
// what Word and Google Docs do: the text becomes a paragraph, and the list under it stays a list,
// moved out a level, with the depth among its items kept.
//
// The ruling (design: block editing, "Backspace and Delete join at block edges"):
// - Backspace at the first item of a list at the top level, or in a quote, takes its marker away
//   and leaves its text a paragraph. What was under it moves out by the item's own offset (its
//   indentation, marker and the spaces after it), if some block under it would else stand four
//   columns in or more, and stays where it is otherwise. Track Changes on writes no such move (a
//   tracked change can't write the indentation of a line, and the format has no block change that
//   takes the item and keeps what it holds), so the key says so in words and writes nothing: lane R
//   widens it into a replacement of the whole item (#497).
// - Shift-Tab in indented code takes only the columns past those that make it code.
// - Backspace at the first item of a nested list goes up a level as Shift-Tab does, with what is
//   nested in it, which the format moves along and the key's plain edit now moves too.
//
// micromark 4.0.2 reads (the same is true of the file without Track Changes):
//   `note⏎    - a`      one paragraph "note\n- a" (the item is text)
//   `note⏎  - a`        <p>note</p><ul><li>a</li></ul>
//   `p⏎⏎    code`       <pre><code>code</code></pre>
//   `p⏎⏎code`           <p>code</p>
// Every script is held to the suite's invariants: micromark reads the file as it reads the newest
// view, every order of decisions agrees, no more item lines than items are read, and Undo gives
// back each step.
import { scriptRows, type Script } from './script.ts';

const NESTED_STAY =
  "This item can't leave its list while Track Changes is on: the list or blocks nested under it would be indented too far to be a list or blocks any more, and their indentation can't be changed as a tracked edit. Take the marker out with Track Changes off, or move the nested items out first.";

/** What a script ends with: the newest view, or the refusal (the file as it was). */
type Ending = string | { refusal: string };

/** A row: the document, the key, what Track Changes off gives and what Track Changes on gives. */
type Row = [
  name: string,
  doc: string,
  keys: Script['keys'],
  off: string,
  on?: Ending, // the same as `off` where not given
];

const rows = (list: Row[]): Script[] =>
  list.flatMap(([name, doc, keys, off, on]) =>
    [true, false].map((tc) => {
      const start = doc.replace('‸', '');
      const ending = tc ? (on ?? off) : off;
      const refused = typeof ending === 'object';
      return {
        name: `${name}, Track Changes ${tc ? 'on' : 'off'}`,
        doc,
        keys,
        tc,
        expect: {
          newest: refused ? start : ending,
          ...(tc ? { original: start } : {}),
          ...(refused ? { refusal: ending.refusal } : {}),
        },
      };
    }),
  );

/** Backspace at the start of the first item of a list: the text is a paragraph, the list stays. */
scriptRows(
  rows([
    [
      'a bullet and a bullet under it (the issue, seed 321)',
      '* ‸note a a a⏎    - a a a',
      ['Backspace'],
      'note a a a⏎  - a a a',
      { refusal: NESTED_STAY },
    ],
    [
      'a number and a bullet under it (the issue, seed 417)',
      '1. ‸alpha a a⏎    * a a a',
      ['Backspace'],
      'alpha a a⏎ * a a a',
      { refusal: NESTED_STAY },
    ],
    [
      'a number and a 1. under it',
      '1. ‸alpha⏎    1. a',
      ['Backspace'],
      'alpha⏎ 1. a',
      { refusal: NESTED_STAY },
    ],
    [
      'two levels deep: the depth among the items is kept',
      '- ‸a⏎    - b⏎        - c',
      ['Backspace'],
      'a⏎  - b⏎      - c',
      { refusal: NESTED_STAY },
    ],
    ['a wide marker', '10. ‸a⏎      - b', ['Backspace'], 'a⏎  - b', { refusal: NESTED_STAY }],
    [
      'the next item of the list stays where it is',
      '- ‸a⏎    - b⏎- c',
      ['Backspace'],
      'a⏎  - b⏎- c',
      { refusal: NESTED_STAY },
    ],
    [
      'in a quote',
      '> * ‸note⏎>     - a',
      ['Backspace'],
      '> note⏎>   - a',
      { refusal: NESTED_STAY },
    ],
    [
      'a loose list',
      '- ‸a⏎⏎    - b⏎⏎- c',
      ['Backspace'],
      'a⏎⏎  - b⏎⏎- c',
      { refusal: NESTED_STAY },
    ],
    [
      'an item with a paragraph and a nested list',
      '- ‸a⏎⏎  more⏎⏎    - b',
      ['Backspace'],
      'a⏎⏎more⏎⏎  - b',
      { refusal: NESTED_STAY },
    ],
    [
      'a second paragraph four columns in (a wide marker)',
      '10. ‸a⏎⏎    more',
      ['Backspace'],
      'a⏎⏎more',
      { refusal: NESTED_STAY },
    ],
  ]),
  60_000,
);

/** Delete at the end of the paragraph above a list takes the first item's marker into it. */
scriptRows(
  rows([
    [
      'Delete above a list with a bullet nested in its first item',
      'p‸⏎⏎- b⏎    - c',
      ['Delete'],
      'pb⏎  - c',
      { refusal: NESTED_STAY },
    ],
    [
      'Delete above a list whose nested bullet is two columns in',
      'p‸⏎⏎- b⏎  - c',
      ['Delete'],
      'pb⏎  - c',
    ],
    [
      'Backspace at the first item below a paragraph',
      'p⏎⏎- ‸b⏎    - c',
      ['Backspace'],
      'p⏎⏎b⏎  - c',
      { refusal: NESTED_STAY },
    ],
  ]),
  60_000,
);

/** Where nothing under the item would stand four columns in, it stays as it is, tracked too. */
scriptRows(
  rows([
    ['a bullet nested two columns in', '- ‸a⏎  - b', ['Backspace'], 'a⏎  - b'],
    ['a number nested three columns in', '1. ‸a⏎   1. b', ['Backspace'], 'a⏎   1. b'],
    [
      'the item after another loses its bullet, what is nested stays nested',
      '- a⏎- ‸b⏎    - c',
      ['Backspace'],
      '- a\\⏎  b⏎    - c',
      '- a\\⏎  b⏎    - c',
    ],
  ]),
  60_000,
);

/** The first item of a nested list goes up a level, and what is nested in it with it. */
scriptRows(
  rows([
    [
      'Backspace at a nested first item with an item nested in it',
      '- a⏎  - ‸b⏎      - c',
      ['Backspace'],
      '- a⏎- b⏎    - c',
    ],
    [
      'Shift-Tab at an item with an item nested in it',
      '- a⏎  - ‸b⏎      - c',
      ['Shift-Tab'],
      '- a⏎- b⏎    - c',
    ],
    [
      'Shift-Tab at a numbered item with a bullet nested in it',
      '1. a⏎   1. ‸b⏎      * c',
      ['Shift-Tab'],
      '1. a⏎1. b⏎   * c',
    ],
  ]),
  60_000,
);

/** Shift-Tab in indented code keeps the columns that make it code (the issue, seeds 297 and 576). */
scriptRows(
  rows([
    [
      'at the four columns of indented code at the top level',
      'p⏎⏎    co‸de',
      ['Shift-Tab'],
      'p⏎⏎    code',
    ],
    [
      'in an item, with a list nested under it (the issue, seed 297)',
      '  ```⏎  ```⏎   2. a a a a a⏎⏎          a alpha‸⏎      1. a a a',
      ['Shift-Tab'],
      '  ```⏎  ```⏎   2. a a a a a⏎⏎          a alpha⏎      1. a a a',
    ],
    [
      'in an item, after a lazy line, then a list under the code (the issue, seed 576)',
      '+ a a a a⏎    1. a a a a⏎    a note⏎⏎           a a‸⏎        + a a a a a a a',
      ['Shift-Tab'],
      '+ a a a a⏎    1. a a a a⏎    a note⏎⏎           a a⏎        + a a a a a a a',
    ],
    [
      'past the four columns it takes what more there is',
      'p⏎⏎      co‸de',
      ['Shift-Tab'],
      'p⏎⏎    code',
      'p⏎⏎    code⏎',
    ],
  ]),
  60_000,
);

/** The issue's seed 217: a nested number under a quote item, Backspace at it. */
scriptRows(
  rows([
    [
      'a 1) item nested in a quote item',
      '>   2. a a⏎>      1) ‸text a',
      ['Backspace'],
      '>   2. a a⏎>   1) text a',
    ],
  ]),
  60_000,
);
