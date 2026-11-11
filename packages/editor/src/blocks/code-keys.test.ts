// @vitest-environment happy-dom
// Return and Tab in code, display math and raw-text HTML (design: block editing, "Code, tables,
// front matter, HTML blocks and rules"), with Track Changes off and on. With it on every edit of
// code is the format's whole-block substitution (rule 9, format §3.5): `<sub …>` holds the old
// block, and the fence holds the newest code.
import { describe } from 'vitest';
import { type Script, scriptRows, type Step } from './script.ts';

interface Row {
  name: string;
  doc: string;
  keys?: Step[];
  off: Script['expect'];
  on: Script['expect'];
  skip?: Script['skip'];
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) => [
    {
      name: `${row.name}, Track Changes off`,
      doc: row.doc,
      keys: row.keys ?? ['Enter'],
      tc: false,
      expect: row.off,
      ...(row.skip ? { skip: row.skip } : {}),
    },
    {
      name: `${row.name}, Track Changes on`,
      doc: row.doc,
      keys: row.keys ?? ['Enter'],
      tc: true,
      expect: row.on,
      ...(row.skip ? { skip: row.skip } : {}),
    },
  ]);

describe('Return in fenced code', () => {
  scriptRows(
    both([
      {
        name: 'at the end of a line keeps the line’s indentation',
        doc: 'Intro.⏎⏎```js⏎  let a = 1;‸⏎  let b = 2;⏎```⏎⏎After.',
        off: {
          file: 'Intro.⏎⏎```js⏎  let a = 1;⏎  ⏎  let b = 2;⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎```js⏎  let a = 1;⏎  ‸⏎  let b = 2;⏎```⏎⏎After.',
        },
        on: {
          file: 'Intro.⏎⏎<sub ```js⏎  let a = 1;⏎  let b = 2;⏎```⏎>⏎⏎```js⏎  let a = 1;⏎  ⏎  let b = 2;⏎```⏎</sub>⏎After.',
          newest: 'Intro.⏎⏎```js⏎  let a = 1;⏎  ⏎  let b = 2;⏎```⏎⏎After.',
          original: 'Intro.⏎⏎```js⏎  let a = 1;⏎  let b = 2;⏎```⏎⏎After.',
          // The caret is on the new line, after the indentation, in the new code.
          caret:
            'Intro.⏎⏎<sub ```js⏎  let a = 1;⏎  let b = 2;⏎```⏎>⏎⏎```js⏎  let a = 1;⏎  ‸⏎  let b = 2;⏎```⏎</sub>⏎After.',
        },
      },
      {
        name: 'in the middle of a line splits it',
        doc: 'Intro.⏎⏎```⏎foo‸bar⏎```⏎⏎After.',
        off: {
          file: 'Intro.⏎⏎```⏎foo⏎bar⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎```⏎foo⏎‸bar⏎```⏎⏎After.',
        },
        on: {
          newest: 'Intro.⏎⏎```⏎foo⏎bar⏎```⏎⏎After.',
          original: 'Intro.⏎⏎```⏎foobar⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎<sub ```⏎foobar⏎```⏎>⏎⏎```⏎foo⏎‸bar⏎```⏎</sub>⏎After.',
        },
      },
      {
        name: 'at the end of the opening fence goes into the code',
        doc: 'Intro.⏎⏎```js‸⏎let a = 1;⏎```⏎⏎After.',
        off: {
          file: 'Intro.⏎⏎```js⏎⏎let a = 1;⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎```js⏎‸⏎let a = 1;⏎```⏎⏎After.',
        },
        on: {
          newest: 'Intro.⏎⏎```js⏎⏎let a = 1;⏎```⏎⏎After.',
          original: 'Intro.⏎⏎```js⏎let a = 1;⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎<sub ```js⏎let a = 1;⏎```⏎>⏎⏎```js⏎‸⏎let a = 1;⏎```⏎</sub>⏎After.',
        },
      },
      {
        name: 'on the empty last line leaves the block, and opens an empty paragraph after it',
        doc: 'Intro.⏎⏎```js⏎let a = 1;⏎‸⏎```⏎⏎After.',
        off: {
          file: 'Intro.⏎⏎```js⏎let a = 1;⏎⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎```js⏎let a = 1;⏎```⏎⏎‸⏎⏎After.',
        },
        on: {
          file: 'Intro.⏎⏎```js⏎let a = 1;⏎⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎<sub ```js⏎let a = 1;⏎⏎```⏎>⏎⏎```js⏎let a = 1;⏎```⏎</sub>⏎‸⏎⏎After.',
        },
      },
      {
        name: 'on the empty last line, then a letter typed in the paragraph that opens',
        doc: 'Intro.⏎⏎```js⏎let a = 1;⏎‸⏎```⏎⏎After.',
        keys: ['Enter', { type: 'X' }],
        off: { file: 'Intro.⏎⏎```js⏎let a = 1;⏎```⏎⏎X⏎⏎After.' },
        on: {
          file: 'Intro.⏎⏎<sub ```js⏎let a = 1;⏎⏎```⏎>⏎⏎```js⏎let a = 1;⏎```⏎</sub>⏎<ins>⏎⏎X</ins>⏎⏎After.',
          newest: 'Intro.⏎⏎```js⏎let a = 1;⏎```⏎⏎X⏎⏎After.',
          original: 'Intro.⏎⏎```js⏎let a = 1;⏎⏎```⏎⏎⏎⏎After.',
        },
      },
      {
        name: 'on a line of indentation alone leaves the block, as on an empty line',
        doc: 'Intro.⏎⏎```js⏎let a = 1;⏎  ‸⏎```⏎⏎After.',
        off: {
          file: 'Intro.⏎⏎```js⏎let a = 1;⏎  ⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎```js⏎let a = 1;⏎```⏎⏎‸⏎⏎After.',
        },
        on: {
          file: 'Intro.⏎⏎```js⏎let a = 1;⏎  ⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎<sub ```js⏎let a = 1;⏎  ⏎```⏎>⏎⏎```js⏎let a = 1;⏎```⏎</sub>⏎‸⏎⏎After.',
        },
      },
      {
        name: 'on an empty line that code follows is a line of the code',
        doc: 'Intro.⏎⏎```js⏎let a = 1;⏎‸⏎let b = 2;⏎```⏎⏎After.',
        off: {
          file: 'Intro.⏎⏎```js⏎let a = 1;⏎⏎⏎let b = 2;⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎```js⏎let a = 1;⏎⏎‸⏎let b = 2;⏎```⏎⏎After.',
        },
        on: {
          newest: 'Intro.⏎⏎```js⏎let a = 1;⏎⏎⏎let b = 2;⏎```⏎⏎After.',
          original: 'Intro.⏎⏎```js⏎let a = 1;⏎⏎let b = 2;⏎```⏎⏎After.',
        },
      },
    ]),
  );
});

