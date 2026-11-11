// @vitest-environment happy-dom
// Backspace and Delete at block edges, with no Return to take back (design: block editing,
// "Backspace and Delete at block edges"), with Track Changes off and on. `caret` is the text as it
// is, with the caret; the file never holds an empty paragraph. A list item's start with an item
// above it is the ladder's (`list-ladder.test.ts`).
import { describe } from 'vitest';
import { type Script, scriptRows, type Step } from './script.ts';

interface Row {
  name: string;
  doc: string;
  keys: Step[];
  others?: string;
  off: Script['expect'];
  on: Script['expect'];
  skipOff?: Script['skip'];
  skipOn?: Script['skip'];
}

/** Each row with Track Changes off and on. */
const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) => [
    {
      name: `${row.name}, Track Changes off`,
      doc: row.doc,
      keys: row.keys,
      tc: false,
      expect: row.off,
      ...(row.others ? { others: row.others } : {}),
      ...(row.skipOff ? { skip: row.skipOff } : {}),
    },
    {
      name: `${row.name}, Track Changes on`,
      doc: row.doc,
      keys: row.keys,
      tc: true,
      expect: row.on,
      ...(row.others ? { others: row.others } : {}),
      ...(row.skipOn ? { skip: row.skipOn } : {}),
    },
  ]);

/** The same text and caret in both modes. */
const same = (caret: string) => ({ off: { caret }, on: { caret } });

/** The Backspace and Delete keys at an edge, with their Mac variants. */
const BS: Step[] = ['Backspace'];
const DEL: Step[] = ['Delete'];

/** The words for taking the first numbered item out of its list at the start of the file. */
const FIRST_NUMBERED =
  "This item can't leave its list while Track Changes is on: a line below it (a number other than 1, an empty item or an underline) would read as part of its text. Take the marker out with Track Changes off, or move the lines below it first.";

/** Track Changes off leaves the next line as the text it reads as: no item to read (a known untracked key). */
const UNTRACKED_TEXT =
  'The untracked key leaves the line below as text of the paragraph, as it reads.';

/** The format's words for lines below a first prefix that a pending change makes read otherwise. */
const BELOW_PENDING =
  'The next lines would read as part of this text without the marker, or read differently with the pending changes in them. Accept or reject the changes below first, or take the marker out with Track Changes off.';

/** Words for a marker inside another container on the file's first line. */
const DEEP_AT_START =
  "A marker inside a quote or another list can't be taken out of the first line of the file while Track Changes is on. Turn Track Changes off for this change, or start the file with a line of text first.";

/** Words for a join onto a setext heading: its underline can't be written again behind a marker. */
const SETEXT_JOIN =
  "A heading underlined with === or --- can't take the block below it while Track Changes is on: its underline would have to be written again after the new text, behind a marker, where it would no longer be an underline. Join them with Track Changes off.";

const SYNTAX_ONLY = 'A line that is only Markdown syntax takes no change.';

/** The design's: Backspace right after a Return over a selection joins, the text stays deleted. */
const SELECTION_TAKE_BACK =
  'Backspace right after a Return over a selection joins the blocks again and leaves the deleted text deleted';

