// @vitest-environment happy-dom
// Backspace, Delete and Return at a join with a block whose text starts with another person's mark
// (review I4): the parse reads such a line as an HTML block, so the keys did nothing and said
// nothing. They join, or refuse in words that name the person; Return keeps a tight list tight.
import { describe } from 'vitest';
import { type Script, scriptRows, type Step } from './script.ts';

interface Row {
  name: string;
  doc: string;
  keys: Step[];
  off: Script['expect'];
  on: Script['expect'];
  skip?: Script['skip'];
}

/** Each row with Track Changes off and on, the marks Bo's. */
const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) =>
    ([false, true] as const).map((tc) => ({
      name: `${row.name}, Track Changes ${tc ? 'on' : 'off'}`,
      doc: row.doc,
      keys: row.keys,
      tc,
      others: 'bo',
      expect: tc ? row.on : row.off,
      ...(row.skip ? { skip: row.skip } : {}),
    })),
  );

const REWRITE =
  'This line holds a tracked change by bo, which the join would have to write again. Decide that change first, or edit it in the raw view.';

const ONLY_DELETED =
  "This block holds only text that bo deleted, so it can't be joined while the change is pending. Decide that change first.";

describe('a join with a block that starts with another person’s insertion', () => {
  scriptRows(
    both([
      {
        name: 'Delete at the end of an item, before an item that starts with the mark',
        doc: '- a‸⏎- <ins>b</ins> c',
        keys: ['Delete'],
        off: { caret: '- a‸<ins>b</ins> c' },
        on: { caret: '- a‸<del ⏎- ><ins>b</ins> c' },
      },
      {
        name: 'Delete in a quote',
        doc: '> a‸⏎> <ins>b</ins> c',
        keys: ['Delete'],
        off: { caret: '> a‸<ins>b</ins> c' },
        on: { caret: '> a‸<del ⏎> ><ins>b</ins> c' },
      },
      {
        name: 'Delete at the end of a paragraph, before a paragraph that starts with the mark',
        doc: 'a‸⏎⏎<ins>b</ins> c',
        keys: ['Delete'],
        off: { caret: 'a‸<ins>b</ins> c' },
        on: { caret: 'a‸<del ⏎⏎><ins>b</ins> c' },
      },
      {
        name: 'Backspace at the start of the item: the bullet goes with the join (no line break before the mark)',
        doc: '- a⏎- ‸<ins>b</ins> c',
        keys: ['Backspace'],
        off: { caret: '- a‸<ins>b</ins> c' },
        on: { caret: '- a<del ⏎- ><ins><split>\\⏎  ‸b</ins> c' },
      },
      {
        name: 'Backspace at the start of a paragraph',
        doc: 'a⏎⏎‸<ins>b</ins> c',
        keys: ['Backspace'],
        off: { caret: 'a‸<ins>b</ins> c' },
        on: { caret: 'a‸<del ⏎⏎><ins>b</ins> c' },
      },
      {
        name: 'a numbered join that would write the other person’s change again: refused, naming them',
        doc: 'Para.‸⏎⏎3. <ins>one</ins>⏎4. two',
        keys: ['Delete'],
        off: { caret: 'Para.‸⏎⏎3. <ins>one</ins>⏎4. two', refusal: REWRITE },
        on: { caret: 'Para.‸⏎⏎3. <ins>one</ins>⏎4. two', refusal: REWRITE },
      },
      {
        name: 'Delete before an item whose only text is the other person’s deletion: refused, naming them',
        doc: '- one‸⏎- <del x>⏎- two',
        keys: ['Delete'],
        off: { caret: '- one‸⏎- <del x>⏎- two', refusal: ONLY_DELETED },
        on: { caret: '- one‸⏎- <del x>⏎- two', refusal: ONLY_DELETED },
        skip: { render: 'The starting document reads that way: its item is empty to micromark.' },
      },
      {
        name: 'Backspace at the item after one that holds only the other person’s deletion',
        doc: '- one⏎- <del x>⏎- ‸two',
        keys: ['Backspace'],
        off: { caret: '- one⏎- <del x>⏎- ‸two', refusal: ONLY_DELETED },
        on: { caret: '- one⏎- <del x>⏎- ‸two', refusal: ONLY_DELETED },
        skip: { render: 'The starting document reads that way: its item is empty to micromark.' },
      },
      {
        name: 'Return at the end of such an item keeps the list tight',
        doc: '- <ins>one‸</ins>⏎- two',
        keys: ['Enter'],
        off: { caret: '- <ins>one</ins>⏎- ‸⏎- two' },
        on: { caret: '- <ins>one</ins><split>⏎- ‸⏎- two' },
      },
      {
        name: 'Return at the end of a numbered item that starts with the mark',
        doc: '3. <ins>one‸</ins>⏎4. two',
        keys: ['Enter'],
        off: { caret: '3. <ins>one</ins>⏎4. ‸⏎4. two' },
        on: { caret: '3. <ins>one</ins><split>⏎4. ‸⏎4. two' },
      },
    ]),
  );
});
