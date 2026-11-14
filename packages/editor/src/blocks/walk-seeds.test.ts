// @vitest-environment happy-dom
// The walks' findings (`walk.test.ts`, `REDLINES_FUZZ=200`), each as the smallest script that
// shows it. The invariants of the suite are held after every script.
import { describe } from 'vitest';
import { type Script, scriptRows, type Step } from './script.ts';

describe('walk seed 29: an agent’s edit at the very start while the empty paragraph is open', () => {
  scriptRows([
    {
      name: 'prepended, Track Changes off',
      doc: '‸delta *gamma*',
      keys: ['Shift-Enter', { agent: 'The agent wrote this.' }],
      tc: false,
      expect: {
        file: 'The agent wrote this.⏎⏎delta *gamma*',
        caret: 'The agent wrote this.⏎⏎⏎⏎‸delta *gamma*',
      },
    },
    {
      name: 'prepended after taking the first Return back, as the seed has it',
      doc: '‸delta *gamma*',
      keys: [
        'Shift-Enter',
        'Mod-z',
        'Shift-Enter',
        { agent: 'The agent wrote this.' },
        'Shift-ArrowRight',
      ],
      tc: false,
      expect: { file: 'The agent wrote this.⏎⏎delta *gamma*' },
    },
  ]);
});

describe('walk seed 147: a selection that leaves the empty paragraph ends in no hidden text', () => {
  scriptRows([
    {
      name: 'Shift-→ from the empty paragraph after a typed letter, Track Changes on',
      doc: 'alpha‸⏎⏎## text',
      keys: [{ type: 'x' }, 'Shift-Enter', 'Shift-ArrowRight'],
      tc: true,
      expect: { file: 'alpha<ins>x</ins>⏎⏎## text' },
    },
  ]);
});

describe('walk seeds 14 and 170 (lists side by side): the caret ends in no hidden text', () => {
  scriptRows([
    {
      name: 'Backspace after Delete in the first half of a numbered item (seed 14)',
      doc: '2. alpha⏎2. d‸elta plan',
      keys: ['Enter', 'Delete', 'Backspace'],
      tc: true,
      expect: {},
    },
    {
      name: 'Delete at the end of typed text, before the next quoted item (seed 170)',
      doc: '> text⏎> 1) one‸⏎>    more⏎> 1) two',
      keys: [
        { type: 'new words ' },
        'Mod-z',
        'Mod-Shift-z',
        { agent: 'The agent wrote this.' },
        'Delete',
      ],
      tc: true,
      expect: {},
    },
  ]);
});