describe('Backspace at the start of a block', () => {
  scriptRows(
    both([
      {
        name: 'a paragraph after a paragraph: joins',
        doc: 'One.⏎⏎‸Two.',
        keys: BS,
        off: { file: 'One.Two.', caret: 'One.‸Two.' },
        on: { caret: 'One.‸<del ⏎⏎>Two.', newest: 'One.Two.' },
      },
      {
        name: 'a heading after a paragraph: its text becomes body text of the paragraph',
        doc: 'One.⏎⏎## ‸Two',
        keys: BS,
        off: { caret: 'One.‸Two' },
        on: { caret: 'One.‸<del ⏎⏎## >Two' },
      },
      {
        name: 'a paragraph after a heading: the text joins the heading',
        doc: '## Head⏎⏎‸Two.',
        keys: BS,
        off: { caret: '## Head‸Two.' },
        on: { caret: '## Head‸<del ⏎⏎>Two.' },
      },
      {
        name: 'a paragraph after a setext heading: the underline goes after the joined text',
        doc: 'Head⏎===⏎⏎‸Two.',
        keys: BS,
        off: { caret: 'Head‸Two.⏎===' },
        on: { caret: 'Head⏎===⏎⏎‸Two.', refusal: SETEXT_JOIN },
      },
      {
        name: 'Delete at the end of a setext heading, a paragraph after it',
        doc: 'Head‸⏎---⏎⏎Two.',
        keys: DEL,
        off: { caret: 'Head‸Two.⏎---' },
        on: { caret: 'Head‸⏎---⏎⏎Two.', refusal: SETEXT_JOIN },
      },
      {
        name: 'a paragraph after a setext heading in a quote',
        doc: '> Head⏎> ===⏎>⏎> ‸Two.',
        keys: BS,
        off: { caret: '> Head‸Two.⏎> ===' },
        on: { caret: '> Head⏎> ===⏎>⏎> ‸Two.', refusal: SETEXT_JOIN },
      },
      {
        name: 'a paragraph after a setext heading in an item',
        doc: '- Head⏎  ===⏎⏎  ‸Two.',
        keys: BS,
        off: { caret: '- Head‸Two.⏎  ===' },
        on: { caret: '- Head⏎  ===⏎⏎  ‸Two.', refusal: SETEXT_JOIN },
      },
      {
        name: 'a setext heading after a paragraph: its underline goes too',
        doc: 'One.⏎⏎‸Two⏎===',
        keys: BS,
        off: { caret: 'One.‸Two' },
        on: { caret: 'One.‸<del ⏎⏎>Two<del ⏎===>' },
      },
      {
        name: 'a paragraph after a list: joins into the last item',
        doc: '- b⏎⏎‸Para.',
        keys: BS,
        off: { caret: '- b‸Para.' },
        on: { caret: '- b‸<del ⏎⏎>Para.' },
      },
      {
        name: 'a paragraph after a quote: joins into its last paragraph',
        doc: '> One.⏎>⏎> Two.⏎⏎‸After.',
        keys: BS,
        off: { caret: '> One.⏎>⏎> Two.‸After.' },
        on: { caret: '> One.⏎>⏎> Two.‸<del ⏎⏎>After.' },
      },
      {
        name: 'the block above is an empty heading: it goes, this one keeps its kind',
        doc: '## ⏎⏎‸Two.',
        keys: BS,
        off: { file: 'Two.', caret: '‸Two.' },
        on: { caret: '<del ## ⏎⏎>⏎⏎‸Two.', newest: 'Two.' },
      },
      {
        name: 'the block above is an empty item: it goes',
        doc: '- ⏎⏎‸Para.',
        keys: BS,
        off: { caret: '‸Para.' },
        on: { caret: '<del - ⏎⏎>⏎⏎‸Para.', newest: 'Para.' },
      },
      {
        name: 'the block above is code: the caret goes to its end, nothing is deleted',
        doc: '```⏎code⏎```⏎⏎‸Para.',
        keys: BS,
        ...same('```⏎code‸⏎```⏎⏎Para.'),
      },
      {
        name: 'the block above is a table: the caret goes to the end of its last cell',
        doc: '| a | b |⏎| - | - |⏎| 1 | 2 |⏎⏎‸After.',
        keys: BS,
        ...same('| a | b |⏎| - | - |⏎| 1 | 2‸ |⏎⏎After.'),
      },
      {
        name: 'the block above is an HTML block: the caret goes to its end',
        doc: '<div>⏎hi⏎</div>⏎⏎‸After.',
        keys: BS,
        ...same('<div>⏎hi⏎</div>‸⏎⏎After.'),
      },
      {
        name: 'the block above is a link reference definition: the caret goes to its end',
        doc: '[a]: /url⏎⏎‸After.',
        keys: BS,
        ...same('[a]: /url‸⏎⏎After.'),
      },
      {
        name: 'the block above is front matter: nothing',
        doc: '---⏎title: x⏎---⏎⏎‸Body.',
        keys: BS,
        ...same('---⏎title: x⏎---⏎⏎‸Body.'),
      },
      {
        name: 'the block above is a thematic break: the rule is deleted',
        doc: 'One.⏎⏎---⏎⏎‸Two.',
        keys: BS,
        off: { caret: 'One.⏎⏎‸Two.' },
        on: { caret: 'One.<del ⏎⏎--->⏎⏎‸Two.', newest: 'One.⏎⏎Two.' },
      },
      {
        name: 'the first block of the document: nothing',
        doc: '‸One.⏎⏎Two.',
        keys: BS,
        ...same('‸One.⏎⏎Two.'),
      },
      {
        name: 'the first paragraph of a quote of one paragraph: out of the quote',
        doc: 'Para.⏎⏎> ‸One two.',
        keys: BS,
        off: { caret: 'Para.⏎⏎‸One two.' },
        on: { caret: 'Para.⏎⏎<fmt was=quote>⏎⏎‸One two.</fmt>' },
      },
      {
        name: 'the first paragraph of a longer quote: out of it, the rest stays a quote',
        doc: 'Para.⏎⏎> ‸One.⏎>⏎> Two.',
        keys: BS,
        off: { caret: 'Para.⏎⏎‸One.⏎⏎> Two.' },
        on: { caret: 'Para.<del ⏎⏎> ><split>⏎⏎‸One.⏎>⏎> Two.', newest: 'Para.⏎⏎One.⏎>⏎> Two.' },
      },
      {
        name: 'the first paragraph of a longer quote, of two lines: each line taken out',
        doc: 'Para.⏎⏎> ‸One⏎> more.⏎>⏎> Two.',
        keys: BS,
        off: { caret: 'Para.⏎⏎‸One⏎more.⏎⏎> Two.' },
        on: { caret: 'Para.<del ⏎⏎> ><split>⏎⏎‸One<sub ⏎> more.>⏎more.</sub>⏎>⏎> Two.' },
      },
      {
        name: 'a quote right under a paragraph: out of it, with a blank line above',
        doc: 'Para.⏎> ‸One.⏎>⏎> Two.',
        keys: BS,
        off: { caret: 'Para.⏎⏎‸One.⏎⏎> Two.' },
        on: { caret: 'Para.<del ⏎> ><split>⏎⏎‸One.⏎>⏎> Two.' },
      },
      {
        name: 'the first paragraph of a quote in a quote: out of the inner one',
        doc: '> > x⏎>⏎> > ‸One.',
        keys: BS,
        off: { caret: '> > x⏎>⏎> ‸One.' },
        on: { caret: '> > x<del ⏎>⏎> > ><split>⏎>⏎> ‸One.' },
      },
      {
        name: 'a later paragraph of a quote: joins the paragraph above, in the quote',
        doc: '> One.⏎>⏎> ‸Two.',
        keys: BS,
        off: { caret: '> One.‸Two.' },
        on: { caret: '> One.‸<del ⏎>⏎> >Two.' },
      },
      {
        name: 'a later paragraph of a list item: joins the paragraph above, its indentation with the break (#204)',
        doc: '- a⏎⏎  ‸b',
        keys: BS,
        off: { caret: '- a‸b' },
        on: { caret: '- a‸<del ⏎⏎  >b' },
      },
      {
        name: "another person's line break: a deletion that belongs to their split",
        doc: 'One<split>⏎⏎‸two.',
        others: 'bo',
        keys: BS,
        off: { caret: 'One‸two.' },
        on: { caret: 'One‸<split><del ⏎⏎>two.' },
      },
    ]),
  );
});

