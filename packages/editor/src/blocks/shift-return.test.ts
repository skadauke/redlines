// @vitest-environment happy-dom
// Shift-Return, Return at the end of an HTML block, and the Option variants (design:
// block editing, "Shift-Return" and "Code, tables, front matter, HTML blocks and rules"; Return in a
// table cell is `table/cell-edit.test.ts`), with
// Track Changes off and on. A hard break is a backslash and a line break.
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

/** The design's: Backspace right after a Return over a selection joins, the text stays deleted. */
const SELECTION_TAKE_BACK =
  'Backspace right after a Return over a selection joins the blocks again and leaves the deleted text deleted';

const ALREADY = 'There is a line break here already. Return starts a new paragraph.';

describe('Shift-Return', () => {
  scriptRows(
    both([
      {
        name: "in the middle of a paragraph's text: a hard line break",
        doc: 'One ‸two.',
        keys: ['Shift-Enter'],
        off: { file: 'One \\⏎two.', caret: 'One \\⏎‸two.' },
        on: { caret: 'One <split>\\⏎‸two.' },
      },
      {
        name: 'in the middle of a list item: the next line at the text column',
        doc: '- One ‸two.',
        keys: ['Shift-Enter'],
        off: { caret: '- One \\⏎  ‸two.' },
        on: { caret: '- One <split>\\⏎  ‸two.' },
      },
      {
        name: "in the middle of a quote: the next line takes the quote's marker",
        doc: '> One ‸two.',
        keys: ['Shift-Enter'],
        off: { caret: '> One \\⏎> ‸two.' },
        on: { caret: '> One <split>\\⏎> ‸two.' },
      },
      {
        name: "at the end of a block's text: what Return does, in this stage",
        doc: 'One two.‸⏎⏎Next.',
        keys: ['Shift-Enter'],
        ...same('One two.⏎⏎‸⏎⏎Next.'),
      },
      {
        name: 'at a soft line break: the backslash in front of the line break there',
        doc: 'One two‸⏎three.',
        keys: ['Shift-Enter'],
        off: { file: 'One two\\⏎three.', caret: 'One two\\⏎‸three.' },
        // The format writes no closer after a typed backslash (rule 11): it replaces the word
        // after it with the backslash in front.
        on: { caret: 'One two<sub ⏎three.>\\⏎‸three.</sub>', newest: 'One two\\⏎three.' },
      },
      {
        name: 'inside emphasis: a hard break inside it',
        doc: '**bold ‸text**',
        keys: ['Shift-Enter'],
        off: { caret: '**bold \\⏎‸text**' },
        on: { caret: '**bold <split>\\⏎‸text**' },
      },
      {
        name: "inside a link's text: a hard break inside it",
        doc: '[the ‸guide](url)',
        keys: ['Shift-Enter'],
        off: { caret: '[the \\⏎‸guide](url)' },
        on: { caret: '[the <split>\\⏎‸guide](url)' },
      },
      {
        name: 'in a code span: the hard break after the span',
        doc: 'A `co‸de` b',
        keys: ['Shift-Enter'],
        off: { caret: 'A `code`\\⏎‸ b' },
        on: { caret: 'A `code`<split>\\⏎‸ b' },
      },
      {
        name: 'over a selection in a paragraph: replaced by the hard break, one step',
        doc: 'O⟦ne t⟧wo.',
        keys: ['Shift-Enter'],
        off: { caret: 'O\\⏎‸wo.' },
        on: { caret: 'O<del ne t><split>\\⏎‸wo.' },
        skipOff: { 'take-back': SELECTION_TAKE_BACK },
        skipOn: { 'take-back': SELECTION_TAKE_BACK },
      },
      {
        name: 'over a selection across blocks: a join, then the hard break',
        doc: 'One.⏎⏎T⟦wo.⏎⏎Th⟧ree.',
        keys: ['Shift-Enter'],
        off: { caret: 'One.⏎⏎T\\⏎‸ree.' },
        on: { caret: 'One.⏎⏎T<del wo.⏎⏎Th><split>\\⏎‸ree.' },
      },
      {
        name: 'right after it, Backspace takes it back',
        doc: 'One ‸two.',
        keys: ['Shift-Enter', 'Backspace'],
        ...same('One ‸two.'),
      },
      {
        name: 'in the empty paragraph: nothing',
        doc: 'One two.‸⏎⏎Next.',
        keys: ['Enter', 'Shift-Enter'],
        ...same('One two.⏎⏎‸⏎⏎Next.'),
      },
      {
        name: 'at the end of a line that has a hard break: refused, saying why (review minor 5)',
        doc: 'One\\‸⏎two.',
        keys: ['Shift-Enter'],
        off: { caret: 'One\\‸⏎two.', refusal: ALREADY },
        on: { caret: 'One\\‸⏎two.', refusal: ALREADY },
      },
      {
        name: 'at the start of the line after a hard break: the same',
        doc: 'One\\⏎‸two.',
        keys: ['Shift-Enter'],
        off: { caret: 'One\\⏎‸two.', refusal: ALREADY },
        on: { caret: 'One\\⏎‸two.', refusal: ALREADY },
      },
      {
        name: 'at the end of a heading: what Return does',
        doc: '## Head‸⏎⏎Body.',
        keys: ['Shift-Enter'],
        ...same('## Head⏎⏎‸⏎⏎Body.'),
      },
      {
        name: 'inside a heading: refused',
        doc: '## Head‸ing',
        keys: ['Shift-Enter'],
        off: { caret: '## Head‸ing', refusal: 'A heading is one line in Markdown.' },
        on: { caret: '## Head‸ing', refusal: 'A heading is one line in Markdown.' },
      },
      {
        name: 'over a selection inside a heading: refused before anything is deleted',
        doc: '## He[ad]ing',
        keys: ['Shift-Enter'],
        off: { caret: '## He[ad]ing', refusal: 'A heading is one line in Markdown.' },
        on: { caret: '## He[ad]ing', refusal: 'A heading is one line in Markdown.' },
      },
      {
        name: 'in code: a line break, as Return (refused in code with Track Changes on)',
        doc: '```⏎co‸de⏎```',
        keys: ['Shift-Enter'],
        off: { caret: '```⏎co⏎‸de⏎```' },
        on: {
          caret: '```⏎co‸de⏎```',
          refusal:
            "A tracked change can't go inside code or an HTML comment, where its markers would not be read. Change the whole code span or comment instead.",
        },
      },
      {
        name: 'in front matter: a line break (refused with Track Changes on, format §3.8)',
        doc: '---⏎title: ‸x⏎---⏎⏎Body.',
        keys: ['Shift-Enter'],
        off: { caret: '---⏎title: ⏎‸x⏎---⏎⏎Body.' },
        on: {
          caret: '---⏎title: ‸x⏎---⏎⏎Body.',
          refusal: "Front matter can't be edited with Track Changes on yet.",
        },
      },
    ]),
  );
});

describe('Return after an HTML block', () => {
  scriptRows(
    both([
      {
        name: "at the end of an HTML block's last line: an empty paragraph after it",
        doc: '<div>⏎hi⏎</div>‸⏎⏎After.',
        keys: ['Enter'],
        ...same('<div>⏎hi⏎</div>⏎⏎‸⏎⏎After.'),
      },
    ]),
  );
});

describe('The Option variants', () => {
  scriptRows(
    both([
      {
        name: 'Option-Return is Return',
        doc: 'One ‸two.',
        keys: ['Alt-Enter'],
        off: { caret: 'One ⏎⏎‸two.' },
        on: { caret: 'One <split>⏎⏎‸two.' },
      },
      {
        name: 'Option-Shift-Return is Shift-Return',
        doc: 'One ‸two.',
        keys: ['Alt-Shift-Enter'],
        off: { caret: 'One \\⏎‸two.' },
        on: { caret: 'One <split>\\⏎‸two.' },
      },
    ]),
  );
});
