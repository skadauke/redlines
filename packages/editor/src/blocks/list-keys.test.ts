// @vitest-environment happy-dom
// Return in list items (design: block editing, the matrix's List items and Containers inside
// containers), with Track Changes off and on. `file` is what the file gets (the empty paragraph
// never), `caret` the text as it is, with the caret.
import { describe } from 'vitest';
import { type Script, scriptRows, type Step } from './script.ts';

interface Row {
  name: string;
  doc: string;
  keys?: Step[];
  off: Script['expect'];
  on: Script['expect'];
  skipOn?: Script['skip'];
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) => [
    {
      name: `${row.name}, Track Changes off`,
      doc: row.doc,
      keys: row.keys ?? ['Enter'],
      tc: false,
      expect: row.off,
    },
    {
      name: `${row.name}, Track Changes on`,
      doc: row.doc,
      keys: row.keys ?? ['Enter'],
      tc: true,
      expect: row.on,
      ...(row.skipOn ? { skip: row.skipOn } : {}),
    },
  ]);

const same = (expect: Script['expect']) => ({ off: expect, on: expect });

describe('Return in a list item', () => {
  scriptRows(
    both([
      {
        name: 'at the end of a filled item: a new item',
        doc: '- one⏎- two‸⏎⏎After.',
        off: { file: '- one⏎- two⏎- ⏎⏎After.', caret: '- one⏎- two⏎- ‸⏎⏎After.' },
        on: { file: '- one⏎- two<split>⏎- ⏎⏎After.', caret: '- one⏎- two<split>⏎- ‸⏎⏎After.' },
      },
      {
        name: 'at the end of a filled item, then text typed',
        doc: '- one⏎- two‸⏎⏎After.',
        keys: ['Enter', { type: 'X' }],
        off: { file: '- one⏎- two⏎- X⏎⏎After.' },
        on: { file: '- one⏎- two<ins><split>⏎- X</ins>⏎⏎After.' },
      },
      {
        name: 'at the end of an item of a loose list: with the blank line the list has',
        doc: '- one⏎⏎- two‸',
        off: { file: '- one⏎⏎- two⏎⏎- ', caret: '- one⏎⏎- two⏎⏎- ‸' },
        on: { file: '- one⏎⏎- two<split>⏎⏎- ', caret: '- one⏎⏎- two<split>⏎⏎- ‸' },
      },
      {
        name: 'at the end of an item with a nested list under it: the nested items go with it',
        doc: '- one‸⏎  - sub',
        off: { file: '- one⏎- ⏎  - sub', caret: '- one⏎- ‸⏎  - sub' },
        on: { file: '- one<split>⏎- ⏎  - sub', caret: '- one<split>⏎- ‸⏎  - sub' },
      },
      {
        name: 'at the end of the first paragraph of an item that has a second: inside the item',
        doc: '- p1‸⏎⏎  p2',
        ...same({ file: '- p1⏎⏎  p2', caret: '- p1⏎⏎  ‸⏎⏎  p2' }),
      },
      {
        name: 'in the middle of the text: two items',
        doc: '- one ‸two⏎⏎After.',
        off: { file: '- one ⏎- two⏎⏎After.', caret: '- one ⏎- ‸two⏎⏎After.' },
        on: { file: '- one <split>⏎- two⏎⏎After.', caret: '- one <split>⏎- ‸two⏎⏎After.' },
      },
      {
        name: 'at the start of the text: an empty item above, the caret staying',
        doc: '- one⏎- ‸two',
        off: { file: '- one⏎- ⏎- two', caret: '- one⏎- ⏎- ‸two' },
        on: { file: '- one⏎- <split>⏎- two', caret: '- one⏎- <split>⏎- ‸two' },
      },
      {
        name: 'in an empty nested item: up one level',
        doc: '- one⏎  - ‸',
        off: { file: '- one⏎- ', caret: '- one⏎- ‸' },
        // In the original text: a change of the item's prefix.
        on: { file: '- one<sub ⏎  - >⏎- </sub>', caret: '- one<sub ⏎  - >⏎- ‸</sub>' },
      },
      {
        name: 'in an empty top-level item, the last: out of the list',
        doc: '- one⏎- ‸⏎⏎After.',
        off: { file: '- one⏎- ⏎⏎After.', caret: '- one⏎⏎‸⏎⏎After.' },
        on: { file: '- one⏎- ⏎⏎After.', caret: '- one<del ⏎- ><split>⏎⏎‸⏎⏎After.' },
      },
      {
        name: 'in an empty top-level item, the last, at the end of the file (review B+C I4)',
        doc: '- one⏎- ‸',
        off: { file: '- one⏎- ', caret: '- one⏎⏎‸' },
        // The format writes the empty item's deletion at the file's end only as a substitution
        // that keeps a space, which no reader sees; the empty paragraph's lines go in after it.
        on: { file: '- one⏎- ', caret: '- one<sub ⏎- > </sub>⏎⏎‸' },
      },
      {
        name: 'in an empty top-level item, the last, at the end of the file, then text typed',
        doc: '- one⏎- ‸',
        keys: ['Enter', { type: 'X' }],
        off: { file: '- one⏎⏎X' },
        // The empty paragraph's line breaks were plain: rejecting the paragraph leaves them.
        on: { newest: '- one ⏎⏎X', original: '- one⏎- ⏎⏎' },
      },
      {
        name: "at the end of an item's line before a soft line break (review D I11)",
        doc: '- one‸⏎  two',
        off: { file: '- one⏎- two', caret: '- one⏎- ‸two' },
        on: { file: '- one<del ⏎  ><split>⏎- two', caret: '- one<del ⏎  ><split>⏎- ‸two' },
      },
      {
        name: 'at the end of an item’s line before a soft line break, then → and typing (seed 97)',
        doc: '- one‸⏎  two',
        keys: ['Enter', 'ArrowRight', { type: 'x' }],
        off: { file: '- one⏎- txwo' },
        on: { newest: '- one⏎- txwo' },
      },
      {
        name: "at the end of an item's line before a lazy line",
        doc: '- one‸⏎two',
        off: { file: '- one⏎- two', caret: '- one⏎- ‸two' },
        on: { caret: '- one<sub ⏎two>⏎- ‸two</sub>' },
      },
      {
        name: "at the end of an item's line before a soft line break, in a quote",
        doc: '> - one‸⏎>   two',
        off: { file: '> - one⏎> - two', caret: '> - one⏎> - ‸two' },
        on: { caret: '> - one<del ⏎>   ><split>⏎> - ‸two' },
      },
      {
        name: 'in an empty top-level item in the middle: an empty paragraph between two lists',
        doc: '- one⏎- ‸⏎- two',
        off: { file: '- one⏎- ⏎- two', caret: '- one⏎⏎‸⏎⏎- two' },
        // The format refuses the blank line under the empty paragraph with Track Changes on: it
        // opens right above the next item, which a bullet starts under text.
        on: { file: '- one⏎- ⏎- two', caret: '- one<del ⏎- ><split>⏎⏎‸⏎- two' },
      },
      {
        name: 'in an empty item of a list in a quote: out of the list, in the quote',
        doc: '> - one⏎> - ‸',
        off: { file: '> - one⏎> - ', caret: '> - one⏎>⏎> ‸' },
        on: { file: '> - one⏎> - ', caret: '> - one<del ⏎> - ><split>⏎>⏎> ‸' },
      },
      {
        name: 'at the end of a numbered item: the next number',
        doc: '2. two‸',
        off: { file: '2. two⏎3. ', caret: '2. two⏎3. ‸' },
        on: { file: '2. two<split>⏎3. ', caret: '2. two<split>⏎3. ‸' },
      },
      {
        name: 'in a list numbered 1. throughout: 1.',
        doc: '1. a⏎1. b‸',
        off: { file: '1. a⏎1. b⏎1. ' },
        on: { file: '1. a⏎1. b<split>⏎1. ' },
      },
      {
        name: 'in the middle of a numbered list: the items after it keep their numbers',
        doc: '1. one‸⏎2. two',
        off: { file: '1. one⏎2. ⏎2. two', caret: '1. one⏎2. ‸⏎2. two' },
        on: { file: '1. one<split>⏎2. ⏎2. two', caret: '1. one<split>⏎2. ‸⏎2. two' },
      },
      {
        name: 'at the end of a task item: a new unchecked item',
        doc: '- [x] two‸',
        off: { file: '- [x] two⏎- [ ] ', caret: '- [x] two⏎- [ ] ‸' },
        on: { file: '- [x] two<split>⏎- [ ] ', caret: '- [x] two<split>⏎- [ ] ‸' },
      },
      {
        name: 'in an empty task item: out of the list',
        doc: '- [x] two⏎- [ ] ‸⏎⏎After.',
        off: { file: '- [x] two⏎- [ ] ⏎⏎After.', caret: '- [x] two⏎⏎‸⏎⏎After.' },
        on: {
          file: '- [x] two⏎- [ ] ⏎⏎After.',
          caret: '- [x] two<del ⏎- [ ] ><split>⏎⏎‸⏎⏎After.',
        },
      },
      {
        name: 'at the end of the last paragraph of a numbered step that has several (#204)',
        doc: '1. a⏎⏎   b‸',
        off: { file: '1. a⏎⏎   b⏎2. ', caret: '1. a⏎⏎   b⏎2. ‸' },
        on: { file: '1. a⏎⏎   b<split>⏎2. ', caret: '1. a⏎⏎   b<split>⏎2. ‸' },
      },
      {
        name: 'in the empty item that holds nested items: they go under the item above',
        doc: '- one⏎- ‸⏎  - sub',
        off: { file: '- one⏎- ⏎  - sub', caret: '- one⏎  - sub⏎⏎‸' },
        on: { file: '- one⏎- ⏎  - sub', caret: '- one<del ⏎- >⏎  - sub⏎⏎‸' },
      },
      {
        name: "at the start of a task item's text: an empty item above, the item keeping its box",
        doc: '- [x] ‸two',
        off: { file: '- [ ] ⏎- [x] two', caret: '- [ ] ⏎- [x] ‸two' },
        // The format takes no marker in front of the box: the empty item above keeps it.
        on: { file: '- [x] <split>⏎- [x] two', caret: '- [x] <split>⏎- [x] ‸two' },
      },
    ]),
  );
});