describe('Backspace in an empty block', () => {
  scriptRows(
    both([
      {
        name: 'an empty nested item: it goes with the break above it, no stray marker (#204)',
        doc: '- one⏎  - ‸',
        keys: BS,
        off: { file: '- one', caret: '- one‸' },
        on: { caret: '- one‸<sub ⏎  - > </sub>', newest: '- one ' },
      },
      {
        name: 'an empty item two levels down (#204)',
        doc: '- one⏎  - two⏎    - ‸',
        keys: BS,
        off: { caret: '- one⏎  - two‸' },
        on: { caret: '- one⏎  - two‸<sub ⏎    - > </sub>' },
      },
      {
        name: 'an empty nested item with a paragraph after the list (#204)',
        doc: '- one⏎  - ‸⏎⏎Next.',
        keys: BS,
        off: { caret: '- one‸⏎⏎Next.' },
        on: { caret: '- one‸<del ⏎  - ⏎⏎>Next.' },
      },
      {
        name: 'an empty heading: it goes, the caret at the start of the next block',
        doc: '## ‸⏎⏎Two.',
        keys: BS,
        off: { caret: '‸Two.' },
        on: { caret: '<del ## ⏎⏎>⏎⏎‸Two.' },
      },
      {
        name: 'an empty code block: it goes whole',
        doc: 'One.⏎⏎```⏎‸⏎```⏎⏎Two.',
        keys: BS,
        off: { caret: 'One.‸⏎⏎Two.' },
        on: { caret: 'One.‸<del ⏎⏎```⏎⏎```>⏎⏎Two.' },
      },
      {
        name: 'the empty paragraph, the Return that opened it no longer in the record: it goes',
        doc: 'One.‸⏎⏎Two.',
        keys: ['Enter', { type: 'x' }, 'Backspace', 'Backspace'],
        ...same('One.‸⏎⏎Two.'),
      },
    ]),
  );
});

