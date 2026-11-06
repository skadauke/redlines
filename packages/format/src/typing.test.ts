// Ordinary typing with Track Changes on (format §3.4): Enter at the end of a block or on a blank
// line, the text typed on the line it makes, and replacing the whole document. The editor and the
// command line make the same edits, so the format decides what they are.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import {
  ada,
  bo,
  bodyOf,
  context,
  exactly,
  expectEveryOrderAlike,
  file,
  fixture,
  idsOf,
  thread,
} from './test-helpers.ts';
import type { Person, TextChange } from './types.ts';
import { trackedEdit, trackedEdits } from './track.ts';
import { newestView, originalView } from './views.ts';

/** The body of a file without the line breaks that end it. */
const bodyText = (text: string) => bodyOf(text).replace(/\n+$/, '');

const without = (view: string) => view.replace(/\n+$/, '');

/** Where `needle` ends in `body`. */
const endOf = (body: string, needle: string) => body.indexOf(needle) + needle.length;

/** Types at `at` of a file with `body`: the new file. */
function type(body: string, at: number, insert: string, ids: string[] = [], author = ada) {
  const before = file(body);
  const result = trackedEdits(before, [{ from: at, to: at, insert }], context(author, ids));
  const after = applyChanges(before, result.changes);
  return { before, after, ...result };
}

describe('Enter at a block boundary writes line breaks and no mark (format §3.4)', () => {
  it('at the end of a paragraph, a heading and the last block', () => {
    for (const [body, at, expected] of [
      ['Para one.\n\nPara two.', 9, 'Para one.\n\n\nPara two.'],
      ['## Heading\n\nText.', 10, '## Heading\n\n\nText.'],
      ['Para one.', 9, 'Para one.\n\n'],
      ['- one\n- two', 11, '- one\n- two\n'],
    ] as const) {
      const { after, markIds, changes } = type(body, at, '\n');
      expect(bodyText(after), body).toBe(without(expected));
      expect(markIds).toEqual([]);
      expect(parse(after).marks).toEqual([]);
      // The line break is in the original text as well: blank lines make no block.
      expect(without(newestView(after).text).replace(/\n+/g, '\n')).toBe(
        without(newestView(file(body)).text).replace(/\n+/g, '\n'),
      );
      expect(changes.length).toBeGreaterThan(0);
    }
  });

  it('at the end of the last list item, with the indentation of its lines', () => {
    const { after, markIds } = type('- one\n- two', 11, '\n  ');
    expect(bodyText(after)).toBe('- one\n- two\n  ');
    expect(markIds).toEqual([]);
  });

  it('on a blank line between two blocks, and in front of the first block', () => {
    expect(bodyText(type('Para one.\n\nPara two.', 10, '\n').after)).toBe(
      'Para one.\n\n\nPara two.',
    );
    expect(bodyText(type('Para one.', 0, '\n').after)).toBe('\nPara one.');
    expect(type('Para one.', 0, '\n').markIds).toEqual([]);
    // Two line breaks, as a paragraph break typed in one go.
    expect(bodyText(type('Para one.\n\nPara two.', 9, '\n\n').after)).toBe(
      'Para one.\n\n\n\nPara two.',
    );
  });

  it('in the file’s own line breaks', () => {
    const before = file('Para one.\r\n\r\nPara two.');
    const changes = trackedEdit(before, { from: 9, to: 9, insert: '\n' }, context(ada));
    expect(bodyText(applyChanges(before, changes))).toBe('Para one.\r\n\r\n\r\nPara two.');
  });

  it('after the markers that end the line, which stay at the end of it', () => {
    // A comment at the end of the paragraph has no text of the original in it.
    const before = file('We will ship it.<!--cmt c8d2-->', {}, thread('c8d2', 'bo', 'Who?'));
    const end = before.indexOf('<!--cmt');
    const changes = trackedEdit(before, { from: end, to: end, insert: '\n' }, context(ada));
    const after = applyChanges(before, changes);
    // The line break comes after the comment, which stays at the end of its line.
    expect(bodyOf(after).endsWith('it.<!--cmt c8d2-->\n')).toBe(true);
    expect(parse(after).warnings).toEqual([]);
    expect(parse(after).marks.map((mark) => mark.id)).toEqual(['c8d2']);
  });

  it('but not where the original text goes on, after a deletion at the end of the paragraph', () => {
    // The paragraph of the example of format §1.2 ends in a deletion of Bo's: the sentence it
    // deleted is the end of the paragraph in the original text, so a line break is a split.
    const end = fixture.indexOf('<!--del w2rf');
    const edit = { from: end, to: end, insert: '\n' };
    const after = applyChanges(fixture, trackedEdit(fixture, edit, context(ada, ['s3vb'])));
    expect(bodyOf(after)).toContain('stays as it is.--><!--split s3vb-->\n');
    expect(originalView(after).text).toBe(originalView(fixture).text);
  });

  it('but not in the middle of a paragraph, where it is a split', () => {
    const { after, markIds } = type('Hello world', 5, '\n', ['s3vb']);
    expect(bodyText(after)).toBe('Hello<!--split s3vb-->\n world');
    expect(markIds).toEqual(['s3vb']);
  });

  it('but next to the break of a split, which the original text goes on through', () => {
    // The paragraph is one in the original text: another break is another split. Bo's break is a
    // blank line, which takes no more, so Ada's goes behind it (#101).
    const before = file('One<!--split s3vb-->\n\ntwo.', { s3vb: 'bo' });
    const at = before.indexOf('<!--split');
    const changes = trackedEdit(before, { from: at, to: at, insert: '\n' }, context(ada, ['w8nn']));
    const after = applyChanges(before, changes);
    expect(bodyText(after)).toBe('One<!--split s3vb-->\n\n<!--split w8nn-->\ntwo.');
    expect(parse(after).warnings).toEqual([]);
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe('Onetwo.');
  });
});