describe('Return in fenced code in a quote and a list item', () => {
  scriptRows(
    both([
      {
        name: 'in a quote keeps the `> `',
        doc: '> Intro.⏎>⏎> ```js⏎>   let a = 1;‸⏎> ```⏎>⏎> After.',
        off: {
          file: '> Intro.⏎>⏎> ```js⏎>   let a = 1;⏎>   ⏎> ```⏎>⏎> After.',
          caret: '> Intro.⏎>⏎> ```js⏎>   let a = 1;⏎>   ‸⏎> ```⏎>⏎> After.',
        },
        on: {
          newest: '> Intro.⏎>⏎> ```js⏎>   let a = 1;⏎>   ⏎> ```⏎> ⏎>⏎> After.',
          original: '> Intro.⏎>⏎> ```js⏎>   let a = 1;⏎> ```⏎>⏎> After.',
        },
      },
      {
        name: 'in a list item keeps the item’s indentation',
        doc: '- Item.⏎⏎  ```js⏎  let a = 1;‸⏎  ```⏎⏎- Next.',
        off: {
          file: '- Item.⏎⏎  ```js⏎  let a = 1;⏎  ⏎  ```⏎⏎- Next.',
          caret: '- Item.⏎⏎  ```js⏎  let a = 1;⏎  ‸⏎  ```⏎⏎- Next.',
        },
        on: {
          newest: '- Item.⏎⏎  ```js⏎  let a = 1;⏎  ⏎  ```⏎  ⏎⏎- Next.',
          original: '- Item.⏎⏎  ```js⏎  let a = 1;⏎  ```⏎⏎- Next.',
        },
      },
    ]),
  );
});

