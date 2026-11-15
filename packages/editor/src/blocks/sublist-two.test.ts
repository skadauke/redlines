// @vitest-environment happy-dom
// A numbered sublist that doesn't start at 1 under the text of an item (`1. a⏎   2. b`) is text of
// that item to CommonMark, which lets an ordered list interrupt a paragraph only when it starts at 1
// (#600, #446). The parse reads a sublist there, so Return, Tab, Shift-Tab and Backspace in such a
// line wrote for a list the file doesn't hold: a new marker line that micromark reads as text, and a
// split right behind a line that the editor drew as an item. The keys read the line as the text it
// is (`textRun` in `structure.ts`). Every script is held to the suite's invariants (micromark reads
// the file as it reads the newest view, every order of decisions agrees, Undo gives back each step),
// with Track Changes on and off, and the rows that follow it show what is not text stays as it was.
//
// micromark 4.0.2 reads:
//   `1. a⏎   2. b`        <ol><li>a⏎2. b</li></ol>            (text)
//   `1. a⏎   2) b`        <ol><li>a⏎2) b</li></ol>            (text)
//   `1. a⏎   1. b`        <ol><li>a<ol><li>b</li></ol></li></ol>   (a sublist: 1 interrupts)
//   `1. a⏎⏎   2. b`       <ol><li><p>a</p><ol start="2">…     (a sublist: a blank line precedes it)
//   `- a⏎  2. b`          <ul><li>a⏎2. b</li></ul>            (text, as the parse reads it too)
import { scriptRows, type Script } from './script.ts';

const NO_FIRST_INDENT =
  "The first item of a list can't be indented: there is no item to put it under.";

/** A row: the document, the key, and the newest view that Track Changes on and off both give. */
type Row = [name: string, doc: string, key: Script['keys'], newest: string, refusal?: string];

const rows = (list: Row[]): Script[] =>
  list.flatMap(([name, doc, keys, newest, refusal]) =>
    [true, false].map((tc) => ({
      name: `${name}, Track Changes ${tc ? 'on' : 'off'}`,
      doc,
      keys,
      tc,
      expect: {
        newest,
        // The original is what the document was, with Track Changes on.
        ...(tc ? { original: doc.replace('‸', '') } : {}),
        ...(refusal ? { refusal } : {}),
      },
    })),
  );

/** Text of the item: Return makes the next item of its list, Backspace deletes one marker. */
scriptRows(
  rows([
    ['Return at the end of a 2. line', '1. a⏎   2. b‸', ['Enter'], '1. a⏎   2. b⏎2. '],
    ['Return in the middle of a 2. line', '1. a⏎   2. b‸b', ['Enter'], '1. a⏎   2. b⏎2. b'],
    ['Return at the end of a 2) line', '1. a⏎   2) b‸', ['Enter'], '1. a⏎   2) b⏎2. '],
    [
      'Return at the end of the third line',
      '1. a⏎   2. b⏎   3. c‸',
      ['Enter'],
      '1. a⏎   2. b⏎   3. c⏎2. ',
    ],
    ['Return in a quote', '> 1. a⏎>    2. b‸', ['Enter'], '> 1. a⏎>    2. b⏎> 2. '],
    [
      'Return in a sublist of a bullet, three levels',
      '- x⏎  1. a⏎     2. b‸',
      ['Enter'],
      '- x⏎  1. a⏎     2. b⏎  2. ',
    ],
    [
      'Return after a 1. line, then a 2. line (the 2. is text, the next 1. is not)',
      '1. a⏎   2. b⏎   1. c‸',
      ['Enter'],
      '1. a⏎   2. b⏎   1. c⏎   2. ',
    ],
    ['Backspace after the marker', '1. a⏎   2. ‸b', ['Backspace'], '1. a⏎   b'],
    ['Shift-Tab at a 2. line, two levels', '- a⏎  - x⏎    2. b‸', ['Shift-Tab'], '- a⏎- x⏎  2. b'],
    [
      'Tab at a 2. line makes the item above a sublist, the line stays its text',
      '1. a⏎1. x⏎   2. ‸b',
      ['Tab'],
      '1. a⏎   1. x⏎      2. b',
    ],
    [
      'Tab at a 2. line of the first item: no item above to put it under',
      '1. a⏎   2. ‸b',
      ['Tab'],
      '1. a⏎   2. b',
      NO_FIRST_INDENT,
    ],
  ]),
  60_000,
);

/** The two minimal reproductions of #600, and the walk's seeds that name them. */
scriptRows(
  rows([
    [
      'the issue, Return at the start of a line under a list after a blank line',
      '1. a a⏎     2. a a⏎⏎     2. a a⏎‸plan a a',
      ['Enter'],
      '1. a a⏎     2. a a⏎⏎     2. a a⏎     3. plan a a',
    ],
    [
      'walk seed 219 (Tab and the arrows, lists side by side): the items are text, each with lines in a quote',
      '> - a⏎>   1) b⏎>      2. c⏎>         d⏎>      2. e⏎>      2. f⏎>         g‸⏎>   1) h',
      ['Enter'],
      '> - a⏎>   1) b⏎>      2. c⏎>         d⏎>      2. e⏎>      2. f⏎>         g⏎>   1) ⏎>   1) h',
    ],
    [
      'the issue, a 2. line in a quote under 1)',
      '>   1) a a⏎>      2. a a⏎>         ‸beta a',
      ['Enter'],
      '>   1) a a⏎>      2. a a⏎>   2) beta a',
    ],
  ]),
  60_000,
);

/** Where micromark reads a list, the keys are as they were. */
scriptRows(
  rows([
    [
      'a sublist numbered 1 under the text interrupts it',
      '1. a⏎   1. b‸',
      ['Enter'],
      '1. a⏎   1. b⏎   2. ',
    ],
    [
      'a sublist after a blank line is a list, whatever its number',
      '1. a⏎⏎   2. b‸',
      ['Enter'],
      '1. a⏎⏎   2. b⏎   3. ',
    ],
    [
      'a sublist continued from an item above is a list',
      '1. a⏎   1. b⏎   2. c‸',
      ['Enter'],
      '1. a⏎   1. b⏎   2. c⏎   3. ',
    ],
    ['a bullet sublist interrupts the text', '1. a⏎   - b‸', ['Enter'], '1. a⏎   - b⏎   - '],
    [
      'a numbered line under a bullet is text in the parse too',
      '- a⏎  2. b‸',
      ['Enter'],
      '- a⏎  2. b⏎- ',
    ],
    [
      'a 2. line under text at the top level is text in the parse too',
      'text⏎2. b‸',
      ['Enter'],
      'text⏎2. b',
    ],
  ]),
  60_000,
);