describe('Enter where a blank line would change the document is not plain (format §3.4)', () => {
  /** What Enter does at `at` of a file with `body`: the new file, or the error code. */
  function enter(body: string, at: number, insert = '\n') {
    const before = file(body);
    try {
      const ids = ['w8nn', 'p3qz', 'k3x9', 'q4gt'];
      const result = trackedEdits(before, [{ from: at, to: at, insert }], context(ada, ids));
      return { before, after: applyChanges(before, result.changes), code: undefined };
    } catch (error) {
      if (error instanceof EditError) return { before, after: undefined, code: error.code };
      throw error;
    }
  }

  /**
   * Enter where it is not plain: it is refused, or it is tracked, so that rejecting the change
   * brings the body back as it was. Never a line break with no mark.
   */
  function expectNotPlain(what: string, body: string, at: number, insert = '\n'): void {
    const { before, after, code } = enter(body, at, insert);
    if (after === undefined) {
      expect(code, what).toBe('no-legal-placement');
      return;
    }
    expect(parse(after).marks.length, `${what}: ${JSON.stringify(bodyOf(after))}`).toBeGreaterThan(
      0,
    );
    // The ledger has nothing in it once the change is rejected, so it goes.
    expect(bodyText(applyChanges(after, rejectAll(after))), what).toBe(bodyText(before));
  }

  /** The body after Enter, whole; undefined when Enter is refused. */
  function plain(body: string, at: number, insert = '\n'): string | undefined {
    const { after } = enter(body, at, insert);
    return after === undefined ? undefined : bodyOf(after).slice(0, -1);
  }

  it('is refused inside fenced code, where a blank line is code', () => {
    // The second review: each of these was written with no mark, and reject could not remove it.
    const cases: [string, string, (body: string) => number][] = [
      [
        'the end of the last code line',
        'Intro.\n\n```js\nline one\nline two\n```\n\nAfter.',
        (b) => endOf(b, 'line two'),
      ],
      [
        'the start of the closing fence line',
        'Intro.\n\n```js\nline one\nline two\n```\n\nAfter.',
        (b) => b.indexOf('\n```\n\nAfter') + 1,
      ],
      [
        'a blank code line',
        'Intro.\n\n```js\nline one\n\nline two\n```\n\nAfter.',
        (b) => endOf(b, 'line one\n'),
      ],
      [
        'between `items:` and `  - a`',
        'Intro.\n\n```yaml\nitems:\n  - a\n  - b\n```\n\nAfter.',
        (b) => endOf(b, 'items:'),
      ],
      [
        'between `1. a` and `2. b`',
        'Intro.\n\n```\n1. a\n2. b\n```\n\nAfter.',
        (b) => endOf(b, '1. a'),
      ],
      [
        'after a `# comment` line',
        'Intro.\n\n```sh\n# comment\necho hi\n```\n\nAfter.',
        (b) => endOf(b, '# comment'),
      ],
      [
        'a fence of tildes',
        'Intro.\n\n~~~\nline one\nline two\n~~~\n\nAfter.',
        (b) => endOf(b, 'line two'),
      ],
      [
        'a fence of four backticks',
        'Intro.\n\n````\nline one\nline two\n````\n\nAfter.',
        (b) => endOf(b, 'line two'),
      ],
      ['an R chunk', 'Intro.\n\n```{r}\nx <- 1\ny <- 2\n```\n\nAfter.', (b) => endOf(b, 'x <- 1')],
      [
        'a fence in a list item',
        '- item\n\n  ```js\n  line one\n  line two\n  ```\n\nAfter.',
        (b) => endOf(b, 'line two'),
      ],
      [
        'a fence in a quote',
        '> ```js\n> line one\n> line two\n> ```\n\nAfter.',
        (b) => endOf(b, 'line two'),
      ],
    ];
    for (const [what, body, position] of cases) {
      for (const insert of ['\n', '\n\n']) {
        // Markers inside code are not read, so there is no way to track the break: it is refused.
        const { after, code } = enter(body, position(body), insert);
        expect(
          ['inside-code', 'no-legal-placement'],
          `${what}: ${JSON.stringify(after)}`,
        ).toContain(code);
      }
    }
  });

  it('is plain right before and right after fenced code', () => {
    const body = 'Intro.\n\n```js\nline one\n```\n\nAfter.';
    expect(plain(body, body.indexOf('```js'))).toBe('Intro.\n\n\n```js\nline one\n```\n\nAfter.');
    expect(plain(body, body.lastIndexOf('```') + 3)).toBe(
      'Intro.\n\n```js\nline one\n```\n\n\nAfter.',
    );
  });

  it('is refused inside an HTML comment and a pre block, where a blank line is content', () => {
    const comment = 'Intro.\n\n<!--\nnote\n\nmore\n-->\n\nAfter.';
    expect(enter(comment, endOf(comment, 'note\n')).code).toBeDefined();
    const pre = 'Intro.\n\n<pre>\nline one\n\nline two\n</pre>\n\nAfter.';
    expect(enter(pre, endOf(pre, 'line one\n')).code).toBeDefined();
  });

  it('is refused inside indented code', () => {
    const body = 'Intro.\n\n    code one\n\n    code two\n\nAfter.';
    expect(enter(body, endOf(body, 'code one')).code).toBeDefined();
    // But not in front of it, or after it.
    expect(enter(body, endOf(body, 'Intro.')).after).toBeDefined();
    expect(enter(body, endOf(body, 'code two')).after).toBeDefined();
  });

  it('is not plain between the items of a tight list, which a blank line would make loose', () => {
    // The second review: `- one⏎- two⏎- three` became a list with a blank line before `- three`,
    // and every item was rendered as a paragraph, with no mark for rejecting it.
    const list = '- one\n- two\n- three';
    for (const insert of ['\n', '\n\n', '\n  ']) {
      for (const needle of ['one', 'two']) {
        expectNotPlain(`${needle} ${JSON.stringify(insert)}`, list, endOf(list, needle), insert);
      }
    }
    // A single line break has no form that keeps the next item's bullet: it is refused.
    expect(enter(list, endOf(list, 'two')).code).toBe('no-legal-placement');
    const ordered = '1. one\n2. two';
    expectNotPlain('ordered', ordered, endOf(ordered, 'one'));
    const nested = '- one\n  - nested\n- two';
    expectNotPlain('nested', nested, endOf(nested, 'one'));
    expectNotPlain('nested, the end of the child', nested, endOf(nested, 'nested'));
    const quoted = '> - one\n> - two';
    expectNotPlain('quoted', quoted, endOf(quoted, 'one'));
  });

  it('is plain at the end of the last item, and where the list is loose or starts', () => {
    const list = '- one\n- two\n- three';
    expect(plain(list, endOf(list, 'three'))).toBe('- one\n- two\n- three\n');
    // The blank line is there already.
    const loose = '- one\n\n- two';
    expect(plain(loose, endOf(loose, 'one'))).toBe('- one\n\n\n- two');
    // A paragraph in front of a list is not an item of it.
    const steps = 'Steps:\n- one\n- two';
    expect(plain(steps, endOf(steps, 'Steps:'))).toBe('Steps:\n\n- one\n- two');
    // And a block after the list is not an item of it.
    const after = '- one\n- two\n\nPara.';
    expect(plain(after, endOf(after, 'two'))).toBe('- one\n- two\n\n\nPara.');
  });

  it('is not plain in front of a wrapped line that starts with a number, which is text', () => {
    // CommonMark: an ordered list interrupts a paragraph only when it starts with 1.
    const body = 'We shipped it in the spring of\n2024. That year was good.\n\nNext.';
    for (const at of [endOf(body, 'spring of'), endOf(body, 'spring of\n')]) {
      for (const insert of ['\n', '\n\n']) {
        expectNotPlain(`${at} ${JSON.stringify(insert)}`, body, at, insert);
      }
    }
    // A list that starts with 1 does interrupt the paragraph, so a blank line changes nothing.
    const one = 'We have\n1. First\n2. Second';
    expect(plain(one, endOf(one, 'We have'))).toBe('We have\n\n1. First\n2. Second');
  });
});

describe('Backspace over line breaks that Enter typed (format §3.4)', () => {
  /** Deletes the characters `[from, to)` of a file: the new file. */
  function remove(text: string, from: number, to: number): string {
    const result = trackedEdits(text, [{ from, to, insert: '' }], context(ada, ['k3x9']));
    return applyChanges(text, result.changes);
  }

  /** Enter at `at` of a file: the new file. */
  function enter(text: string, at: number): string {
    return applyChanges(text, trackedEdit(text, { from: at, to: at, insert: '\n' }, context(ada)));
  }

  it('undoes Enter: the file is as it was, with no mark', () => {
    // The second review: Enter and then Backspace joined the two paragraphs.
    const marked = file('Para one.\n\nPara two. <!--ins k3x9-->x<!--/k3x9-->', { k3x9: 'bo' });
    for (const [text, at] of [
      ['Para one.\n\nPara two.', 9],
      ['Para one.\n\nPara two.', 10],
      ['Para one.\n\nPara two.', 11],
      ['## Heading\n\nText.', 10],
      ['Para one.\n\nPara two.\n', 9],
      ['- one\n- two\n', 11],
      [marked, 9],
      [marked, 10],
    ] as const) {
      const entered = enter(text, at);
      expect(entered, JSON.stringify(text)).not.toBe(text);
      expect(parse(entered).marks.map((mark) => mark.id)).toEqual(
        parse(text).marks.map((m) => m.id),
      );
      // Any one of the line breaks in the run goes: they are the same.
      let start = at;
      while (start > 0 && /\s/.test(entered[start - 1] ?? '')) start--;
      let end = at;
      while (/\s/.test(entered[end] ?? '')) end++;
      for (let i = start; i < end; i++) {
        if (entered[i] !== '\n') continue;
        expect(remove(entered, i, i + 1), `${JSON.stringify(text)} at ${at}, break ${i}`).toBe(
          text,
        );
      }
    }
  });

  it('undoes Enter in the file’s own line breaks', () => {
    const before = 'Para one.\r\n\r\nPara two.';
    const entered = enter(before, 9);
    expect(entered).toBe('Para one.\r\n\r\n\r\nPara two.');
    expect(remove(entered, 9, 11)).toBe(before);
  });

  it('undoes Enter at the start and at the end of a file with no ledger', () => {
    expect(enter('Para one.', 9)).toBe('Para one.\n');
    expect(remove('Para one.\n', 9, 10)).toBe('Para one.');
    expect(enter('Para one.', 0)).toBe('\nPara one.');
    expect(remove('\nPara one.', 0, 1)).toBe('Para one.');
  });

  it('is a join when fewer than two line breaks are left between the blocks', () => {
    const entered = enter('Para one.\n\nPara two.', 9);
    // Two of the three: the paragraphs would be one.
    const joined = remove(entered, 9, 11);
    expect(parse(joined).marks.map((mark) => mark.kind)).toEqual(['del']);
    expect(bodyText(joined)).toBe('Para one.<!--del k3x9 \\n\\n-->\nPara two.');
    // One line break of a soft break is a deletion, too.
    const soft = remove('One\ntwo', 3, 4);
    expect(parse(soft).marks.map((mark) => mark.kind)).toEqual(['del']);
  });

  it('does not take line breaks out of code', () => {
    const body = 'Intro.\n\n```\nline one\n\n\nline two\n```\n\nAfter.';
    const at = endOf(body, 'line one\n');
    expect(() => remove(body, at, at + 1)).toThrow(EditError);
  });
});

