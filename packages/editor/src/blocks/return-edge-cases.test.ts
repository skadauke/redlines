// @vitest-environment happy-dom
// Return inside inline syntax, at hard line breaks and over selections (design: block editing, the
// matrix's Paragraphs rows for them), with Track Changes off and on.
import { newestView } from '@redlines/format';
import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { runScript, type Script, scriptRows, type Step } from './script.ts';

interface Row {
  name: string;
  doc: string;
  keys?: Step[];
  off: Script['expect'];
  on: Script['expect'];
  skip?: Script['skip'];
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) =>
    ([false, true] as const).map((tc) => ({
      name: `${row.name}, Track Changes ${tc ? 'on' : 'off'}`,
      doc: row.doc,
      keys: row.keys ?? ['Enter'],
      tc,
      expect: tc ? row.on : row.off,
      ...(row.skip ? { skip: row.skip } : {}),
    })),
  );

const same = (expect: Script['expect']) => ({ off: expect, on: expect });

/**
 * A Return over a selection is recorded without the deletion: Backspace right after it joins the
 * blocks again and leaves the deleted text deleted, as in Word (design: block editing, "Taking a
 * Return back"), so Return then Backspace doesn't give the file back.
 */
const SELECTION = {
  'take-back':
    'A Return over a selection is recorded without its deletion: Backspace joins the blocks again',
};

const IN_SYNTAX: Row[] = [
  {
    name: 'inside bold, a space at the split',
    doc: 'One **bold ‸text** two.',
    off: { file: 'One **bold**⏎⏎ **text** two.', caret: 'One **bold**⏎⏎ **‸text** two.' },
    on: { file: 'One **bold<sub  >**<split>⏎⏎ **</sub>text** two.' },
  },
  {
    name: 'inside bold',
    doc: 'One **bo‸ld** two.',
    off: { file: 'One **bo**⏎⏎**ld** two.', caret: 'One **bo**⏎⏎**‸ld** two.' },
    on: { file: 'One **bo<ins>**<split>⏎⏎**</ins>ld** two.' },
  },
  {
    name: 'inside emphasis',
    doc: 'One *em‸ph* two.',
    off: { file: 'One *em*⏎⏎*ph* two.' },
    on: { file: 'One *em<ins>*<split>⏎⏎*</ins>ph* two.' },
  },
  {
    name: 'inside strikethrough',
    doc: 'One ~~str‸ike~~ two.',
    off: { file: 'One ~~str~~⏎⏎~~ike~~ two.' },
    on: { file: 'One ~~str<ins>~~<split>⏎⏎~~</ins>ike~~ two.' },
  },
  {
    name: 'inside a code span: it is parted as a whole',
    doc: 'One `co‸de` two.',
    off: { file: 'One `co`⏎⏎`de` two.', caret: 'One `co`⏎⏎`‸de` two.' },
    on: {
      file: 'One <sub `code`>`co`<split>⏎⏎`de`</sub> two.',
      caret: 'One <sub `code`>`co`<split>⏎⏎`‸de`</sub> two.',
    },
  },
  {
    name: "inside a link's text: two links, the destination repeated",
    doc: 'Read [the ‸guide](https://x.org) now.',
    off: {
      file: 'Read [the](https://x.org)⏎⏎ [guide](https://x.org) now.',
      caret: 'Read [the](https://x.org)⏎⏎ [‸guide](https://x.org) now.',
    },
    on: { file: 'Read [the<sub  >](https://x.org)<split>⏎⏎ [</sub>guide](https://x.org) now.' },
  },
  {
    name: "inside a heading's bold",
    doc: '## Head **bo‸ld**',
    off: { file: '## Head **bo**⏎⏎## **ld**', caret: '## Head **bo**⏎⏎## **‸ld**' },
    on: { file: '## Head **bo<ins>**<split>⏎⏎## **</ins>ld**' },
  },
  {
    name: "inside a list item's bold",
    doc: '- one **bo‸ld**',
    off: { file: '- one **bo**⏎- **ld**' },
    on: { file: '- one **bo<ins>**<split>⏎- **</ins>ld**' },
  },
];