describe('Backspace and Delete in code', () => {
  scriptRows(
    both([
      {
        name: "Backspace at the start of code's first line: nothing",
        doc: '```⏎‸code⏎```',
        keys: BS,
        ...same('```⏎‸code⏎```'),
      },
      {
        name: "Delete at the end of code's last line: nothing",
        doc: '```⏎code‸⏎```',
        keys: DEL,
        ...same('```⏎code‸⏎```'),
      },
    ]),
  );
});

describe('Delete at the end of a block', () => {
  scriptRows(
    both([
      {
        name: 'a paragraph: joins the next',
        doc: 'One.‸⏎⏎Two.',
        keys: DEL,
        off: { caret: 'One.‸Two.' },
        on: { caret: 'One.‸<del ⏎⏎>Two.' },
      },
      {
        name: "a heading's text into this paragraph, which keeps its kind",
        doc: 'One.‸⏎⏎## Two',
        keys: DEL,
        off: { caret: 'One.‸Two' },
        on: { caret: 'One.‸<del ⏎⏎## >Two' },
      },
      {
        name: "a list's first item into this paragraph",
        doc: 'One.‸⏎⏎- two',
        keys: DEL,
        off: { caret: 'One.‸two' },
        on: { caret: 'One.‸<del ⏎⏎- >two' },
      },
      {
        name: 'the next block is empty: it goes',
        doc: 'One.‸⏎⏎## ⏎⏎Three.',
        keys: DEL,
        off: { caret: 'One.‸⏎⏎Three.' },
        on: { caret: 'One.‸<del ⏎⏎## >⏎⏎Three.' },
      },
      {
        name: 'the next block is code: nothing',
        doc: 'One.‸⏎⏎```⏎code⏎```',
        keys: DEL,
        ...same('One.‸⏎⏎```⏎code⏎```'),
      },
      {
        name: 'the next block is a thematic break: it is deleted',
        doc: 'One.‸⏎⏎---⏎⏎Two.',
        keys: DEL,
        off: { caret: 'One.‸⏎⏎Two.' },
        on: { caret: 'One.‸<del ⏎⏎--->⏎⏎Two.' },
      },
      {
        name: 'the last block: nothing',
        doc: 'One.⏎⏎Two.‸',
        keys: DEL,
        ...same('One.⏎⏎Two.‸'),
      },
      {
        name: "an item's end: joins the next item at once",
        doc: '- one‸⏎- two',
        keys: DEL,
        off: { caret: '- one‸two' },
        on: { caret: '- one‸<del ⏎- >two' },
      },
      {
        name: 'in an empty heading: it goes, the next block keeping its kind',
        doc: '## ‸⏎⏎Two.',
        keys: DEL,
        off: { caret: '‸Two.' },
        on: { caret: '<del ## ⏎⏎>⏎⏎‸Two.' },
      },
      {
        name: 'in the empty paragraph right after Return: takes it back, the caret at the next text',
        doc: 'One.‸⏎⏎Two.',
        keys: ['Enter', 'Delete'],
        ...same('One.⏎⏎‸Two.'),
      },
      {
        name: 'in the empty paragraph, no Return in the record: it goes, the caret at the next text',
        doc: 'One.‸⏎⏎Two.',
        keys: ['Enter', { type: 'x' }, 'Backspace', 'Delete'],
        ...same('One.⏎⏎‸Two.'),
      },
      {
        name: 'a numbered item other than 1 left under text keeps a blank line before it',
        doc: 'Para.‸⏎⏎2. one⏎3. two',
        keys: DEL,
        off: { caret: 'Para.‸one⏎⏎3. two' },
        on: { caret: 'Para.‸<sub ⏎⏎2. one>one⏎</sub>⏎3. two' },
      },
      // #248: Delete at the end of a list before a separate list of other markers joins the first
      // item of the list below into the item above, as it does before a list of the same markers
      // (`sameListLevel` is the Return rule's and never reads these keys).
      {
        name: 'a bullet list before a numbered list (#248)',
        doc: '- b‸⏎⏎3. c',
        keys: DEL,
        off: { caret: '- b‸c' },
        on: { caret: '- b‸<del ⏎⏎3. >c', newest: '- bc' },
      },
      {
        name: 'a numbered list before a bullet list (#248)',
        doc: '1. b‸⏎⏎- c⏎- d',
        keys: DEL,
        off: { caret: '1. b‸c⏎- d' },
        on: { caret: '1. b‸<del ⏎⏎- >c⏎- d' },
      },
      {
        name: 'a bullet list before a list of another bullet, in a quote (#248)',
        doc: '> - b‸⏎>⏎> + c',
        keys: DEL,
        off: { caret: '> - b‸c' },
        on: { caret: '> - b‸<del ⏎>⏎> + >c' },
      },
      {
        name: 'a numbered list before another numbered list (#248)',
        doc: '1. b‸⏎⏎1) c',
        keys: DEL,
        off: { caret: '1. b‸c' },
        on: { caret: '1. b‸<del ⏎⏎1) >c' },
      },
    ]),
  );
});

