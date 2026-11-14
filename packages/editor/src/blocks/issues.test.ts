// @vitest-environment happy-dom
// The issues block editing touches, as keystroke scripts (design: block editing, Tests): each made
// with the block keys where it can be, held to every invariant of the suite, with Track Changes
// off and on. Where the format still refuses, the refusal is pinned with its words and the issue.
// #20 (4,000 own-line markers, the hidden-line pass linear) is `hidden.test.ts`'s, and the cost
// of the keys `cost.test.ts`'s.
import { describe } from 'vitest';
import { type Script, scriptRows, type Step } from './script.ts';

interface Row {
  name: string;
  doc: string;
  keys: Step[];
  others?: string;
  off?: Script['expect'];
  on?: Script['expect'];
  skipOff?: Script['skip'];
  skipOn?: Script['skip'];
  lineBreakMarks?: boolean;
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) =>
    (
      [
        [false, row.off, row.skipOff],
        [true, row.on, row.skipOn],
      ] as const
    ).map(([tc, want, skip]) => ({
      name: `${row.name}, Track Changes ${tc ? 'on' : 'off'}`,
      doc: row.doc,
      keys: row.keys,
      tc,
      expect: want ?? {},
      ...(row.others ? { others: row.others } : {}),
      ...(skip ? { skip } : {}),
      ...(row.lineBreakMarks !== undefined ? { lineBreakMarks: row.lineBreakMarks } : {}),
    })),
  );

const SELF_CHECK =
  "This edit can't be made with Track Changes off without changing other text or the changes around it. Accept or reject those changes first, or turn on Track Changes.";
const TWO_BREAKS =
  'The format writes the break as two line breaks that read as one, where a plain blank line would change what renders (#136, chunk C)';
const SELECTION =
  'Backspace right after a Return over a selection joins again and leaves the deleted text deleted';

