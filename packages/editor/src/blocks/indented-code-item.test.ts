// @vitest-environment happy-dom
// A key in indented code that stands right before a `2.` item (#601): the file and the view read
// alike. micromark takes a `2.` line for a list of its own only after a blank line or a list, and
// the write that put a closer's line between the code and the `2.` item made the file read the
// item as a list and the view as a paragraph; the write is now the whole block, with the item in it
// (found by the walks of seeds 529 and 564 at `REDLINES_FUZZ=600`).

import { describe, expect, it } from 'vitest';
import { invariantProblems, runScript, type Step } from './script.ts';

const cases: [string, string, Step[]][] = [
  [
    'Shift-Return in an indented code line, before a 2. item',
    '      1. ‸ship a\n2. a a',
    ['Shift-Enter'],
  ],
  [
    'Tab after ⌥↑ in the item under an indented code line',
    '     a a\n2. ‸review a',
    ['Alt-ArrowUp', 'Tab'],
  ],
  ['Return in the code, before a 2. item', '     a a‸\n2. review a', ['Enter']],
  ['typing in the code, before a 2. item', '     a‸ a\n2. review a', [{ type: 'x' }]],
];

describe('indented code before a 2. item, with Track Changes on', () => {
  for (const [name, doc, keys] of cases) {
    it(name, () => {
      const result = runScript({ name, doc, keys, tc: true, expect: {} });
      const problems = Object.entries(invariantProblems(result)).filter(
        ([, found]) => found.length,
      );
      expect(problems, result.file).toEqual([]);
      // The `2.` line is never left bare under a closer's line: that is what the file and the view
      // read differently.
      expect(result.file).not.toMatch(/-->\n\n?2\. /);
    });
  }
});
