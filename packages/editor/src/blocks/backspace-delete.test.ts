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

/**
 * The format refuses a blank line written in front of a numbered item other than 1 together with
 * the join or the unlisting that needs it, with Track Changes on (design: the Call on numbered
 * joins). Without it, the item would become text of the paragraph: refusing is the lesser harm,
 * until the format writes it.
 */
/**
 * With Track Changes on the format has no form for taking the syntax off the first line of the
 * document, a list's marker or a quote's (it would put a marker in front of it), nor for deleting
 * a block of syntax alone there. Format rules wanted; refused with the format's words until then.
 */
const AT_THE_START =
  "A marker can't go in a line's indentation, or in front of or inside its list marker, quote marker or heading #s.";
const SYNTAX_ONLY = 'A line that is only Markdown syntax takes no change.';

/** The design's: Backspace right after a Return over a selection joins, the text stays deleted. */
const SELECTION_TAKE_BACK =
  'Backspace right after a Return over a selection joins the blocks again and leaves the deleted text deleted';

const NUMBERED_REFUSAL =
  'A line break typed here would be read as a different break once the changes are made together. Make the changes one at a time.';

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
        on: { caret: 'Head‸<del ⏎===⏎⏎>Two.<ins><split>⏎===</ins>', newest: 'HeadTwo.⏎===' },
        skipOn: {
          render:
            "The format writes the moved underline as an insertion whose closer ends its line, which micromark doesn't read as an underline (chunk C's setext row, a format issue)",
        },
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
        on: { caret: '<del - ⏎⏎>⏎⏎‸Para.' },
      },
      {
        name: 'the block above is code: the caret goes to its end, nothing is deleted',
        doc: '```⏎code⏎```⏎⏎‸Para.',
        keys: BS,
        ...same('```⏎code‸⏎```⏎⏎Para.'),
      },
      {
        name: 'the block above is a table: the caret goes to its end',
        doc: '| a | b |⏎| - | - |⏎| 1 | 2 |⏎⏎‸After.',
        keys: BS,
        ...same('| a | b |⏎| - | - |⏎| 1 | 2 |‸⏎⏎After.'),
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
        on: { caret: '- one‸<del ⏎  - >⏎⏎Next.' },
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
        on: { caret: 'Para.‸⏎⏎2. one⏎3. two', refusal: NUMBERED_REFUSAL },
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
        on: { caret: '- a⏎⏎1. ‸b⏎2. c', refusal: NUMBERED_REFUSAL },
      },
    ]),
  );
});

describe('At the start of the document, Track Changes on: refused by the format', () => {
  scriptRows(
    both([
      {
        name: 'the first item of a list at the start of the document: out of the list',
        doc: '- ‸one⏎- two',
        keys: BS,
        off: { caret: '‸one⏎- two' },
        on: { caret: '- ‸one⏎- two', refusal: AT_THE_START },
      },
      {
        name: 'the first paragraph of a longer quote at the start of the document',
        doc: '> ‸One.⏎>⏎> Two.',
        keys: BS,
        off: { caret: '‸One.⏎⏎> Two.' },
        on: { caret: '> ‸One.⏎>⏎> Two.', refusal: AT_THE_START },
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
