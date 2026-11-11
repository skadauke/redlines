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
      // #248: an empty first item at the very start of the file, Track Changes on. The format has
      // no place for a marker in front of the item's marker, so the item's deletion alone is
      // tracked (it takes the break after it, and the next item's marker: `- ⏎- two` reads as
      // `- two` in the newest view, and rejecting gives the empty item back), and the empty
      // paragraph's line breaks go in front of it as they are.
      {
        name: 'in the empty first item at the start of the file, an item after it (#248)',
        doc: '- ‸⏎- two',
        off: { file: '- ⏎- two', caret: '⏎‸⏎⏎- two' },
        on: { file: '- ⏎- two', caret: '‸⏎⏎- <del ⏎- >⏎  two' },
      },
      {
        name: 'in the empty first item at the start of the file, then text typed (#248)',
        doc: '- ‸⏎- two',
        keys: ['Enter', { type: 'X' }],
        off: { file: '⏎X⏎⏎- two' },
        // The empty paragraph's line breaks were plain: rejecting the paragraph leaves them.
        on: { newest: 'X⏎⏎- two', original: '⏎⏎- ⏎- two' },
      },
      {
        name: 'in the empty first item at the start of the file, taken back (#248)',
        doc: '- ‸⏎- two',
        keys: ['Enter', 'Backspace'],
        ...same({ caret: '- ‸⏎- two' }),
      },
      {
        name: 'in a numbered empty first item at the start of the file (#248)',
        doc: '1. ‸⏎2. two',
        off: { file: '1. ⏎2. two', caret: '⏎‸⏎⏎2. two' },
        on: { file: '1. ⏎2. two', caret: '‸⏎⏎1. <del ⏎2. >⏎   two' },
      },
      {
        name: 'in the empty first item at the start of the file, a paragraph after it (#248)',
        doc: '- ‸⏎⏎Para',
        off: { file: '- ⏎⏎Para', caret: '⏎‸⏎⏎Para' },
        on: { file: '- ⏎⏎Para', caret: '‸⏎⏎<del - ⏎⏎>⏎⏎Para' },
      },
      {
        name: 'in an empty task item at the start of the file (#248 review)',
        doc: '- [ ] ‸⏎- two',
        off: { file: '- [ ] ⏎- two', caret: '⏎‸⏎⏎- two' },
        on: { file: '- [ ] ⏎- two', caret: '‸⏎⏎<del - [ ] ⏎>⏎⏎- two' },
      },
      {
        name: 'under a line that ends in a hard break: refused, in words (#248 review)',
        doc: '- One⏎  Beta\\⏎  + ‸delta',
        off: { caret: '- One⏎  Beta\\⏎⏎  + ⏎  + ‸delta' },
        on: {
          caret: '- One⏎  Beta\\⏎  + ‸delta',
          refusal:
            "A blank line can't be put right after a hard line break while Track Changes is on. Take the hard break out first (Backspace at the start of the next line), or turn Track Changes off.",
        },
      },
      {
        name: 'in the empty first item at the start of the file, indented (#248)',
        doc: '  - ‸⏎  - two',
        off: { caret: '⏎  ‸⏎⏎  - two' },
        on: { caret: '‸⏎⏎  - <del ⏎  - >⏎    two' },
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
        // The format refuses line breaks alone behind an item of the same list with Track Changes
        // on (the newest view reads one loose list, the closer before `- two` would end it): the
        // empty paragraph opens right above the next item, which a bullet starts under text.
        on: { file: '- one⏎- ⏎- two', caret: '- one<del ⏎- ><split>⏎⏎‸⏎- two' },
      },
      {
        name: 'in an empty first item, under a paragraph: an empty paragraph above the list',
        doc: 'Para.⏎⏎- ‸⏎- two',
        off: { file: 'Para.⏎⏎- ⏎- two', caret: 'Para.⏎⏎‸⏎⏎- two' },
        // The format writes the line breaks alone here, with the blank line under the paragraph.
        on: { file: 'Para.⏎⏎- ⏎- two', caret: 'Para.<sub ⏎⏎- ><split>⏎⏎‸⏎</sub>⏎- two' },
      },
      {
        name: 'in an empty first item, under a paragraph, then text typed',
        doc: 'Para.⏎⏎- ‸⏎- two',
        keys: ['Enter', { type: 'X' }],
        off: { file: 'Para.⏎⏎X⏎⏎- two' },
        on: { file: 'Para.<sub ⏎⏎- ><split>⏎⏎X⏎</sub>⏎- two' },
      },
      {
        name: 'in an empty first item, under a paragraph, then Backspace: the item again',
        doc: 'Para.⏎⏎- ‸⏎- two',
        keys: ['Enter', 'Backspace'],
        ...same({ file: 'Para.⏎⏎- ⏎- two', caret: 'Para.⏎⏎- ‸⏎- two' }),
      },
      {
        name: 'at the start of the first item, right under a line of text: a blank line above the list (walk seed 54)',
        doc: 'Beta⏎+ ‸delta',
        off: { file: 'Beta⏎⏎+ ⏎+ delta', caret: 'Beta⏎⏎+ ⏎+ ‸delta' },
        on: { file: 'Beta⏎⏎+ <split>⏎+ delta', caret: 'Beta⏎⏎+ <split>⏎+ ‸delta' },
      },
      {
        name: 'at the start of the first item, right under a line of text in a quote',
        doc: '> Beta⏎> + ‸delta',
        off: { file: '> Beta⏎>⏎> + ⏎> + delta', caret: '> Beta⏎>⏎> + ⏎> + ‸delta' },
        on: { caret: '> Beta<ins>⏎></ins>⏎> + <split>⏎> + ‸delta' },
      },
      // #248: the blank line is the first line of one break with the new item, a split at the end
      // of the line above (the format writes it as it writes any split whose break holds a blank
      // line), so that the file reads as the newest view does: the item above loose in both.
      {
        name: 'at the start of the first item of a nested list, under its item’s text',
        doc: '- One⏎  Beta⏎  + ‸delta',
        off: { file: '- One⏎  Beta⏎⏎  + ⏎  + delta' },
        on: { caret: '- One⏎  Beta<split>⏎⏎  + ⏎  + ‸delta' },
      },
      {
        name: 'the same, right under the item’s first line',
        doc: '- One⏎  + ‸delta',
        off: { file: '- One⏎⏎  + ⏎  + delta' },
        on: { caret: '- One<split>⏎⏎  + ⏎  + ‸delta' },
      },
      {
        name: 'the same, with an item after it, and taken back',
        doc: '- One⏎  Beta⏎  + ‸delta⏎  + two',
        keys: ['Enter', 'Backspace'],
        ...same({ caret: '- One⏎  Beta⏎  + ‸delta⏎  + two' }),
      },
      {
        name: 'the same, in a numbered list, and in a quote',
        doc: '1. One⏎   Beta⏎   1. ‸delta',
        on: { caret: '1. One⏎   Beta<split>⏎⏎   1. ⏎   1. ‸delta' },
        off: { caret: '1. One⏎   Beta⏎⏎   1. ⏎   2. ‸delta' },
      },
      {
        // The new item has the first item's own number, so the list starts where it did (a `2.`
        // ahead of `1.` would start it at 2, #248 review I2) and reads by position.
        name: 'the same, in a numbered list with an item after it',
        doc: '- One⏎  Beta⏎  1. ‸delta⏎  2. eps',
        off: { caret: '- One⏎  Beta⏎⏎  1. ⏎  2. ‸delta⏎  2. eps' },
        on: { caret: '- One⏎  Beta<split>⏎⏎  1. ⏎  1. ‸delta⏎  2. eps' },
      },
      {
        name: 'the same, in a quote',
        doc: '> - One⏎>   Beta⏎>   + ‸delta',
        off: { caret: '> - One⏎>   Beta⏎>⏎>   + ⏎>   + ‸delta' },
        on: { caret: '> - One⏎>   Beta<split>⏎>⏎>   + ⏎>   + ‸delta' },
      },
      {
        name: 'the same, two levels down, then text typed',
        doc: '- a⏎  - b⏎    c⏎    * ‸d',
        keys: ['Enter', { type: 'x' }],
        off: { file: '- a⏎  - b⏎    c⏎⏎    * ⏎    * xd' },
        on: { newest: '- a⏎  - b⏎    c⏎⏎    * ⏎    * xd' },
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