describe('The first item of a list', () => {
  scriptRows(
    both([
      {
        name: 'of a nested list: up one level',
        doc: '- a⏎  - ‸b',
        keys: BS,
        off: { caret: '- a⏎- ‸b' },
        on: { caret: '- a⏎- <fmt was=indent=2>⏎  ‸b</fmt>' },
      },
      {
        name: 'of a list at the top level: out of the list',
        doc: 'Para.⏎⏎- ‸one⏎- two',
        keys: BS,
        off: { caret: 'Para.⏎⏎‸one⏎- two' },
        on: { caret: 'Para.<sub ⏎⏎- one>⏎⏎‸one</sub>⏎- two' },
      },
      {
        name: 'of a one-item list: the block change',
        doc: 'Para.⏎⏎- ‸one',
        keys: BS,
        off: { caret: 'Para.⏎⏎‸one' },
        on: { caret: 'Para.⏎⏎<fmt was=ul>⏎⏎‸one</fmt>' },
      },
      {
        name: 'right under an item of another list: a blank line above it (the lazy-line Call)',
        doc: '- a⏎1. ‸b⏎1. c',
        keys: BS,
        off: { caret: '- a⏎⏎‸b⏎1. c' },
        on: { caret: '- a<del ⏎1. ><split>⏎⏎‸b⏎1. c' },
      },
      {
        name: 'of a numbered list whose next item is not 1: a blank line after it',
        doc: '- a⏎⏎1. ‸b⏎2. c',
        keys: BS,
        off: { caret: '- a⏎⏎‸b⏎⏎2. c' },
        on: { caret: '- a<sub ⏎⏎1. b><split>⏎⏎‸b⏎</sub>⏎2. c' },
      },
    ]),
  );
});

