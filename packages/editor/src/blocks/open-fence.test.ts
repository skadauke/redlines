// @vitest-environment happy-dom
// A fenced code block with no closing line runs to the end of the file (CommonMark). With Track
// Changes on, an edit in it is the whole-block substitution of rule 9 (format §3.5) with one
// difference: the closer would stand inside the code, so the new block is written with its closing
// fence, and the old block, the payload, stays as it was. Accepting gives a closed block (the
// same code to a reader), rejecting gives the unclosed block back byte for byte (#570).
import {
  accept,
  acceptAll,
  applyChanges,
  newestView,
  parse,
  reject,
  rejectAll,
} from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { runScript, type Script, scriptRows, type Step } from './script.ts';

interface Row {
  name: string;
  doc: string;
  keys: Step[];
  off: Script['expect'];
  on: Script['expect'];
  ids?: string[];
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) => [
    {
      name: `${row.name}, Track Changes off`,
      doc: row.doc,
      keys: row.keys,
      tc: false,
      expect: row.off,
    },
    {
      name: `${row.name}, Track Changes on`,
      doc: row.doc,
      keys: row.keys,
      tc: true,
      expect: row.on,
    },
  ]);

describe('typing in a fenced block that is never closed', () => {
  scriptRows(
    both([
      {
        name: 'a letter at the last line',
        doc: 'Some text.⏎⏎```js⏎let x = 1‸',
        keys: [{ type: 'a' }],
        off: { file: 'Some text.⏎⏎```js⏎let x = 1a', caret: 'Some text.⏎⏎```js⏎let x = 1a‸' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1>⏎⏎```js⏎let x = 1a⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1',
          newest: 'Some text.⏎⏎```js⏎let x = 1a⏎```⏎',
          caret: 'Some text.⏎⏎<sub ```js⏎let x = 1>⏎⏎```js⏎let x = 1a‸⏎```⏎</sub>',
        },
      },
      {
        name: 'a letter at the last line, no language',
        doc: 'Some text.⏎⏎```⏎let x = 1‸',
        keys: [{ type: 'a' }],
        off: { file: 'Some text.⏎⏎```⏎let x = 1a' },
        on: {
          file: 'Some text.⏎⏎<sub ```⏎let x = 1>⏎⏎```⏎let x = 1a⏎```⏎</sub>',
          original: 'Some text.⏎⏎```⏎let x = 1',
        },
      },
      {
        name: 'a letter at the last line of a tilde fence',
        doc: 'Some text.⏎⏎~~~py⏎x = 1‸',
        keys: [{ type: 'a' }],
        off: { file: 'Some text.⏎⏎~~~py⏎x = 1a' },
        on: {
          file: 'Some text.⏎⏎<sub ~~~py⏎x = 1>⏎⏎~~~py⏎x = 1a⏎~~~⏎</sub>',
          original: 'Some text.⏎⏎~~~py⏎x = 1',
        },
      },
      {
        name: 'a letter at the last line of a longer fence keeps its length',
        doc: 'Some text.⏎⏎`````⏎x = 1‸',
        keys: [{ type: 'a' }],
        off: { file: 'Some text.⏎⏎`````⏎x = 1a' },
        on: {
          file: 'Some text.⏎⏎<sub `````⏎x = 1>⏎⏎`````⏎x = 1a⏎`````⏎</sub>',
          original: 'Some text.⏎⏎`````⏎x = 1',
        },
      },
      {
        name: 'a letter after the file’s last line break',
        doc: 'Some text.⏎⏎```js⏎let x = 1⏎‸',
        keys: [{ type: 'a' }],
        off: { file: 'Some text.⏎⏎```js⏎let x = 1⏎a' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1⏎>⏎⏎```js⏎let x = 1⏎a⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1⏎',
        },
      },
      {
        name: 'a letter before the file’s last line break',
        doc: 'Some text.⏎⏎```js⏎let x = 1‸⏎',
        keys: [{ type: 'a' }],
        off: { file: 'Some text.⏎⏎```js⏎let x = 1a⏎' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1⏎>⏎⏎```js⏎let x = 1a⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1⏎',
        },
      },
      {
        name: 'a letter in the middle of the last line',
        doc: 'Some text.⏎⏎```js⏎let‸ x = 1',
        keys: [{ type: 'a' }],
        off: { file: 'Some text.⏎⏎```js⏎leta x = 1' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1>⏎⏎```js⏎leta x = 1⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1',
        },
      },
      {
        name: 'a letter in an earlier line',
        doc: 'Some text.⏎⏎```js⏎let‸ x = 1⏎let y = 2',
        keys: [{ type: 'a' }],
        off: { file: 'Some text.⏎⏎```js⏎leta x = 1⏎let y = 2' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1⏎let y = 2>⏎⏎```js⏎leta x = 1⏎let y = 2⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1⏎let y = 2',
        },
      },
      {
        name: 'two letters in a row make one substitution',
        doc: 'Some text.⏎⏎```js⏎let x = 1‸',
        keys: [{ type: 'a' }, { type: 'b' }],
        off: { file: 'Some text.⏎⏎```js⏎let x = 1ab' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1>⏎⏎```js⏎let x = 1ab⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1',
        },
      },
      {
        name: 'a letter in the document’s only block',
        doc: '```⏎code‸',
        keys: [{ type: 'a' }],
        off: { file: '```⏎codea' },
        on: { file: '<sub ```⏎code>⏎⏎```⏎codea⏎```⏎</sub>', original: '```⏎code' },
      },
    ]),
  );
});

describe('Backspace and Return in a fenced block that is never closed', () => {
  scriptRows(
    both([
      {
        name: 'Backspace at the last line',
        doc: 'Some text.⏎⏎```js⏎let x = 1‸',
        keys: ['Backspace'],
        off: { file: 'Some text.⏎⏎```js⏎let x = ', caret: 'Some text.⏎⏎```js⏎let x = ‸' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1>⏎⏎```js⏎let x = ⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1',
        },
      },
      {
        name: 'Backspace at the start of the last line joins it to the one above',
        doc: 'Some text.⏎⏎```js⏎let x = 1⏎‸let y = 2',
        keys: ['Backspace'],
        off: { file: 'Some text.⏎⏎```js⏎let x = 1let y = 2' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1⏎let y = 2>⏎⏎```js⏎let x = 1let y = 2⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1⏎let y = 2',
        },
      },
      {
        name: 'Backspace at the empty last line',
        doc: 'Some text.⏎⏎```js⏎let x = 1⏎‸',
        keys: ['Backspace'],
        off: { file: 'Some text.⏎⏎```js⏎let x = 1' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1⏎>⏎⏎```js⏎let x = 1⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1⏎',
        },
      },
      {
        name: 'Return at the last line',
        doc: 'Some text.⏎⏎```js⏎  let x = 1‸',
        keys: ['Enter'],
        off: {
          file: 'Some text.⏎⏎```js⏎  let x = 1⏎  ',
          caret: 'Some text.⏎⏎```js⏎  let x = 1⏎  ‸',
        },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎  let x = 1>⏎⏎```js⏎  let x = 1⏎  ⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎  let x = 1',
          caret: 'Some text.⏎⏎<sub ```js⏎  let x = 1>⏎⏎```js⏎  let x = 1⏎  ‸⏎```⏎</sub>',
        },
      },
      {
        name: 'Return in the middle of the last line',
        doc: 'Some text.⏎⏎```js⏎let‸ x = 1',
        keys: ['Enter'],
        off: { file: 'Some text.⏎⏎```js⏎let⏎ x = 1' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1>⏎⏎```js⏎let⏎ x = 1⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1',
        },
      },
      {
        name: 'Return in the middle of the code',
        doc: 'Some text.⏎⏎```js⏎let x‸ = 1⏎let y = 2',
        keys: ['Enter'],
        off: { file: 'Some text.⏎⏎```js⏎let x⏎ = 1⏎let y = 2' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1⏎let y = 2>⏎⏎```js⏎let x⏎ = 1⏎let y = 2⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1⏎let y = 2',
        },
      },
      {
        name: 'Return at the end of the opening line goes into the code',
        doc: 'Some text.⏎⏎```js‸⏎let x = 1',
        keys: ['Enter'],
        off: { file: 'Some text.⏎⏎```js⏎⏎let x = 1' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1>⏎⏎```js⏎⏎let x = 1⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1',
        },
      },
      {
        name: 'a selection of the last line, typed over',
        doc: 'Some text.⏎⏎```js⏎[let x = 1]',
        keys: [{ type: 'z' }],
        off: { file: 'Some text.⏎⏎```js⏎z' },
        on: {
          file: 'Some text.⏎⏎<sub ```js⏎let x = 1>⏎⏎```js⏎z⏎```⏎</sub>',
          original: 'Some text.⏎⏎```js⏎let x = 1',
        },
      },
    ]),
  );
});

describe('typing in a never-closed fence in a quote and a list item', () => {
  scriptRows(
    both([
      {
        name: 'in a quote that a line of text follows, with a change above that gives the file a ledger',
        doc: 'Some <ins>new</ins> text.⏎⏎> ```js⏎> let x = 1‸⏎⏎After.',
        keys: [{ type: 'a' }],
        off: { file: 'Some <ins>new</ins> text.⏎⏎> ```js⏎> let x = 1a⏎⏎After.' },
        on: {
          file: 'Some <ins>new</ins> text.⏎⏎> <sub ```js⏎> let x = 1>⏎>⏎> ```js⏎> let x = 1a⏎> ```⏎> </sub>⏎⏎After.',
          original: 'Some  text.⏎⏎> ```js⏎> let x = 1⏎⏎After.',
        },
      },
      {
        name: 'in a list item that a line of text follows',
        doc: '- a⏎⏎  ```js⏎  let x = 1‸⏎⏎After.',
        keys: [{ type: 'a' }],
        off: { file: '- a⏎⏎  ```js⏎  let x = 1a⏎⏎After.' },
        on: {
          file: '- a⏎⏎  <sub ```js⏎  let x = 1>⏎⏎  ```js⏎  let x = 1a⏎  ```⏎  </sub>⏎⏎After.',
          original: '- a⏎⏎  ```js⏎  let x = 1⏎⏎After.',
        },
      },
      {
        name: 'in a list item that another item follows',
        doc: '- a⏎⏎  ```js⏎  let x = 1‸⏎- b',
        keys: [{ type: 'a' }],
        off: { file: '- a⏎⏎  ```js⏎  let x = 1a⏎- b' },
        on: {
          file: '- a⏎⏎  <sub ```js⏎  let x = 1>⏎⏎  ```js⏎  let x = 1a⏎  ```⏎  </sub>⏎- b',
          original: '- a⏎⏎  ```js⏎  let x = 1⏎- b',
        },
      },
      {
        name: 'in a quote',
        doc: '> ```js⏎> let x = 1‸',
        keys: [{ type: 'a' }],
        off: { file: '> ```js⏎> let x = 1a' },
        on: {
          file: '> <sub ```js⏎> let x = 1>⏎>⏎> ```js⏎> let x = 1a⏎> ```⏎> </sub>',
          original: '> ```js⏎> let x = 1',
        },
      },
      {
        name: 'Return in a quote',
        doc: '> ```js⏎> let x = 1‸',
        keys: ['Enter'],
        off: { file: '> ```js⏎> let x = 1⏎> ' },
        on: {
          file: '> <sub ```js⏎> let x = 1>⏎>⏎> ```js⏎> let x = 1⏎> ⏎> ```⏎> </sub>',
          original: '> ```js⏎> let x = 1',
        },
      },
      {
        name: 'Backspace in a quote',
        doc: '> ```js⏎> let x = 1‸',
        keys: ['Backspace'],
        off: { file: '> ```js⏎> let x = ' },
        on: {
          file: '> <sub ```js⏎> let x = 1>⏎>⏎> ```js⏎> let x = ⏎> ```⏎> </sub>',
          original: '> ```js⏎> let x = 1',
        },
      },
      {
        name: 'in a list item',
        doc: '- a⏎⏎  ```js⏎  let x = 1‸',
        keys: [{ type: 'a' }],
        off: { file: '- a⏎⏎  ```js⏎  let x = 1a' },
        on: {
          file: '- a⏎⏎  <sub ```js⏎  let x = 1>⏎⏎  ```js⏎  let x = 1a⏎  ```⏎  </sub>',
          original: '- a⏎⏎  ```js⏎  let x = 1',
        },
      },
      {
        name: 'Return in a list item',
        doc: '- a⏎⏎  ```js⏎  let x = 1‸',
        keys: ['Enter'],
        off: { file: '- a⏎⏎  ```js⏎  let x = 1⏎  ' },
        on: {
          file: '- a⏎⏎  <sub ```js⏎  let x = 1>⏎⏎  ```js⏎  let x = 1⏎  ⏎  ```⏎  </sub>',
          original: '- a⏎⏎  ```js⏎  let x = 1',
        },
      },
      {
        name: 'Backspace in a list item',
        doc: '- a⏎⏎  ```js⏎  let x = 1‸',
        keys: ['Backspace'],
        off: { file: '- a⏎⏎  ```js⏎  let x = ' },
        on: {
          file: '- a⏎⏎  <sub ```js⏎  let x = 1>⏎⏎  ```js⏎  let x = ⏎  ```⏎  </sub>',
          original: '- a⏎⏎  ```js⏎  let x = 1',
        },
      },
    ]),
  );
});

describe('↓ at the last line of a fenced block that is never closed', () => {
  scriptRows(
    both([
      {
        name: '↓ writes the closing fence and opens the paragraph below it',
        doc: 'Some text.⏎⏎```js⏎let x = 1‸',
        keys: ['ArrowDown'],
        off: {
          file: 'Some text.⏎⏎```js⏎let x = 1⏎```',
          caret: 'Some text.⏎⏎```js⏎let x = 1⏎```⏎⏎‸',
        },
        on: {
          original: 'Some text.⏎⏎```js⏎let x = 1',
          newest: 'Some text.⏎⏎```js⏎let x = 1⏎```⏎',
        },
      },
      {
        name: '↓ then a letter writes it in the paragraph below',
        doc: 'Some text.⏎⏎```js⏎let x = 1‸',
        keys: ['ArrowDown', { type: 'q' }],
        off: { file: 'Some text.⏎⏎```js⏎let x = 1⏎```⏎⏎q' },
        on: {
          original: 'Some text.⏎⏎```js⏎let x = 1',
          newest: 'Some text.⏎⏎```js⏎let x = 1⏎```⏎⏎q⏎⏎',
        },
      },
      {
        name: '↓ on the empty last line closes the fence there',
        doc: 'Some text.⏎⏎```js⏎let x = 1⏎‸',
        keys: ['ArrowDown', { type: 'q' }],
        off: { file: 'Some text.⏎⏎```js⏎let x = 1⏎```⏎⏎q' },
        on: { original: 'Some text.⏎⏎```js⏎let x = 1⏎' },
      },
      {
        name: '↓ in a quote',
        doc: '> ```js⏎> let x = 1‸',
        keys: ['ArrowDown', { type: 'q' }],
        off: { file: '> ```js⏎> let x = 1⏎> ```⏎⏎q' },
        on: { original: '> ```js⏎> let x = 1' },
      },
      {
        name: '↓ in a tilde fence',
        doc: '~~~⏎x = 1‸',
        keys: ['ArrowDown', { type: 'q' }],
        off: { file: '~~~⏎x = 1⏎~~~⏎⏎q' },
        on: { original: '~~~⏎x = 1' },
      },
      {
        name: '↓ in a fence indented three spaces writes the fence at the same indentation',
        doc: 'Some text.⏎⏎   ```js⏎   let x = 1‸',
        keys: ['ArrowDown', { type: 'q' }],
        off: { file: 'Some text.⏎⏎   ```js⏎   let x = 1⏎   ```⏎⏎q' },
        on: { original: 'Some text.⏎⏎   ```js⏎   let x = 1' },
      },
      {
        name: '↓ in the middle of the code is the caret’s move only',
        doc: 'Some text.⏎⏎```js⏎let x‸ = 1⏎let y = 2',
        keys: ['ArrowDown'],
        off: { file: 'Some text.⏎⏎```js⏎let x = 1⏎let y = 2' },
        on: { file: 'Some text.⏎⏎```js⏎let x = 1⏎let y = 2' },
      },
    ]),
  );
});

describe('the closing fence typed at the end of a block that is never closed', () => {
  scriptRows(
    both([
      {
        name: 'three backticks on a new last line',
        doc: 'Some text.⏎⏎```js⏎let x = 1⏎‸',
        keys: [{ type: '`' }, { type: '`' }, { type: '`' }],
        off: { file: 'Some text.⏎⏎```js⏎let x = 1⏎```' },
        // The first change closed the block, as every one does: a fence typed in it is typed in
        // closed code, where it is refused with Track Changes on, as everywhere (lane R, #497).
        on: {
          original: 'Some text.⏎⏎```js⏎let x = 1⏎',
          newest: 'Some text.⏎⏎```js⏎let x = 1⏎``⏎```⏎',
          refusal:
            'This would end the code block it is typed in. Change the code first, or turn off Track Changes.',
        },
      },
    ]),
  );
});

describe('a change elsewhere in a file that ends in a block that is never closed', () => {
  scriptRows([
    {
      name: 'is refused with the reason when it needs a ledger (named for #497)',
      doc: 'Some text‸.⏎⏎```js⏎let x = 1',
      keys: [{ type: 'a' }],
      tc: true,
      expect: {
        file: 'Some text.⏎⏎```js⏎let x = 1',
        refusal:
          "The end of this file is inside a code block or a comment that is never closed, so Redlines can't add its ledger. Close it first.",
      },
    },
    {
      name: 'is plain text with Track Changes off',
      doc: 'Some text‸.⏎⏎```js⏎let x = 1',
      keys: [{ type: 'a' }],
      tc: false,
      expect: { file: 'Some texta.⏎⏎```js⏎let x = 1' },
    },
  ]);
});

/** Every order of accepting and rejecting the file's marks, none refused: how many ends it reaches. */
function walkNoneRefused(file: string, seen = new Set<string>()): number {
  if (seen.has(file)) return 0;
  seen.add(file);
  const marks = [
    ...new Set(
      parse(file)
        .marks.filter((mark) => mark.kind !== 'cmt' && mark.kind !== 'hl')
        .map((mark) => mark.id),
    ),
  ];
  if (marks.length === 0) return 1;
  let ends = 0;
  for (const id of marks) {
    for (const decide of [accept, reject]) {
      // A decision that is refused throws: the test fails with its words.
      ends += walkNoneRefused(applyChanges(file, decide(file, id)), seen);
    }
  }
  return ends;
}

describe('rejecting and accepting what was typed in a block that is never closed', () => {
  // The invariants let a decision that is refused wait for the others; here none may be refused,
  // and rejecting everything gives the original, or the original with its fence closed where a
  // ledger stays after it (a comment thread, a setting).
  const docs = [
    'Some text.⏎⏎```js⏎let x = 1‸',
    'Some text.⏎⏎```js⏎let x = 1⏎‸',
    'Some text.⏎⏎~~~⏎let x = 1‸⏎',
    '> ```js⏎> let x = 1‸',
    '- a⏎⏎  ```js⏎  let x = 1‸⏎⏎After.',
    'Some text.⏎⏎   ```js⏎   let x = 1‸',
  ];
  for (const doc of docs) {
    for (const keys of [[{ type: 'a' }], ['Enter'], ['Backspace'], ['ArrowDown']] as Step[][]) {
      it(`${doc} with ${JSON.stringify(keys)}`, () => {
        const result = runScript({ name: 'decide', doc, keys, tc: true, expect: {} });
        const { file, start } = result;
        expect(walkNoneRefused(file)).toBeGreaterThan(0);
        expect(applyChanges(file, rejectAll(file)).trimEnd()).toBe(start.trimEnd());
        const accepted = applyChanges(file, acceptAll(file));
        expect(accepted.trimEnd()).toBe(newestView(file).text.trimEnd());
        // A comment thread (or a setting) keeps the ledger: rejecting closes the fence, and no
        // decision is refused.
        if (parse(file).ledgerRange === null) return; // a key that wrote nothing
        const kept = file.replace(/\n-->(\n?)$/, '\ntracking: everyone\n-->$1');
        expect(walkNoneRefused(kept)).toBeGreaterThan(0);
        const back = applyChanges(kept, rejectAll(kept));
        expect(parse(back).ledgerRange, 'the ledger is read').not.toBeNull();
        expect(parse(back).warnings).toEqual([]);
      });
    }
  }
});
