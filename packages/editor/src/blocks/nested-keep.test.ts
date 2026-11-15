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
//   columns in or more, and stays where it is otherwise (code moves with it, to keep its content).
//   Track Changes on writes the move as one substitution that holds the old lines, from the end of
//   the paragraph's last line (or the break above it) through the item's last line, beside the
//   deletion of the marker.
// - Shift-Tab in indented code keeps the four columns that make it code only where the line below
//   it would else join the paragraph it becomes; there it says so in words.
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

/** The refusal that main has for a marker in a quote on the first line of the file, tracked. */
const DEEP_AT_START =
  "A marker inside a quote or another list can't be taken out of the first line of the file while Track Changes is on. Turn Track Changes off for this change, or start the file with a line of text first.";

/** What a script ends with: the newest view, or the refusal (the file as it was). */
type Ending = string | { refusal: string };

/** A row: the document, the key, what Track Changes off gives and what Track Changes on gives. */
type Row = [
  name: string,
  doc: string,
  keys: Script['keys'],
  off: Ending,
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
    ],
    [
      'a number and a bullet under it (the issue, seed 417)',
      '1. ‸alpha a a⏎    * a a a',
      ['Backspace'],
      'alpha a a⏎ * a a a',
    ],
    ['a number and a 1. under it', '1. ‸alpha⏎    1. a', ['Backspace'], 'alpha⏎ 1. a'],
    [
      'two levels deep: the depth among the items is kept',
      '- ‸a⏎    - b⏎        - c',
      ['Backspace'],
      'a⏎  - b⏎      - c',
    ],
    ['a wide marker', '10. ‸a⏎      - b', ['Backspace'], 'a⏎  - b'],
    [
      'the next item of the list stays where it is',
      '- ‸a⏎    - b⏎- c',
      ['Backspace'],
      'a⏎  - b⏎- c',
    ],
    [
      'in a quote',
      '> * ‸note⏎>     - a',
      ['Backspace'],
      '> note⏎>   - a',
      { refusal: DEEP_AT_START },
    ],
    ['in a quote, below a paragraph', 'p⏎⏎> * ‸note⏎>     - a', ['Backspace'], 'p⏎⏎> note⏎>   - a'],
    ['a loose list', '- ‸a⏎⏎    - b⏎⏎- c', ['Backspace'], 'a⏎⏎  - b⏎⏎- c'],
    [
      'an item with a paragraph and a nested list',
      '- ‸a⏎⏎  more⏎⏎    - b',
      ['Backspace'],
      'a⏎⏎more⏎⏎  - b',
    ],
    [
      'a second paragraph four columns in (a wide marker)',
      '10. ‸a⏎⏎    more',
      ['Backspace'],
      'a⏎⏎more',
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
    ],
  ]),
  60_000,
);

/** Other shapes of what is under the item: tabs, a quote, a fence, code, a task item, a quote around it. */
const NESTED_CODE =
  "This item can't leave its list while Track Changes is on: what is under it has to move out a level, and code among it can't be written again as a tracked change yet. Take the marker out with Track Changes off, or move the code out first.";
scriptRows(
  rows([
    ['a nested item indented with a tab', '- ‸a⏎\t- b', ['Backspace'], 'a⏎  - b'],
    ['a quote nested in the item', '- ‸a⏎⏎    > q', ['Backspace'], 'a⏎⏎  > q'],
    ['a task item', '- [ ] ‸a⏎    - b', ['Backspace'], 'a⏎  - b'],
    [
      'a wide marker in a quote, below a paragraph',
      'p⏎⏎> 10. ‸a⏎>       - b',
      ['Backspace'],
      'p⏎⏎> a⏎>   - b',
    ],
    [
      'a fence nested in the item',
      '- ‸a⏎⏎    ```⏎    x⏎    ```',
      ['Backspace'],
      'a⏎⏎  ```⏎  x⏎  ```',
      { refusal: NESTED_CODE },
    ],
    [
      'indented code beside a nested list',
      '- ‸a⏎⏎      code⏎⏎    - b',
      ['Backspace'],
      'a⏎⏎    code⏎⏎  - b',
      { refusal: NESTED_CODE },
    ],
    [
      'indented code alone keeps its content untracked, as it was tracked',
      '- ‸a⏎⏎      code',
      ['Backspace'],
      'a⏎⏎    code',
      'a⏎⏎      code',
    ],
    [
      'Delete into a list item moves the lines to its text column (the join, two columns less)',
      '- a‸⏎⏎10. b⏎      - c',
      ['Delete'],
      '- ab⏎    - c',
    ],
    [
      'Backspace at a nested first item with indented code after it',
      '- a⏎  - ‸b⏎⏎        code⏎  - c',
      ['Backspace'],
      '- a⏎- b⏎⏎      code⏎  - c',
      '- a⏎- b⏎⏎        code⏎  - c',
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

/**
 * Shift-Tab in indented code outdents it, to a paragraph at the end: only where a line right under
 * it would join that paragraph (the issue, seeds 297 and 576) it says so in words and does nothing.
 */
const KEEP_CODE =
  "This code can't be outdented any further: the line right under it would become part of the paragraph it turns into. Put a blank line under the code first.";
// With Track Changes on, outdenting indented code is refused by the tracked layer, in words.
const END_CODE =
  'This would end the code block it is typed in. Change the code first, or turn off Track Changes.';
const CODE_IN_ITEM =
  "A tracked change can't go in indented code in a list item or a quote yet. Turn off Track Changes to edit it.";
scriptRows(
  rows([
    [
      'at the four columns of indented code at the top level',
      'p⏎⏎    co‸de',
      ['Shift-Tab'],
      'p⏎⏎code',
      { refusal: END_CODE },
    ],
    ['in an item', '- a⏎⏎      co‸de', ['Shift-Tab'], '- a⏎⏎  code', { refusal: CODE_IN_ITEM }],
    [
      'before a list, a blank line between',
      '    co‸de⏎⏎- a⏎    - b',
      ['Shift-Tab'],
      'code⏎⏎- a⏎    - b',
      { refusal: END_CODE },
    ],
    [
      'past the four columns it takes what more there is',
      'p⏎⏎      co‸de',
      ['Shift-Tab'],
      'p⏎⏎code',
      { refusal: END_CODE },
    ],
    [
      'with a list item right under it, in an item (the issue, seed 297)',
      '  ```⏎  ```⏎   2. a a a a a⏎⏎          a alpha‸⏎      1. a a a',
      ['Shift-Tab'],
      { refusal: KEEP_CODE },
    ],
    [
      'with a list item right under it, after a lazy line (the issue, seed 576)',
      '+ a a a a⏎    1. a a a a⏎    a note⏎⏎           a a‸⏎        + a a a a a a a',
      ['Shift-Tab'],
      { refusal: KEEP_CODE },
    ],
    [
      'with text right under it at the top level',
      'p⏎⏎    co‸de⏎text',
      ['Shift-Tab'],
      { refusal: KEEP_CODE },
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