describe('At the start of the document, Track Changes on', () => {
  scriptRows(
    both([
      // #248: the first item's marker, or the quote's, is the mark's text, its opener alone on
      // the first line for the block that stays (the format's `firstPrefix`, §3.3).
      {
        name: 'the first item of a list at the start of the document: out of the list',
        doc: '- ‸one⏎- two',
        keys: BS,
        off: { caret: '‸one⏎- two' },
        on: { caret: '<del - >⏎⏎‸one⏎- two', newest: 'one⏎- two', original: '- one⏎- two' },
      },
      {
        name: 'the first paragraph of a longer quote at the start of the document',
        doc: '> ‸One.⏎>⏎> Two.',
        keys: BS,
        off: { caret: '‸One.⏎⏎> Two.' },
        on: { caret: '<del > >⏎⏎‸One.⏎>⏎> Two.', newest: 'One.⏎>⏎> Two.' },
      },
      {
        name: 'the same, with an item of another list after it, and one that holds a list',
        doc: '- ‸a⏎1. b',
        keys: BS,
        off: { caret: '‸a⏎1. b' },
        on: { caret: '<del - >⏎⏎‸a⏎1. b' },
      },
      {
        name: 'the first item holding a nested list',
        doc: '- ‸one⏎  - two⏎- three',
        keys: BS,
        off: { caret: '‸one⏎  - two⏎- three' },
        on: { caret: '<del - >⏎⏎‸one⏎  - two⏎- three' },
      },
      {
        name: 'a numbered list whose next item is numbered 1',
        doc: '1. ‸a⏎1. b',
        keys: BS,
        off: { caret: '‸a⏎1. b' },
        on: { caret: '<del 1. >⏎⏎‸a⏎1. b' },
      },
      {
        name: 'then text typed, and taken back',
        doc: '- ‸one⏎- two',
        keys: [...BS, { type: 'x' }, 'Mod-z', 'Mod-z'],
        ...same('- ‸one⏎- two'),
      },
      // A numbered item's next one reads as text of its line without a blank line between them,
      // which the format has no place for next to the marker's deletion: refused, in words.
      {
        name: 'the first numbered item at the start of the document: the caret stays at its text (review I1)',
        doc: '1. ‸a⏎2. b',
        keys: BS,
        off: { caret: '‸a⏎⏎2. b' },
        on: { caret: '1. ‸a⏎2. b', refusal: FIRST_NUMBERED },
      },
      {
        name: 'the same with a third item',
        doc: '1. ‸a⏎2. b⏎3. c',
        keys: BS,
        off: { caret: '‸a⏎⏎2. b⏎3. c' },
        on: { caret: '1. ‸a⏎2. b⏎3. c', refusal: FIRST_NUMBERED },
      },
      {
        name: 'a numbered list that starts at 2, and one with a paren',
        doc: '2. ‸a⏎3. b',
        keys: BS,
        off: { caret: '‸a⏎⏎3. b' },
        on: { caret: '2. ‸a⏎3. b', refusal: FIRST_NUMBERED },
      },
      {
        name: 'the first numbered item of a quote at the start of the document',
        doc: '> 1. ‸a⏎> 2. b',
        keys: BS,
        off: { caret: '> ‸a⏎>⏎> 2. b' },
        on: { caret: '> 1. ‸a⏎> 2. b', refusal: FIRST_NUMBERED },
      },
      // #248 review: a task item is a first prefix too; a line below that would read as text of the
      // item, or that a pending change empties, keeps the item in its list, in words.
      {
        name: 'the first task item at the start of the document',
        doc: '- [ ] ‸one⏎- two',
        keys: BS,
        off: { caret: '‸one⏎- two' },
        on: { caret: '<del - [ ] >⏎⏎‸one⏎- two', newest: 'one⏎- two' },
      },
      {
        name: 'a bullet above an item numbered other than 1',
        doc: '- ‸a⏎2. b',
        keys: BS,
        off: { caret: '‸a⏎2. b' },
        on: { caret: '- ‸a⏎2. b', refusal: FIRST_NUMBERED },
        skipOff: { 'list-reads': UNTRACKED_TEXT },
      },
      {
        name: 'a bullet above an empty item',
        doc: '- ‸a⏎- ',
        keys: BS,
        off: { caret: '‸a⏎- ' },
        on: { caret: '- ‸a⏎- ', refusal: FIRST_NUMBERED },
        skipOff: { 'list-reads': UNTRACKED_TEXT },
      },
      {
        name: "a bullet above an item that another person's deletion empties",
        doc: '- ‸one⏎- <del two>',
        keys: BS,
        others: 'bo',
        off: { caret: '‸one⏎- <del two>' },
        on: { caret: '- ‸one⏎- <del two>', refusal: BELOW_PENDING },
        skipOff: {
          render:
            'The untracked key takes the bullet out in front of an item that a pending deletion empties, which reads as a heading (a known gap of the untracked keys, filed with the walk findings)',
        },
      },
      {
        name: 'a quote inside a quote, and a list inside a quote, at the start of the document',
        doc: '> > ‸One.⏎> >⏎> > Two.',
        keys: BS,
        off: { caret: '> ‸One.⏎> ⏎> > Two.' },
        on: { caret: '> > ‸One.⏎> >⏎> > Two.', refusal: DEEP_AT_START },
      },
      {
        name: 'the first item of a list in a quote',
        doc: '> - ‸a⏎> - b',
        keys: BS,
        off: { caret: '> ‸a⏎> - b' },
        on: { caret: '> - ‸a⏎> - b', refusal: DEEP_AT_START },
      },
      {
        name: 'an empty code block at the start of the document',
        doc: '```⏎‸⏎```⏎⏎Two.',
        keys: BS,
        off: { caret: '‸Two.' },
        on: { caret: '```⏎‸⏎```⏎⏎Two.', refusal: SYNTAX_ONLY },
      },
    ]),
  );
});