describe('Enter twice in the middle of a paragraph (format §3.4)', () => {
  /** Enter at `at` of a file with `body`, and then `second` where the caret is: both files. */
  function twice(
    body: string,
    at: number,
    options: { first?: string; second?: string; split?: Record<string, string> } = {},
  ) {
    const { first = '\n', second = '\n', split = {} } = options;
    const before = file(body, split);
    const one = applyChanges(
      before,
      trackedEdit(before, { from: at, to: at, insert: first }, context(ada, ['s3vb'])),
    );
    const view = newestView(one);
    const caret = view.map.toSource(at + first.length, -1);
    const result = trackedEdits(
      one,
      [{ from: caret, to: caret, insert: second }],
      context(ada, ['w8nn']),
    );
    return { before, one, after: applyChanges(one, result.changes), ...result };
  }

  /** What accepting and rejecting every change gives, as the body without its final line breaks. */
  const accepted = (text: string) => bodyText(applyChanges(text, acceptAll(text)));
  const rejected = (text: string) => bodyText(applyChanges(text, rejectAll(text)));

  it('makes the break of the first Enter a blank line: one split', () => {
    // The coordinator's repro: the second Enter failed in `legalize` with "Text can not start the
    // line after a line break that someone inserted yet".
    for (const [body, at] of [
      ['Hello world', 5],
      ['Hello world', 6],
      ['Hello brave new world', 11],
    ] as const) {
      const { one, after, markIds, extendedIds } = twice(body, at);
      expect(bodyText(one)).toBe(`${body.slice(0, at)}<!--split s3vb-->\n${body.slice(at)}`);
      expect(bodyText(after), body).toBe(
        `${body.slice(0, at)}<!--split s3vb-->\n\n${body.slice(at)}`,
      );
      // The split is the same: no new mark, and the one that grew is listed.
      expect(markIds).toEqual([]);
      expect(extendedIds).toEqual(['s3vb']);
      expect(parse(after).warnings).toEqual([]);
      expect(parse(after).marks.map((mark) => mark.id)).toEqual(['s3vb']);
      // The paragraph is two when the change is accepted, and as it was when it is rejected.
      expect(accepted(after)).toBe(`${body.slice(0, at)}\n\n${body.slice(at)}`);
      expect(rejected(after)).toBe(body);
      expect(without(originalView(after).text)).toBe(body);
    }
  });

  it('is the same when the first Enter is a blank line and when the second is two breaks', () => {
    const typed = twice('Hello world', 5, { first: '\n\n', second: '\n' });
    // The break is a blank line already: the next one is a split of its own, behind it (#101).
    expect(bodyText(typed.after)).toBe('Hello<!--split s3vb-->\n\n<!--split w8nn-->\n world');
    expect(accepted(typed.after)).toBe('Hello\n\n\n world');
    expect(rejected(typed.after)).toBe('Hello world');
    expect(parse(typed.after).warnings).toEqual([]);
    expect(typed.markIds).toEqual(['w8nn']);
    // Two breaks after a soft break: the same.
    const more = twice('Hello world', 5, { first: '\n', second: '\n\n' });
    expect(accepted(more.after)).toBe('Hello\n\n\n world');
    expect(rejected(more.after)).toBe('Hello world');
    expect(parse(more.after).warnings).toEqual([]);
  });

  it('keeps the indentation of a list item and the marker of a quote', () => {
    const item = twice('- Hello world', 7, { first: '\n  ', second: '\n  ' });
    expect(bodyText(item.after)).toBe('- Hello<!--split s3vb-->\n  \n   world');
    expect(accepted(item.after)).toBe('- Hello\n  \n   world');
    expect(rejected(item.after)).toBe('- Hello world');
    const quote = twice('> Hello world', 7, { first: '\n> ', second: '\n> ' });
    expect(bodyText(quote.after)).toBe('> Hello<!--split s3vb-->\n> \n>  world');
    expect(accepted(quote.after)).toBe('> Hello\n> \n>  world');
    expect(rejected(quote.after)).toBe('> Hello world');
    for (const { after } of [item, quote]) expect(parse(after).warnings).toEqual([]);
  });

  it('is refused after the break of one line of someone else’s split (#101)', () => {
    // A split of its own, in front of Bo's or behind it, would stand alone on the line after the
    // other's line break: accepting it would make that line blank, and rejecting the other would
    // then take both line breaks away.
    const body = 'One<!--split s3vb-->\n two three.';
    const before = file(body, { s3vb: 'bo' });
    const at = before.indexOf('\n two') + 1;
    expect(() =>
      trackedEdit(before, { from: at, to: at, insert: '\n' }, context(ada, ['w8nn'])),
    ).toThrow('deciding one would change the other');
  });

  it('goes on in front of the breaks of other people’s splits that come after it', () => {
    // A file from before #101 was fixed, with Ada's split alone on the line after Bo's break.
    const one = file('One<!--split w8nn-->\n<!--split s3vb-->\n two three.', {
      w8nn: 'ada',
      s3vb: 'bo',
    });
    // The caret is after both breaks. Ada's second Enter makes her break a blank line, in front of
    // Bo's marker, and it is her split still; her break now takes no more, whatever is decided.
    const caret = one.lastIndexOf('\n two') + 1;
    const result = trackedEdits(
      one,
      [{ from: caret, to: caret, insert: '\n' }],
      context(ada, ['p3qz']),
    );
    const after = applyChanges(one, result.changes);
    expect(bodyText(after)).toBe('One<!--split w8nn-->\n\n<!--split s3vb-->\n two three.');
    expect(result.markIds).toEqual([]);
    expect(result.extendedIds).toEqual(['w8nn']);
    expect(parse(after).warnings).toEqual([]);
    expect(accepted(after)).toBe('One\n\n\n two three.');
    expect(rejected(after)).toBe('One two three.');
    expectEveryOrderAlike('repaired', after, exactly);
  });

  it('is cancelled by Backspace, which takes the break of the split whole (format §3.4)', () => {
    const { after } = twice('Hello world', 5);
    const end = after.indexOf('\n\n world') + 2;
    // Over the second break, and over the first, and over both: the split is cancelled, and the
    // paragraph is whole again, with nothing left of the split.
    for (const [from, to] of [
      [end - 1, end],
      [end - 2, end - 1],
      [end - 2, end],
    ] as const) {
      const none = applyChanges(after, trackedEdit(after, { from, to, insert: '' }, context(ada)));
      expect(bodyText(none), `${from}-${to}`).toBe('Hello world');
      expect(parse(none).marks).toEqual([]);
    }
  });

  it('takes text typed after it into one insertion with the split', () => {
    const { after } = twice('Hello world', 5);
    const end = after.indexOf('\n\n world') + 2;
    const typed = applyChanges(
      after,
      trackedEdit(after, { from: end, to: end, insert: 'X' }, context(ada, ['k3x9', 'p3qz'])),
    );
    expect(parse(typed).warnings).toEqual([]);
    expect(accepted(typed)).toBe('Hello\n\nX world');
    expect(rejected(typed)).toBe('Hello world');
  });
});

