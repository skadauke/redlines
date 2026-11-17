// Format issues that the widening (format §3.12) superseded: each reproduction reads alike in every
// order of decisions now, and rejecting gives the old text back. They are regression tests, kept so
// that a later change can't bring the refusal or the silent write back.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { rejectAll } from './decide.ts';
import { expectWidened } from './oracle.ts';
import { parse } from './parse.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';

/** The body once every change is rejected, without the line breaks that end it. */
const back = (text: string) => bodyOf(applyChanges(text, rejectAll(text))).replace(/\s+$/, '');

describe('#284: code that starts a list item, and indented code in an item or a quote', () => {
  // With Track Changes on, a key in each of these was refused. It is a replacement of the code's
  // block now, held to every order of decisions, and its prefixes are kept.
  const shapes: [string, string][] = [
    ['fenced code that is the first block of an item', '- ```js\n  one\n  ```\n\nAfter.'],
    ['indented code in an item', '- Item.\n\n      one\n      two\n\n  After.'],
    ['indented code in a quote', '> Para.\n>\n>     one\n>     two'],
  ];
  for (const [name, body] of shapes) {
    it(`${name} is written as a replacement of its block`, () => {
      const text = file(body);
      const at = text.indexOf('one') + 1;
      const edit = { from: at, to: at, insert: 'x' };
      const result = trackedEdits(text, [edit], context(ada, ['m2bd', 'n8fx']));
      const after = expectWidened(name, text, result.changes, 'ada');
      expect(parse(after).marks.map((mark) => mark.kind)).toEqual(['sub']);
      expect(bodyOf(after)).toContain('oxne');
      expect(back(after)).toBe(body);
    });
  }
});
