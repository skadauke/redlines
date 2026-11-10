// @vitest-environment happy-dom
// Backspace at the start of a list item's text with an item above it: Word's two presses (design:
// block editing, the Call on Backspace at the start of a list item). The first takes the bullet
// off and keeps the text where it is, as a hard line break in a tight list or a second paragraph
// of the item above in a loose one; the second joins. Track Changes off and on.
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

describe("Backspace at a list item's start", () => {
  scriptRows(
    both([
      {
        name: 'a tight list, first press: the bullet goes, a hard line break after the item above',
        doc: '- one⏎- ‸two',
        keys: ['Backspace'],
        off: { file: '- one\\⏎  two', caret: '- one\\⏎  ‸two' },
        on: { caret: '- one<del ⏎- ><split>\\⏎  ‸two' },
      },
      {
        name: 'a tight list, second press: joins, your split cancelled',
        doc: '- one⏎- ‸two',
        keys: ['Backspace', 'Backspace'],
        off: { file: '- onetwo', caret: '- one‸two' },
        on: { caret: '- one‸<del ⏎- >two' },
      },
      {
        name: 'a loose list, first press: a second paragraph of the item above',
        doc: '- one⏎⏎- ‸two',
        keys: ['Backspace'],
        off: { caret: '- one⏎⏎  ‸two' },
        on: { caret: '- one<sub ⏎⏎- two>⏎⏎  ‸two</sub>' },
      },
      {
        name: 'a loose list, second press: joins',
        doc: '- one⏎⏎- ‸two',
        keys: ['Backspace', 'Backspace'],
        off: { caret: '- one‸two' },
        on: { caret: '- one‸<sub ⏎⏎- two>two</sub>' },
      },
      {
        name: "the item above ends in a nested item: the hard break at that item's text column",
        doc: '- one⏎  - sub⏎- ‸two',
        keys: ['Backspace'],
        off: { caret: '- one⏎  - sub\\⏎    ‸two' },
        on: { caret: '- one⏎  - sub<del ⏎- ><split>\\⏎    ‸two' },
      },
      {
        name: 'a numbered item: at the text column of the item above',
        doc: '1. one⏎2. ‸two',
        keys: ['Backspace'],
        off: { caret: '1. one\\⏎   ‸two' },
        on: { caret: '1. one<del ⏎2. ><split>\\⏎   ‸two' },
      },
      {
        name: "an item with nested items of its own: they become the item above's",
        doc: '- one⏎- ‸two⏎  - sub',
        keys: ['Backspace'],
        off: { caret: '- one\\⏎  ‸two⏎  - sub' },
        on: { caret: '- one<del ⏎- ><split>\\⏎  ‸two⏎  - sub' },
      },
      {
        name: 'the item above ends in a heading: joins at once',
        doc: '- ## H⏎- ‸two',
        keys: ['Backspace'],
        off: { caret: '- ## H‸two' },
        on: { caret: '- ## H‸<del ⏎- >two' },
      },
      {
        name: 'the item above ends in code: the caret goes there, nothing is deleted',
        doc: '- ```⏎  code⏎  ```⏎- ‸two',
        keys: ['Backspace'],
        ...same('- ```⏎  code‸⏎  ```⏎- two'),
      },
      {
        name: "a list indented with a tab: the hard break line keeps the file's tab",
        doc: '-\tone⏎-\t‸two',
        keys: ['Backspace'],
        off: { caret: '-\tone\\⏎ \t‸two' },
        on: { caret: '-\tone<sub ⏎-\ttwo><split>\\⏎ \t‸two</sub>' },
      },
      {
        name: 'a list with four columns before its text: four spaces on the hard break line',
        doc: '-   one⏎-   ‸two',
        keys: ['Backspace'],
        off: { caret: '-   one\\⏎    ‸two' },
        on: { caret: '-   one<del ⏎-   ><split>\\⏎    ‸two' },
      },
      {
        name: 'a list in a quote: the quote marker kept on the hard break line',
        doc: '> - one⏎> - ‸two',
        keys: ['Backspace'],
        off: { caret: '> - one\\⏎>   ‸two' },
        on: { caret: '> - one<sub ⏎> - two><split>\\⏎>   ‸two</sub>' },
      },
      {
        name: 'an empty item: no first press, it goes',
        doc: '- one⏎- ‸',
        keys: ['Backspace'],
        off: { caret: '- one‸' },
        on: { caret: '- one‸<sub ⏎- > </sub>' },
      },
      {
        name: 'right after Return: one press takes the Return back',
        doc: '- one ‸two',
        keys: ['Enter', 'Backspace'],
        ...same('- one ‸two'),
      },
      {
        name: "Delete at an item's end: joins the next item at once",
        doc: '- one‸⏎- two',
        keys: ['Delete'],
        off: { caret: '- one‸two' },
        on: { caret: '- one‸<del ⏎- >two' },
      },
    ]),
  );
});