describe('a line break next to a pending one reads the same in every decision order (#101)', () => {
  // A split's break is read when the split is decided, and it takes a blank line that follows it.
  // A split alone on the line after another split's line break makes that line blank once it is
  // accepted, and rejecting the other split then takes both line breaks: accepting the first Enter
  // and rejecting the second kept the first's line break in one order and lost it in the other.

  /** Types `insert` at the newest view's offset `at` of `text` (in place of `[at, to)`), with the
   * caret on the `side` of the markers there: the new file. */
  function typeAt(
    text: string,
    at: number,
    insert: string,
    who: { author: Person; ids: string[]; side: 1 | -1; to?: number },
  ): string {
    const view = newestView(text);
    const to = who.to ?? at;
    const edit =
      at === to
        ? { from: view.map.toSource(at, who.side), to: view.map.toSource(at, who.side), insert }
        : { from: view.map.toSource(at, 1), to: view.map.toSource(to, -1), insert };
    return applyChanges(text, trackedEdit(text, edit, context(who.author, who.ids)));
  }

  /** Every order of deciding every change of `text` gives the same text for the same decisions,
   * and accepting or rejecting them all gives the newest or the original view. */
  function expectOrderFree(label: string, text: string): void {
    expect(parse(text).warnings, label).toEqual([]);
    expectEveryOrderAlike(label, text, exactly);
    expect(applyChanges(text, acceptAll(text)), label).toBe(newestView(text).text);
    expect(applyChanges(text, rejectAll(text)), label).toBe(originalView(text).text);
  }

  const sides = [1, -1] as const;

  it('makes your own break longer when Enter is pressed at the end of the line above it', () => {
    for (const side of sides) {
      // The smallest form of the issue: Enter after the space of `one two`, and then at the end
      // of the first line. One split, whose break is a blank line, as Enter twice makes it.
      const one = typeAt('one two\n', 4, '\n', { author: bo, ids: ['tnv3'], side });
      const two = typeAt(one, 4, '\n', { author: bo, ids: ['nfkp'], side });
      expect(bodyText(two), `side ${side}`).toBe('one <!--split tnv3-->\n\ntwo');
      expect(newestView(two).text).toBe('one \n\ntwo\n');
      expectOrderFree(`smallest, side ${side}`, two);
      // The seed's own form: the space typed over with Enter, and then Enter at the end of the
      // first line. With the space's deletion accepted and the second Enter rejected, the words
      // were joined in three of the six orders.
      const over = typeAt('one two\n', 3, '\n', { author: bo, ids: ['tnv3', 'nfkp'], side, to: 4 });
      expect(bodyText(over)).toBe('one<!--del tnv3  --><!--split nfkp-->\ntwo');
      const again = typeAt(over, 3, '\n', { author: bo, ids: ['bqdb'], side });
      expect(bodyText(again), `side ${side}`).toBe('one<!--del tnv3  --><!--split nfkp-->\n\ntwo');
      expectOrderFree(`seed, side ${side}`, again);
      // A line break of your own insertion is a split of its own: the same.
      const typed = typeAt('one two\n', 4, 'new\nwords ', {
        author: ada,
        ids: ['k3x9', 's3vb'],
        side,
      });
      const longer = typeAt(typed, 7, '\n', { author: ada, ids: ['w8nn'], side });
      expect(bodyText(longer), `side ${side}`).toBe(
        'one <!--ins k3x9-->new<!--split s3vb-->\n\nwords <!--/k3x9-->two',
      );
      expectOrderFree(`insertion, side ${side}`, longer);
      // In a quote, with the quote's marker on the new line.
      const quote = typeAt('> one two\n', 6, '\n> ', { author: ada, ids: ['s3vb'], side });
      const quoted = typeAt(quote, 6, '\n> ', { author: ada, ids: ['w8nn'], side });
      expect(bodyText(quoted), `side ${side}`).toBe('> one <!--split s3vb-->\n> \n> two');
      expectOrderFree(`quote, side ${side}`, quoted);
      // In front of the two spaces of a hard break: the spaces end the line either way.
      const hard = typeAt('one two three\n', 7, '  \n', { author: ada, ids: ['s3vb'], side });
      const blank = typeAt(hard, 7, '\n', { author: ada, ids: ['w8nn'], side });
      expect(bodyText(blank), `side ${side}`).toBe('one two<!--split s3vb-->  \n\n three');
      expectOrderFree(`hard break, side ${side}`, blank);
    }
  });

  it('puts the new break behind a break that is a blank line already, which takes no more', () => {
    for (const side of sides) {
      // Enter twice in the middle of a paragraph, typed as two Enters or as one paragraph break,
      // by Ada or by Bo; then Ada's Enter at the end of the line above or at the start of the line
      // below. Her break is a split of its own on the line after the blank line.
      const twice = typeAt(
        typeAt('one two\n', 4, '\n', { author: ada, ids: ['s3vb'], side }),
        5,
        '\n',
        { author: ada, ids: [], side },
      );
      const paragraph = typeAt('one two\n', 4, '\n\n', { author: ada, ids: ['s3vb'], side });
      const bos = typeAt('one two\n', 4, '\n\n', { author: bo, ids: ['s3vb'], side });
      for (const [what, before] of [
        ['twice', twice],
        ['paragraph', paragraph],
        ["Bo's paragraph", bos],
      ] as const) {
        expect(bodyText(before), what).toBe('one <!--split s3vb-->\n\ntwo');
        for (const at of [4, 5, 6]) {
          const label = `${what}, Enter at ${at}, side ${side}`;
          const after = typeAt(before, at, '\n', { author: ada, ids: ['w8nn'], side });
          expect(bodyText(after), label).toBe('one <!--split s3vb-->\n\n<!--split w8nn-->\ntwo');
          expect(newestView(after).text, label).toBe('one \n\n\ntwo\n');
          expectOrderFree(label, after);
        }
      }
      // Bo's Enter next to the paragraph break in Ada's insertion.
      const typed = typeAt('one two\n', 4, 'new\n\nwords ', {
        author: ada,
        ids: ['k3x9', 's3vb'],
        side,
      });
      const after = typeAt(typed, 7, '\n', { author: bo, ids: ['w8nn'], side });
      expect(bodyText(after), `side ${side}`).toBe(
        'one <!--ins k3x9-->new<!--split s3vb-->\n\n<!--split w8nn-->\nwords <!--/k3x9-->two',
      );
      expectOrderFree(`Bo in an insertion, side ${side}`, after);
      // In a quote, from the end of the line above: the quote's blank lines come in the other
      // order, which reads the same.
      const quote = typeAt('> one two\n', 6, '\n>\n> ', { author: bo, ids: ['s3vb'], side });
      const quoted = typeAt(quote, 6, '\n> ', { author: ada, ids: ['w8nn'], side });
      expect(bodyText(quoted), `side ${side}`).toBe(
        '> one <!--split s3vb-->\n>\n> <!--split w8nn-->\n> two',
      );
      expectOrderFree(`quote, side ${side}`, quoted);
      // Enter three times in front of a space, which then starts the line.
      const once = typeAt('Hello world\n', 5, '\n', { author: ada, ids: ['s3vb'], side });
      const thrice = typeAt(typeAt(once, 6, '\n', { author: ada, ids: [], side }), 7, '\n', {
        author: ada,
        ids: ['w8nn'],
        side,
      });
      expect(bodyText(thrice), `side ${side}`).toBe(
        'Hello<!--split s3vb-->\n\n<!--split w8nn-->\n world',
      );
      expectOrderFree(`three times, side ${side}`, thrice);
    }
  });

  it('makes your own split behind a paragraph break longer when Enter is pressed again', () => {
    // Enter, Enter at the end of the first half of a paragraph you split: a new paragraph between
    // the halves. The second Enter lands on the first blank line, next to the paragraph break; your
    // split behind it grows, as four Enters in a row make it.
    const enters = (first: Person, steps: readonly number[], side: 1 | -1) => {
      let text = typeAt('one two\n', 4, '\n\n', { author: first, ids: ['s3vb'], side });
      for (const [i, at] of steps.entries()) {
        text = typeAt(text, at, '\n', {
          author: ada,
          ids: [['w8nn', 'p3qz', 'q4gt'][i] ?? ''],
          side,
        });
      }
      return text;
    };
    for (const side of sides) {
      for (const [what, first, steps] of [
        ['a paragraph break, then 4 and 5', ada, [4, 5]],
        ["Bo's paragraph break, then Ada's 4 and 5", bo, [4, 5]],
        ["Bo's paragraph break, then Ada's 4 and 4", bo, [4, 4]],
      ] as const) {
        const after = enters(first, steps, side);
        const label = `${what}, side ${side}`;
        expect(bodyText(after), label).toBe('one <!--split s3vb-->\n\n<!--split w8nn-->\n\ntwo');
        expect(newestView(after).text, label).toBe('one \n\n\n\ntwo\n');
        expectOrderFree(label, after);
      }
      // One Enter after another, the caret going down or staying.
      for (const steps of [
        [4, 5, 4, 5],
        [4, 5, 6, 5],
        [4, 4, 4, 5],
        [4, 4, 4, 4],
        [4, 5, 6, 7],
      ]) {
        let text = 'one two\n';
        for (const [i, at] of steps.entries()) {
          text = typeAt(text, at, '\n', {
            author: ada,
            ids: [['s3vb', 'w8nn', 'p3qz', 'q4gt'][i] ?? ''],
            side,
          });
        }
        const label = `${steps.join(',')}, side ${side}`;
        expect(newestView(text).text, label).toBe('one \n\n\n\ntwo\n');
        expect(idsOf(text).length, label).toBe(2);
        expectOrderFree(label, text);
      }
    }
  });

  it('refuses white space or block syntax typed in front of a split behind a paragraph break', () => {
    // Accepted, a space in front of the split would be the indentation of its line, which tells its
    // break how much of the next line's indentation is its own, and a bullet would be the prefix
    // that the paragraph break reads: the same decisions read differently in different orders.
    // Words are typed there as a block of their own, and read alike.
    for (const side of sides) {
      const thrice = typeAt(
        typeAt(typeAt('Hello world\n', 5, '\n', { author: ada, ids: ['s3vb'], side }), 6, '\n', {
          author: ada,
          ids: [],
          side,
        }),
        7,
        '\n',
        { author: ada, ids: ['w8nn'], side },
      );
      const item = ['\n  ', '\n  ', '\n  '].reduce(
        (text, typed, i) =>
          typeAt(text, 6 + 3 * i, typed, {
            author: ada,
            ids: [['s3vb', '', 'w8nn'][i] ?? ''],
            side,
          }),
        '- one two\n',
      );
      const inserted = typeAt(
        typeAt('one two\n', 4, 'new\n\nwords ', { author: ada, ids: ['k3x9', 's3vb'], side }),
        7,
        '\n',
        { author: bo, ids: ['w8nn'], side },
      );
      for (const [what, text, at] of [
        ['Enter three times', thrice, 7],
        ['a list item', item, 12],
        ["Bo's split in Ada's insertion", inserted, 9],
      ] as const) {
        const label = `${what}, side ${side}`;
        expect(
          () => typeAt(text, at, ' ', { author: bo, ids: ['d3x9'], side }),
          `${label}: a space`,
        ).toThrow('deciding one would change the other');
        expect(
          () => typeAt(text, at, '- x', { author: bo, ids: ['d3x9'], side }),
          `${label}: a bullet`,
        ).toThrow('deciding one would change the other');
        const words = typeAt(text, at, 'new words', { author: bo, ids: ['d3x9', 'p3qz'], side });
        expect(newestView(words).text, `${label}: words`).toMatch(/\n *new words\n/);
        expectOrderFree(`${label}: words`, words);
      }
    }
  });

  it('lets the block after a paragraph break be deleted, but not in front of a list', () => {
    for (const side of sides) {
      for (const [what, base, allowed] of [
        ['a paragraph', 'one two\n\nthree four\n', true],
        ['a list', 'one two\n\n- three four\n', false],
      ] as const) {
        const broken = typeAt(base, 4, '\n\n', { author: ada, ids: ['s3vb'], side });
        const remove = () => typeAt(broken, 6, '', { author: bo, ids: ['d3x9'], side, to: 9 });
        const label = `${what}, side ${side}`;
        if (allowed) expectOrderFree(label, remove());
        else expect(remove, label).toThrow('deciding one would change the other');
      }
    }
  });

  it('refuses a line break next to the line break of another person’s split', () => {
    // No form keeps the two apart: whichever split is on the line of its own, accepting it makes
    // the other's break a blank line, which rejecting the other then takes away.
    // The refusal names the two changes, and the other person's to decide first.
    const message = (theirs: string) =>
      `This edit would leave your line break right next to ${theirs}'s line break, and deciding one would change the other. Decide ${theirs}'s line break first.`;
    for (const side of sides) {
      const bos = typeAt('one two\n', 4, '\n', { author: bo, ids: ['s3vb'], side });
      const over = typeAt('one two\n', 3, '\n', { author: bo, ids: ['d3x9', 's3vb'], side, to: 4 });
      const typed = typeAt('one two\n', 4, 'new\nwords ', {
        author: ada,
        ids: ['k3x9', 's3vb'],
        side,
      });
      for (const [what, text, author, at] of [
        ["Ada at the end of the line above Bo's", bos, ada, 4],
        ["Ada at the start of the line below Bo's", bos, ada, 5],
        ["Ada above Bo's Enter over a space", over, ada, 3],
        ["Bo at the end of the line above Ada's", typed, bo, 7],
        ["Bo at the start of the line below Ada's", typed, bo, 8],
      ] as const) {
        const other = author === ada ? 'Bo Chen' : 'Ada Lovelace';
        expect(
          () => typeAt(text, at, '\n', { author, ids: ['w8nn'], side }),
          `${what}, side ${side}`,
        ).toThrow(message(other));
      }
      // A deletion between the two: Ada's paragraph break, which Bo deletes (a join), and then
      // Ada's Enter after the space. Once Bo's deletion was accepted, Ada's first split would take
      // the space and the second split's line break for its own break.
      const broken = typeAt('one two three\n', 3, '\n\n', { author: ada, ids: ['s3vb'], side });
      const joined = typeAt(broken, 3, '', { author: bo, ids: ['d3x9'], side, to: 4 });
      expect(bodyText(joined)).toBe('one<!--split s3vb--><!--del d3x9 \\n\\n--> two three');
      expect(
        () => typeAt(joined, 4, '\n', { author: ada, ids: ['w8nn'], side }),
        `join, side ${side}`,
      ).toThrow("Decide Bo Chen's deletion first.");
    }
  });

  it('keeps a break in front of a list item’s, where the bullet keeps the two apart', () => {
    for (const side of sides) {
      const item = typeAt('- one two\n', 6, '\n- ', { author: bo, ids: ['s3vb'], side });
      const after = typeAt(item, 6, '\n- ', { author: ada, ids: ['w8nn'], side });
      expect(bodyText(after), `side ${side}`).toBe(
        '- one <!--split w8nn-->\n- <!--split s3vb-->\n- two',
      );
      expectOrderFree(`list, side ${side}`, after);
    }
  });
});

