// Ordinary typing with Track Changes on (format §3.4): Enter at the end of a block or on a blank
// line, the text typed on the line it makes, and replacing the whole document. The editor and the
// command line make the same edits, so the format decides what they are.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { ada, bo, bodyOf, context, file, fixture, thread } from './test-helpers.ts';
import type { TextChange } from './types.ts';
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
    // The paragraph is one in the original text: another break is another split, in front of it.
    const before = file('One<!--split s3vb-->\n\ntwo.', { s3vb: 'bo' });
    const at = before.indexOf('<!--split');
    const changes = trackedEdit(before, { from: at, to: at, insert: '\n' }, context(ada, ['w8nn']));
    const after = applyChanges(before, changes);
    expect(bodyText(after)).toBe('One<!--split w8nn-->\n<!--split s3vb-->\n\ntwo.');
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
    // The break is a blank line already: the next one is a split of its own, in front of it.
    expect(bodyText(typed.after)).toBe('Hello<!--split w8nn-->\n<!--split s3vb-->\n\n world');
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

  it('is a split of its own after the break of someone else’s split', () => {
    const body = 'One<!--split s3vb-->\n two three.';
    const before = file(body, { s3vb: 'bo' });
    const at = before.indexOf('\n two') + 1;
    const changes = trackedEdit(before, { from: at, to: at, insert: '\n' }, context(ada, ['w8nn']));
    const after = applyChanges(before, changes);
    expect(bodyText(after)).toBe('One<!--split w8nn-->\n<!--split s3vb-->\n two three.');
    expect(parse(after).warnings).toEqual([]);
    expect(accepted(after)).toBe('One\n\n two three.');
    expect(rejected(after)).toBe('One two three.');
    // Bo's split alone is rejected: Ada's break stays.
    expect(bodyText(applyChanges(after, reject(after, 's3vb')))).toBe(
      'One<!--split w8nn-->\n two three.',
    );
  });

  it('goes on in front of the breaks of other people’s splits that come after it', () => {
    const before = file('One<!--split s3vb-->\n two three.', { s3vb: 'bo' });
    const first = before.indexOf('\n two') + 1;
    const one = applyChanges(
      before,
      trackedEdit(before, { from: first, to: first, insert: '\n' }, context(ada, ['w8nn'])),
    );
    expect(bodyText(one)).toBe('One<!--split w8nn-->\n<!--split s3vb-->\n two three.');
    // The caret is after both breaks. Ada's second Enter makes her break a blank line, in front of
    // Bo's marker, and it is her split still.
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
