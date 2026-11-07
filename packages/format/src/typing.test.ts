// Ordinary typing with Track Changes on (format §3.4): Enter at the end of a block or on a blank
// line, the text typed on the line it makes, and replacing the whole document. The editor and the
// command line make the same edits, so the format decides what they are.

import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
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

describe('Enter at the end of the last line of a quote goes on with the quote (#125)', () => {
  // The editor's Enter types the line break and the quote's `> ` there. A split's break takes the
  // blank line after it, and the new line `> ` is blank: the break would take the line break that
  // ends it, which is the paragraph break's, and rejecting the split would leave the block after the
  // quote a line of it. The new line is a blank line of the quote, which a renderer reads as
  // nothing more, as it reads a blank line at the end of a block: it is written plain.

  /** Types `insert` at `at` of a file with `body` by `author`: the new file. */
  function typed(body: string, at: number, insert: string, author = ada): string {
    const before = file(body);
    const ctx = context(author, ['s3vb']);
    return applyChanges(before, trackedEdit(before, { from: at, to: at, insert }, ctx));
  }

  /** Deletes `[from, to)` of a file: the new file. */
  function remove(text: string, from: number, to: number): string {
    return applyChanges(text, trackedEdit(text, { from, to, insert: '' }, context(ada, ['k3x9'])));
  }

  /** The text without its blank lines, a quote's too: where blocks start and end, as read. */
  const unblank = (text: string) => text.replace(/^[ \t>]*$/gm, '').replace(/\n+/g, '\n');

  /** What a renderer makes of the newest text of a file. */
  const rendered = (text: string) => micromark(newestView(text).text);

  const QUOTES = [
    ['a quote with a paragraph after it', '> one two\n\nNext para.', '\n> '],
    ['a quote between paragraphs', 'Intro.\n\n> one two\n\nNext.', '\n> '],
    ['a quote of two lines', '> one\n> two\n\nNext para.', '\n> '],
    ['a quote with a heading after it', '> one two\n\n## Next', '\n> '],
    ['a quote with a list after it', '> one two\n\n- next', '\n> '],
    ['a quote in a quote', '> > one two\n\nNext para.', '\n> > '],
    ['a quote in a list item', '- > one two\n\nNext para.', '\n  > '],
    ['a quote that ends the text', '> one two', '\n> '],
  ] as const;

  it('writes the line break and the quote marker as they are, with no mark', () => {
    for (const [what, body, insert] of QUOTES) {
      // At the end of the quote's last line.
      const at = endOf(body, 'two');
      for (const author of [ada, bo]) {
        const label = `${what}, by ${author.handle}`;
        const before = file(body);
        const after = typed(body, at, insert, author);
        expect(bodyText(after), label).toBe(body.slice(0, at) + insert + body.slice(at));
        expect(parse(after).marks, label).toEqual([]);
        expect(rendered(after), label).toBe(rendered(before));
        // The original text has the blank line of the quote too, which reads as nothing more.
        expect(unblank(originalView(after).text), label).toBe(unblank(originalView(before).text));
      }
    }
  });

  it('takes the quote marker and then the line break out again with Backspace', () => {
    // As the editor's Backspace takes them: the quote markers of the blank line, one quote at a
    // time, then the indentation of a list item's lines, and then the line break. The file is as it
    // was, and no mark is written.
    for (const [what, body, insert] of QUOTES) {
      const at = endOf(body, 'two');
      const before = file(body);
      let text = typed(body, at, insert);
      let end = at + insert.length;
      for (const quote of insert.match(/> ?/g)?.toReversed() ?? []) {
        text = remove(text, end - quote.length, end);
        end -= quote.length;
        expect(parse(text).marks, `${what}, ${JSON.stringify(quote)}`).toEqual([]);
        expect(rendered(text), `${what}, ${JSON.stringify(quote)}`).toBe(rendered(before));
      }
      if (end > at + 1) {
        text = remove(text, at + 1, end);
        expect(parse(text).marks, `${what}, the indentation`).toEqual([]);
      }
      text = remove(text, at, at + 1);
      expect(bodyText(text), what).toBe(bodyText(before));
      expect(parse(text).marks, what).toEqual([]);
    }
  });

  it('takes the quote marker out plain at the end of the text, in front of the ledger', () => {
    // The ledger is not on the line: Backspace takes the quote marker out plain, as anywhere else,
    // and leaves the line break that Enter wrote.
    const before = file('Intro <!--ins b2b2-->x<!--/b2b2-->.\n\n> one two', { b2b2: 'bo' });
    const at = endOf(before, 'one two');
    const entered = applyChanges(
      before,
      trackedEdit(before, { from: at, to: at, insert: '\n> ' }, context(ada)),
    );
    expect(bodyText(entered)).toBe('Intro <!--ins b2b2-->x<!--/b2b2-->.\n\n> one two\n> ');
    const marker = remove(entered, at + 1, at + 3);
    expect(marker).toBe(before.slice(0, at) + '\n' + before.slice(at));
  });

  it('tracks a quote marker line that opens a quote of its own, which a reader sees', () => {
    // A `>` line with no line of its quote right above it is an empty quote, a block of its own:
    // typing it, or taking its markers out, changes what is rendered, and is tracked or refused,
    // never written plain. Each row: the body, the range, and what is typed there.
    for (const [what, body, from, to, insert] of [
      ['a quote marker after a blank line', '> one two\n\nNext.', 9, 9, '\n\n> '],
      [
        'a quote marker after a blank quote line and a blank line',
        '> one two\n\nNext.',
        9,
        9,
        '\n> \n\n> ',
      ],
      ['a quote marker after a line of white space', '> one two\n\nNext.', 9, 9, '\n \n> '],
      ['an empty quote between paragraphs', 'Para.\n\n>\n\nNext.', 7, 8, ''],
      ['an empty quote right below a paragraph', 'Para.\n>\n\nNext.', 6, 7, ''],
      ['an empty quote that ends the text', 'Para.\n\n>', 7, 8, ''],
      ['an empty quote in a quote', '> one\n> >\n\nNext.', 6, 9, ''],
      ['an empty quote in a list item', '- a\n\n  >\n\nNext.', 7, 8, ''],
    ] as const) {
      const before = file(body);
      let after: string;
      try {
        const ctx = context(ada, ['s3vb', 'k3x9', 'w8nn']);
        after = applyChanges(before, trackedEdit(before, { from, to, insert }, ctx));
      } catch (error) {
        expect(error, what).toBeInstanceOf(EditError);
        continue;
      }
      expect(parse(after).marks.length, what).toBeGreaterThan(0);
      expect(originalView(after).text, what).toBe(originalView(before).text);
      expectEveryOrderAlike(what, after, exactly);
      expect(applyChanges(after, acceptAll(after)), what).toBe(newestView(after).text);
    }
  });

  it('is no quote line in an HTML block or code, and is tracked there as anywhere else', () => {
    // A `>` at the start of a line in an HTML block, or in code, is text of that block: a line of
    // it typed or taken out changes what is rendered, and is never written plain. In a quote that
    // holds an HTML block, what the quote's blank line does is left to the tracked edit too.
    const html = (text: string) =>
      micromark(newestView(text).text, { allowDangerousHtml: true }).replace(/\n+/g, '\n');
    for (const [what, body, from, to, insert, plain] of [
      ['a quote marker typed in an HTML block', '<div>\n> x\n\nNext.', 9, 9, '\n> ', false],
      ['a quote marker taken out of an HTML block', '<div>\n> x\n>\n\nNext.', 10, 11, '', false],
      [
        'a quote marker typed in a custom element',
        '<custom-el>\n> x\n\nNext.',
        15,
        15,
        '\n> ',
        false,
      ],
      [
        'a quote marker taken out of a custom element',
        '<custom-el>\n> x\n>\n\nNext.',
        16,
        17,
        '',
        false,
      ],
      [
        'a quote marker typed in a fence in a list item',
        '- ```\n  > x\n\nNext.',
        11,
        11,
        '\n  > ',
        false,
      ],
      [
        'a quote marker typed in a quote that holds an HTML block',
        '> <div>\n> x\n\nNext.',
        11,
        11,
        '\n> ',
        true,
      ],
      [
        'a quote marker taken out of a quote that holds an HTML block',
        '> <div>\n> x\n>\n\nNext.',
        12,
        13,
        '',
        true,
      ],
      [
        'a quote marker typed in indented code',
        'Para.\n\n    > x\n\nNext.',
        14,
        14,
        '\n    > ',
        false,
      ],
    ] as const) {
      const before = file(body);
      let after: string;
      try {
        const ctx = context(ada, ['s3vb', 'k3x9', 'w8nn']);
        after = applyChanges(before, trackedEdit(before, { from, to, insert }, ctx));
      } catch (error) {
        expect(error, what).toBeInstanceOf(EditError);
        continue;
      }
      const marks = parse(after).marks.length;
      if (marks === 0) {
        expect(plain, `${what}: written plain`).toBe(true);
        expect(html(after), what).toBe(html(before));
        continue;
      }
      expect(originalView(after).text, what).toBe(originalView(before).text);
      expectEveryOrderAlike(what, after, exactly);
    }
  });

  it('refuses to take out the quote markers of a blank line that the quote goes on after', () => {
    // Taking them out would part the quote in two, and no marker can stand in a prefix. Before, the
    // deletion took the whole break, and the paragraphs on either side of it were one.
    const message =
      "The quote markers of a blank line can't be taken out as a tracked change where the quote goes on after it: the quote would be parted in two.";
    // Enter twice at the end of a quote, and Backspace on the first of the two new lines.
    const twice = typed('> one two\n> \n\nNext para.', 12, '\n> ');
    expect(bodyText(twice)).toBe('> one two\n> \n> \n\nNext para.');
    expect(() => remove(twice, 10, 12)).toThrow(message);
    // A blank line between two paragraphs of a quote.
    const paragraphs = file('> one\n>\n> two');
    expect(() => remove(paragraphs, 6, 7)).toThrow(message);
  });

  it('continues the quote with the text typed on the new line, in every decision order', () => {
    for (const [what, body, insert] of QUOTES) {
      const at = endOf(body, 'two');
      const entered = typed(body, at, insert);
      const end = at + insert.length;
      const after = applyChanges(
        entered,
        trackedEdit(entered, { from: end, to: end, insert: 'new' }, context(ada, ['k3x9'])),
      );
      const view = newestView(entered).text;
      expect(newestView(after).text, what).toBe(view.slice(0, end) + 'new' + view.slice(end));
      expectEveryOrderAlike(what, after, exactly);
      expect(applyChanges(after, acceptAll(after)), what).toBe(newestView(after).text);
      expect(applyChanges(after, rejectAll(after)), what).toBe(originalView(after).text);
    }
  });

  it('gives the new line back when the text typed on it is deleted again, with no mark', () => {
    // Text typed on the new line is a substitution of the line break in front of it by itself and
    // the text. Deleted again, the substitution's new text is its old text: it changes nothing, and
    // goes, as an insertion of your own does when all its text is deleted.
    for (const [what, body, insert] of [
      ...QUOTES,
      ['a paragraph with a paragraph after it', 'One two.\n\nNext.', '\n'],
    ] as const) {
      const at = endOf(body, what.startsWith('a paragraph') ? 'two.' : 'two');
      const entered = typed(body, at, insert);
      const end = at + insert.length;
      const word = applyChanges(
        entered,
        trackedEdit(entered, { from: end, to: end, insert: 'x' }, context(ada, ['k3x9'])),
      );
      const x = newestView(word).map.toSource(end, 1);
      const deleted = remove(word, x, x + 1);
      expect(deleted, what).toBe(entered);
      expect(parse(deleted).marks, what).toEqual([]);
    }
    // A word replaced by your own, and the new letter taken out again.
    const replaced = applyChanges(
      file('The cat sat.'),
      trackedEdit(file('The cat sat.'), { from: 4, to: 7, insert: 'cats' }, context(ada, ['k3x9'])),
    );
    expect(bodyText(replaced)).toBe('The <!--sub k3x9 cat-->cats<!--/k3x9--> sat.');
    const at = replaced.indexOf('<!--/k3x9-->');
    expect(bodyText(remove(replaced, at - 1, at))).toBe('The cat sat.');
  });

  it('is a split at the end of the last item of a list, whose bullet makes the line no blank line', () => {
    for (const [what, body, insert] of [
      ['a bullet item', '- one\n\nNext para.', '\n- '],
      ['a numbered item', '1. one\n\nNext para.', '\n2. '],
      ['the second item', '- one\n- two\n\nNext para.', '\n- '],
      ['a list item in a quote', '> - one\n\nNext para.', '\n> - '],
    ] as const) {
      const at = body.indexOf('\n\n');
      const after = typed(body, at, insert);
      expect(newestView(after).text, what).toBe(`${body.slice(0, at)}${insert}${body.slice(at)}\n`);
      expect(parse(after).marks.map((mark) => mark.kind)).toEqual(['split']);
      expectEveryOrderAlike(what, after, exactly);
      expect(applyChanges(after, acceptAll(after)), what).toBe(newestView(after).text);
      expect(applyChanges(after, rejectAll(after)), what).toBe(`${body}\n`);
    }
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

  it('is cancelled by Backspace over its last line break (format §3.4)', () => {
    const { after } = twice('Hello world', 5);
    const end = after.indexOf('\n\n world') + 2;
    // Over both line breaks, the split is cancelled, and the paragraph is whole again, with nothing
    // left of the split.
    const none = applyChanges(
      after,
      trackedEdit(after, { from: end - 2, to: end, insert: '' }, context(ada)),
    );
    expect(bodyText(none)).toBe('Hello world');
    expect(parse(none).marks).toEqual([]);
    // Over one of them, the break loses that one, and the split stays; the next Backspace cancels
    // it (#118).
    for (const [from, to] of [
      [end - 1, end],
      [end - 2, end - 1],
    ] as const) {
      const one = applyChanges(after, trackedEdit(after, { from, to, insert: '' }, context(ada)));
      expect(bodyText(one), `${from}-${to}`).toBe('Hello<!--split s3vb-->\n world');
      const at = one.indexOf('\n world');
      const whole = applyChanges(
        one,
        trackedEdit(one, { from: at, to: at + 1, insert: '' }, context(ada)),
      );
      expect(bodyText(whole), `${from}-${to}`).toBe('Hello world');
      expect(parse(whole).marks).toEqual([]);
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

  it('keeps your split when Backspace after Enter takes the markup of the new line', () => {
    // Enter in the middle of a quote or a list item writes the next line's `> ` or bullet in the
    // break of the split. The editor's Backspace right after it takes the `> ` away, or makes the
    // bullet the item's indentation: the split stays, with that break, and the next Backspace,
    // over the line break, cancels it.
    for (const side of sides) {
      for (const [what, base, at, enter, from, to, insert, body, view] of [
        [
          'a quote',
          '> One two.\n',
          6,
          '\n> ',
          7,
          9,
          '',
          '> One <!--split s3vb-->\ntwo.',
          '> One \ntwo.\n',
        ],
        [
          'a bullet item',
          '- One two.\n',
          6,
          '\n- ',
          7,
          9,
          '  ',
          '- One <!--split s3vb-->\n  two.',
          '- One \n  two.\n',
        ],
        [
          'a numbered item',
          '1. One two.\n',
          7,
          '\n2. ',
          8,
          11,
          '   ',
          '1. One <!--split s3vb-->\n   two.',
          '1. One \n   two.\n',
        ],
        [
          'a quote in a quote',
          '> > One two.\n',
          8,
          '\n> > ',
          11,
          13,
          '',
          '> > One <!--split s3vb-->\n> two.',
          '> > One \n> two.\n',
        ],
      ] as const) {
        const label = `${what}, side ${side}`;
        const before = typeAt(base, at, enter, { ids: ['s3vb'], side });
        const after = typeAt(before, from, insert, { side, to });
        expect(bodyText(after), label).toBe(body);
        expect(newestView(after).text, label).toBe(view);
        expect(originalView(after).text, label).toBe(base);
        expectOrderFree(label, after);
        // Backspace over the line break cancels the split, and gives the line back.
        const joined = typeAt(after, at, '', { side, to: at + 1 });
        expect(bodyText(joined), label).toBe(bodyText(base));
        expect(parse(joined).marks, label).toEqual([]);
      }
      // The spaces of a hard break, taken out one by one: a line break, and then the split's.
      const hard = file('One<!--split s3vb-->  \ntwo.', { s3vb: 'ada' });
      const one = typeAt(hard, 3, '', { side, to: 4 });
      expect(bodyText(one)).toBe('One<!--split s3vb--> \ntwo.');
      const none = typeAt(one, 3, '', { side, to: 4 });
      expect(bodyText(none)).toBe('One<!--split s3vb-->\ntwo.');
      for (const text of [one, none]) expectOrderFree(`a hard break, side ${side}`, text);
    }
  });

  it('deletes a line typed on the blank line together with a line break of it', () => {
    // Selected with the line break after it, or the one in front of it: the line goes, and one
    // line break is left of the paragraph break, as in plain text.
    for (const side of sides) {
      for (const [what, before] of Object.entries(broken(side))) {
        const typed = typeAt(before, 5, 'new', { ids: ['k3x9', 'w8nn', 'p3qz'], side });
        for (const [from, to] of [
          [5, 9],
          [4, 8],
        ] as const) {
          const label = `${what}, ${from}-${to}, side ${side}`;
          const after = typeAt(typed, from, '', { side, to });
          expect(newestView(after).text, label).toBe('one \ntwo\n');
          expect(
            parse(after).marks.map((mark) => mark.kind),
            label,
          ).toEqual(['split']);
          expectOrderFree(label, after);
        }
        // Bo's comment on a word of the line, or on all of it: its markers stay, where the edit
        // places them, and the line goes with the line break after it as well.
        for (const [on, from, to] of [
          ['a word', 5, 6],
          ['the line', 5, 8],
        ] as const) {
          const view = newestView(typed);
          const range = { from: view.map.toSource(from, 1), to: view.map.toSource(to, -1) };
          const comment = addComment(typed, range, 'Why?', context(bo, ['c8d2']));
          const commented = applyChanges(typed, comment.changes);
          const label = `${what}, Bo's comment on ${on}, side ${side}`;
          const after = typeAt(commented, 5, '', { ids: ['d3x9', 'q4gt'], side, to: 9 });
          expect(newestView(after).text, label).toBe('one \ntwo\n');
          expect(
            parse(after).marks.some((mark) => mark.id === 'c8d2'),
            label,
          ).toBe(true);
          expect(parse(after).warnings, label).toEqual([]);
          expectEveryOrderAlike(label, after, exactly);
          // The comment stays when the changes are decided.
          const plain = (text: string) => bodyText(text).replace(/<!--\/?(?:cmt )?c8d2-->/g, '');
          expect(plain(applyChanges(after, acceptAll(after))), label).toBe('one \ntwo');
          expect(plain(applyChanges(after, rejectAll(after))), label).toBe('one two');
        }
      }
    }
  });

  it('takes a caret between the CR and the LF of a line break for one after the LF', () => {
    // The editor's own text has LF alone, but a caller can give any offset of the file.
    const text = file('one <!--split s3vb-->\r\n\r\ntwo', { s3vb: 'ada' }).replaceAll(
      /\r?\n/g,
      '\r\n',
    );
    const crlf = text.indexOf('\r\n\r\ntwo');
    const typed = (at: number) =>
      applyChanges(
        text,
        trackedEdit(
          text,
          { from: at, to: at, insert: 'new' },
          context(ada, ['k3x9', 'w8nn', 'p3qz']),
        ),
      );
    // In the first line break: on the blank line, as after it.
    expect(bodyText(typed(crlf + 1))).toBe(bodyText(typed(crlf + 2)));
    expect(bodyText(typed(crlf + 1))).toBe(
      'one <!--ins k3x9--><!--split w8nn-->\r\nnew<!--/k3x9--><!--split p3qz-->\r\ntwo',
    );
    // In the second: on the line after the break, as after it.
    expect(bodyText(typed(crlf + 3))).toBe(bodyText(typed(crlf + 4)));
    expect(newestView(typed(crlf + 3)).text).toBe('one \r\n\r\nnewtwo\r\n');
    for (const at of [crlf + 1, crlf + 3]) expectOrderFree(`at ${at}`, typed(at));
  });

  it('types on the blank line of your own paragraph break inside another person’s insertion', () => {
    // Bo's paragraph break in Ada's pending words. The text that Bo types on its blank line splits
    // Ada's insertion around it, and the line break after the text goes into her insertion's
    // second part, behind its opener, so that the opener does not start the line.
    for (const side of sides) {
      const words = typeAt('one two\n', 4, 'new words ', { ids: ['k3x9'], side });
      const twice = typeAt(typeAt(words, 8, '\n', { author: bo, ids: ['s3vb'], side }), 9, '\n', {
        author: bo,
        side,
      });
      const once = typeAt(words, 8, '\n\n', { author: bo, ids: ['s3vb'], side });
      for (const [what, before] of [
        ['Enter twice', twice],
        ['a paragraph break', once],
      ] as const) {
        const label = `${what}, side ${side}`;
        expect(bodyText(before), label).toBe(
          'one <!--ins k3x9-->new <!--split s3vb-->\n\nwords <!--/k3x9-->two',
        );
        const after = typeAt(before, 9, 'x', { author: bo, ids: ['w8nn', 'p3qz', 'q4gt'], side });
        expect(bodyText(after), label).toBe(
          'one <!--ins k3x9-->new <!--/k3x9--><!--ins w8nn--><!--split p3qz-->\nx<!--/w8nn-->' +
            '<!--ins k3x9--><!--split q4gt-->\nwords <!--/k3x9-->two',
        );
        expect(newestView(after).text, label).toBe('one new \nx\nwords two\n');
        expectOrderFree(label, after);
        // Ada can't type there: the line break is Bo's.
        expect(() => typeAt(before, 9, 'x', { ids: ['w8nn'], side }), label).toThrow(
          "Decide Bo Chen's line break first.",
        );
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

describe('Backspace after Enter twice takes one line break (#118)', () => {
  // Enter twice in the middle of a paragraph is one split whose break is a blank line. Backspace at
  // the start of the second half, or on the blank line, took both line breaks: the split was
  // cancelled, and the paragraph was whole again.

  /** Types `insert` at the newest view's offset `at` of `text`, on the `side` of the markers there,
   * or in place of `[at, to)`: the new file. */
  function typeAt(
    text: string,
    at: number,
    insert: string,
    who: { ids?: string[]; side?: 1 | -1; to?: number } = {},
  ): string {
    const { ids = [], side = 1, to = at } = who;
    const view = newestView(text);
    const edit =
      at === to
        ? { from: view.map.toSource(at, side), to: view.map.toSource(at, side), insert }
        : { from: view.map.toSource(at, 1), to: view.map.toSource(to, -1), insert };
    return applyChanges(text, trackedEdit(text, edit, context(ada, ids)));
  }

  /** Every order of deciding every change gives the same text for the same decisions, and
   * accepting or rejecting them all gives the newest or the original view. */
  function expectOrderFree(label: string, text: string): void {
    expect(parse(text).warnings, label).toEqual([]);
    expectEveryOrderAlike(label, text, exactly);
    expect(applyChanges(text, acceptAll(text)), label).toBe(newestView(text).text);
    expect(applyChanges(text, rejectAll(text)), label).toBe(originalView(text).text);
  }

  const sides = [1, -1] as const;

  /** The newest view with `[from, to)` taken out. */
  const without = (text: string, from: number, to: number) => {
    const view = newestView(text).text;
    return view.slice(0, from) + view.slice(to);
  };

  it('takes one line break of the blank line in a paragraph, and the second Backspace the other', () => {
    for (const side of sides) {
      const twice = typeAt(typeAt('one two\n', 4, '\n', { ids: ['s3vb'], side }), 5, '\n', {
        side,
      });
      const once = typeAt('one two\n', 4, '\n\n', { ids: ['s3vb'], side });
      for (const [what, before] of [
        ['Enter twice', twice],
        ['a paragraph break', once],
      ] as const) {
        expect(bodyText(before), what).toBe('one <!--split s3vb-->\n\ntwo');
        // At the start of `two`, where the caret is, and on the blank line.
        for (const [where, from] of [
          ['at the start of the second half', 5],
          ['on the blank line', 4],
        ] as const) {
          const label = `${what}, ${where}, side ${side}`;
          const after = typeAt(before, from, '', { side, to: from + 1 });
          expect(bodyText(after), label).toBe('one <!--split s3vb-->\ntwo');
          expect(newestView(after).text, label).toBe(without(before, from, from + 1));
          expect(originalView(after).text, label).toBe('one two\n');
          expectOrderFree(label, after);
          // The second Backspace takes the last line break, and the split with it.
          const joined = typeAt(after, 4, '', { side, to: 5 });
          expect(bodyText(joined), label).toBe('one two');
          expect(parse(joined).marks, label).toEqual([]);
        }
      }
    }
  });

  it('takes one line break in a quote and a list item, as Backspace does there', () => {
    for (const side of sides) {
      for (const [what, base, at, breaks, steps] of [
        // The editor's Backspace takes a quote's `> ` first, then the line break.
        [
          'a quote, at the start of the second half',
          '> one two\n',
          6,
          ['\n> ', '\n> '],
          [
            [10, 12, '> one \n> \ntwo\n'],
            [9, 10, '> one \n> two\n'],
          ],
        ],
        [
          'a quote, on the blank line',
          '> one two\n',
          6,
          ['\n> ', '\n> '],
          [
            [7, 9, '> one \n\n> two\n'],
            [6, 7, '> one \n> two\n'],
          ],
        ],
        [
          'a quote, typed at once',
          '> one two\n',
          6,
          ['\n>\n> '],
          [
            [9, 11, '> one \n>\ntwo\n'],
            [8, 9, '> one \n>two\n'],
          ],
        ],
        // In front of the indentation of the second half, and on the blank line.
        [
          'a list item, in front of its indentation',
          '- one two\n',
          6,
          ['\n\n  '],
          [[7, 8, '- one \n  two\n']],
        ],
        [
          'a list item, on the blank line',
          '- one two\n',
          6,
          ['\n\n  '],
          [[6, 7, '- one \n  two\n']],
        ],
        [
          'a list item with an indented blank line',
          '- one two\n',
          6,
          ['\n  \n  '],
          [
            [10, 12, '- one \n  \ntwo\n'],
            [9, 10, '- one \n  two\n'],
          ],
        ],
      ] as const) {
        let text: string = base;
        let caret: number = at;
        for (const [i, insert] of breaks.entries()) {
          text = typeAt(text, caret, insert, { ids: i === 0 ? ['s3vb'] : [], side });
          caret += insert.length;
        }
        for (const [from, to, view] of steps) {
          const label = `${what}, ${from}-${to}, side ${side}`;
          text = typeAt(text, from, '', { side, to });
          expect(newestView(text).text, label).toBe(view);
          expect(originalView(text).text, label).toBe(base);
          expect(
            parse(text).marks.map((mark) => mark.id),
            label,
          ).toEqual(['s3vb']);
          expectOrderFree(label, text);
        }
      }
    }
  });

  it('takes one line break after Enter three times, wherever it is pressed', () => {
    // Enter three times leaves a split whose break is a blank line, and a split behind it. A line
    // break taken out of the first break brings the second split right behind it, alone on the line
    // after the first's line break: the first's break takes the second's in, as Enter makes them.
    for (const side of sides) {
      const ids: Record<number, string[]> = { 4: ['s3vb'], 5: [], 6: ['w8nn'] };
      const thrice = [4, 5, 6].reduce(
        (text, at) => typeAt(text, at, '\n', { ids: ids[at] ?? [], side }),
        'one two\n',
      );
      expect(bodyText(thrice)).toBe('one <!--split s3vb-->\n\n<!--split w8nn-->\ntwo');
      for (const from of [4, 5, 6]) {
        const label = `at ${from}, side ${side}`;
        const after = typeAt(thrice, from, '', { side, to: from + 1 });
        expect(newestView(after).text, label).toBe('one \n\ntwo\n');
        expect(originalView(after).text, label).toBe('one two\n');
        expectOrderFree(label, after);
      }
    }
  });
});

describe('Enter and Backspace in list items, headings and quotes (#129)', () => {
  // The edits are the editor's: its Enter types a line break with the next line's prefix, and its
  // Backspace takes a quote's `> `, makes a bullet the item's indentation, takes the indentation and
  // then the line break. Each comes out as typed, and every order of deciding every change gives
  // the same text.

  /** One step: `[from, to)` of the newest view replaced by `insert`. */
  type Step = readonly [from: number, to: number, insert: string];

  /** Makes each step by Ada on the `side` of the markers there: the file after each. */
  function steps(text: string, list: readonly Step[], side: 1 | -1 = 1): string[] {
    const files: string[] = [];
    for (const [i, [from, to, insert]] of list.entries()) {
      const view = newestView(text);
      const edit =
        from === to
          ? { from: view.map.toSource(from, side), to: view.map.toSource(from, side), insert }
          : { from: view.map.toSource(from, 1), to: view.map.toSource(to, -1), insert };
      const ids = [
        ['s3vb', 'm9tp'],
        ['k3x9', 'b2b2'],
        ['w8nn', 'r5tw'],
        ['p3qz', 'c4cv'],
        ['q4gt', 'd5dw'],
      ][i];
      text = applyChanges(text, trackedEdit(text, edit, context(ada, ids)));
      files.push(text);
    }
    return files;
  }

  /** The newest view after each step, which is as typed, and the checks of every order. */
  function expectAsTyped(label: string, body: string, list: readonly Step[], views: string[]) {
    for (const side of [1, -1] as const) {
      const files = steps(file(body), list, side);
      for (const [i, after] of files.entries()) {
        const what = `${label}, step ${i + 1}, side ${side}`;
        expect(newestView(after).text, what).toBe(views[i]);
        expect(originalView(after).text.replace(/\n+$/, ''), what).toBe(body);
        expect(parse(after).warnings, what).toEqual([]);
        expectEveryOrderAlike(what, after, exactly);
        expect(applyChanges(after, acceptAll(after)), what).toBe(newestView(after).text);
        expect(applyChanges(after, rejectAll(after)), what).toBe(originalView(after).text);
      }
    }
  }

  it('undoes Enter in front of the first word of an item or a heading, and goes on (item 4)', () => {
    // The first half is an empty block, `- ` or `## `: the Backspace that takes the line break took
    // the empty block, bullet or `#`s and all, for a block whose text is all deleted.
    expectAsTyped(
      'a heading',
      'Intro.\n\n## One two',
      [
        [11, 11, '\n'],
        [11, 12, ''],
        [10, 11, ''],
      ],
      ['Intro.\n\n## \nOne two\n', 'Intro.\n\n## One two\n', 'Intro.\n\n##One two\n'],
    );
    expectAsTyped(
      'a bullet item',
      'Intro.\n\n- one two',
      [
        [10, 10, '\n- '],
        [11, 13, '  '],
        [11, 13, ''],
        [10, 11, ''],
        [8, 10, ''],
      ],
      [
        'Intro.\n\n- \n- one two\n',
        'Intro.\n\n- \n  one two\n',
        'Intro.\n\n- \none two\n',
        'Intro.\n\n- one two\n',
        'Intro.\n\none two\n',
      ],
    );
    // At the top of the file, the line break taken out gives the file back.
    for (const [body, typed] of [
      ['## One two', '\n'],
      ['- one two', '\n- '],
    ] as const) {
      const at = body.indexOf(' ') + 1;
      const [entered = ''] = steps(file(body), [[at, at, typed]]);
      const [joined = ''] = steps(entered, [[at, at + 1, '']]);
      expect(bodyText(joined), body).toBe(body);
      expect(parse(joined).marks, body).toEqual([]);
    }
  });

  it('undoes Enter in a quote in a list item, a step at a time (item 1)', () => {
    // The break of the split reads the item's indentation in front of the line's text, once the
    // `> ` is taken out: it is the indentation of the item's lines.
    expectAsTyped(
      'a quote in a list item',
      '- > one two\n\nNext.',
      [
        [8, 8, '\n  > '],
        [11, 13, ''],
        [9, 11, ''],
        [8, 9, ''],
      ],
      [
        '- > one \n  > two\n\nNext.\n',
        '- > one \n  two\n\nNext.\n',
        '- > one \ntwo\n\nNext.\n',
        '- > one two\n\nNext.\n',
      ],
    );
    // A quote in a numbered item, and in a nested item.
    expectAsTyped(
      'a quote in a numbered item',
      '1. > one two',
      [
        [9, 9, '\n   > '],
        [13, 15, ''],
      ],
      ['1. > one \n   > two\n', '1. > one \n   two\n'],
    );
    // A later line of the item's quote, which has the item's indentation in front of `> `.
    expectAsTyped(
      'a later line of a quote in a list item',
      '- > one\n  > two three',
      [
        [16, 16, '\n  > '],
        [19, 21, ''],
        [17, 19, ''],
        [16, 17, ''],
      ],
      [
        '- > one\n  > two \n  > three\n',
        '- > one\n  > two \n  three\n',
        '- > one\n  > two \nthree\n',
        '- > one\n  > two three\n',
      ],
    );
    expectAsTyped(
      'a quote in a nested item',
      '- - > one two',
      [
        [10, 10, '\n    > '],
        [15, 17, ''],
        [11, 15, ''],
      ],
      ['- - > one \n    > two\n', '- - > one \n    two\n', '- - > one \ntwo\n'],
    );
  });

  it('keeps the new line of the last item of a list when Backspace takes its bullet (item 2)', () => {
    // The editor's Backspace makes the bullet the item's indentation. The line is then a blank
    // line, which changes nothing that is rendered: it stays, written plain, as Enter writes one,
    // and the next Backspaces take its white space and its line break out plain.
    for (const [what, body, typed] of [
      ['a bullet item', '- One two.\n\nNext.', '\n- '],
      ['a bullet item that ends the text', '- One two.', '\n- '],
      ['a numbered item', '1. One two.\n\nNext.', '\n2. '],
      ['the second item', '- One\n- two.\n\nNext.', '\n- '],
    ] as const) {
      const at = endOf(body, 'two.');
      const rest = body.slice(at);
      const indent = ' '.repeat(typed.length - 1);
      const files = steps(
        file(body),
        [
          [at, at, typed],
          [at + 1, at + typed.length, indent],
          [at + 1, at + 1 + indent.length, ''],
          [at, at + 1, ''],
        ],
        -1,
      );
      const [split, kept, blank, back] = files.map((text) => bodyText(text));
      expect(split, what).toContain('<!--split s3vb-->');
      expect(kept, what).toBe(`${body.slice(0, at)}\n${indent}${rest}`);
      expect(blank, what).toBe(`${body.slice(0, at)}\n${rest}`.replace(/\n+$/, ''));
      expect(back, what).toBe(body);
      for (const text of files.slice(1)) {
        expect(parse(text).marks, what).toEqual([]);
        expect(micromark(newestView(text).text), what).toBe(micromark(`${body}\n`));
      }
    }
  });

  it('gives the file back after Enter at the end of a last item or a paragraph that a block follows directly (#129)', () => {
    // A heading, a quote, a thematic break of `*`, a fence, an HTML block or comment keeps apart
    // from the line above with no blank line, as with one: the line breaks Enter wrote, or the blank
    // line that Backspace leaves of the new item, are taken out plain, and the blocks are as far
    // apart as the original has them. That was a tracked join of the next block onto the item.
    const AFTER = ['# Head', '> Quote.', '***', '```\ncode\n```', '<div>\nx\n</div>', '<!-- c -->'];
    for (const next of AFTER) {
      for (const [lead, typed] of [
        ['- ', '\n- '],
        ['1. ', '\n2. '],
        ['', '\n'],
      ] as const) {
        // After a paragraph, a line starting with `<` is read as one of its lines: Enter there is
        // refused, as on main.
        if (lead === '' && next.startsWith('<')) continue;
        const body = `${lead}One two.\n${next}`;
        const at = endOf(body, 'two.');
        const indent = ' '.repeat(typed.length - 1);
        const list: Step[] =
          lead === ''
            ? [
                [at, at, typed],
                [at, at + 1, ''],
              ]
            : [
                [at, at, typed],
                [at + 1, at + typed.length, indent],
                [at + 1, at + 1 + indent.length, ''],
                [at, at + 1, ''],
              ];
        const files = steps(file(body), list, -1);
        let view = `${body}\n`;
        for (const [i, [from, to, insert]] of list.entries()) {
          view = view.slice(0, from) + insert + view.slice(to);
          const text = files[i] ?? '';
          const label = `${JSON.stringify(body)}, step ${i + 1}`;
          expect(newestView(text).text, label).toBe(view);
          expectEveryOrderAlike(label, text, exactly);
          if (i > 0 || lead === '') {
            expect(parse(text).marks, label).toEqual([]);
            expect(micromark(newestView(text).text, { allowDangerousHtml: true }), label).toBe(
              micromark(`${body}\n`, { allowDangerousHtml: true }),
            );
          }
        }
        expect(bodyText(files.at(-1) ?? ''), body).toBe(body);
      }
    }
    // Not where the line above is in a quote that the next one goes on, nor in an HTML block,
    // nor under a paragraph that `---` would make a heading: there it is a join, as before.
    for (const [body, at] of [
      ['> One two.\n\n> Next.', 10],
      ['<div>\nOne two.\n\n# Head', 14],
      ['One two.\n\n---', 8],
    ] as const) {
      const [after = ''] = steps(file(body), [[at, at + 1, '']], -1);
      expect(parse(after).marks.length, body).toBeGreaterThan(0);
      expectEveryOrderAlike(body, after, exactly);
    }
  });

  /** The HTML that CommonMark (micromark) makes of a text. */
  const html = (text: string) => micromark(text, { allowDangerousHtml: true });

  it('takes a line break out plain in front of a block only where the blocks read the same (#129)', () => {
    // One of the two line breaks of the blank line between two blocks, taken with Backspace at the
    // start of the next block or with Delete at the end of the line above, is taken out plain only
    // where the blocks around it read the same without the blank line as with it: the same blocks,
    // of the same kinds, with the same text, in the same containers. Everywhere else it is a join,
    // as on main: a lazy line of a quote goes on with the quote after it, in a quote, a quote in a
    // quote or a list in a quote; a line that looks like a block and starts none (a fence whose
    // info string has a backtick, `<!` and no comment or letter, a tag of its own) is a line of the
    // paragraph above; `---` and `===` under a paragraph make it a heading; an HTML block takes the
    // line after it in; and items, or blocks of one item, with no blank line between them make the
    // list tight.
    const JOINS = [
      '> A long quote that\nwraps lazily.\n\n> Another quote.',
      '> > a\nlazy\n\n> q',
      '> > a\nlazy\n\n> > q',
      '> - a\nlazy\n\n> q',
      '> - a\nlazy\n\n> - q',
      '- a\nlazy\n\n- q',
      '1. a\nlazy\n\n2. q',
      'One two.\n\n```a`b`',
      'One two.\n\n<!-x',
      'One two.\n\n<!1 x',
      'One two.\n\n<custom-tag>',
      'One two.\n\n<span>x</span>',
      'One two.\n\n---',
      'One two.\n\n===',
      '<div>\nx\n\n# Head',
      '- One two.\n\n- Three.',
      '- One two.\n\n  # Head',
    ];
    const PLAIN = [
      'One two.\n\n# Head',
      'One two.\n\n> q',
      'One two.\n\n***',
      'One two.\n\n* * *',
      'One two.\n\n___',
      'One two.\n\n```\ncode\n```',
      'One two.\n\n```\ncode\n\nmore\n```',
      'One two.\n\n~~~a`b\ncode\n~~~',
      'One two.\n\n<div>\nx\n</div>',
      'One two.\n\n<!-- c -->',
      'One two.\n\n<?php x ?>',
      'One two.\n\n<![CDATA[ x ]]>',
      'One two.\n\n#',
      'One two.\n\n>',
      '> a\nlazy\n\n# Head',
      '> > a\nlazy\n\n# Head',
      '> - a\nlazy\n\n***',
      '- a\nlazy\n\n> q',
      '- > a\nlazy\n\n> q',
      '- One two.\n\n# Head',
      '- One two.\n\n> q',
      '- a\n  - b\n\n# H',
      '1. One\n\n# Head',
      '> One two.\n\n# Head',
      '> One two.\n\n***',
      '> One two.\n\n<div>',
      '    code\n\n# Head',
      'One two.\\\n\n# Head',
      'One two.  \n\n# Head',
      '# A\n\n# B',
      'Setext\n===\n\n# H',
      '| a | b |\n\n# H',
      'One\n\n\n# Head',
    ];
    // Where the reading does not know what it finds, a link reference definition or a tab, it is a
    // join too, as on main, though the blocks would read the same.
    const UNREAD = ['[a]: /u\n\n# H', 'One two.\n\n#\tHead'];
    for (const body of [...JOINS, ...PLAIN, ...UNREAD]) {
      const i = body.indexOf('\n\n');
      // Backspace at the start of the next block, and Delete at the end of the line above.
      for (const at of [i + 1, i]) {
        const [after = ''] = steps(file(body), [[at, at + 1, '']], -1);
        const label = `${JSON.stringify(body)}, at ${at}`;
        const typed = `${body.slice(0, at)}${body.slice(at + 1)}\n`;
        const plain = parse(after).marks.length === 0;
        expect(plain, label).toBe(PLAIN.includes(body));
        expectEveryOrderAlike(label, after, exactly);
        if (plain) {
          expect(newestView(after).text, label).toBe(typed);
          expect(html(typed), label).toBe(html(`${body}\n`));
        } else expect(html(originalView(after).text), label).toBe(html(`${body}\n`));
      }
    }
    // Another person's comment on the next block is no change of the text: it is read through.
    const commented = file(
      'One two.\n\n# <!--cmt c8d2-->Head<!--/c8d2-->',
      {},
      thread('c8d2', 'bo', 'Why?'),
    );
    const [after = ''] = steps(commented, [[9, 10, '']], -1);
    expect(
      parse(after).marks.filter((mark) => mark.kind !== 'cmt'),
      'a comment',
    ).toEqual([]);
    expect(newestView(after).text, 'a comment').toBe('One two.\n# Head\n');
  });

  it('reads the blocks around a line break from the first line of a file that starts with HTML (#129)', () => {
    // The reading starts at the first line of the file, an HTML block that ends on its line: the
    // line break goes plain. It looked for the start of such a block above the first line, from the
    // first line again, and never stopped.
    for (const body of [
      '<!-- c -->\nOne two.\n\n# Head',
      '<?x ?>\nOne two.\n\n# Head',
      '<!DOCTYPE html>\nOne two.\n\n# Head',
      '<![CDATA[ x ]]>\nOne two.\n\n# Head',
    ]) {
      const at = body.indexOf('\n\n') + 1;
      const [after = ''] = steps(file(body), [[at, at + 1, '']], -1);
      const typed = `${body.slice(0, at)}${body.slice(at + 1)}\n`;
      expect(parse(after).marks, body).toEqual([]);
      expect(newestView(after).text, body).toBe(typed);
      expect(html(typed), body).toBe(html(`${body}\n`));
    }
    // Under a block of `<?` that is still open, the blank line is a line of that block: no plain cut.
    const open = '<?php\nx\n\nOne two.\n\n# Head\n?>';
    const at = open.lastIndexOf('\n\n') + 1;
    const [after = ''] = steps(file(open), [[at, at + 1, '']], -1);
    expect(parse(after).marks.length, open).toBeGreaterThan(0);
    expectEveryOrderAlike(open, after, exactly);
  });

  it('leaves the new item after Enter at the end of an item, a letter and Backspace (#129)', () => {
    // The letter is typed in one insertion with the split. Deleting it leaves the split, as Enter
    // left it, and the empty item: the next letter goes on it. It deleted the item, as deleting all
    // of a block's text does.
    for (const [what, body, typed] of [
      ['a bullet item', '- One two.\n\nNext.', '\n- '],
      ['a bullet item that ends the text', '- One two.', '\n- '],
      ['a numbered item', '1. One two.\n\nNext.', '\n2. '],
      ['an item in the middle of a list', '- One two.\n- Three.', '\n- '],
      ['a list item in a quote', '> - One two.\n\nNext.', '\n> - '],
    ] as const) {
      const at = endOf(body, 'two.');
      const end = at + typed.length;
      // On the side of the markers in front of the caret, as at the end of the text, before the
      // ledger.
      const [entered = '', , deleted = '', again = ''] = steps(
        file(body),
        [
          [at, at, typed],
          [end, end, 'x'],
          [end, end + 1, ''],
          [end, end, 'y'],
        ],
        -1,
      );
      expect(newestView(deleted).text, what).toBe(newestView(entered).text);
      expect(
        parse(deleted).marks.map((mark) => mark.kind),
        what,
      ).toEqual(['split']);
      const view = newestView(entered).text;
      expect(newestView(again).text, what).toBe(`${view.slice(0, end)}y${view.slice(end)}`);
      for (const text of [deleted, again]) {
        expectEveryOrderAlike(what, text, exactly);
        expect(originalView(text).text.replace(/\n+$/, ''), what).toBe(body);
        expect(applyChanges(text, rejectAll(text)), what).toBe(originalView(text).text);
      }
    }
  });

  it('gives the line breaks back with no mark after a block, a letter and Backspace (#129)', () => {
    // After a heading, which is one line, or after Enter twice, the letter is a block of its own,
    // a whole-block insertion. Deleting it took a line break that Enter wrote with it, as deleting
    // a block takes one of its breaks: a deletion of a line break that is not in the original.
    for (const [what, body, typed] of [
      ['a heading', '## One two\n\nNext.', '\n'],
      ['a heading that ends the text', '## One two', '\n'],
      ['a paragraph, after Enter twice', 'One two.\n\nNext.', '\n\n'],
      ['a quote, after Enter twice', '> One two.\n\nNext.', '\n\n'],
    ] as const) {
      const at = endOf(body, 'two') + (body.includes('two.') ? 1 : 0);
      const end = at + typed.length;
      const [entered = '', , deleted = '', again = ''] = steps(
        file(body),
        [
          [at, at, typed],
          [end, end, 'x'],
          [end, end + 1, ''],
          [end, end, 'y'],
        ],
        -1,
      );
      expect(deleted, what).toBe(entered);
      expect(parse(deleted).marks, what).toEqual([]);
      const view = newestView(entered).text;
      expect(newestView(again).text, what).toBe(`${view.slice(0, end)}y${view.slice(end)}`);
      expectEveryOrderAlike(what, again, exactly);
    }
  });

  /** The quote paragraphs that a blank line of the quote parts, and what Enter types after `one`. */
  const PARAGRAPHS = [
    ['two paragraphs of a quote', '> one\n>\n> two', '\n> '],
    ['a blank line with a space', '> one\n> \n> two', '\n> '],
    ['two blank lines', '> one\n>\n>\n> two', '\n> '],
    ['a paragraph after the quote', '> one\n>\n> two\n\nNext.', '\n> '],
    ['a blank line that ends the quote', 'Intro.\n\n> one\n>\n\nNext.', '\n> '],
    ['a quote in a quote', '> > one\n> >\n> > two', '\n> > '],
    ['a quote in a list item', '- > one\n  >\n  > two', '\n  > '],
  ] as const;

  it('writes Enter at the end of a quote paragraph before a blank line of the quote plain (item 5)', () => {
    // The new line is a blank line of the quote next to another: a renderer reads the two as one.
    // A split's break would take the blank line after it, and with it the quote's paragraph break:
    // Enter was refused.
    for (const [what, body, insert] of PARAGRAPHS) {
      const at = endOf(body, 'one');
      for (const author of [ada, bo]) {
        const label = `${what}, by ${author.handle}`;
        const before = file(body);
        const ctx = context(author, ['s3vb']);
        const after = applyChanges(before, trackedEdit(before, { from: at, to: at, insert }, ctx));
        expect(bodyText(after), label).toBe(body.slice(0, at) + insert + body.slice(at));
        expect(parse(after).marks, label).toEqual([]);
        expect(micromark(newestView(after).text), label).toBe(micromark(newestView(before).text));
        expect(micromark(originalView(after).text), label).toBe(
          micromark(originalView(before).text),
        );
        // Text typed on the new line goes on with the paragraph above it, as typed, alike.
        const end = at + insert.length;
        const typed = applyChanges(
          after,
          trackedEdit(after, { from: end, to: end, insert: 'new' }, context(author, ['k3x9'])),
        );
        const view = newestView(after).text;
        expect(newestView(typed).text, label).toBe(view.slice(0, end) + 'new' + view.slice(end));
        expectEveryOrderAlike(label, typed, exactly);
        expect(applyChanges(typed, rejectAll(typed)), label).toBe(originalView(typed).text);
      }
    }
  });

  it('takes the new line out again with Backspace, a step at a time, back to the file (item 5)', () => {
    // The editor's Backspace takes the new line's quote markers, one quote at a time, then the
    // indentation of a list item's lines, and the line break. With the markers taken out, the
    // empty line parts the quote, which a reader sees: a substitution of the break from the end
    // of `one` to the end of the first word of the next paragraph, whose old text is the file's,
    // without the blank line that Enter wrote, which went on with another and reads as nothing. The
    // last Backspace gives that old text back, and the substitution goes. It was refused.
    for (const [what, body, insert] of PARAGRAPHS) {
      if (what === 'a blank line that ends the quote') continue;
      const at = endOf(body, 'one');
      const end = at + insert.length;
      const cuts: Step[] = [];
      let caret = end;
      for (const quote of insert.match(/> ?/g)?.toReversed() ?? []) {
        cuts.push([caret - quote.length, caret, '']);
        caret -= quote.length;
      }
      if (caret > at + 1) cuts.push([at + 1, caret, '']);
      cuts.push([at, at + 1, '']);
      const typed = body.slice(0, at) + insert + body.slice(at);
      const views: string[] = [];
      let view = typed;
      for (const [from, to] of cuts) {
        view = view.slice(0, from) + view.slice(to);
        views.push(`${view}\n`);
      }
      for (const side of [1, -1] as const) {
        const entered = applyChanges(
          file(body),
          trackedEdit(file(body), { from: at, to: at, insert }, context(ada)),
        );
        const files = steps(entered, cuts, side);
        for (const [i, after] of files.entries()) {
          const label = `${what}, Backspace ${i + 1}, side ${side}`;
          expect(newestView(after).text, label).toBe(views[i]);
          expect(parse(after).warnings, label).toEqual([]);
          expectEveryOrderAlike(label, after, exactly);
          expect(applyChanges(after, acceptAll(after)), label).toBe(newestView(after).text);
          expect(applyChanges(after, rejectAll(after)), label).toBe(originalView(after).text);
          // The original text is the file's: the blank line Enter wrote reads as nothing.
          expect(micromark(originalView(after).text), label).toBe(micromark(`${body}\n`));
        }
        expect(bodyText(files.at(-1) ?? ''), `${what}, side ${side}`).toBe(body);
        expect(parse(files.at(-1) ?? '').marks, `${what}, side ${side}`).toEqual([]);
      }
    }
  });

  it('writes the parted quote alike for a run of blank quote lines that the file has (item 5)', () => {
    // A run of two blank lines of a quote in the file can't be told from one that Enter wrote: the
    // markers of one taken out write the same substitution, whose old text reads the run as one
    // line. Rejecting it gives the file with one blank line of the quote fewer, which renders the
    // same; Backspace on the line break then gives that, with no mark.
    const body = '> one\n>\n>\n> two';
    const [parted = '', joined = ''] = steps(
      file(body),
      [
        [6, 7, ''],
        [5, 6, ''],
      ],
      -1,
    );
    expect(newestView(parted).text).toBe('> one\n\n>\n> two\n');
    expect(parse(parted).marks.map((mark) => mark.kind)).toEqual(['sub']);
    expectEveryOrderAlike(body, parted, exactly);
    const rejected = applyChanges(parted, rejectAll(parted));
    expect(rejected).toBe('> one\n>\n> two\n');
    expect(micromark(rejected)).toBe(micromark(`${body}\n`));
    expect(bodyText(joined)).toBe('> one\n>\n> two');
    expect(parse(joined).marks).toEqual([]);
  });

  it('takes Enter three times at the end of a quote paragraph as Track Changes off does, and back (item 5)', () => {
    // The editor's third Enter, on an empty quote line, leaves the quote: it takes the markers of
    // both new lines, the last first, in one keystroke. The first writes the substitution of the
    // parted quote; the second falls inside its new text, and changes it there.
    for (const [what, body, quote] of [
      ['a quote', '> One.\n>\n> Two.', '> '],
      ['a quote in a quote', '> > One.\n> >\n> > Two.', '> > '],
      ['a quote in a list item', '- > One.\n  >\n  > Two.', '  > '],
    ] as const) {
      const at = endOf(body, 'One.');
      const n = quote.length;
      const first = at + 1;
      const second = first + n + 1;
      // The markers left of a line once the editor takes the last quote off it.
      const outer = quote.slice(0, quote.lastIndexOf('>')).replace(/\s+$/, ' ').replace(/^ $/, '');
      const cut = n - outer.length;
      const list: Step[] = [
        [at, at, `\n${quote}`],
        [first + n, first + n, `\n${quote}`],
        [second + outer.length, second + n, ''],
        [first + outer.length, first + n, ''],
      ];
      const files = steps(file(body), list, -1);
      const entered = newestView(files[3] ?? '').text;
      const typed = `${body.slice(0, at)}\n${outer}\n${outer}${body.slice(at)}\n`;
      expect(entered, what).toBe(typed);
      for (const [i, text] of files.entries()) {
        expectEveryOrderAlike(`${what}, step ${i + 1}`, text, exactly);
        expect(applyChanges(text, rejectAll(text)), what).toBe(originalView(text).text);
      }
      // Backspace over what is left of the two lines gives the file back, with no mark.
      let text = files[3] ?? '';
      // At the end of the third line, which moved up by the markers taken off the second.
      let caret = second + outer.length - cut;
      for (let k = 0; k < 2 * (outer.length > 0 ? 2 : 1); k++) {
        const view = newestView(text).text;
        const lineAt = view.lastIndexOf('\n', caret - 1) + 1;
        const before = view.slice(lineAt, caret);
        const marker = /> ?$/.exec(before)?.[0];
        const from = marker ? caret - marker.length : before !== '' ? lineAt : caret - 1;
        [text = ''] = steps(text, [[from, caret, '']], -1);
        expect(newestView(text).text, `${what}, Backspace ${k + 1}`).toBe(
          view.slice(0, from) + view.slice(caret),
        );
        expectEveryOrderAlike(`${what}, Backspace ${k + 1}`, text, exactly);
        caret = from;
      }
      expect(bodyText(text), what).toBe(body);
      expect(parse(text).marks, what).toEqual([]);
    }
  });

  it('is not plain where the line after the paragraph opens a quote of its own (item 5)', () => {
    // A deeper quote is a block a renderer shows, and a `>` in an HTML block is no quote: Enter
    // there is tracked or refused, as before.
    for (const body of ['> one\n> >\n> > two', '<div>\n> one\n>\n> two']) {
      const before = file(body);
      const at = endOf(body, 'one');
      try {
        const changes = trackedEdit(before, { from: at, to: at, insert: '\n> ' }, context(ada));
        expect(parse(applyChanges(before, changes)).marks.length, body).toBeGreaterThan(0);
      } catch (error) {
        expect(error, body).toBeInstanceOf(EditError);
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
