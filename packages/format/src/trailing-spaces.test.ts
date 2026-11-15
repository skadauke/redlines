// Two spaces typed at the end of a line that another line follows (#603). They are a hard break in
// the newest view, so no marker may stand between them and the line end (format §3.1, rule 6): the
// closer of the insertion was written right after them, and the file read a soft break where the
// newest view had a hard break. The change now goes on past the line break, to the end of the first
// word of the next line, as a change that ends behind a hard break's spaces always did.

import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { parse } from './parse.ts';
import { ada, bodyOf, expectEveryOrderAlike, file, TIME } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView, originalView } from './views.ts';

/** Bytes that go on, so that each id an edit draws is another, and the same in every run. */
function counting(): (n: number) => Uint8Array {
  let at = 0;
  return (n) => Uint8Array.from({ length: n }, () => (at++ * 7 + 3) % 19);
}

/** micromark's reading of a Markdown text, markers as HTML comments left out. */
const read = (text: string) =>
  micromark(text, { allowDangerousHtml: true })
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ <\/p>/g, '</p>')
    .trim();

/** The file after typing `typed` at `at` of the newest view of `text`, replacing up to `to`. */
function typedAt(text: string, at: number, typed: string, random?: (n: number) => Uint8Array) {
  const to = at;
  const view = newestView(text);
  const from = view.map.toSource(at, 1);
  const edit = { from, to: to === at ? from : view.map.toSource(to, -1), insert: typed };
  const result = trackedEdits(text, [edit], {
    author: ada,
    time: TIME,
    random: random ?? counting(),
  });
  return applyChanges(text, result.changes);
}

/** The edit must write the file so that micromark reads what the newest view reads, in every order
 * of decisions, and accepting gives the typed text and rejecting the old one. */
function expectSound(label: string, text: string, after: string) {
  const newest = newestView(after).text;
  expect(read(bodyOf(after)), `${label}: the file as other readers read it`).toBe(read(newest));
  expect(parse(after).warnings, label).toEqual([]);
  expectEveryOrderAlike(label, after);
  const ids = parse(after).marks.map((mark) => mark.id);
  let accepted = after;
  let rejected = after;
  for (const id of ids) {
    accepted = applyChanges(accepted, accept(accepted, id));
    rejected = applyChanges(rejected, reject(rejected, id));
  }
  expect(newestView(accepted).text.trim(), `${label}: accepting`).toBe(newest.trim());
  expect(newestView(rejected).text.trim(), `${label}: rejecting`).toBe(
    originalView(text).text.trim(),
  );
}

describe('two spaces typed at the end of a line (#603)', () => {
  it('goes past the line break, as a change behind a hard break does', () => {
    const text = file('abc\ndef', {});
    const after = typedAt(text, 3, '  ');
    expect(bodyOf(after).trim()).toBe('abc<!--sub fpxh \\ndef-->  \ndef<!--/fpxh-->');
    expect(newestView(after).text.trim()).toBe('abc  \ndef');
    expectSound('two spaces', text, after);
  });

  const shapes: [string, string, string, number, string][] = [
    ['three spaces', 'abc\ndef', '   ', 3, 'abc   \ndef'],
    ['spaces typed after text', 'abc\ndef', 'x  ', 3, 'abcx  \ndef'],
    ['spaces in a paragraph of three lines', 'a\nabc\ndef', '  ', 5, 'a\nabc  \ndef'],
    ['the end of a list item', '- abc\n  def', '  ', 5, '- abc  \n  def'],
    ['the end of a numbered item', '1. abc\n   def', '  ', 6, '1. abc  \n   def'],
    ['the end of a quote line', '> abc\n> def', '  ', 5, '> abc  \n> def'],
    ['the end of a quoted item', '> - abc\n>   def', '  ', 7, '> - abc  \n>   def'],
    ['a quote in a quote', '> > abc\n> > def', '  ', 7, '> > abc  \n> > def'],
    ['a space after a space of the file', 'abc \ndef', ' ', 4, 'abc  \ndef'],
    ['a space in front of a space of the file', 'abc \ndef', ' ', 3, 'abc  \ndef'],
  ];
  for (const [label, body, typed, at, want] of shapes) {
    it(`reads alike in every order: ${label}`, () => {
      const text = file(body, {});
      const after = typedAt(text, at, typed);
      expect(newestView(after).text.trim()).toBe(want);
      expectSound(label, text, after);
    });
  }

  it('leaves spaces that a blank line follows, as they were', () => {
    for (const body of ['abc\n\ndef']) {
      const text = file(body, {});
      const after = typedAt(text, 3, '  ');
      expect(bodyOf(after).trim()).toBe(
        `${body.split('\n')[0]}<!--ins fpxh-->  <!--/fpxh-->${body.slice(3)}`,
      );
      expectSound(body, text, after);
    }
  });

  it('keeps the spaces typed in the middle of a line in an insertion of their own', () => {
    const text = file('abc\ndef', {});
    const after = typedAt(text, 1, '  ');
    expect(bodyOf(after).trim()).toBe('a<!--ins fpxh-->  <!--/fpxh-->bc\ndef');
  });

  it('goes on past the first of the spaces, typed one by one into the author own insertion', () => {
    const text = file('abc\ndef', {});
    let after = typedAt(text, 3, ' ');
    expect(bodyOf(after).trim()).toBe('abc<!--ins fpxh--> <!--/fpxh-->\ndef');
    // The second space reaches the insertion, and its closer would stand among the spaces.
    after = typedAt(after, 4, ' ');
    expect(newestView(after).text.trim()).toBe('abc  \ndef');
    expect(bodyOf(after)).not.toMatch(/ <!--\/[a-z0-9]{4}-->\n/);
    expectSound('one by one', text, after);
  });

  describe('next to another person pending change', () => {
    const marks = { b2b2: 'bo' };
    it('at the end of their insertion', () => {
      const text = file('abc<!--ins b2b2-->de<!--/b2b2-->\nfgh', marks);
      const after = typedAt(text, 5, '  ');
      expectSound('behind an insertion', text, after);
    });
    it('in front of their deletion at the line end', () => {
      const text = file('abc<!--del b2b2 de-->\nfgh', marks);
      const after = typedAt(text, 3, '  ');
      expectSound('in front of a deletion', text, after);
    });
    it('behind their deletion at the line end', () => {
      const text = file('abc<!--del b2b2 de-->\nfgh', marks);
      const after = typedAt(text, 3, '  ');
      expect(newestView(after).text.trim()).toBe('abc  \nfgh');
    });
    it('in front of their insertion at the line end', () => {
      const text = file('abc<!--ins b2b2-->de<!--/b2b2-->\nfgh', marks);
      const after = typedAt(text, 3, '  ');
      expectSound('in front of an insertion', text, after);
    });
  });
});