describe('text typed in the break of a pending split stays where it was typed (#111)', () => {
  // Enter twice in the middle of a paragraph is one split whose break is a blank line. Text typed
  // on that blank line went in front of the split's marker, at the end of the line above.

  /** Types `insert` at the newest view's offset `at` of `text`, on the `side` of the markers there,
   * or in place of `[at, to)`: the new file. */
  function typeAt(
    text: string,
    at: number,
    insert: string,
    who: { author?: Person; ids?: string[]; side?: 1 | -1; to?: number } = {},
  ): string {
    const { author = ada, ids = [], side = 1, to = at } = who;
    const view = newestView(text);
    const edit =
      at === to
        ? { from: view.map.toSource(at, side), to: view.map.toSource(at, side), insert }
        : { from: view.map.toSource(at, 1), to: view.map.toSource(to, -1), insert };
    return applyChanges(text, trackedEdit(text, edit, context(author, ids)));
  }

  /** The newest view with `insert` typed at its offset `at`. */
  const typedInto = (text: string, at: number, insert: string) => {
    const view = newestView(text).text;
    return view.slice(0, at) + insert + view.slice(at);
  };

  /** Every order of deciding every change gives the same text for the same decisions, and
   * accepting or rejecting them all gives the newest or the original view. */
  function expectOrderFree(label: string, text: string): void {
    expect(parse(text).warnings, label).toEqual([]);
    expectEveryOrderAlike(label, text, exactly);
    expect(applyChanges(text, acceptAll(text)), label).toBe(newestView(text).text);
    expect(applyChanges(text, rejectAll(text)), label).toBe(originalView(text).text);
  }

  const sides = [1, -1] as const;

  /** `one two` split by Ada after the space: with Enter twice, or with a paragraph break typed at
   * once. */
  const broken = (side: 1 | -1) => ({
    twice: typeAt(typeAt('one two\n', 4, '\n', { ids: ['s3vb'], side }), 5, '\n', { side }),
    once: typeAt('one two\n', 4, '\n\n', { ids: ['s3vb'], side }),
  });

  it('puts text typed on the blank line of your own paragraph break on that line', () => {
    for (const side of sides) {
      for (const [what, before] of Object.entries(broken(side))) {
        expect(bodyText(before), what).toBe('one <!--split s3vb-->\n\ntwo');
        // The caret on the blank line is the place between the two line breaks, on either side.
        const between = before.indexOf('\n\ntwo') + 1;
        expect(newestView(before).map.toSource(5, side)).toBe(between);
        const label = `${what}, side ${side}`;
        const after = typeAt(before, 5, 'new', { ids: ['k3x9', 'w8nn', 'p3qz'], side });
        // The split is typed again with the text, as one insertion, as if the two had been typed
        // together: the line break in front of the text, and the one after it.
        expect(bodyText(after), label).toBe(
          'one <!--ins k3x9--><!--split w8nn-->\nnew<!--/k3x9--><!--split p3qz-->\ntwo',
        );
        expect(newestView(after).text, label).toBe('one \nnew\ntwo\n');
        expect(originalView(after).text, label).toBe('one two\n');
        expectOrderFree(label, after);
      }
    }
  });

  it('types a space, words, a line break after them, and letter by letter, where they go', () => {
    for (const side of sides) {
      for (const [what, before] of Object.entries(broken(side))) {
        for (const insert of [' ', 'new words', 'new\n', 'café ', '😀']) {
          const label = `${what}, ${JSON.stringify(insert)}, side ${side}`;
          const after = typeAt(before, 5, insert, { ids: ['k3x9', 'w8nn', 'p3qz'], side });
          expect(newestView(after).text, label).toBe(typedInto(before, 5, insert));
          expectOrderFree(label, after);
        }
        // Letter by letter, the caret after the last one: one insertion.
        let text = before;
        for (const [i, letter] of [...'new'].entries()) {
          text = typeAt(text, 5 + i, letter, { ids: ['k3x9', 'w8nn', 'p3qz'], side: -1 });
        }
        expect(bodyText(text), what).toBe(
          'one <!--ins k3x9--><!--split w8nn-->\nnew<!--/k3x9--><!--split p3qz-->\ntwo',
        );
        // Enter after the word: the break after it is a blank line, as the one it was typed on.
        const enter = typeAt(text, 8, '\n', { side: -1 });
        expect(newestView(enter).text, what).toBe('one \nnew\n\ntwo\n');
        expectOrderFree(`${what}, Enter after the word`, enter);
      }
    }
  });

  it('gives the blank line back when what was typed on it is deleted again', () => {
    for (const side of sides) {
      for (const [what, before] of Object.entries(broken(side))) {
        const typed = typeAt(before, 5, 'new', { ids: ['k3x9', 'w8nn', 'p3qz'], side });
        // All of it at once, and letter by letter with Backspace.
        const removed = typeAt(typed, 5, '', { side, to: 8 });
        let backspaced = typed;
        for (const at of [8, 7, 6]) backspaced = typeAt(backspaced, at - 1, '', { side, to: at });
        for (const [how, after] of [
          ['at once', removed],
          ['with Backspace', backspaced],
        ] as const) {
          const label = `${what}, ${how}, side ${side}`;
          // One split whose break is a blank line, as Enter twice makes it.
          expect(bodyText(after), label).toBe('one <!--split w8nn-->\n\ntwo');
          expect(newestView(after).text, label).toBe('one \n\ntwo\n');
          expectOrderFree(label, after);
        }
        // Words and a line break after them: the second split goes behind the paragraph break,
        // as Enter three times leaves it.
        const enter = typeAt(before, 5, 'new\n', { ids: ['k3x9', 'w8nn', 'p3qz'], side });
        const words = typeAt(enter, 5, '', { side, to: 8 });
        expect(bodyText(words), `${what}, Enter`).toBe(
          'one <!--split w8nn-->\n\n<!--split p3qz-->\ntwo',
        );
        expectOrderFree(`${what}, Enter, side ${side}`, words);
        // A space, which the break takes in, and Backspace: the split stays, as it was.
        const space = typeAt(before, 5, ' ', { ids: ['k3x9'], side });
        expect(bodyText(space), `${what}, a space`).toBe('one <!--split k3x9-->\n \ntwo');
        const back = typeAt(space, 5, '', { side, to: 6 });
        expect(bodyText(back), `${what}, a space and Backspace`).toBe(
          'one <!--split k3x9-->\n\ntwo',
        );
        expectOrderFree(`${what}, a space and Backspace, side ${side}`, back);
      }
    }
  });

  it('types on the blank line of a quote or a list item after the prefix of the lines there', () => {
    for (const side of sides) {
      for (const [what, base, at, first, second, blank, expected] of [
        ['a quote, Enter twice', '> one two\n', 6, '\n> ', '\n> ', 9, '> one \n> new\n> two\n'],
        ['a quote, typed at once', '> one two\n', 6, '\n>\n> ', '', 8, '> one \n> new\n> two\n'],
        ['a list item', '- one two\n', 6, '\n\n  ', '', 7, '- one \n  new\n  two\n'],
        ['a list item, indented', '- one two\n', 6, '\n  \n  ', '', 9, '- one \n  new\n  two\n'],
      ] as const) {
        let before = typeAt(base, at, first, { ids: ['s3vb'], side });
        if (second !== '') before = typeAt(before, at + first.length, second, { side });
        // At the end of the blank line, and in front of its prefix: after the prefix that the
        // lines of the block have.
        for (const offset of [blank, at + 1]) {
          const label = `${what}, at ${offset}, side ${side}`;
          const after = typeAt(before, offset, 'new', { ids: ['k3x9', 'w8nn', 'p3qz'], side });
          expect(newestView(after).text, label).toBe(expected);
          expect(originalView(after).text, label).toBe(base);
          expectOrderFree(label, after);
        }
      }
    }
  });

  it('types in the paragraph break of your own insertion, and after Enter three times', () => {
    for (const side of sides) {
      // A paragraph break in typed words: the split is in the insertion.
      const words = typeAt('one two\n', 4, 'new\n\nwords ', { ids: ['k3x9', 's3vb'], side });
      expect(bodyText(words)).toBe(
        'one <!--ins k3x9-->new<!--split s3vb-->\n\nwords <!--/k3x9-->two',
      );
      const inside = typeAt(words, 8, 'x', { ids: ['w8nn', 'p3qz'], side });
      expect(newestView(inside).text, `insertion, side ${side}`).toBe('one new\nx\nwords two\n');
      expectOrderFree(`insertion, side ${side}`, inside);
      // Enter three times, and text on each empty line.
      const ids: Record<number, string[]> = { 4: ['s3vb'], 5: [], 6: ['w8nn'] };
      const thrice = [4, 5, 6].reduce(
        (text, at) => typeAt(text, at, '\n', { ids: ids[at] ?? [], side }),
        'one two\n',
      );
      expect(newestView(thrice).text).toBe('one \n\n\ntwo\n');
      for (const at of [5, 6]) {
        const label = `three times, at ${at}, side ${side}`;
        const after = typeAt(thrice, at, 'new', { ids: ['k3x9', 'p3qz', 'q4gt'], side });
        expect(newestView(after).text, label).toBe(typedInto(thrice, at, 'new'));
        expectOrderFree(label, after);
      }
    }
  });

  it('refuses text typed in another person’s break, which only they can part', () => {
    // On the blank line, the text would part Bo's break in two, and rejecting his change would then
    // take away one line break and leave the other. The refusal names the change to decide first.
    const message =
      "Text can't be typed inside Bo Chen's line break while it is pending. Decide Bo Chen's line break first.";
    for (const side of sides) {
      for (const [what, base, at, first, blank] of [
        ['a paragraph break', 'one two\n', 4, '\n\n', 5],
        ['a quote', '> one two\n', 6, '\n>\n> ', 8],
      ] as const) {
        const before = typeAt(base, at, first, { author: bo, ids: ['s3vb'], side });
        for (const insert of ['new', ' ', 'new\nwords']) {
          expect(
            () => typeAt(before, blank, insert, { ids: ['k3x9', 'w8nn', 'p3qz'], side }),
            `${what}, ${JSON.stringify(insert)}, side ${side}`,
          ).toThrow(message);
        }
      }
    }
  });
});