describe('walk seed 23 (lists side by side): Return at the start of a nested first item of a loose list, tracked', () => {
  // The empty item goes in above the first one, at the end of the parent item's text, with the one
  // blank line that a split's break holds above it. With Track Changes off a loose list also gets a
  // blank line below the new item; tracked, that second blank line would follow the first, and two
  // in a row were written as two splits, the second a marker line in column 0, which ended the
  // parent item (micromark read the sublist as a list of its own). The list is as loose as it was.
  scriptRows([
    {
      name: 'a nested list with a blank line between its items, Track Changes on (the seed)',
      doc: '* plan beta⏎  * ‸note note⏎⏎  * review gamma⏎',
      keys: ['Enter'],
      tc: true,
      expect: { file: '* plan beta<split>⏎⏎  * ⏎  * note note⏎⏎  * review gamma' },
    },
    {
      name: 'the same list with no blank line between its items writes the same form',
      doc: '* plan beta⏎  * ‸note note⏎  * review gamma⏎',
      keys: ['Enter'],
      tc: true,
      expect: { file: '* plan beta<split>⏎⏎  * ⏎  * note note⏎  * review gamma' },
    },
    {
      // The seed's other keys, Backspace, Delete and Shift-Return over the selection, are refused in
      // words, which the walk allows.
      name: 'the seed’s own text: a continuation line, and a loose sublist with a numbered list in it',
      doc: '* note delta⏎* gamma gamma⏎* plan beta⏎  * ‸note note⏎    note delta⏎  * review gamma⏎    2. code plan⏎       delta alpha⏎⏎    2. delta ship⏎       code text⏎',
      keys: ['Enter', 'Shift-ArrowLeft'],
      tc: true,
      expect: {},
    },
    {
      name: 'a numbered nested list, a blank line between its items',
      doc: '1. plan beta⏎   1. ‸note note⏎⏎   2. review gamma⏎',
      keys: ['Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'in a quote',
      doc: '> * plan beta⏎>   * ‸note note⏎>⏎>   * review gamma⏎',
      keys: ['Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'taken back with ⌘Z, and done again',
      doc: '* plan beta⏎  * ‸note note⏎⏎  * review gamma⏎',
      keys: ['Enter', 'Mod-z', 'Mod-Shift-z'],
      tc: true,
      expect: {},
    },
    {
      name: 'Track Changes off writes the blank line below the new item as well',
      doc: '* plan beta⏎  * ‸note note⏎⏎  * review gamma⏎',
      keys: ['Enter'],
      tc: false,
      expect: { file: '* plan beta⏎⏎  * ⏎⏎  * note note⏎⏎  * review gamma⏎' },
    },
  ]);
});

describe('walk-248 seed 1027: Return on the empty line Shift-Return opened, in a file with a ledger', () => {
  // Return on the empty line takes the Shift-Return back (a step of its own) and opens an empty
  // paragraph, and the history joins the Return's step to that one. With Track Changes on, the
  // tracked layer writes the file's ledger again at each of these (here a short one: no note, no
  // people), so the Return replaces it, and its inverse puts it back. Leaving the paragraph takes
  // the Return back outside the history, and the joined step must stay exactly what the take-back
  // of the Shift-Return left: mapped through the Return's inverse, which had put the ledger back,
  // its inverse inserted the new ledger beside the old one, not over it, and Undo ended in a file
  // with two. The heading is what lets the harness leave the paragraph (its caret goes to the
  // file's start, which the block the Return was pressed in doesn't reach).
  const doc = '## café⏎⏎beta ship<del a>⏎x delta‸';
  scriptRows([
    {
      name: 'Shift-Return, then Return, Track Changes on (the seed)',
      doc,
      keys: ['Shift-Enter', 'Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'the same, Track Changes off',
      doc,
      keys: ['Shift-Enter', 'Enter'],
      tc: false,
      expect: {},
    },
    {
      // Up out of the block the Return was pressed in takes the Return back, as leaving does; ⌘Z
      // then gives back the Shift-Return, with one ledger, and ⌘Z again the file as it was.
      name: 'left with ↑, then ⌘Z twice',
      doc,
      keys: ['Shift-Enter', 'Enter', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'Mod-z', 'Mod-z'],
      tc: true,
      expect: { file: '## café⏎⏎beta ship<del a>⏎x delta' },
    },
  ]);
});

const FM = '---⏎title: Notes⏎---⏎';
const HEAD = '⏎⏎<!-- redlines⏎version: 1⏎';
const mark = (by: string) => `marks:⏎  k6hg: {by: ${by}, at: 2026-11-01T10:00Z}⏎-->⏎`;
const COMMENT =
  'comments:⏎  k6hg:⏎    by: ada⏎    at: 2026-11-01T10:00Z⏎    text: |-⏎      Why?⏎-->⏎';

describe('walk seed 7 (#257): Return over a selection, with a closer between it and the Return', () => {
  // The Return lands after the closer, so the history can't join it to the deletion by adjacency:
  // the record of Returns must not take it for joined, nor Undo for two steps.
  const rows = (front: string, tail: string) =>
    [
      ['a highlight closer, Track Changes off', 'hl', mark('ada'), false],
      ['a comment closer, Track Changes off', 'cmt', COMMENT, false],
      ['another person’s insertion closer, Track Changes off', 'ins', mark('bo'), false],
      ['a highlight closer, Track Changes on', 'hl', mark('ada'), true],
    ].map(([name, kind, ledger, tc]) => ({
      name: `${name}${tail}`,
      doc: `${front}x <!--${kind} k6hg-->abc‸<!--/k6hg-->${HEAD}${ledger}`,
      keys: ['Shift-ArrowLeft', 'Enter'] satisfies Step[],
      tc: tc as boolean,
      expect: {},
    }));
  scriptRows(rows(FM, ''));
  scriptRows(rows('', ', no front matter'));
  scriptRows([
    {
      name: '⌘Z gives the text back exactly (the invariants redo it, too)',
      doc: `${FM}x <!--hl k6hg-->abc‸<!--/k6hg-->${HEAD}${mark('ada')}`,
      keys: ['Shift-ArrowLeft', 'Enter', 'Mod-z'],
      tc: false,
      expect: { file: `${FM}x <!--hl k6hg-->abc<!--/k6hg-->` },
    },
  ]);
});

describe('walk seed 1326 (#292): Return in front of a pending deletion that starts an item’s text, tracked', () => {
  // Delete at the start of an item's text writes the deletion of its first character as the marker
  // alone after the item's marker, the rest of the text on the next line (format §3.3), which the
  // block reading takes for an HTML block that holds only a marker. Return there opened an empty
  // paragraph inside the item, a blank line in front of the marker, which the file reads as a
  // paragraph of the item and the newest view as text after the list: the newest view read
  // `<li></li>` and a paragraph outside, the file `<li><p>…</p></li>`. It is Return at the start of
  // the item's text: an empty item above, the item keeping its pending deletion.
  scriptRows([
    {
      name: 'the walk: Delete, ←, Return at the start of a numbered item (seed 1326)',
      doc: '1) ship⏎2) ‸alpha delta plan',
      keys: ['Delete', 'ArrowLeft', 'Enter'],
      tc: true,
      expect: { file: '1) ship⏎2) <split>⏎3) <del a>⏎   lpha delta plan' },
    },
    {
      name: 'a bullet item',
      doc: '- ship⏎- ‸alpha delta plan',
      keys: ['Delete', 'ArrowLeft', 'Enter'],
      tc: true,
      expect: { file: '- ship⏎- <split>⏎- <del a>⏎  lpha delta plan' },
    },
    {
      name: 'the item is the first of its list, under text',
      doc: 'Text.⏎⏎- ‸alpha delta plan⏎- beta',
      keys: ['Delete', 'ArrowLeft', 'Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'a nested item',
      doc: '- ship⏎  - ‸alpha delta plan',
      keys: ['Delete', 'ArrowLeft', 'Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'another person’s deletion starts the text',
      doc: '- ship⏎- ‸<del a>lpha delta plan',
      keys: ['Enter'],
      tc: true,
      others: 'bo',
      expect: {},
    },
  ]);
});

describe('walk seed 1141 (#292): Delete over the only character of a paragraph’s first line', () => {
  // The paragraph the Return made starts with `a`, a line of its own, and Delete took the letter and
  // left an empty first line: two blank lines in a row in the file, a stray blank line. The line goes
  // with its break, as the format's own deletion of a whole line does (`<del a⏎>`).
  const rows = (tc: boolean): Script[] => [
    {
      name: `the walk: ←, Return in the word, Delete (seed 1141), Track Changes ${tc ? 'on' : 'off'}`,
      doc: 'note ship⏎===⏎⏎ship ship delta‸⏎ship gamma',
      keys: ['ArrowLeft', 'Enter', 'Delete'],
      tc,
      expect: tc ? {} : { file: 'note ship⏎===⏎⏎ship ship delt⏎⏎ship gamma' },
    },
    {
      name: `Backspace after the letter, Track Changes ${tc ? 'on' : 'off'}`,
      doc: 'one⏎⏎a‸⏎two',
      keys: ['Backspace'],
      tc,
      expect: tc ? { caret: 'one⏎⏎<del a⏎>⏎⏎‸two' } : { file: 'one⏎⏎two', caret: 'one⏎⏎‸two' },
    },
    {
      name: `in an item, and in a quote, Track Changes ${tc ? 'on' : 'off'}`,
      doc: '- ‸a⏎  two⏎⏎> a⏎> three',
      keys: ['Delete'],
      tc,
      expect: tc ? {} : { file: '- two⏎⏎> a⏎> three' },
    },
    {
      name: `a letter that isn’t alone on its line stays the plain edit, Track Changes ${tc ? 'on' : 'off'}`,
      doc: 'one⏎⏎‸ab⏎two',
      keys: ['Delete'],
      tc,
      expect: tc ? {} : { file: 'one⏎⏎b⏎two' },
    },
    {
      name: `⌘Z gives the line back, Track Changes ${tc ? 'on' : 'off'}`,
      doc: 'one⏎⏎‸a⏎two',
      keys: ['Delete', 'Mod-z'],
      tc,
      expect: { file: 'one⏎⏎a⏎two', caret: 'one⏎⏎‸a⏎two' },
    },
  ];
  scriptRows([...rows(false), ...rows(true)]);
});

describe('#439: getDoc() is the document with the open item taken back, as it stands', () => {
  // Return then Tab at the end of an item makes the empty item `- ` an empty nested item under the
  // item's text, which the file can't hold (it is open: out of the file). With Track Changes on the
  // take-back is the rejection of the Return's split with its ledger entry (`itemRemoval`), and
  // there were two faults in it. `getDoc()` moved the live ledger's range through the take-back,
  // which left it in the body, and gave the text twice (`- onePara.- onePara.`), which ⌘S would have
  // saved; and the format read the nested bullet as the underline of the text above it, so that the
  // rejection joined the next paragraph into it (`- onePara.`). Opening an item and leaving it is
  // no edit: each of the rows ends in the file it started from.
  scriptRows([
    {
      name: 'Return, Tab at the end of an item before a paragraph (the issue)',
      doc: '- one‸⏎⏎Para.',
      keys: ['Enter', 'Tab'],
      tc: true,
      expect: { file: '- one⏎⏎Para.' },
    },
    {
      name: 'the same, Track Changes off',
      doc: '- one‸⏎⏎Para.',
      keys: ['Enter', 'Tab'],
      tc: false,
      expect: { file: '- one⏎⏎Para.' },
    },
    {
      name: 'at the end of the file',
      doc: '- one‸',
      keys: ['Enter', 'Tab'],
      tc: true,
      expect: { file: '- one' },
    },
    {
      name: 'an item after it, tight',
      doc: '- one‸⏎- two',
      keys: ['Enter', 'Tab'],
      tc: true,
      expect: { file: '- one⏎- two' },
    },
    {
      name: 'a numbered step, a quote after it',
      doc: '1. one‸⏎⏎> quote',
      keys: ['Enter', 'Tab'],
      tc: true,
      expect: { file: '1. one⏎⏎> quote' },
    },
    {
      name: 'a nested item, a paragraph after the list',
      doc: '- a⏎  - b‸⏎⏎Para.',
      keys: ['Enter', 'Tab'],
      tc: true,
      expect: { file: '- a⏎  - b⏎⏎Para.' },
    },
    {
      name: 'three levels down',
      doc: '- a⏎  - b⏎    - c‸⏎⏎Para.',
      keys: ['Enter', 'Tab'],
      tc: true,
      expect: { file: '- a⏎  - b⏎    - c⏎⏎Para.' },
    },
    {
      name: 'a numbered parent of two digits',
      doc: '10. a⏎    1. b‸⏎⏎Para.',
      keys: ['Enter', 'Tab'],
      tc: true,
      expect: { file: '10. a⏎    1. b⏎⏎Para.' },
    },
    {
      name: 'a bullet under a numbered step',
      doc: '1. a⏎   - b‸⏎⏎Para.',
      keys: ['Enter', 'Tab'],
      tc: true,
      expect: { file: '1. a⏎   - b⏎⏎Para.' },
    },
    {
      name: 'in a quote',
      doc: '> - one‸⏎>⏎> Para.',
      keys: ['Enter', 'Tab'],
      tc: false,
      expect: { file: '> - one⏎>⏎> Para.' },
    },
    {
      name: 'after front matter',
      doc: '---⏎a: b⏎---⏎⏎- one‸⏎⏎Para.',
      keys: ['Enter', 'Tab'],
      tc: true,
      expect: { file: '---⏎a: b⏎---⏎⏎- one⏎⏎Para.' },
    },
    {
      name: 'a ledger already there: a pending change of another person elsewhere',
      doc: '- one‸⏎⏎Para <del x>',
      others: 'bo',
      keys: ['Enter', 'Tab'],
      tc: true,
      expect: { file: '- one⏎⏎Para <del x>' },
    },
    {
      name: 'Return, Tab, a letter, ⌘Z twice',
      doc: '- one‸⏎⏎Para.',
      keys: ['Enter', 'Tab', { type: 'x' }, 'Mod-z', 'Mod-z'],
      tc: true,
      expect: {},
    },
  ]);

  // The ledger the take-back reads again: a file that had none when Track Changes was off, and got
  // one with the first Return. The take-back from the record gives back the file as it was, with
  // no ledger, and the live ledger's range, moved through it, lay in the body: the text came out
  // twice, for the open item and for the open empty line alike.
  scriptRows([
    {
      name: 'text typed with Track Changes off, then Return and Tab with it on',
      doc: '- one‸⏎⏎Para.',
      keys: [{ type: 'x' }, { tracking: true }, 'Enter', 'Tab'],
      tc: false,
      expect: { file: '- onex⏎⏎Para.' },
    },
    {
      name: 'the open empty line of Shift-Return, at the end of the file',
      doc: 'Para‸',
      keys: [{ type: 'x' }, { tracking: true }, 'Shift-Enter'],
      tc: false,
      expect: { file: 'Parax' },
    },
    {
      name: 'the open empty line of Shift-Return, a paragraph after it',
      doc: 'Para‸⏎⏎Next.',
      keys: [{ type: 'x' }, { tracking: true }, 'Shift-Enter'],
      tc: false,
      expect: { file: 'Parax⏎⏎Next.' },
    },
  ]);
});

describe('#440: Return twice at the end of a nested item whose marker is another kind than its parent’s', () => {
  // The second Return moves the empty item up a level: its line takes its parent's syntax. With
  // Track Changes on the item is the author's own pending split's, and the new syntax went over
  // the marker as typed text: the format took the break away with the old marker and wrote the new
  // one at the end of the text above (`1. a⏎   - b<ins>2. </ins>`), one item with the number in
  // its text. Now the edit of the item's line is final, as Tab's is: the split stays, the new
  // syntax is its line.
  const THEIRS =
    "Another person's pending change made this item. Accept or reject it before moving it out of its list.";
  const OFF =
    "This edit can't be made with Track Changes off without changing other text or the changes around it. Accept or reject those changes first, or turn on Track Changes.";
  const rows = (tc: boolean): Script[] => {
    const mode = `Track Changes ${tc ? 'on' : 'off'}`;
    const brk = tc ? '<split>⏎' : '⏎';
    // A loose list's break holds its blank line.
    const loose = tc ? '<split>⏎⏎' : '⏎⏎';
    return [
      {
        name: `a bullet under a numbered step (the issue), ${mode}`,
        doc: '1. a⏎   - b‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: {
          file: `1. a⏎   - b${brk}2. `,
          caret: `1. a⏎   - b${brk}2. ‸`,
          newest: '1. a⏎   - b⏎2. ',
          original: tc ? '1. a⏎   - b' : '1. a⏎   - b⏎2. ',
        },
      },
      {
        name: `with an item after it, ${mode}`,
        doc: '1. a⏎   - b‸⏎2. c',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `1. a⏎   - b${brk}2. ⏎2. c`, caret: `1. a⏎   - b${brk}2. ‸⏎2. c` },
      },
      {
        name: `a numbered item under a bullet, ${mode}`,
        doc: '- a⏎  1. b‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `- a⏎  1. b${brk}- `, caret: `- a⏎  1. b${brk}- ‸` },
      },
      {
        name: `a bullet of another character, ${mode}`,
        doc: '- a⏎  * b‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `- a⏎  * b${brk}- `, caret: `- a⏎  * b${brk}- ‸` },
      },
      {
        name: `a task item keeps its box, ${mode}`,
        doc: '1. a⏎   - [ ] b‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `1. a⏎   - [ ] b${brk}2. [ ] `, caret: `1. a⏎   - [ ] b${brk}2. [ ] ‸` },
      },
      {
        name: `Backspace right after puts the empty item back, ${mode}`,
        doc: '1. a⏎   - b‸',
        keys: ['Enter', 'Enter', 'Backspace'],
        tc,
        expect: { file: `1. a⏎   - b${brk}   - `, caret: `1. a⏎   - b${brk}   - ‸` },
      },
      {
        name: `⌘Z twice leaves nothing of it, ${mode}`,
        doc: '1. a⏎   - b‸',
        keys: ['Enter', 'Enter', 'Mod-z', 'Mod-z'],
        tc,
        expect: { file: '1. a⏎   - b', caret: '1. a⏎   - b‸' },
      },
      {
        name: `a loose nested list, the last item: the break holds the blank line, ${mode}`,
        doc: '1. a⏎   - b⏎⏎   - c‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: {
          file: `1. a⏎   - b⏎⏎   - c${loose}2. `,
          caret: `1. a⏎   - b⏎⏎   - c${loose}2. ‸`,
        },
      },
      {
        name: `a loose nested list, an item after the blank line, ${mode}`,
        doc: '1. a⏎   - b‸⏎⏎   - c',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `1. a⏎   - b${loose}2. ⏎⏎   - c` },
      },
      {
        name: `a numbered item under a bullet, loose, ${mode}`,
        doc: '- a⏎  1. b⏎⏎  2. c‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `- a⏎  1. b⏎⏎  2. c${loose}- ` },
      },
      {
        name: `an item of two paragraphs, a tight item after it, ${mode}`,
        doc: '1. S⏎   - a⏎⏎     more⏎   - b‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `1. S⏎   - a⏎⏎     more⏎   - b${loose}2. ` },
      },
      {
        name: `a number that differs from its parent's, ${mode}`,
        doc: '3. a⏎   1. b‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `3. a⏎   1. b${brk}4. ` },
      },
      {
        name: `three levels, up one, ${mode}`,
        doc: '1. a⏎   - b⏎     1. c‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `1. a⏎   - b⏎     1. c${brk}   - ` },
      },
      {
        name: `in a quote, ${mode}`,
        doc: '> 1. a⏎>    - b‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `> 1. a⏎>    - b${brk}> 2. ` },
      },
      {
        name: `a parent of two digits, ${mode}`,
        doc: '10. a⏎    - b‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `10. a⏎    - b${brk}11. ` },
      },
      {
        name: `a parent with a parenthesis, ${mode}`,
        doc: '1) a⏎   - b‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `1) a⏎   - b${brk}2) ` },
      },
      {
        name: `a parent with two spaces after its marker, ${mode}`,
        doc: '1.  a⏎    - b‸',
        keys: ['Enter', 'Enter'],
        tc,
        expect: { file: `1.  a⏎    - b${brk}2.  ` },
      },
      {
        name: `typing in the new item, ${mode}`,
        doc: '1. a⏎   - b‸',
        keys: ['Enter', 'Enter', { type: 'c' }],
        tc,
        expect: tc
          ? { file: '1. a⏎   - b<ins><split>⏎2. c</ins>', newest: '1. a⏎   - b⏎2. c' }
          : { file: '1. a⏎   - b⏎2. c' },
      },
    ];
  };
  scriptRows([
    ...rows(false),
    ...rows(true),
    // The caret anywhere in the item's line (a click puts it there): the line ends the same, the caret
    // at its end.
    ...[
      ['‸   - ', 'at the start of the line'],
      [' ‸  - ', 'in the indentation'],
      ['   ‸- ', 'in front of the marker'],
      ['   -‸ ', 'after the marker'],
    ].map(([line, where]): Script => ({
      name: `the caret ${where} of the empty item: Track Changes on`,
      doc: `1. a⏎   - b<split>⏎${line}`,
      keys: ['Enter'],
      tc: true,
      expect: { file: '1. a⏎   - b<split>⏎2. ', caret: '1. a⏎   - b<split>⏎2. ‸' },
    })),
    {
      name: 'a file reopened with the split pending, the caret in its item: the same, Track Changes on',
      doc: '1. a⏎   - b<split>⏎   - ‸',
      keys: ['Enter'],
      tc: true,
      expect: { file: '1. a⏎   - b<split>⏎2. ', caret: '1. a⏎   - b<split>⏎2. ‸' },
    },
    {
      name: 'a file reopened with the split pending: refused, Track Changes off, in words',
      doc: '1. a⏎   - b<split>⏎   - ‸',
      keys: ['Enter'],
      tc: false,
      expect: { refusal: OFF },
    },
    {
      name: 'the split is another person’s: refused in words, Track Changes on',
      doc: '1. a⏎   - b<split>⏎   - ‸',
      others: 'bo',
      keys: ['Enter'],
      tc: true,
      expect: { refusal: THEIRS },
    },
  ]);
});
