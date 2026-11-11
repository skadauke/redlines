// @vitest-environment happy-dom
// Typed Markdown in an empty paragraph (design: block editing, "Typed syntax and the Paragraph menu
// on an empty paragraph"), with Track Changes off and on. The Paragraph menu is
// `plugins/formatting/src/index.test.ts`; how a lone `#` or `-` is drawn is `preview.test.ts`.
import { describe } from 'vitest';
import { type Script, scriptRows, type Step } from './script.ts';

interface Row {
  name: string;
  doc: string;
  keys: Step[];
  off: Script['expect'];
  on: Script['expect'];
  skipOff?: Script['skip'];
  skipOn?: Script['skip'];
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) => [
    {
      name: `${row.name}, Track Changes off`,
      doc: row.doc,
      keys: row.keys,
      tc: false,
      expect: row.off,
      ...(row.skipOff ? { skip: row.skipOff } : {}),
    },
    {
      name: `${row.name}, Track Changes on`,
      doc: row.doc,
      keys: row.keys,
      tc: true,
      expect: row.on,
      ...(row.skipOn ? { skip: row.skipOn } : {}),
    },
  ]);

const key = (text: string): Step[] => [...text].map((type) => ({ type }));

describe('typed syntax in an empty paragraph', () => {
  scriptRows(
    both([
      {
        name: '## and a space: a heading 2 with nothing in it yet',
        doc: 'One.‸⏎⏎Next.',
        keys: ['Enter', ...key('## ')],
        off: { caret: 'One.⏎⏎## ‸⏎⏎Next.' },
        on: { caret: 'One.⏎⏎<ins>⏎⏎## ‸</ins>⏎⏎Next.' },
      },
      {
        name: '- and a space: a bulleted item with nothing in it yet',
        doc: 'One.‸⏎⏎Next.',
        keys: ['Enter', ...key('- ')],
        off: { caret: 'One.⏎⏎- ‸⏎⏎Next.' },
        on: { caret: 'One.⏎⏎<ins>⏎⏎- ‸</ins>⏎⏎Next.' },
      },
      {
        name: '1. and a space: a numbered item',
        doc: 'One.‸⏎⏎Next.',
        keys: ['Enter', ...key('1. ')],
        off: { caret: 'One.⏎⏎1. ‸⏎⏎Next.' },
        on: { caret: 'One.⏎⏎<ins>⏎⏎1. ‸</ins>⏎⏎Next.' },
      },
      {
        name: '- [ ] and a space: a task item',
        doc: 'One.‸⏎⏎Next.',
        keys: ['Enter', ...key('- [ ] ')],
        off: { caret: 'One.⏎⏎- [ ] ‸⏎⏎Next.' },
        on: { caret: 'One.⏎⏎<ins>⏎⏎- [ ] ‸</ins>⏎⏎Next.' },
      },
      {
        name: '> at once: a quote, which stays when the caret leaves it',
        doc: 'One.‸⏎⏎Next.',
        keys: ['Enter', ...key('>')],
        off: { caret: 'One.⏎⏎>‸⏎⏎Next.' },
        on: { caret: 'One.⏎⏎<ins>⏎⏎>‸</ins>⏎⏎Next.' },
        // A `>` line is a quote of its own, which stays: the harness reads it as a blank line.
        skipOff: {
          'empty-paragraph': 'an empty quote is a block that stays, not an empty paragraph',
        },
      },
      {
        name: '--- is a thematic break at once',
        doc: 'One.‸⏎⏎Next.',
        keys: ['Enter', ...key('---')],
        off: { caret: 'One.⏎⏎---‸⏎⏎Next.' },
        on: { caret: 'One.⏎⏎<ins>⏎⏎---‸⏎</ins>⏎⏎Next.' },
      },
      {
        name: 'three backticks: a code block, closed at once, the caret after the opening fence',
        doc: 'One.‸⏎⏎Next.',
        keys: ['Enter', ...key('```')],
        off: { caret: 'One.⏎⏎```‸⏎⏎```⏎⏎Next.' },
        on: { caret: 'One.⏎⏎<ins>⏎⏎```‸⏎⏎```⏎</ins>⏎⏎Next.' },
      },
      {
        name: 'three tildes: the same',
        doc: 'One.‸⏎⏎Next.',
        keys: ['Enter', ...key('~~~')],
        off: { caret: 'One.⏎⏎~~~‸⏎⏎~~~⏎⏎Next.' },
        on: { caret: 'One.⏎⏎<ins>⏎⏎~~~‸⏎⏎~~~⏎</ins>⏎⏎Next.' },
      },
      {
        name: 'two backticks: just text',
        doc: 'One.‸⏎⏎Next.',
        keys: ['Enter', ...key('``')],
        off: { caret: 'One.⏎⏎``‸⏎⏎Next.' },
        on: { caret: 'One.⏎⏎<ins>⏎⏎``‸</ins>⏎⏎Next.' },
      },
      {
        name: '--- and Return: a thematic break and an empty paragraph after it',
        doc: 'One.‸⏎⏎Next.',
        keys: ['Enter', ...key('---'), 'Enter'],
        off: { caret: 'One.⏎⏎---⏎⏎‸⏎⏎Next.' },
        on: { caret: 'One.⏎⏎<ins>⏎⏎---⏎⏎‸⏎⏎</ins>⏎⏎Next.' },
      },
      {
        name: '| a | b | and Return: the delimiter row, and a row to type in',
        doc: 'One.‸⏎⏎Next.',
        keys: ['Enter', ...key('| a | b |'), 'Enter'],
        off: { caret: 'One.⏎⏎| a | b |⏎| --- | --- |⏎| ‸ |  |⏎⏎Next.' },
        on: {
          caret: 'One.⏎⏎<ins>⏎⏎| a | b |<split>⏎| --- | --- |<split>⏎| ‸ |  |</ins>⏎⏎Next.',
        },
      },
    ]),
  );
});