describe('text typed on a blank line between two blocks is a block (format §3.4)', () => {
  it('is a whole-block insertion with its opener on a line of its own', () => {
    // Enter twice at the end of a paragraph leaves a blank line with a blank line on either side.
    const { before, after, markIds } = type('Para one.\n\n\n\nPara two.', 11, 'New', ['k3x9']);
    expect(bodyText(after)).toBe('Para one.\n\n<!--ins k3x9-->\n\nNew<!--/k3x9-->\n\nPara two.');
    expect(markIds).toEqual(['k3x9']);
    expect(parse(after).warnings).toEqual([]);
    expect(without(newestView(after).text)).toBe('Para one.\n\nNew\n\nPara two.');
    expect(without(originalView(after).text)).toBe(without(originalView(before).text));
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe('Para one.\n\n\n\nPara two.');
    expect(bodyText(applyChanges(after, acceptAll(after)))).toBe('Para one.\n\nNew\n\nPara two.');
  });

  it('is the same after Enter on a blank line, which makes the second blank line', () => {
    const blank = 'Para one.\n\nPara two.';
    const enter = type(blank, 10, '\n');
    expect(bodyText(enter.after)).toBe('Para one.\n\n\nPara two.');
    // The caret is after the line break that was typed: 11. Typed text goes there.
    const typed = applyChanges(
      enter.after,
      trackedEdit(enter.after, { from: 11, to: 11, insert: 'New' }, context(ada, ['k3x9'])),
    );
    expect(parse(typed).warnings).toEqual([]);
    expect(without(newestView(typed).text)).toBe('Para one.\n\nNew\nPara two.');
  });

  it('is a block after a heading, which is one line', () => {
    const { after } = type('## Heading\n\n\nText.', 11, 'New', ['k3x9']);
    expect(bodyText(after)).toBe('## Heading\n<!--ins k3x9-->\n\nNew<!--/k3x9-->\n\nText.');
    expect(parse(after).warnings).toEqual([]);
    expect(without(newestView(after).text)).toBe('## Heading\nNew\n\nText.');
  });

  it('continues the paragraph above when it is on the line right below it, as in Markdown', () => {
    // After one Enter at the end of a paragraph, the line has text right above it: a wrapped line.
    const { before, after } = type('Para one.\n\n\nPara two.', 10, 'New', ['k3x9']);
    expect(bodyText(after)).toBe('Para one.<!--sub k3x9 \\n-->\nNew<!--/k3x9-->\n\nPara two.');
    expect(parse(after).warnings).toEqual([]);
    expect(without(newestView(after).text)).toBe('Para one.\nNew\n\nPara two.');
    expect(without(originalView(after).text)).toBe(without(originalView(before).text));
  });
});

