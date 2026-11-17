// Format issues that the widening (format §3.12) superseded: each reproduction reads alike in every
// order of decisions now, and rejecting gives the old text back. They are regression tests, kept so
// that a later change can't bring the refusal or the silent write back.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { expectWidened } from './oracle.ts';
import { parse } from './parse.ts';
import { trackedFormat, untrackedFormat } from './formatting.ts';
import { TIME, ada, bodyOf, context, expectEveryOrderAlike, file } from './test-helpers.ts';
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

describe('#429: a tracked _ at the start of a bare header that begins with **', () => {
  it('writes the leading pipe plain, and reads alike in every order of decisions', () => {
    const text = file('**b** | c\n--- | ---\nx | y');
    const result = trackedEdits(text, [{ from: 0, to: 0, insert: '_' }], context(ada, ['m2bd', 'n8fx']));
    for (const change of result.changes) expect(change.from).toBeLessThanOrEqual(change.to);
    const after = applyChanges(text, result.changes);
    expectEveryOrderAlike('429', after);
    expect(bodyOf(after).startsWith('|')).toBe(true);
  });
});

describe('#445: a paragraph made a list item, with a tab-indented block after it', () => {
  const text = file('Intro.\n\nA plain paragraph\n\n\tindent');
  const at = text.indexOf('plain');
  for (const to of ['ul', 'ol', 'task'] as const) {
    it(`${to} is refused as the block of spaces is, tracked or not`, () => {
      const op = { kind: 'block', to } as never;
      const ctx = { author: ada, time: TIME, random: () => new Uint8Array(8) } as never;
      expect(() => trackedFormat(text, { from: at, to: at }, op, ctx)).toThrow(
        "This block can't become a list item",
      );
      expect(() => untrackedFormat(text, { from: at, to: at }, op, ctx)).toThrow(
        "This block can't become a list item",
      );
    });
  }
});

describe('#420: a block change with the caret before a quote whose paragraph a marker opens', () => {
  const text = file("> <!--ins k3x9-->\n>\n> Bo's new words<!--/k3x9--> and older text.", {
    k3x9: 'bo',
  });
  for (const to of ['h2', 'quote', 'ul'] as const) {
    it(`${to} writes a change or refuses with words, and never does nothing`, () => {
      const op = { kind: 'block', to } as never;
      const ctx = { author: ada, time: TIME, random: () => new Uint8Array(8) } as never;
      let changes: unknown[];
      try {
        changes = trackedFormat(text, { from: 0, to: 0 }, op, ctx).changes;
      } catch (error) {
        expect(error).toBeInstanceOf(EditError);
        return;
      }
      expect(changes.length).toBeGreaterThan(0);
    });
  }
});