describe('Return in indented code, display math and raw-text HTML', () => {
  scriptRows(
    both([
      {
        name: 'in indented code is a line break with the indentation',
        doc: 'Intro.⏎⏎    let a = 1;‸⏎    let b = 2;⏎⏎After.',
        off: {
          file: 'Intro.⏎⏎    let a = 1;⏎    ⏎    let b = 2;⏎⏎After.',
          caret: 'Intro.⏎⏎    let a = 1;⏎    ‸⏎    let b = 2;⏎⏎After.',
        },
        on: {
          newest: 'Intro.⏎⏎    let a = 1;⏎    ⏎    let b = 2;⏎⏎After.',
          original: 'Intro.⏎⏎    let a = 1;⏎    let b = 2;⏎⏎After.',
        },
      },
      {
        name: 'at the end of indented code opens an indented line, which is not in the file',
        doc: 'Intro.⏎⏎    let b = 2;‸⏎⏎After.',
        off: {
          file: 'Intro.⏎⏎    let b = 2;⏎⏎After.',
          caret: 'Intro.⏎⏎    let b = 2;⏎    ‸⏎⏎After.',
        },
        on: {
          file: 'Intro.⏎⏎    let b = 2;⏎⏎After.',
          caret: 'Intro.⏎⏎    let b = 2;⏎    ‸⏎⏎After.',
        },
      },
      {
        name: 'at the end of indented code, then typing, writes the line with its indentation',
        doc: 'Intro.⏎⏎    let b = 2;‸⏎⏎After.',
        keys: ['Enter', { type: 'c' }],
        off: { file: 'Intro.⏎⏎    let b = 2;⏎    c⏎⏎After.' },
        on: {
          newest: 'Intro.⏎⏎    let b = 2;⏎    c⏎⏎After.',
          original: 'Intro.⏎⏎    let b = 2;⏎⏎After.',
        },
      },
      {
        name: 'at the end of indented code, then Backspace, takes the Return back',
        doc: 'Intro.⏎⏎    let b = 2;‸⏎⏎After.',
        keys: ['Enter', 'Backspace'],
        off: { file: 'Intro.⏎⏎    let b = 2;⏎⏎After.', caret: 'Intro.⏎⏎    let b = 2;‸⏎⏎After.' },
        on: { file: 'Intro.⏎⏎    let b = 2;⏎⏎After.', caret: 'Intro.⏎⏎    let b = 2;‸⏎⏎After.' },
      },
      {
        name: 'at the end of indented code, then Return again, leaves the block',
        doc: 'Intro.⏎⏎    let b = 2;‸⏎⏎After.',
        keys: ['Enter', 'Enter'],
        off: {
          file: 'Intro.⏎⏎    let b = 2;⏎⏎After.',
          caret: 'Intro.⏎⏎    let b = 2;⏎⏎‸⏎⏎After.',
        },
        on: {
          file: 'Intro.⏎⏎    let b = 2;⏎⏎After.',
          caret: 'Intro.⏎⏎    let b = 2;⏎⏎‸⏎⏎After.',
        },
      },
      {
        name: 'in display math is a line break',
        doc: 'Intro.⏎⏎$$⏎x = 1‸⏎y = 2⏎$$⏎⏎After.',
        off: {
          file: 'Intro.⏎⏎$$⏎x = 1⏎⏎y = 2⏎$$⏎⏎After.',
          caret: 'Intro.⏎⏎$$⏎x = 1⏎‸⏎y = 2⏎$$⏎⏎After.',
        },
        on: {
          newest: 'Intro.⏎⏎$$⏎x = 1⏎⏎y = 2⏎$$⏎⏎After.',
          original: 'Intro.⏎⏎$$⏎x = 1⏎y = 2⏎$$⏎⏎After.',
        },
      },
      {
        name: 'in a pre block is a line break, and the block stays one',
        doc: 'Intro.⏎⏎<pre>⏎line one‸⏎line two⏎</pre>⏎⏎After.',
        off: {
          file: 'Intro.⏎⏎<pre>⏎line one⏎⏎line two⏎</pre>⏎⏎After.',
          caret: 'Intro.⏎⏎<pre>⏎line one⏎‸⏎line two⏎</pre>⏎⏎After.',
        },
        on: {
          newest: 'Intro.⏎⏎<pre>⏎line one⏎⏎line two⏎</pre>⏎⏎After.',
          original: 'Intro.⏎⏎<pre>⏎line one⏎line two⏎</pre>⏎⏎After.',
        },
      },
    ]),
  );
});

