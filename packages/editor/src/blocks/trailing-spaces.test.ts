// @vitest-environment happy-dom
// Two spaces typed at the end of a line that another line follows (#603): they are a hard break in
// the newest view, so no marker may stand between them and the line end (format §3.1, rule 6). The
// closer used to be written right after them, and the file read a soft break. Track Changes on.
import { describe, it } from 'vitest';
import { checkInvariants, runScript, type Script, type Step } from './script.ts';

const shapes: [string, string, Step[], Partial<Script>?][] = [
  ['two spaces at the end of a line', 'abc‸⏎def', [{ type: '  ' }]],
  ['three spaces', 'abc‸⏎def', [{ type: '   ' }]],
  ['one space, then one more', 'abc‸⏎def', [{ type: ' ' }, { type: ' ' }]],
  ['two spaces in front of a line break and a blank line', 'abc‸⏎⏎def', [{ type: '  ' }]],
  ['two spaces in the middle of a paragraph of three lines', 'a⏎abc‸⏎def', [{ type: '  ' }]],
  ['two spaces after typed text', 'abc‸⏎def', [{ type: 'x  ' }]],
  ['two spaces and text after them', 'abc‸⏎def', [{ type: '  x' }]],
  ['spaces typed at the end of a list item line', '- abc‸⏎  def', [{ type: '  ' }]],
  ['spaces typed at the end of a quote line', '> abc‸⏎> def', [{ type: '  ' }]],
  ['spaces typed at the end of a quoted list item', '> - abc‸⏎>   def', [{ type: '  ' }]],
  ['spaces typed at the end of a numbered item', '1. abc‸⏎   def', [{ type: '  ' }]],
  ['spaces typed at the end of a heading-less last paragraph line', 'abc‸', [{ type: '  ' }]],
  ['spaces typed at the end of a paragraph', 'abc‸⏎⏎def', [{ type: '  ' }]],
  ['spaces in the middle of a line', 'ab‸c⏎def', [{ type: '  ' }]],
  [
    'spaces typed at the end of a pending insertion',
    `abc<ins>de‸</ins>⏎fgh`,
    [{ type: '  ' }],
    { others: 'bo', ids: ['b2b2', 'c3c3', 'd4d4'] },
  ],
  [
    'spaces typed in front of a pending deletion at the end of the line',
    `abc‸<del de>⏎fgh`,
    [{ type: '  ' }],
    { others: 'bo', ids: ['b2b2', 'c3c3', 'd4d4'] },
  ],
  [
    'spaces typed behind a pending deletion at the end of the line',
    `abc<del de>‸⏎fgh`,
    [{ type: '  ' }],
    { others: 'bo', ids: ['b2b2', 'c3c3', 'd4d4'] },
  ],
  [
    'spaces typed in front of another one',
    `abc‸<ins>de</ins>⏎fgh`,
    [{ type: '  ' }],
    { others: 'bo', ids: ['b2b2', 'c3c3', 'd4d4'] },
  ],
  ['a space typed after a space of the file', 'abc ‸⏎def', [{ type: ' ' }]],
  ['spaces typed at the end of a line of the last item', '- a⏎- abc‸⏎  def', [{ type: '  ' }]],
  ['spaces typed in the second line of a quote of a quote', '> > abc‸⏎> > def', [{ type: '  ' }]],
  [
    'a space typed after a space in a pending insertion',
    'abc<ins>d ‸</ins>⏎fgh',
    [{ type: ' ' }],
    { others: 'bo', ids: ['b2b2', 'c3c3', 'd4d4'] },
  ],
  [
    'the walk of #603: Tab in an HTML block, then its `<` deleted',
    '<div>‸⏎a a a',
    ['Tab', 'Alt-ArrowUp', 'Delete'],
  ],
  ['an HTML block', '<div>abc‸⏎def</div>', [{ type: '  ' }]],
  [
    'the next line starts with an insertion of the author',
    'abc‸⏎<ins>de</ins> fg',
    [{ type: '  ' }],
  ],
  ['the next line starts with a deletion of the author', 'abc‸⏎<del de> fg', [{ type: '  ' }]],
  ['the first word of the next line holds an insertion', 'abc‸⏎d<ins>e</ins>', [{ type: '  ' }]],
  [
    'the first word of the next line holds an insertion of another person',
    'abc‸⏎d<ins>e</ins>',
    [{ type: '  ' }],
    { others: 'bo', ids: ['b2b2', 'c3c3', 'd4d4'] },
  ],
  ['Tab in a code-less paragraph line', 'abc‸⏎def', ['Tab']],
  ['spaces, then a letter, then Undo-free typing', 'abc‸⏎def', [{ type: '  ' }, { type: 'x' }]],
  ['spaces then Backspace', 'abc‸⏎def', [{ type: '  ' }, 'Backspace']],
];

describe('spaces typed at the end of a line (#603)', () => {
  for (const [name, doc, keys, extra] of shapes) {
    it(name, () => {
      const result = runScript({ name, doc, keys, tc: true, expect: {}, ...extra });
      checkInvariants(result);
    });
  }

  for (const [name, doc] of [
    ['an insertion', 'abc‸⏎<ins>de</ins> fg'],
    ['a deletion', 'abc‸⏎<del de> fg'],
  ] as [string, string][]) {
    it(`says why where the next line starts with another person's ${name}`, () => {
      const result = runScript({
        name,
        doc,
        keys: [{ type: '  ' }],
        tc: true,
        others: 'bo',
        ids: ['b2b2', 'c3c3', 'd4d4'],
        // The document starts a line with a marker, which micromark reads as an HTML block.
        skip: { render: 'the starting document' },
        expect: {
          refusal:
            "Two spaces make a hard break, and another person's change starts the next line. Decide it first.",
        },
      });
      checkInvariants(result);
    });
  }
});