describe('replacing the whole document (format §3.4)', () => {
  const body = '# Title\n\nFirst para here.\n\n- item one\n- item two\n\n> A quote.\n\nLast para.';
  const before = file(body);
  const bodyEnd = body.length + 2;

  /** Types over everything, up to the end of the body or the end of the file's text. */
  function replaceAll(insert: string, to: number, ids = ['k3x9']) {
    const edit = { from: 0, to, insert };
    const after = applyChanges(before, trackedEdit(before, edit, context(ada, ids)));
    expect(parse(after).warnings).toEqual([]);
    expect(without(originalView(after).text)).toBe(without(originalView(before).text));
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe(body);
    return after;
  }

  it('is a substitution of everything after the prefix of the first block', () => {
    for (const to of [body.length, bodyEnd]) {
      const after = replaceAll('New text', to);
      expect(bodyText(after)).toBe(
        '# <!--sub k3x9 Title\\n\\nFirst para here.\\n\\n- item one\\n- item two\\n\\n> A quote.\\n\\nLast para.-->New text<!--/k3x9-->',
      );
      expect(without(newestView(after).text)).toBe('# New text');
      expect(without(applyChanges(after, acceptAll(after)))).toContain('# New text');
    }
  });

  it('holds the paragraph breaks of the new text as splits inside the substitution', () => {
    const after = replaceAll('New one.\n\nNew two.', body.length, ['k3x9', 's3vb']);
    expect(bodyText(after)).toContain('New one.<!--split s3vb-->\n\nNew two.<!--/k3x9-->');
    expect(without(newestView(after).text)).toBe('# New one.\n\nNew two.');
  });

  it('is a deletion of everything when nothing is typed', () => {
    const edit = { from: 0, to: bodyEnd, insert: '' };
    const after = applyChanges(before, trackedEdit(before, edit, context(ada, ['k3x9'])));
    expect(bodyText(after)).toBe(
      '<!--del k3x9 # Title\\n\\nFirst para here.\\n\\n- item one\\n- item two\\n\\n> A quote.\\n\\nLast para.-->',
    );
    expect(without(newestView(after).text)).toBe('');
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe(body);
  });

  it('is a deletion and an insertion when other people’s changes are in it', () => {
    const marked = file('One <!--ins k3x9-->two<!--/k3x9--> three.\n\nFour.', { k3x9: 'bo' });
    const edit: TextChange = { from: 0, to: marked.indexOf('\n\n<!-- redlines'), insert: 'New' };
    const after = applyChanges(marked, trackedEdit(marked, edit, context(ada, ['w2rf', 'w3rf'])));
    expect(parse(after).warnings).toEqual([]);
    expect(without(newestView(after).text)).toBe('New');
    expect(without(originalView(after).text)).toBe(without(originalView(marked).text));
    // Bo's insertion is still Bo's, and Ada's deletion of its text is inside it.
    expect(parse(after).marks.find((mark) => mark.id === 'k3x9')?.entry.by).toBe('bo');
  });
});

describe('Enter in a numbered list numbers the items after it again (format §3.4)', () => {
  // The Markdown keymap of the editor types the break with the next number, and numbers the items
  // after it again: the edits of one transaction. The editor makes them one at a time, the last
  // first; `trackedEdits` makes them together. Whatever way they are made, accepting every change
  // gives the list as the keymap made it, and rejecting every change gives the list as it was, or
  // the edit is refused and the file is as it was.
  const intro = '## Try it\n\n1. Turn on **Track Changes**, then type.\n2. Press Enter twice.\n';
  const three = '3. Hover over a change to accept or reject it.\n';
  const four = '4. Reply to a comment from its note in the margin.\n';
  const five = '5. Switch between Clean, Redlines and Raw with the eye.';
  const quote = (decides: string) => `\n\n> Changes are kept until someone ${decides}, in any app.`;
  const body = `${intro}${three}${four}${five}${quote('<!--sub r4tn decides-->accepts them<!--/r4tn-->')}`;
  const IDS = ['k3x9', 'w8nn', 'p3qz', 'q4gt', 'r5tw', 's6vx'];

  const before = file(body, { r4tn: 'bo' });
  /** The edits of an Enter at `caret`: the break with the next number, and the item after it. */
  const enter = (caret: number): TextChange[] => {
    const number = before.indexOf('5. Switch');
    return [
      { from: caret, to: caret, insert: '\n5. ' },
      { from: number, to: number + 1, insert: '6' },
    ];
  };
  /** Where `position` of `before` is after `changes`. */
  const moved = (position: number, changes: readonly TextChange[]) =>
    changes.reduce(
      (at, change) =>
        at >= change.to ? at + change.insert.length - (change.to - change.from) : at,
      position,
    );

  const modes: Record<string, (edits: TextChange[]) => string> = {
    // The last first: the offsets of the ones before it do not move.
    'one at a time, the last first (the editor)': (edits) =>
      [...edits]
        .reverse()
        .reduce(
          (text, edit) => applyChanges(text, trackedEdit(text, edit, context(ada, IDS))),
          before,
        ),
    'one at a time, the first first': (edits) => {
      let text = before;
      const made: TextChange[] = [];
      for (const edit of edits) {
        const at = { from: moved(edit.from, made), to: moved(edit.to, made) };
        const changes = trackedEdit(text, { ...edit, ...at }, context(ada, IDS));
        made.push(...changes);
        text = applyChanges(text, changes);
      }
      return text;
    },
    together: (edits) =>
      applyChanges(before, trackedEdits(before, edits, context(ada, IDS)).changes),
  };

  /** Checks a result that was made: the views and both decisions. */
  function expectList(after: string, newestFour: string, newestFive: string) {
    expect(parse(after).warnings).toEqual([]);
    const newest = `${intro}${three}${newestFour}${newestFive}${quote('accepts them')}`;
    expect(without(newestView(after).text)).toBe(newest);
    expect(without(originalView(after).text)).toBe(without(originalView(before).text));
    expect(bodyText(applyChanges(after, acceptAll(after)))).toBe(newest);
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe(
      `${intro}${three}${four}${five}${quote('decides')}`,
    );
    // Bo's change is still Bo's.
    expect(parse(after).marks.find((mark) => mark.id === 'r4tn')?.entry.by).toBe('bo');
  }

  /** Runs the edits in a mode: the file, or undefined when the edit is refused. */
  function run(mode: string, edits: TextChange[]): string | undefined {
    try {
      return modes[mode]?.(edits);
    } catch (error) {
      if (!(error instanceof EditError) || error.code !== 'no-legal-placement') throw error;
      return undefined;
    }
  }

  for (const mode of Object.keys(modes)) {
    it(`in the middle of an item, ${mode}`, { timeout: 10_000 }, () => {
      const caret = before.indexOf('fro') + 'fro'.length;
      const after = run(mode, enter(caret));
      expect(after, 'the edit is refused').toBeDefined();
      expectList(
        after as string,
        '4. Reply to a comment fro\n5. m its note in the margin.\n',
        '6. Switch between Clean, Redlines and Raw with the eye.',
      );
    });

    it(`at the end of an item, ${mode}: right, or refused`, { timeout: 10_000 }, () => {
      const caret = before.indexOf('margin.') + 'margin.'.length;
      const after = run(mode, enter(caret));
      // Where the new empty item and the sub of the next one are written in the same place, the
      // sub would be read as the carrier of the empty item's marker: refused.
      if (after === undefined) return;
      expectList(
        after,
        '4. Reply to a comment from its note in the margin.\n5. \n',
        '6. Switch between Clean, Redlines and Raw with the eye.',
      );
    });
  }

  it('at the end of an item, the way the editor makes it, is not refused', () => {
    const caret = before.indexOf('margin.') + 'margin.'.length;
    expect(run('one at a time, the last first (the editor)', enter(caret))).toBeDefined();
  });

  it('in a longer list: every item after it is numbered again, and 9 becomes 10', () => {
    const items = Array.from({ length: 9 }, (_, i) => `${i + 1}. Item ${i + 1} text.`);
    const list = file(items.join('\n'));
    const caret = list.indexOf('Item 3') + 'Item 3'.length;
    const edits: TextChange[] = [{ from: caret, to: caret, insert: '\n4. ' }];
    for (let n = 4; n <= 9; n++) {
      const at = list.indexOf(`${n}. Item`);
      edits.push({ from: at, to: at + 1, insert: String(n + 1) });
    }
    const ids = [...IDS, 'b3cd', 'f4gh', 'j5km', 'n6pq', 'r7st', 't8vw'];
    const after = [...edits]
      .reverse()
      .reduce((text, edit) => applyChanges(text, trackedEdit(text, edit, context(ada, ids))), list);
    const newest = [
      '1. Item 1 text.',
      '2. Item 2 text.',
      '3. Item 3',
      '4.  text.',
      ...Array.from({ length: 6 }, (_, i) => `${i + 5}. Item ${i + 4} text.`),
    ].join('\n');
    // The tenth item has two digits.
    expect(without(newestView(after).text)).toBe(newest);
    expect(bodyText(applyChanges(after, acceptAll(after)))).toBe(newest);
    expect(bodyText(applyChanges(after, rejectAll(after)))).toBe(items.join('\n'));
    expect(parse(after).warnings).toEqual([]);
  });
});