describe('Tab and Shift-Tab in code', () => {
  scriptRows(
    both([
      {
        name: 'Tab puts in the language’s unit: two spaces for js',
        doc: 'Intro.⏎⏎```js⏎let‸ a = 1;⏎```⏎⏎After.',
        keys: ['Tab'],
        off: {
          file: 'Intro.⏎⏎```js⏎let   a = 1;⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎```js⏎let  ‸ a = 1;⏎```⏎⏎After.',
        },
        on: {
          newest: 'Intro.⏎⏎```js⏎let   a = 1;⏎```⏎⏎After.',
          original: 'Intro.⏎⏎```js⏎let a = 1;⏎```⏎⏎After.',
        },
      },
      {
        name: 'Tab puts in four spaces for python',
        doc: 'Intro.⏎⏎```python⏎‸x = 1⏎```⏎⏎After.',
        keys: ['Tab'],
        off: {
          file: 'Intro.⏎⏎```python⏎    x = 1⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎```python⏎    ‸x = 1⏎```⏎⏎After.',
        },
        on: {
          newest: 'Intro.⏎⏎```python⏎    x = 1⏎```⏎⏎After.',
          original: 'Intro.⏎⏎```python⏎x = 1⏎```⏎⏎After.',
        },
      },
      {
        name: 'Tab puts in a tab for go',
        doc: 'Intro.⏎⏎```go⏎‸x := 1⏎```⏎⏎After.',
        keys: ['Tab'],
        off: {
          file: 'Intro.⏎⏎```go⏎\tx := 1⏎```⏎⏎After.',
        },
        on: { newest: 'Intro.⏎⏎```go⏎\tx := 1⏎```⏎⏎After.' },
      },
      {
        name: 'Tab puts in what the lines use where the language is not known',
        doc: 'Intro.⏎⏎```⏎if x:⏎   y = 1‸⏎```⏎⏎After.',
        keys: ['Tab'],
        off: {
          file: 'Intro.⏎⏎```⏎if x:⏎   y = 1   ⏎```⏎⏎After.',
        },
        on: { newest: 'Intro.⏎⏎```⏎if x:⏎   y = 1   ⏎```⏎⏎After.' },
      },
      {
        name: 'Shift-Tab takes one unit from the start of the line',
        doc: 'Intro.⏎⏎```js⏎    let a‸ = 1;⏎```⏎⏎After.',
        keys: ['Shift-Tab'],
        off: {
          file: 'Intro.⏎⏎```js⏎  let a = 1;⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎```js⏎  let a‸ = 1;⏎```⏎⏎After.',
        },
        on: {
          newest: 'Intro.⏎⏎```js⏎  let a = 1;⏎```⏎⏎After.',
          original: 'Intro.⏎⏎```js⏎    let a = 1;⏎```⏎⏎After.',
        },
      },
      {
        name: 'Shift-Tab on a line with no indentation does nothing',
        doc: 'Intro.⏎⏎```js⏎let a‸ = 1;⏎```⏎⏎After.',
        keys: ['Shift-Tab'],
        off: { file: 'Intro.⏎⏎```js⏎let a = 1;⏎```⏎⏎After.' },
        on: { file: 'Intro.⏎⏎```js⏎let a = 1;⏎```⏎⏎After.' },
      },
      {
        name: 'Tab over lines indents each of them',
        doc: 'Intro.⏎⏎```js⏎[let a = 1;⏎let b = 2;]⏎```⏎⏎After.',
        keys: ['Tab'],
        off: { file: 'Intro.⏎⏎```js⏎  let a = 1;⏎  let b = 2;⏎```⏎⏎After.' },
        on: {
          newest: 'Intro.⏎⏎```js⏎  let a = 1;⏎  let b = 2;⏎```⏎⏎After.',
          original: 'Intro.⏎⏎```js⏎let a = 1;⏎let b = 2;⏎```⏎⏎After.',
        },
      },
      {
        name: 'Shift-Tab over lines outdents each of them',
        doc: 'Intro.⏎⏎```js⏎[    let a = 1;⏎  let b = 2;]⏎```⏎⏎After.',
        keys: ['Shift-Tab'],
        off: { file: 'Intro.⏎⏎```js⏎  let a = 1;⏎let b = 2;⏎```⏎⏎After.' },
        on: {
          newest: 'Intro.⏎⏎```js⏎  let a = 1;⏎let b = 2;⏎```⏎⏎After.',
          original: 'Intro.⏎⏎```js⏎    let a = 1;⏎  let b = 2;⏎```⏎⏎After.',
        },
      },
    ]),
  );
});