describe('Return in containers inside containers', () => {
  scriptRows(
    both([
      {
        name: 'at the end of a quote in a list item: an empty paragraph in the quote',
        doc: '- > q‸',
        ...same({ file: '- > q', caret: '- > q⏎  >⏎  > ‸' }),
      },
      {
        name: 'in the empty paragraph at the end of that quote: in the item',
        doc: '- > q‸',
        keys: ['Enter', 'Enter'],
        ...same({ file: '- > q', caret: '- > q⏎⏎  ‸' }),
      },
      {
        name: 'at the end of an item in a list in a quote: a new item',
        doc: '> - a‸',
        off: { file: '> - a⏎> - ', caret: '> - a⏎> - ‸' },
        on: { file: '> - a<split>⏎> - ', caret: '> - a<split>⏎> - ‸' },
      },
      {
        name: 'at the end of a heading in an item: an empty paragraph in the item',
        doc: '- ## H‸',
        ...same({ file: '- ## H', caret: '- ## H⏎⏎  ‸' }),
      },
      {
        name: 'in an empty paragraph at the end of an item: a new empty item after it',
        doc: '- p1‸',
        keys: ['Enter', 'Enter'],
        off: { file: '- p1⏎- ', caret: '- p1⏎⏎‸' },
        on: { file: '- p1<split>⏎- ', caret: '- p1<split>⏎⏎‸' },
      },
      {
        name: 'in a nested item three levels down, empty: up one level per Return, then out',
        doc: '- a⏎  - b⏎    - c‸',
        keys: ['Enter', 'Enter', 'Enter', 'Enter'],
        off: { file: '- a⏎  - b⏎    - c⏎- ', caret: '- a⏎  - b⏎    - c⏎⏎‸' },
        on: { file: '- a⏎  - b⏎    - c<split>⏎- ', caret: '- a⏎  - b⏎    - c<split>⏎⏎‸' },
      },
    ]),
  );
});

describe('the chain Stephan asked about', () => {
  scriptRows(
    both([
      {
        name: 'Return three times at the end of a nested item, then Backspace three times',
        doc: '- one⏎  - sub‸⏎⏎After.',
        keys: ['Enter', 'Enter', 'Enter', 'Backspace', 'Backspace', 'Backspace'],
        ...same({ file: '- one⏎  - sub⏎⏎After.', caret: '- one⏎  - sub‸⏎⏎After.' }),
      },
      {
        name: 'Return three times at the end of a nested item',
        doc: '- one⏎  - sub‸⏎⏎After.',
        keys: ['Enter', 'Enter', 'Enter'],
        off: { file: '- one⏎  - sub⏎- ⏎⏎After.', caret: '- one⏎  - sub⏎⏎‸⏎⏎After.' },
        on: { file: '- one⏎  - sub<split>⏎- ⏎⏎After.', caret: '- one⏎  - sub<split>⏎⏎‸⏎⏎After.' },
      },
    ]),
  );
});
