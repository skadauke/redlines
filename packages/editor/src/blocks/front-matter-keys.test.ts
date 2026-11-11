// @vitest-environment happy-dom
// Return and Tab in front matter (design: block editing, "Code, tables, front matter, HTML blocks
// and rules"). Front matter is YAML: Return is a line break with the line's indentation and Tab puts
// in two spaces. With Track Changes on its edits are refused in format §3.8's words; the
// empty paragraph Return opens after its closing line is plain, as it is after any block.
import { describe } from 'vitest';
import { type Script, scriptRows, type Step } from './script.ts';

/** Format §3.8's words for an edit of front matter with Track Changes on. */
const FRONT = "Front matter can't be edited with Track Changes on yet.";

interface Row {
  name: string;
  doc: string;
  keys?: Step[];
  off: Script['expect'];
  on: Script['expect'];
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
    },
  ]);

/** The key is refused with Track Changes on: nothing changes. */
const refused = (doc: string) => ({ file: doc.replace('‸', ''), caret: doc, refusal: FRONT });

describe('Return in front matter', () => {
  scriptRows(
    both([
      {
        name: 'at the end of a line is a line break',
        doc: '---⏎title: x‸⏎tags:⏎  - a⏎---⏎⏎Body.',
        off: {
          file: '---⏎title: x⏎⏎tags:⏎  - a⏎---⏎⏎Body.',
          caret: '---⏎title: x⏎‸⏎tags:⏎  - a⏎---⏎⏎Body.',
        },
        on: refused('---⏎title: x‸⏎tags:⏎  - a⏎---⏎⏎Body.'),
      },
      {
        name: 'keeps the line’s indentation',
        doc: '---⏎tags:⏎  - a‸⏎---⏎⏎Body.',
        off: {
          file: '---⏎tags:⏎  - a⏎  ⏎---⏎⏎Body.',
          caret: '---⏎tags:⏎  - a⏎  ‸⏎---⏎⏎Body.',
        },
        on: refused('---⏎tags:⏎  - a‸⏎---⏎⏎Body.'),
      },
      {
        name: 'in the middle of a line splits it',
        doc: '---⏎title: ab‸cd⏎---⏎⏎Body.',
        off: {
          file: '---⏎title: ab⏎cd⏎---⏎⏎Body.',
          caret: '---⏎title: ab⏎‸cd⏎---⏎⏎Body.',
        },
        on: refused('---⏎title: ab‸cd⏎---⏎⏎Body.'),
      },
      {
        name: 'at the end of the opening line goes into the front matter',
        doc: '---‸⏎title: x⏎---⏎⏎Body.',
        off: {
          file: '---⏎⏎title: x⏎---⏎⏎Body.',
          caret: '---⏎‸⏎title: x⏎---⏎⏎Body.',
        },
        on: refused('---‸⏎title: x⏎---⏎⏎Body.'),
      },
      {
        name: 'at the very start does nothing: nothing goes before front matter',
        doc: '‸---⏎title: x⏎---⏎⏎Body.',
        off: { file: '---⏎title: x⏎---⏎⏎Body.', caret: '‸---⏎title: x⏎---⏎⏎Body.' },
        on: { file: '---⏎title: x⏎---⏎⏎Body.', caret: '‸---⏎title: x⏎---⏎⏎Body.' },
      },
      {
        name: 'at the end of the closing line opens an empty paragraph at the start of the body',
        doc: '---⏎title: x⏎---‸⏎⏎Body.',
        off: {
          file: '---⏎title: x⏎---⏎⏎Body.',
          caret: '---⏎title: x⏎---⏎⏎‸⏎⏎Body.',
        },
        on: {
          file: '---⏎title: x⏎---⏎⏎Body.',
          caret: '---⏎title: x⏎---⏎⏎‸⏎⏎Body.',
        },
      },
      {
        name: 'at the end of the closing line, then text typed, starts the body with it',
        doc: '---⏎title: x⏎---‸⏎⏎Body.',
        keys: ['Enter', { type: 'Hi' }],
        off: { file: '---⏎title: x⏎---⏎⏎Hi⏎⏎Body.' },
        on: {
          newest: '---⏎title: x⏎---⏎⏎Hi⏎⏎Body.',
          original: '---⏎title: x⏎---⏎⏎⏎⏎Body.',
        },
      },
    ]),
  );
});

describe('Tab in front matter', () => {
  scriptRows(
    both([
      {
        name: 'Tab puts in two spaces',
        doc: '---⏎tags:⏎‸- a⏎---⏎⏎Body.',
        keys: ['Tab'],
        off: {
          file: '---⏎tags:⏎  - a⏎---⏎⏎Body.',
          caret: '---⏎tags:⏎  ‸- a⏎---⏎⏎Body.',
        },
        on: refused('---⏎tags:⏎‸- a⏎---⏎⏎Body.'),
      },
      {
        name: 'Shift-Tab takes two spaces away',
        doc: '---⏎tags:⏎    - a‸⏎---⏎⏎Body.',
        keys: ['Shift-Tab'],
        off: {
          file: '---⏎tags:⏎  - a⏎---⏎⏎Body.',
          caret: '---⏎tags:⏎  - a‸⏎---⏎⏎Body.',
        },
        on: refused('---⏎tags:⏎    - a‸⏎---⏎⏎Body.'),
      },
      {
        name: 'Backspace at the start of the first line does nothing',
        doc: '‸---⏎title: x⏎---⏎⏎Body.',
        keys: ['Backspace'],
        off: { file: '---⏎title: x⏎---⏎⏎Body.', caret: '‸---⏎title: x⏎---⏎⏎Body.' },
        on: { file: '---⏎title: x⏎---⏎⏎Body.', caret: '‸---⏎title: x⏎---⏎⏎Body.' },
      },
    ]),
  );
});