describe('Backspace and Delete at the edges of code stay no-ops', () => {
  const same = (doc: string) => ({ file: doc.replace('‸', ''), caret: doc });
  scriptRows(
    both([
      {
        name: 'Backspace at the start of the first code line',
        doc: 'Intro.⏎⏎```js⏎‸let a = 1;⏎```⏎⏎After.',
        keys: ['Backspace'],
        off: same('Intro.⏎⏎```js⏎‸let a = 1;⏎```⏎⏎After.'),
        on: same('Intro.⏎⏎```js⏎‸let a = 1;⏎```⏎⏎After.'),
      },
      {
        name: 'Delete at the end of the last code line',
        doc: 'Intro.⏎⏎```js⏎let a = 1;‸⏎```⏎⏎After.',
        keys: ['Delete'],
        off: same('Intro.⏎⏎```js⏎let a = 1;‸⏎```⏎⏎After.'),
        on: same('Intro.⏎⏎```js⏎let a = 1;‸⏎```⏎⏎After.'),
      },
      {
        name: 'Delete at the end of display math',
        doc: 'Intro.⏎⏎$$⏎x = 1⏎$$‸⏎⏎After.',
        keys: ['Delete'],
        off: same('Intro.⏎⏎$$⏎x = 1⏎$$‸⏎⏎After.'),
        on: same('Intro.⏎⏎$$⏎x = 1⏎$$‸⏎⏎After.'),
      },
    ]),
  );
});

/** The selection is deleted as typing deletes it; only the Return after it is taken back. */
const SELECTION_TAKE_BACK =
  'the selection stays deleted: Backspace takes only the Return back, as in Word';