describe('Enter at every position (format §3.2)', () => {
  // Every position, both sides of hidden text, two authors and two kinds of break: a few hundred
  // edits, each one parsed and viewed again. A slow runner needs more than the default 5 seconds.
  it(
    'never leaves a marker at the start of a line, in the example of format §1.2',
    { timeout: 120_000 },
    () => {
      const view = newestView(fixture);
      const was = parse(fixture).warnings.length;
      let done = 0;
      let refused = 0;
      for (const author of [ada, bo]) {
        for (const insert of ['\n', '\n\n']) {
          for (let at = 0; at <= view.text.length - 1; at++) {
            const seen = new Set<number>();
            for (const side of [-1, 1] as const) {
              const source = view.map.toSource(at, side);
              // Both sides of a position that has no hidden text are the same edit.
              if (seen.has(source)) continue;
              seen.add(source);
              try {
                const changes = trackedEdit(
                  fixture,
                  { from: source, to: source, insert },
                  context(author, ['w8nn', 'p3qz']),
                );
                const after = applyChanges(fixture, changes);
                expect(
                  parse(after).warnings.map((warning) => warning.code),
                  `${author.handle} ${JSON.stringify(insert)} at ${at}: ${JSON.stringify(bodyOf(after))}`,
                ).toEqual(parse(fixture).warnings.map((warning) => warning.code));
                expect(parse(after).warnings.length).toBe(was);
                // The text is as it was, with the line break in it.
                expect(newestView(after).text.replace(/\s+/g, ' ')).toBe(
                  `${view.text.slice(0, at)}${insert}${view.text.slice(at)}`.replace(/\s+/g, ' '),
                );
                done++;
              } catch (error) {
                if (!(error instanceof EditError) || error.code !== 'no-legal-placement')
                  throw error;
                refused++;
              }
            }
          }
        }
      }
      // Most go through; the ones that do not are in front of a space and a marker.
      expect(done).toBeGreaterThan(refused * 5);
    },
  );

  it('twice, at every position, is one break that is a blank line', { timeout: 120_000 }, () => {
    const view = newestView(fixture);
    const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
    const was = parse(fixture).warnings.length;
    let twice = 0;
    for (const author of [ada, bo]) {
      for (const second of ['\n', '\n\n']) {
        for (let at = 0; at < view.text.length; at++) {
          const seen = new Set<number>();
          for (const side of [-1, 1] as const) {
            const source = view.map.toSource(at, side);
            if (seen.has(source)) continue;
            seen.add(source);
            let one: string;
            try {
              const edit = { from: source, to: source, insert: '\n' };
              one = applyChanges(fixture, trackedEdit(fixture, edit, context(author, ['w8nn'])));
            } catch (error) {
              // Before a space and a marker, the first Enter is refused: there is no second.
              if (!(error instanceof EditError) || error.code !== 'no-legal-placement') throw error;
              continue;
            }
            const caret = newestView(one).map.toSource(at + 1, -1);
            const edit = { from: caret, to: caret, insert: second };
            const result = trackedEdit(one, edit, context(author, ['p3qz', 'q4gt']));
            const after = applyChanges(one, result);
            const label = `${author.handle} ${JSON.stringify(second)} at ${at}`;
            expect(parse(after).warnings.length, label).toBe(was);
            // The text has the breaks that were typed, and rejecting the changes brings the
            // original back, whatever marks the breaks became.
            expect(flat(newestView(after).text), label).toBe(
              flat(`${view.text.slice(0, at)}\n${second}${view.text.slice(at)}`),
            );
            expect(flat(newestView(applyChanges(after, rejectAll(after))).text), label).toBe(
              flat(originalView(fixture).text),
            );
            twice++;
          }
        }
      }
    }
    expect(twice).toBeGreaterThan(300);
  });

  it('moves the line break past the opener that follows it, which stays on the line before', () => {
    // "the |new importer": the opener of Ada's insertion would start the new line.
    const body = 'We will ship the <!--ins k3x9-->new <!--/k3x9-->importer.';
    const before = file(body, { k3x9: 'ada' });
    const at = before.indexOf('<!--ins');
    for (const insert of ['\n', '\n\n']) {
      const changes = trackedEdit(before, { from: at, to: at, insert }, context(bo, ['s3vb']));
      const after = applyChanges(before, changes);
      expect(bodyText(after)).toBe(
        `We will ship the <!--ins k3x9--><!--split s3vb-->${insert}new <!--/k3x9-->importer.`,
      );
      expect(parse(after).warnings).toEqual([]);
      expect(bodyText(applyChanges(after, reject(after, 's3vb')))).toBe(bodyText(before));
      expect(bodyText(applyChanges(after, accept(after, 's3vb')))).toBe(
        `We will ship the <!--ins k3x9-->${insert}new <!--/k3x9-->importer.`,
      );
    }
  });

  it('puts the break after the closer that follows it, and after a deletion', () => {
    const body = 'after the <!--cmt c8d2-->review<!--/c8d2--> and <!--del w2rf now-->end.';
    const before = file(body, { w2rf: 'bo' }, [
      '  c8d2:',
      '    by: bo',
      '    at: 2026-10-13T22:40Z',
      '    text: |-',
      '      Why?',
    ]);
    const closer = before.indexOf('<!--/c8d2-->');
    const closed = applyChanges(
      before,
      trackedEdit(before, { from: closer, to: closer, insert: '\n' }, context(ada, ['s3vb'])),
    );
    expect(bodyText(closed)).toContain('review<!--/c8d2--><!--split s3vb-->\n and');
    const deletion = before.indexOf('<!--del');
    const deleted = applyChanges(
      before,
      trackedEdit(before, { from: deletion, to: deletion, insert: '\n' }, context(ada, ['s3vb'])),
    );
    expect(bodyText(deleted)).toContain('and <!--del w2rf now--><!--split s3vb-->\nend.');
    expect(parse(deleted).warnings).toEqual([]);
  });

  it('refuses a break in front of spaces and a marker, which would start the new line', () => {
    const before = file('the <!--ins k3x9-->new <!--/k3x9-->importer.', { k3x9: 'ada' });
    const at = before.indexOf(' <!--ins');
    expect(() => trackedEdit(before, { from: at, to: at, insert: '\n' }, context(bo))).toThrow(
      EditError,
    );
  });
});