describe('Option and Command at an edge', () => {
  scriptRows(
    both([
      {
        name: 'Option-Backspace at the start of a block: as Backspace',
        doc: 'One.⏎⏎‸Two.',
        keys: ['Alt-Backspace'],
        off: { caret: 'One.‸Two.' },
        on: { caret: 'One.‸<del ⏎⏎>Two.' },
      },
      {
        name: 'Command-Backspace at the start of a block: as Backspace',
        doc: 'One.⏎⏎‸Two.',
        keys: ['Mod-Backspace'],
        off: { caret: 'One.‸Two.' },
        on: { caret: 'One.‸<del ⏎⏎>Two.' },
      },
      {
        name: 'Option-Delete at the end of a block: as Delete',
        doc: 'One.‸⏎⏎Two.',
        keys: ['Alt-Delete'],
        off: { caret: 'One.‸Two.' },
        on: { caret: 'One.‸<del ⏎⏎>Two.' },
      },
    ]),
  );
});

describe('Selections', () => {
  scriptRows(
    both([
      {
        name: "from a block's start to the next's: the covered block goes whole",
        doc: '⟦One.⏎⏎⟧Two.',
        keys: BS,
        off: { file: 'Two.', caret: '‸Two.' },
        on: { caret: '<del One.⏎⏎>⏎⏎‸Two.' },
      },
      {
        name: "Shift-↓ from a heading's start: the heading goes with its break (Delete)",
        doc: 'Para.⏎⏎## ⟦One.⏎⏎⟧Two.',
        keys: DEL,
        off: { caret: 'Para.⏎⏎‸Two.' },
        on: { caret: 'Para.⏎⏎<del ## One.⏎⏎>⏎⏎‸Two.' },
      },
      {
        name: 'across two blocks: a join, the first keeping its kind',
        doc: '## O⟦ne.⏎⏎Tw⟧o.',
        keys: BS,
        off: { caret: '## O‸o.' },
        on: { caret: '## O<del ne.⏎⏎Tw>‸o.' },
      },
      {
        name: 'select-all then Backspace: one empty paragraph',
        doc: '⟦One.⏎⏎Two.⟧',
        keys: BS,
        off: { file: '', caret: '‸' },
        on: { caret: '<del One.⏎⏎Two.>‸', newest: '' },
      },
      {
        name: 'select-all then Delete: one empty paragraph',
        doc: '⟦## One.⏎⏎- Two.⟧',
        keys: DEL,
        off: { file: '', caret: '‸' },
        on: { caret: '<del ## One.⏎⏎- Two.>‸', newest: '' },
      },
      {
        name: 'select-all then Return: one empty paragraph, the file empty (review B+C I7)',
        doc: '⟦One.⏎⏎Two.⟧',
        keys: ['Enter'],
        off: { file: '', caret: '‸' },
        // With Track Changes on the deletion stays, and the empty paragraph opens in front of it.
        on: { caret: '‸⏎⏎<del One.⏎⏎Two.>', newest: '' },
        skipOff: { 'take-back': SELECTION_TAKE_BACK },
        skipOn: { 'take-back': SELECTION_TAKE_BACK },
      },
      {
        name: 'select-all then Return over a heading, a paragraph and a list: one empty paragraph',
        doc: '⟦# H⏎⏎One.⏎⏎- a⏎- b⟧',
        keys: ['Enter'],
        off: { file: '', caret: '‸' },
        on: { caret: '‸⏎⏎<del # H⏎⏎One.⏎⏎- a⏎- b>', newest: '' },
        skipOff: { 'take-back': SELECTION_TAKE_BACK },
        skipOn: { 'take-back': SELECTION_TAKE_BACK },
      },
      {
        name: 'select-all then Return over a list, then text typed: one paragraph',
        doc: '⟦# H⏎⏎One.⏎⏎- a⏎- b⟧',
        keys: ['Enter', { type: 'X' }],
        off: { file: 'X', caret: 'X‸' },
        on: { newest: 'X⏎⏎' },
      },
      {
        name: 'a selection of two whole blocks ending in a heading, then Return: no empty heading',
        doc: 'Top.⏎⏎⟦One.⏎⏎## Two⟧⏎⏎End.',
        keys: ['Enter'],
        off: { file: 'Top.⏎⏎End.', caret: 'Top.⏎⏎‸⏎⏎End.' },
        on: { caret: 'Top.⏎⏎‸⏎⏎<del One.⏎⏎## Two⏎⏎>⏎⏎End.', newest: 'Top.⏎⏎End.' },
        skipOff: { 'take-back': SELECTION_TAKE_BACK },
        skipOn: { 'take-back': SELECTION_TAKE_BACK },
      },
      {
        name: 'select-all in a quote then Return: one empty paragraph in the quote',
        doc: '> ⟦One.⏎>⏎> Two.⟧',
        keys: ['Enter'],
        off: { file: '', caret: '> ‸' },
        on: { caret: '‸⏎⏎<del > One.⏎>⏎> Two.>', newest: '' },
        skipOff: { 'take-back': SELECTION_TAKE_BACK },
        skipOn: { 'take-back': SELECTION_TAKE_BACK },
      },
      {
        name: 'select-all then typing: the text replaced',
        doc: '⟦One.⏎⏎Two.⟧',
        keys: [{ type: 'x' }],
        off: { file: 'x', caret: 'x‸' },
        on: { newest: 'x' },
      },
    ]),
  );
});

