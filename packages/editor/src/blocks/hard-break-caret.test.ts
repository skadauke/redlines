// @vitest-environment happy-dom
// The caret and a hard break's trailing spaces (#608): the spaces are hidden and one unit that the
// caret steps over, so typing at their start never leaves the caret between them (the suite's
// `hidden-caret` invariant, Track Changes off and on).
import { describe } from 'vitest';
import { type Script, scriptRows, type Step } from './script.ts';

const shapes: [string, string, Step[]][] = [
  ['a space typed in front of the two spaces', 'abc‸  ⏎def', [{ type: ' ' }]],
  ['two spaces typed in front of them', 'abc‸  ⏎def', [{ type: '  ' }]],
  ['a space typed in front of three spaces', 'abc‸   ⏎def', [{ type: ' ' }]],
  ['a letter typed in front of them', 'abc‸  ⏎def', [{ type: 'x' }]],
  ['a space typed behind them', 'abc  ‸⏎def', [{ type: ' ' }]],
  ['a space typed in front of them in a list item', '- abc‸  ⏎  def', [{ type: ' ' }]],
  ['⇧← over them', 'abc  ‸⏎def', ['Shift-ArrowLeft']],
  ['← then a space', 'abc  ‸⏎def', ['ArrowLeft', { type: ' ' }]],
];

describe('the caret by a hard break’s spaces (#608)', () => {
  scriptRows(
    shapes.flatMap(([name, doc, keys]) =>
      [false, true].map((tc): Script => ({
        name: `${name}, Track Changes ${tc ? 'on' : 'off'}`,
        doc,
        keys,
        tc,
        expect: {},
      })),
    ),
  );
});