describe('Return inside inline syntax', () => {
  scriptRows(both(IN_SYNTAX));

  // micromark reads CommonMark, which has no strikethrough.
  it.each(
    IN_SYNTAX.filter((row) => !row.doc.includes('~~')).map((row) => [row.name, row.doc] as const),
  )('renders both halves with no delimiter showing, %s', (_, doc) => {
    for (const tc of [false, true]) {
      const result = runScript({ name: doc, doc, keys: ['Enter'], tc, expect: {} });
      const html = micromark(newestView(result.file).text);
      const text = html.replace(/<[^>]*>/g, '');
      expect(text, `${doc}: ${html}`).not.toMatch(/\*|~~|`|\[|\]/);
    }
  });
});

describe('Return at the edge of inline syntax, or in an atom', () => {
  scriptRows(
    both([
      {
        name: "at the start of bold's text: in front of it",
        doc: 'One **‸bold** two.',
        off: { file: 'One ⏎⏎**bold** two.', caret: 'One ⏎⏎‸**bold** two.' },
        on: { file: 'One <split>⏎⏎**bold** two.' },
      },
      {
        name: "at the end of bold's text: after it",
        doc: 'One **bold‸** two.',
        off: { file: 'One **bold**⏎⏎ two.', caret: 'One **bold**⏎⏎‸ two.' },
        on: { file: 'One **bold**<split>⏎⏎ two.' },
      },
      {
        name: "at the start of a link's text: in front of it",
        doc: 'Read [‸the](u) now.',
        off: { file: 'Read ⏎⏎[the](u) now.' },
        on: { file: 'Read <split>⏎⏎[the](u) now.' },
      },
      {
        name: 'in an image: after it',
        doc: 'One ![al‸t](i.png) two.',
        off: { file: 'One ![alt](i.png)⏎⏎ two.' },
        on: { file: 'One ![alt](i.png)<split>⏎⏎ two.' },
      },
      {
        name: 'in an autolink: after it',
        doc: 'One <https://x.‸org> two.',
        off: { file: 'One <https://x.org>⏎⏎ two.' },
        on: { file: 'One <https://x.org><split>⏎⏎ two.' },
      },
    ]),
  );
});

describe('Return at a hard line break', () => {
  scriptRows(
    both([
      {
        name: 'before it: the hard break becomes the paragraph break',
        doc: 'One ‸\\⏎two.',
        off: { file: 'One ⏎⏎two.', caret: 'One ⏎⏎‸two.' },
        on: { file: 'One <sub \\⏎two.>⏎⏎two.</sub>', caret: 'One <sub \\⏎two.>⏎⏎‸two.</sub>' },
      },
      {
        name: 'after it',
        doc: 'One \\⏎‸two.',
        off: { file: 'One ⏎⏎two.', caret: 'One ⏎⏎‸two.' },
        on: { file: 'One <sub \\⏎two.>⏎⏎two.</sub>' },
      },
      {
        name: 'after a hard break of two spaces',
        doc: 'One··⏎‸two.'.replaceAll('·', ' '),
        off: { file: 'One⏎⏎two.', caret: 'One⏎⏎‸two.' },
        on: {},
      },
    ]),
  );
});

describe('Return over a selection', () => {
  scriptRows(
    both([
      {
        name: 'in one paragraph: two paragraphs',
        doc: 'One [two] three.',
        off: { file: 'One ⏎⏎ three.', caret: 'One ⏎⏎‸ three.' },
        on: { file: 'One <del two><split>⏎⏎ three.', caret: 'One <del two><split>⏎⏎‸ three.' },
        skip: SELECTION,
      },
      {
        name: 'in one paragraph, then Backspace: joined, the text still deleted',
        doc: 'One [two] three.',
        keys: ['Enter', 'Backspace'],
        off: { file: 'One  three.', caret: 'One ‸ three.' },
        on: { file: 'One <del two> three.', caret: 'One <del two>‸ three.' },
      },
      {
        name: 'across two blocks: each keeps its kind, the break untouched',
        doc: 'One [two.⏎⏎Th]ree.',
        off: { file: 'One ⏎⏎ree.', caret: 'One ⏎⏎‸ree.' },
        on: { file: 'One <del two.>⏎⏎<del Th>⏎⏎ree.' },
        skip: SELECTION,
      },
      {
        name: 'across two blocks of different kinds',
        doc: '## One [two⏎⏎Th]ree.',
        off: { file: '## One ⏎⏎ree.', caret: '## One ⏎⏎‸ree.' },
        on: {},
        skip: SELECTION,
      },
      {
        name: 'across three blocks: the blocks inside go whole, one break stays',
        doc: 'First [one.⏎⏎Middle.⏎⏎La]st.',
        off: { file: 'First ⏎⏎st.', caret: 'First ⏎⏎‸st.' },
        on: { file: 'First <del one.⏎⏎Middle.>⏎⏎<del La>⏎⏎st.' },
        skip: SELECTION,
      },
      {
        name: "of all of one block's text: an empty paragraph",
        doc: 'Before.⏎⏎[One two.]⏎⏎Next.',
        off: { file: 'Before.⏎⏎Next.', caret: 'Before.⏎⏎‸⏎⏎Next.' },
        // The block's deletion stays, and the empty paragraph opens in the break in front of it.
        on: {
          file: 'Before.⏎⏎<del One two.⏎⏎>⏎⏎Next.',
          caret: 'Before.⏎⏎‸⏎⏎<del One two.⏎⏎>⏎⏎Next.',
        },
        skip: SELECTION,
      },
      {
        name: "of all of one block's text, then text typed",
        doc: 'Before.⏎⏎[One two.]⏎⏎Next.',
        keys: ['Enter', { type: 'X' }],
        off: { file: 'Before.⏎⏎X⏎⏎Next.' },
        on: { file: 'Before.⏎⏎<ins>⏎⏎X</ins>⏎⏎<del One two.⏎⏎>⏎⏎Next.' },
      },
    ]),
  );
});

describe('Return before a block that takes no text, with no paragraph above it', () => {
  scriptRows(
    both([
      {
        name: 'the opening fence of code that starts the document',
        doc: '‸```⏎code⏎```',
        ...same({ file: '```⏎code⏎```', caret: '⏎⏎‸```⏎code⏎```' }),
      },
      {
        name: "a table's first |",
        doc: '‸| a | b |⏎| - | - |⏎| 1 | 2 |',
        ...same({
          file: '| a | b |⏎| - | - |⏎| 1 | 2 |',
          caret: '⏎⏎‸| a | b |⏎| - | - |⏎| 1 | 2 |',
        }),
      },
      {
        name: 'an HTML block',
        doc: '‸<div>⏎x⏎</div>',
        ...same({ file: '<div>⏎x⏎</div>', caret: '⏎⏎‸<div>⏎x⏎</div>' }),
      },
    ]),
  );
});
