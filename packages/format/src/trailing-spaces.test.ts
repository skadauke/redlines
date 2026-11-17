// Two spaces typed at the end of a line that another line follows (#603). They are a hard break in
// the newest view, so no marker may stand between them and the line end (format §3.1, rule 6): the
// closer of the insertion was written right after them, and the file read a soft break where the
// newest view had a hard break. The change now goes on past the line break, to the end of the first
// word of the next line, as a change that ends behind a hard break's spaces always did.

import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { ada, bodyOf, expectEveryOrderAlike, file, TIME } from './test-helpers.ts';
import { fineEdits as trackedEdits } from './track.ts';
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

/** The file with every change decided, one at a time: a decision that has no form in one state is
 * tried again later, and in the other order; some order must come to the end. */
function decideAll(after: string, how: typeof accept): string {
  const ids = parse(after).marks.map((mark) => mark.id);
  for (const order of [ids, [...ids].reverse()]) {
    let now = after;
    for (let pass = 0; pass < order.length + 1; pass++) {
      for (const id of order) {
        if (!parse(now).marks.some((mark) => mark.id === id)) continue;
        try {
          now = applyChanges(now, how(now, id));
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
        }
      }
    }
    if (parse(now).marks.length === 0) return now;
  }
  throw new Error('no order of decisions comes to the end');
}

/** The edit must write the file so that micromark reads what the newest view reads, in every order
 * of decisions, and accepting gives the typed text and rejecting the old one. */
function expectSound(label: string, text: string, after: string) {
  const newest = newestView(after).text;
  expect(read(bodyOf(after)), `${label}: the file as other readers read it`).toBe(read(newest));
  expect(parse(after).warnings, label).toEqual([]);
  expectEveryOrderAlike(label, after);
  const accepted = decideAll(after, accept);
  const rejected = decideAll(after, reject);
  expect(newestView(accepted).text.trim(), `${label}: accepting`).toBe(newest.trim());
  expect(newestView(rejected).text.trim(), `${label}: rejecting`).toBe(
    originalView(text).text.trim(),
  );
}