describe('Atoms at an edge', () => {
  scriptRows(
    both([
      {
        name: 'Backspace after an emoji at the start of a block deletes it whole',
        doc: 'One.⏎⏎😀‸Two.',
        keys: BS,
        off: { caret: 'One.⏎⏎‸Two.' },
        on: { newest: 'One.⏎⏎Two.' },
      },
      {
        name: 'Delete at the end of a block after an emoji: joins, the emoji whole',
        doc: '😀‸⏎⏎Two.',
        keys: DEL,
        off: { caret: '😀‸Two.' },
        on: { caret: '😀‸<del ⏎⏎>Two.' },
      },
      {
        name: 'Backspace in front of an emoji at the start of a block: joins, the emoji whole',
        doc: 'One.⏎⏎‸😀Two.',
        keys: BS,
        off: { caret: 'One.‸😀Two.' },
        on: { caret: 'One.‸<del ⏎⏎>😀Two.' },
      },
      {
        name: 'Delete after a combining accent: the sequence stays whole',
        doc: 'Café‸⏎⏎Two.',
        keys: DEL,
        off: { caret: 'Café‸Two.' },
        on: { caret: 'Café‸<del ⏎⏎>Two.' },
      },
      {
        name: 'Backspace in front of a combining sequence: joins, the sequence whole',
        doc: 'One.⏎⏎‸étwo',
        keys: BS,
        off: { caret: 'One.‸étwo' },
        on: { caret: 'One.‸<del ⏎⏎>étwo' },
      },
      {
        name: 'Delete between CJK paragraphs: joins',
        doc: '一二‸⏎⏎三',
        keys: DEL,
        off: { caret: '一二‸三' },
        on: { caret: '一二‸<del ⏎⏎>三' },
      },
    ]),
  );
});

// #248, the walks' findings on main (seeds 332, 511 and 887 of `walk-248` at 1000): each was a
// silent wrong write, a list whose later items the file read as text; now written soundly or refused.
const OUTDENT_NUMBERED =
  'The items after this one would be left numbered from a number other than 1 under its text, where they would read as part of the text. Number them from 1 first, or outdent the whole list.';
const NUMBERED_IN_CONTAINER =
  "This join would make the next numbered item a line of the text, and the blank line that keeps it apart can't be written as a tracked change inside a list or quote. Turn Track Changes off for this join, or start the next list at 1.";

describe('Numbered items that would become text (walk seeds 332, 511, 887)', () => {
  scriptRows([
    ...both([
      {
        name: 'Backspace at the first item of a nested numbered list, items numbered 2 after it (seed 332)',
        doc: '1. a⏎   1. ‸plan⏎   2. ship',
        keys: BS,
        off: { caret: '1. a⏎   1. ‸plan⏎   2. ship', refusal: OUTDENT_NUMBERED },
        on: { caret: '1. a⏎   1. ‸plan⏎   2. ship', refusal: OUTDENT_NUMBERED },
      },
      {
        name: 'Delete at the end of an item before its first nested numbered item, `2)` after it (seed 887)',
        doc: '- plan‸⏎  1) alpha⏎  2) ship',
        keys: DEL,
        off: { caret: '- plan‸alpha⏎⏎  2) ship' },
        on: { caret: '- plan‸⏎  1) alpha⏎  2) ship', refusal: NUMBERED_IN_CONTAINER },
      },
    ]),
    {
      name: 'Delete at the start of a soft-broken line before a numbered item that a deletion ends (seed 511), Track Changes on',
      doc: '1) ship plan<del  >⏎‸   gamma<del z>⏎2) alpha beta',
      keys: DEL,
      tc: true,
      expect: {
        caret: '1) ship plan<del  >⏎‸   gamma<del z>⏎2) alpha beta',
        refusal:
          'A line break typed here would be read as a different break once the changes are made together. Make the changes one at a time.',
      },
    },
  ]);
});
