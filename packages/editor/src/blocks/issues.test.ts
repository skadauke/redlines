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