const WRITES: Record<string, string> = {
  'an insertion of their own': 'abc<!--del fpxh \\n--><!--ins c3c3-->  \nde<!--/c3c3--> fg',
  'a deletion of their own':
    'abc<!--del rbkt \\n--><!--del c3c3 de--><!--del rbkt  fg--><!--ins fpxh-->  \n fg<!--/fpxh-->',
  'an insertion of their own in the first word':
    'abc<!--del fpxh \\nd--><!--ins c3c3-->  \nde<!--/c3c3-->',
  'a deletion of their own in the first word':
    'abc<!--del rbkt \\nd--><!--del c3c3 e--><!--del rbkt f--><!--ins fpxh-->  \ndf<!--/fpxh-->',
  'an insertion of another in the first word':
    'abc<!--del rbkt \\nd--><!--ins b2b2--><!--del rbkt e--><!--/b2b2--><!--ins fpxh-->  \nde<!--/fpxh-->',
};

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

  /** The file after typing at `at` of the file's own text (a place among the markers). */
  const typedInFile = (text: string, at: number, typed: string) => {
    const result = trackedEdits(text, [{ from: at, to: at, insert: typed }], {
      author: ada,
      time: TIME,
      random: counting(),
    });
    return applyChanges(text, result.changes);
  };

  describe('next to a pending change at the end of the line', () => {
    const marks = { b2b2: 'bo' };
    it('behind the end of their insertion', () => {
      const text = file('abc<!--ins b2b2-->de<!--/b2b2-->\nfgh', marks);
      const after = typedInFile(text, text.indexOf('\n'), '  ');
      expect(bodyOf(after).trim()).toBe(
        'abc<!--ins b2b2-->de<!--/b2b2--><!--sub fpxh \\nfgh-->  \nfgh<!--/fpxh-->',
      );
      expectSound('behind an insertion', text, after);
    });
    it('in front of their deletion', () => {
      const text = file('abc<!--del b2b2 de-->\nfgh', marks);
      const after = typedInFile(text, 3, '  ');
      expect(bodyOf(after).trim()).toBe(
        'abc<!--del b2b2 de--><!--del rbkt \\nfgh--><!--ins fpxh-->  \nfgh<!--/fpxh-->',
      );
      expectSound('in front of a deletion', text, after);
    });
    it('behind their deletion', () => {
      const text = file('abc<!--del b2b2 de-->\nfgh', marks);
      const after = typedInFile(text, text.indexOf('\n'), '  ');
      expect(bodyOf(after).trim()).toBe(
        'abc<!--del b2b2 de--><!--sub fpxh \\nfgh-->  \nfgh<!--/fpxh-->',
      );
      expectSound('behind a deletion', text, after);
    });
    it('in front of their insertion', () => {
      const text = file('abc<!--ins b2b2-->de<!--/b2b2-->\nfgh', marks);
      const after = typedInFile(text, 3, '  ');
      expect(bodyOf(after).trim()).toBe(
        'abc<!--ins fpxh-->  <!--/fpxh--><!--ins b2b2-->de<!--/b2b2-->\nfgh',
      );
      expectSound('in front of an insertion', text, after);
    });
  });

  describe('the next line starts with a pending change', () => {
    const bo = { b2b2: 'bo' };
    const own = { c3c3: 'ada' };
    const starts: [string, string, Record<string, string>][] = [
      ['an insertion of their own', 'abc\n<!--ins c3c3-->de<!--/c3c3--> fg', own],
      ['a deletion of their own', 'abc\n<!--del c3c3 de--> fg', own],
      ['an insertion of their own in the first word', 'abc\nd<!--ins c3c3-->e<!--/c3c3-->', own],
      ['a deletion of their own in the first word', 'abc\nd<!--del c3c3 e-->f', own],
      ['an insertion of another in the first word', 'abc\nd<!--ins b2b2-->e<!--/b2b2-->', bo],
    ];
    for (const [label, body, marks] of starts) {
      it(`is written soundly over ${label}`, () => {
        const text = file(body, marks);
        const after = typedAt(text, 3, '  ');
        expect(bodyOf(after).trim()).toBe(WRITES[label]);
        expectSound(label, text, after);
      });
    }

    const refused: [string, string][] = [
      ['an insertion', 'abc\n<!--ins b2b2-->de<!--/b2b2--> fg'],
      ['a deletion', 'abc\n<!--del b2b2 de--> fg'],
    ];
    for (const [label, body] of refused) {
      it(`says what is going on where it starts with another person's ${label}`, () => {
        const text = file(body, bo);
        expect(() => typedAt(text, 3, '  ')).toThrow(/hard break.*another person's change/);
      });
    }
  });

  it('goes past the line break in an HTML block too, where a block change may make them a hard break', () => {
    // The spaces read as nothing there, but deleting the `<` of the tag makes the block a paragraph
    // and them a hard break (the second way in of #603): the closer is never left behind them.
    const text = file('<div>abc\ndef</div>', {});
    const after = typedAt(text, 8, '  ');
    expect(bodyOf(after).trim()).toBe(
      '<div>abc<!--sub fpxh \\ndef</div>-->  \ndef</div><!--/fpxh-->',
    );
    expect(newestView(after).text.trim()).toBe('<div>abc  \ndef</div>');
    expectEveryOrderAlike('html block', after);
  });

  describe('the next line is a block of its own, or takes no marker', () => {
    // A line that ends the paragraph: the spaces are no hard break, and a plain insertion is sound.
    const ends: [string, string][] = [
      ['a heading', 'abc\n# H'],
      ['a fence', 'abc\n```\ncode\n```'],
      ['a rule', 'abc\n***'],
      ['a bullet', 'abc\n- x'],
    ];
    for (const [label, body] of ends) {
      it(`writes the spaces as they are in front of ${label}`, () => {
        const text = file(body, {});
        const after = typedAt(text, 3, '  ');
        expect(bodyOf(after).trim()).toBe(
          `abc<!--ins fpxh-->  <!--/fpxh-->\n${body.split('\n').slice(1).join('\n')}`,
        );
        expectEveryOrderAlike(label, after);
      });
    }

    it('says what is on the next line where it is a link definition, which takes no marker', () => {
      const text = file('abc\n[x]: /u', {});
      expect(() => typedAt(text, 3, '  ')).toThrow(
        'Two spaces make a hard break, and the next line takes no marker (a link definition, for one). Type the spaces somewhere else.',
      );
    });

    it('says what is on the next line where it is a table row with no delimiter row', () => {
      const text = file('abc\n| a | b |', {});
      expect(() => typedAt(text, 3, '  ')).toThrow(/the next line takes no marker/);
    });

    it('ends the paragraph at a table with its delimiter row, and writes the spaces as they are', () => {
      const text = file('abc\n| a | b |\n|---|---|', {});
      const after = typedAt(text, 3, '  ');
      expect(bodyOf(after).trim()).toBe('abc<!--ins fpxh-->  <!--/fpxh-->\n| a | b |\n|---|---|');
    });

    it('writes the same as before for a multi-line deletion of the author starting the line', () => {
      const text = file('abc\n<!--del c3c3 de\n-->hi', { c3c3: 'ada' });
      const after = typedAt(text, 3, '  ');
      expect(bodyOf(after).trim()).toBe('abc<!--ins fpxh-->  <!--/fpxh-->\n<!--del c3c3 de\n-->hi');
      expectSound('a deletion that starts the line', text, after);
    });
  });
});