describe('Return and typing over a selection in code', () => {
  scriptRows(
    both([
      {
        name: 'Return over a selection deletes it and breaks the line',
        doc: 'Intro.⏎⏎```js⏎let [a = ]1;⏎```⏎⏎After.',
        skip: { 'take-back': SELECTION_TAKE_BACK },
        off: {
          file: 'Intro.⏎⏎```js⏎let ⏎1;⏎```⏎⏎After.',
          caret: 'Intro.⏎⏎```js⏎let ⏎‸1;⏎```⏎⏎After.',
        },
        on: {
          newest: 'Intro.⏎⏎```js⏎let ⏎1;⏎```⏎⏎After.',
          original: 'Intro.⏎⏎```js⏎let a = 1;⏎```⏎⏎After.',
        },
      },
      {
        name: 'typing over a selection replaces it',
        doc: 'Intro.⏎⏎```js⏎let [a] = 1;⏎```⏎⏎After.',
        keys: [{ type: 'b' }],
        off: { file: 'Intro.⏎⏎```js⏎let b = 1;⏎```⏎⏎After.' },
        on: {
          newest: 'Intro.⏎⏎```js⏎let b = 1;⏎```⏎⏎After.',
          original: 'Intro.⏎⏎```js⏎let a = 1;⏎```⏎⏎After.',
        },
      },
    ]),
  );
});

describe('Return at the end of code in a quote (fix round 1)', () => {
  for (const depth of [1, 2]) {
    const q = '> '.repeat(depth);
    const bar = q.trimEnd();
    const doc = (code: string) =>
      `${q}Intro.⏎${bar}⏎${q}\`\`\`js⏎${q}let a = 1;⏎${code}${q}\`\`\`⏎${bar}⏎${q}After.`;
    describe(`depth ${depth}`, () => {
      scriptRows(
        both([
          {
            name: 'Return at the end of the closing fence opens the empty paragraph after it',
            doc: `${q}Intro.⏎${bar}⏎${q}\`\`\`js⏎${q}let a = 1;⏎${q}\`\`\`‸⏎${bar}⏎${q}After.`,
            off: {
              file: doc('').replace('‸', ''),
              caret: `${q}Intro.⏎${bar}⏎${q}\`\`\`js⏎${q}let a = 1;⏎${q}\`\`\`⏎${bar}⏎${q}‸⏎${bar}⏎${q}After.`,
            },
            on: {
              file: doc('').replace('‸', ''),
              caret: `${q}Intro.⏎${bar}⏎${q}\`\`\`js⏎${q}let a = 1;⏎${q}\`\`\`⏎${bar}⏎${q}‸⏎${bar}⏎${q}After.`,
            },
          },
          {
            name: 'Return on the empty last line leaves the block',
            doc: doc(`${q}‸⏎`),
            on: { file: doc(`${q}⏎`).replace('‸', '') },
            off: { file: doc(`${q}⏎`).replace('‸', '') },
          },
          {
            name: 'Return on the empty last line, then a letter, writes the letter after the block',
            doc: doc(`${q}‸⏎`),
            keys: ['Enter', { type: 'X' }],
            // Every order of decisions reads alike, the Return is taken back exactly: the harness.
            on: {},
            off: {},
          },
        ]),
      );
    });
  }
});

describe('Return at the end of a closing fence with text right under it (fix round 2)', () => {
  const docs: [string, string][] = [
    ['at the top level', 'Intro.⏎⏎```js⏎let a = 1;⏎```‸⏎After.'],
    ['in a quote', '> ```js⏎> let a = 1;⏎> ```‸⏎> After.'],
    ['in a quote in a quote', '> > ```js⏎> > let a = 1;⏎> > ```‸⏎> > After.'],
    ['in a list item', '- item⏎⏎  ```js⏎  let a = 1;⏎  ```‸⏎  After.'],
  ];
  for (const [where, doc] of docs) {
    describe(where, () => {
      scriptRows(
        both([
          {
            name: 'Return opens the empty paragraph, which is not in the file',
            doc,
            off: { file: doc.replace('‸', '') },
            on: { file: doc.replace('‸', '') },
          },
          {
            name: 'Return, then a letter, writes the letter between the fence and the text',
            doc,
            keys: ['Enter', { type: 'X' }],
            off: {},
            on: {},
          },
        ]),
      );
    });
  }
});