describe('the linked issues', () => {
  scriptRows(
    both([
      {
        name: '#143: Return at the start of the first item, then typing on',
        doc: '- ‸café 42',
        keys: ['Enter', { type: 'new words' }],
        off: { caret: '- ⏎- new words‸café 42' },
        on: { caret: '- <ins><split>⏎- new words‸</ins>café 42' },
      },
      {
        name: '#143: Return at the start of a later item, then typing on',
        doc: '- one⏎- ‸café 42',
        keys: ['Enter', { type: 'x' }],
        off: { caret: '- one⏎- ⏎- x‸café 42' },
        on: { caret: '- one⏎- <ins><split>⏎- x‸</ins>café 42' },
      },
      {
        name: '#136: Return at the end of a quote whose last line is lazy, another quote after it',
        doc: '> A long quote that⏎wraps lazily.‸⏎> q',
        keys: ['Enter'],
        skipOn: { 'stray-blank-line': TWO_BREAKS },
      },
      {
        name: '#136: Return at the end of a paragraph that a fence-like line follows',
        doc: 'One two.‸⏎```a`b`',
        keys: ['Enter'],
        skipOn: { 'stray-blank-line': TWO_BREAKS },
      },
      {
        name: '#130: Return at the end of a quote with an autolink, then typing',
        doc: '> See <https://x.org>.‸⏎⏎After.',
        keys: ['Enter', { type: 'x' }],
        off: { caret: '> See <https://x.org>.⏎>⏎> x‸⏎⏎After.' },
        on: { caret: '> See <https://x.org>.⏎>⏎> <ins>⏎>⏎> x‸</ins>⏎⏎After.' },
      },
      {
        name: '#120: Return in a list item, then text typed right after it',
        doc: '- one ‸two',
        keys: ['Enter', { type: 'new' }],
        off: { caret: '- one ⏎- new‸two' },
        on: { caret: '- one <ins><split>⏎- new‸</ins>two' },
      },
      {
        name: '#120: Return after two spaces',
        doc: 'One  ‸two.',
        keys: ['Enter'],
      },
      {
        name: "#112: Return at the end of the line above another person's line break",
        doc: 'One‸<split>⏎two.',
        others: 'bo',
        keys: ['Enter'],
      },
      {
        name: "#112: Return at the start of the line below another person's line break",
        doc: 'One<split>⏎‸two.',
        others: 'bo',
        keys: ['Enter'],
      },
      {
        name: "#102: Return at the start of a numbered list's first item",
        doc: '1. ‸gamma beta⏎2. delta⏎⏎End',
        keys: ['Enter'],
      },
      {
        name: "#107: a heading typed at the start of the paragraph after another person's split",
        doc: 'alpha <split>⏎⏎‸beta',
        others: 'bo',
        keys: [{ type: '## x' }],
        // Still refused, #107 open: the block insertion would read differently by the order.
        off: { refusal: SELF_CHECK },
        on: {
          refusal:
            "This edit would leave bo's line break right next to your insertion, and deciding one would change the other. Decide bo's line break first.",
        },
      },
      {
        name: "#109: Delete twice at the end of the line above another person's split",
        doc: 'new‸<split>⏎words',
        others: 'bo',
        keys: ['Delete', 'Delete'],
        // The second Delete is refused (#109 open); the first is a join of bo's break.
        on: {
          refusal:
            "This edit would leave bo's line break right next to your deletion, and deciding one would change the other. Decide bo's line break first.",
        },
      },
      {
        name: "#119: Backspace at the start of the line of another person's split in an item",
        doc: '- one⏎new<split>⏎  ‸two',
        others: 'bo',
        keys: ['Backspace'],
        // Refused with Track Changes on, #119 open.
        on: {
          refusal:
            "A marker can't go in a line's indentation, or in front of or inside its list marker, quote marker or heading #s.",
        },
      },
      {
        name: '#154: list keys under front matter closed by ...',
        doc: '---⏎title: x⏎...⏎⏎- one‸',
        keys: ['Enter', 'Enter', 'Backspace'],
      },
      {
        name: '#35: a selection of spaces and Return: the spaces are replaced',
        doc: 'One⟦  ⟧two.',
        keys: ['Enter'],
        off: { caret: 'One⏎⏎‸two.' },
        on: { caret: 'One<del   ><split>⏎⏎‸two.' },
        skipOff: { 'take-back': SELECTION },
        skipOn: { 'take-back': SELECTION },
      },
      {
        name: '#198: Return twice at the end of a task item: an empty box, then out of the list',
        doc: '- [ ] task‸',
        keys: ['Enter', 'Enter'],
        off: { caret: '- [ ] task⏎⏎‸' },
        on: { caret: '- [ ] task<split>⏎⏎‸' },
      },
      {
        name: '#204: Backspace in an empty nested item at two spaces',
        doc: '- one⏎  - ‸',
        keys: ['Backspace'],
      },
      {
        name: '#204: Backspace in an empty item four levels down',
        doc: '- a⏎  - b⏎    - c⏎      - ‸',
        keys: ['Backspace'],
      },
      {
        name: "#204: Return at the end of a numbered step's last paragraph",
        doc: '1. a⏎⏎   b‸',
        keys: ['Enter'],
        off: { caret: '1. a⏎⏎   b⏎2. ‸' },
        on: { caret: '1. a⏎⏎   b<split>⏎2. ‸' },
      },
      {
        name: "#204: Backspace in front of an item's second paragraph",
        doc: '- a⏎⏎  ‸b',
        keys: ['Backspace'],
        off: { caret: '- a‸b' },
        on: { caret: '- a‸<del ⏎⏎  >b' },
      },
      // The same three keys in the other shapes of numbered steps and nested items: not refused,
      // and every invariant held (the cases above were found in one shape each).
      ...[
        '1) a⏎⏎   b‸',
        '9. a⏎⏎   b‸⏎10. c',
        '10. a⏎⏎    b‸',
        '1. a⏎⏎   b‸⏎2. c⏎3. d',
        '1. a⏎   1. x⏎⏎      y‸',
        '> 1. a⏎>⏎>    b‸',
        '1. a⏎⏎   b‸⏎   - sub',
      ].map((doc) => ({
        name: `#204: Return at the end of the last paragraph of a step: ${doc}`,
        doc,
        keys: ['Enter'] as Step[],
      })),
      ...[
        '1. a⏎⏎   ‸b',
        '- a⏎  - b⏎⏎    ‸c',
        '1. a⏎   1. b⏎⏎      ‸c',
        '> - a⏎>⏎>   ‸b',
        '- a⏎⏎  ‸b⏎⏎  c',
        '10. a⏎⏎    ‸b',
      ].map((doc) => ({
        name: `#204: Backspace in front of an item's later paragraph: ${doc}`,
        doc,
        keys: ['Backspace'] as Step[],
      })),
      {
        name: '#204: Backspace in an empty numbered item two levels down',
        doc: '1. a⏎   1. b⏎      1. ‸',
        keys: ['Backspace'],
        off: { caret: '1. a⏎   1. b‸' },
      },
      // Delete in an empty nested item: the format has no place for the marker of a deletion of
      // `  - ` alone at the start of its line, so the break above goes with the item, as Backspace
      // takes it (it was refused with "A line that is only Markdown syntax takes no change.").
      {
        name: '#204: Delete in an empty nested item, an item of its parent’s list after it',
        doc: '- one⏎  - ‸⏎- two',
        keys: ['Delete'],
        off: { caret: '- one⏎- ‸two' },
        on: { caret: '- one<del ⏎  - >⏎- ‸two' },
      },
      {
        name: '#204: Delete in an empty nested item, a sibling after it',
        doc: '- one⏎  - ‸⏎  - two',
        keys: ['Delete'],
        off: { caret: '- one⏎  - ‸two' },
        on: { caret: '- one<del ⏎  - >⏎  - ‸two' },
      },
      {
        name: '#204: Delete in an empty nested numbered item',
        doc: '1. one⏎   1. ‸⏎2. two',
        keys: ['Delete'],
        off: { caret: '1. one⏎2. ‸two' },
        on: { caret: '1. one<del ⏎   1. >⏎2. ‸two' },
      },
      {
        name: '#204: Delete in an empty item three levels down',
        doc: '- a⏎  - b⏎    - ‸⏎  - c',
        keys: ['Delete'],
        off: { caret: '- a⏎  - b⏎  - ‸c' },
        on: { caret: '- a⏎  - b<del ⏎    - >⏎  - ‸c' },
      },
      // The text of a nested item deleted again. Under a line of text an empty bullet is the
      // underline of a heading and an empty numbered item is more of the text, so the item the
      // person typed in (Return, Tab, text) and emptied by Backspace is open again, as it was before
      // the text: the file never held it, and read the text above as a heading while the editor drew
      // an empty item.
      {
        name: '#204: Backspace over the only character of a new nested item: the item is open',
        doc: '- one‸',
        keys: ['Enter', 'Tab', { type: 'x' }, 'Backspace'],
        off: { file: '- one', caret: '- one⏎  - ‸' },
        on: { file: '- one', caret: '- one<split>⏎  - ‸' },
      },
      {
        name: '#204: …and the next Backspace takes it away',
        doc: '- one‸',
        keys: ['Enter', 'Tab', { type: 'x' }, 'Backspace', 'Backspace'],
        off: { file: '- one', caret: '- one‸' },
        on: { file: '- one', caret: '- one‸' },
      },
      {
        name: '#204: …or text typed in it again is written',
        doc: '- one‸',
        keys: ['Enter', 'Tab', { type: 'x' }, 'Backspace', { type: 'y' }],
        off: { file: '- one⏎  - y' },
        on: { file: '- one<ins><split>⏎  - y</ins>' },
      },
      {
        name: '#204: a numbered step, typed in and deleted',
        doc: '1. one‸',
        keys: ['Enter', 'Tab', { type: 'x' }, 'Backspace'],
        off: { file: '1. one', caret: '1. one⏎   1. ‸' },
        on: { file: '1. one', caret: '1. one<split>⏎   1. ‸' },
      },
      {
        name: '#204: an item the file holds, its one character deleted',
        doc: '- one⏎  - x‸',
        keys: ['Backspace'],
        off: { file: '- one', caret: '- one⏎  - ‸' },
        on: { caret: '- one‸<del ⏎  - x>' },
      },
      {
        name: '#204: ⌘Z gives the item and its text back',
        doc: '- one⏎  - x‸',
        keys: ['Backspace', 'Mod-z'],
        off: { file: '- one⏎  - x' },
        on: { file: '- one⏎  - x' },
      },
      {
        name: '#204: an item of the list at the top level keeps its empty item, which is sound there',
        doc: '- one⏎- x‸',
        keys: ['Backspace'],
        off: { file: '- one⏎- ' },
        on: { caret: '- one‸<del ⏎- x>' },
      },
      ...[false, true].flatMap((marks) => [
        {
          name: `#161: Return then Backspace, line break marks ${marks ? 'shown' : 'hidden'}`,
          doc: 'One ‸two.⏎⏎Next.',
          keys: ['Enter', 'Backspace'] as Step[],
          lineBreakMarks: marks,
        },
        {
          name: `#161: a join by Backspace, line break marks ${marks ? 'shown' : 'hidden'}`,
          doc: 'One.⏎⏎‸Two.',
          keys: ['Backspace'] as Step[],
          lineBreakMarks: marks,
        },
      ]),
    ]),
  );
});
