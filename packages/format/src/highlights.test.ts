import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { addHighlight } from './highlights.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import { readTables } from './table.ts';
import { tableEdit } from './table-ops.ts';
import type { TableOp } from './table-ops.ts';
import {
  TIME,
  ada,
  bo,
  bodyOf,
  claudeAda,
  context,
  everyOrder,
  expectEveryDecision,
  expectInOrder,
  expectNoDecisionRefused,
  expectNoNewLineStarts,
  file,
  fixture,
  idsOf,
  markersInIndentedCode,
  REFUSALS,
  thread,
  viewBlocks,
} from './test-helpers.ts';
import type { ViewBlock } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import type { Range } from './types.ts';
import { newestView, originalView } from './views.ts';

/** The words of a highlight that code or an HTML comment would hide (format §2.1). */
const IN_CODE =
  "A highlight can't be made inside code or an HTML comment, where its markers would not be read. Highlight the whole code span or comment instead, or the text around a code block.";

/** The range of `needle` in the text. */
function at(text: string, needle: string, occurrence = 0): Range {
  let from = -1;
  for (let i = 0; i <= occurrence; i++) from = text.indexOf(needle, from + 1);
  if (from < 0) throw new Error(`No ${needle} in the text`);
  return { from, to: from + needle.length };
}

/** The ledger comment of a file: what a person would read in it. */
function ledgerOf(text: string): string {
  return text.slice(text.indexOf('<!-- redlines'));
}

/** A text without its trailing line breaks: a file that gains or loses a ledger gains or loses one. */
const trimmed = (text: string) => text.replace(/[\r\n]+$/, '');

/**
 * Makes a highlight by Ada on `range` of `text`, and checks what any highlight must leave: the
 * marks and the ledger match and the ledger is as it is written, the threads are as they were, no
 * marker is in code or starts a line, neither view reads otherwise, and dismissing it by accepting
 * or by rejecting gives back exactly the text it was made on, with no marker and no ledger entry
 * for it. Returns the new text and the highlight's id.
 */
function highlight(
  text: string,
  range: Range,
  ids: string[] = ['h4kz'],
): { result: string; id: string } {
  const { changes, id } = addHighlight(text, range, context(ada, ids));
  const result = applyChanges(text, changes);
  const label = `${JSON.stringify(bodyOf(text))} on ${JSON.stringify(range)}`;
  const before = parse(text);
  const parsed = expectInOrder(
    label,
    before.ledger.comments.map((t) => t.id),
    result,
  );
  const mark = parsed.marks.find((m) => m.id === id);
  expect(mark?.kind, label).toBe('hl');
  expect(
    mark?.segments.every((segment) => segment.close !== undefined),
    label,
  ).toBe(true);
  expect(parsed.ledger.marks[id], label).toMatchObject({ by: 'ada', at: TIME });
  // No warning the file did not have.
  const warned = new Set(before.warnings.map((w) => w.code));
  expect(
    parsed.warnings.map((w) => w.code).filter((code) => !warned.has(code)),
    label,
  ).toEqual([]);
  expectNoNewLineStarts(label, before, parsed);
  // No text changed, so no view did.
  expect(trimmed(newestView(result).text), label).toBe(trimmed(newestView(text).text));
  expect(trimmed(originalView(result).text), label).toBe(trimmed(originalView(text).text));
  expect(markersInIndentedCode(result), label).toEqual(markersInIndentedCode(text));
  // Accepting and rejecting dismiss it, and leave the text: the file as it was, but that a ledger
  // that holds nothing but people goes with its last mark.
  const kept =
    before.ledgerRange === null || before.marks.length > 0 || before.ledger.comments.length > 0;
  const original = kept ? text : `${trimmed(bodyOf(text))}${text.includes('\r\n') ? '\r\n' : '\n'}`;
  for (const decide of [accept, reject]) {
    const dismissed = applyChanges(result, decide(result, id));
    expect(dismissed, label).toBe(original);
    expect(idsOf(dismissed), label).not.toContain(id);
    expect(dismissed, label).not.toContain(id);
  }
  return { result, id };
}

describe('addHighlight', () => {
  it('puts the markers around the text, and the author and time in the ledger', () => {
    const { result, id } = highlight(fixture, at(fixture, 'importer'));
    expect(id).toBe('h4kz');
    expect(bodyOf(result)).toContain(
      'the <!--ins k3x9-->new <!--/k3x9--><!--hl h4kz-->importer<!--/h4kz--> in',
    );
    const parsed = parse(result);
    expect(parsed.ledger.marks['h4kz']).toEqual({ by: 'ada', at: TIME });
    // In the order of the document: the new highlight is after the insertion in front of it.
    expect(parsed.marks.map((m) => [m.id, m.kind])).toEqual([
      ['k3x9', 'ins'],
      ['h4kz', 'hl'],
      ['p7qd', 'sub'],
      ['c8d2', 'cmt'],
      ['w2rf', 'del'],
    ]);
    expect(ledgerOf(result)).toContain(
      '  k3x9: {by: ada, at: 2026-10-13T22:30Z}\n  h4kz: {by: ada, at: 2026-10-31T09:00Z}\n  p7qd:',
    );
    // A highlight has no thread, no quote, and no payload: the comments are as they were.
    expect(parsed.ledger.comments).toEqual(parse(fixture).ledger.comments);
    expect(ledgerOf(result)).not.toContain('quote');
  });

  it('adds the author to the people, and draws an id that is free', () => {
    const text = file('One two.', {}, thread('c8d2'));
    // The first id is a thread's already, the second is free.
    const { changes, id } = addHighlight(
      text,
      { from: 0, to: 3 },
      context(claudeAda, ['c8d2', 'w8nn', 'h4kz']),
    );
    expect(id).toBe('w8nn');
    const result = applyChanges(text, changes);
    // (The thread has no anchor in the text, which a thread may not have.)
    expect(idsOf(result)).toEqual(['w8nn']);
    expect(parse(result).ledger.comments.map((t) => t.id)).toEqual(['c8d2']);
    expect(parse(result).ledger.people.map((p) => p.handle)).toEqual(['ada', 'bo', 'claude-ada']);
    expect(parse(result).ledger.people[2]).toEqual(claudeAda);
    expect(parse(result).ledger.marks['w8nn']).toEqual({ by: 'claude-ada', at: TIME });
  });

  it('writes the note and the group that the context has, as a tracked change does', () => {
    const text = file('One two.');
    const { changes } = addHighlight(
      text,
      at(text, 'two'),
      context(claudeAda, ['h4kz'], { note: 'The key claim', group: 'g2rs' }),
    );
    expect(parse(applyChanges(text, changes)).ledger.marks['h4kz']).toEqual({
      by: 'claude-ada',
      at: TIME,
      group: 'g2rs',
      note: 'The key claim',
    });
  });

  it('covers an insertion, a substitution and a comment anchor that the range holds', () => {
    const range = {
      from: fixture.indexOf('<!--ins k3x9-->'),
      to: fixture.indexOf('.<!--del w2rf'),
    };
    const { result } = highlight(fixture, range);
    expect(bodyOf(result)).toContain(
      'the <!--hl h4kz--><!--ins k3x9-->new <!--/k3x9-->importer in <!--sub p7qd March-->April<!--/p7qd-->, after the <!--cmt c8d2-->security review<!--/c8d2--><!--/h4kz-->.',
    );
    // Starting in the text of the insertion, it starts inside it and ends outside.
    const inside = { from: fixture.indexOf('new '), to: fixture.indexOf(' in <!--sub') };
    expect(bodyOf(highlight(fixture, inside).result)).toContain(
      'the <!--ins k3x9--><!--hl h4kz-->new <!--/k3x9-->importer<!--/h4kz--> in <!--sub',
    );
  });

  it('covers a deletion that the range holds, and a range that is only in one', () => {
    const text = file('a b <!--del b4rt gone-->c d', { b4rt: 'bo' });
    const { result } = highlight(text, { from: 2, to: text.indexOf(' d') + 2 });
    expect(bodyOf(result)).toBe('a <!--hl h4kz-->b <!--del b4rt gone-->c d<!--/h4kz-->');
    // From inside the payload of the deletion: its text is in no view of the file, so the highlight
    // covers the whole marker, which is what a comment does.
    const marker = at(text, '<!--del b4rt gone-->');
    const within = highlight(text, { from: marker.from + 12, to: marker.to - 2 }).result;
    expect(bodyOf(within)).toBe('a b <!--hl h4kz--><!--del b4rt gone--><!--/h4kz-->c d');
  });

  it('overlaps another highlight, holds it, or is held by it', () => {
    const text = file('One two three four.', { h8nq: 'bo' }).replace(
      'two three',
      '<!--hl h8nq-->two three<!--/h8nq-->',
    );
    const crossing = highlight(text, { from: 0, to: text.indexOf(' three') });
    expect(bodyOf(crossing.result)).toBe(
      '<!--hl h4kz-->\n\nOne <!--hl h8nq-->two<!--/h4kz--> three<!--/h8nq--> four.',
    );
    expect(parse(crossing.result).ledger.marks['h8nq']).toEqual({
      by: 'bo',
      at: '2026-10-13T22:30Z',
    });
    const holding = highlight(text, { from: 4, to: text.indexOf('.') });
    expect(bodyOf(holding.result)).toBe(
      'One <!--hl h4kz--><!--hl h8nq-->two three<!--/h8nq--> four<!--/h4kz-->.',
    );
    const held = highlight(text, at(text, 'three'));
    expect(bodyOf(held.result)).toBe(
      'One <!--hl h8nq-->two <!--hl h4kz-->three<!--/h4kz--><!--/h8nq--> four.',
    );
    // The same words twice are two highlights, which can be dismissed one at a time.
    const twice = highlight(text, at(text, '<!--hl h8nq-->two three<!--/h8nq-->'));
    expect(bodyOf(twice.result)).toBe(
      'One <!--hl h4kz--><!--hl h8nq-->two three<!--/h8nq--><!--/h4kz--> four.',
    );
    expect(parse(twice.result).marks.filter((m) => m.kind === 'hl')).toHaveLength(2);
    // And a comment's anchor overlaps one the same way.
    const commented = file('One two three.', {}, thread('c8d2')).replace(
      'two',
      '<!--cmt c8d2-->two<!--/c8d2-->',
    );
    const over = highlight(commented, { from: 0, to: commented.indexOf(' three') });
    expect(bodyOf(over.result)).toBe(
      '<!--hl h4kz-->\n\nOne <!--cmt c8d2-->two<!--/c8d2--><!--/h4kz--> three.',
    );
  });

  it('moves the ends of the range out of a marker', () => {
    const text = file('a<!--ins k3x9-->bc<!--/k3x9-->d', { k3x9: 'bo' });
    const open = at(text, '<!--ins k3x9-->');
    const close = at(text, '<!--/k3x9-->');
    // From inside the opener to inside the closer: the highlight covers both markers.
    const { result } = highlight(text, { from: open.from + 4, to: close.from + 4 });
    expect(bodyOf(result)).toBe('a<!--hl h4kz--><!--ins k3x9-->bc<!--/k3x9--><!--/h4kz-->d');
  });

  it('never puts a marker inside the ledger, and ends where the body does', () => {
    const body = 'One two.';
    const text = file(body);
    const ledgerStart = text.indexOf('<!-- redlines');
    // From the text to inside the ledger, and, as select all does, to the very end of the file.
    for (const to of [ledgerStart + 10, text.length]) {
      const { result } = highlight(text, { from: body.length - 4, to });
      expect(bodyOf(result)).toBe('One <!--hl h4kz-->two.<!--/h4kz-->');
    }
    const all = highlight(text, { from: 0, to: text.length }).result;
    expect(bodyOf(all)).toBe('<!--hl h4kz-->\n\nOne two.<!--/h4kz-->');
    // Only the ledger is not a range of text.
    expect(() =>
      addHighlight(text, { from: ledgerStart + 2, to: text.length }, context(ada)),
    ).toThrow('Select some text to highlight.');
  });

  it('keeps emoji, combining characters and line breaks in the range', () => {
    const text = file('x 😀 café é\ny z');
    const range = { from: 2, to: text.indexOf(' z') };
    const { result } = highlight(text, range);
    expect(bodyOf(result)).toBe('x <!--hl h4kz-->😀 café é\ny<!--/h4kz--> z');
  });

  it('refuses a range with no text, with words that say what to do', () => {
    const text = 'One two.\n';
    let error: unknown;
    try {
      addHighlight(text, { from: 4, to: 4 }, context(ada, ['h4kz']));
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(EditError);
    expect((error as EditError).code).toBe('empty-range');
    expect((error as EditError).message).toBe('Select some text to highlight.');
    // A highlight has no point form, at the start of the text or the end of it either.
    for (const point of [0, text.length - 1, text.length]) {
      expect(() => addHighlight(text, { from: point, to: point }, context(ada, ['h4kz']))).toThrow(
        'Select some text to highlight.',
      );
    }
    // The line break between two blocks is no text: the range goes back to where it started.
    const blocks = file('One.\n\nTwo.');
    for (const range of [
      { from: 4, to: 6 },
      { from: 4, to: 5 },
      { from: 5, to: 6 },
    ]) {
      expect(() => addHighlight(blocks, range, context(ada, ['h4kz']))).toThrow(
        'Select some text to highlight.',
      );
    }
    // A range that is only the line break that wraps a paragraph is none either.
    const wrapped = file('One two\nthree four.');
    expect(() => addHighlight(wrapped, { from: 7, to: 8 }, context(ada, ['h4kz']))).toThrow(
      'Select some text to highlight.',
    );
  });

  it('says what to do where its markers have no place, as well as why', () => {
    // A marker can't go in front of the first pipe of a row, which the text of the line is.
    const text = file('| a | b |\n| - | - |\n| 1 | 2 |');
    let error: unknown;
    try {
      addHighlight(text, { from: 0, to: text.indexOf('2') + 1 }, context(ada, ['h4kz']));
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(EditError);
    expect((error as EditError).code).toBe('no-legal-placement');
    expect((error as EditError).message).toBe(
      'A line that is only Markdown syntax takes no change. Select other text to highlight.',
    );
    // The same cells, from their text, are fine.
    expect(bodyOf(highlight(text, { from: 2, to: text.indexOf('2') + 1 }).result)).toContain(
      '| <!--hl h4kz-->a | b |',
    );
  });

  it('throws a RangeError for a range outside the text', () => {
    expect(() => addHighlight('abc', { from: 1, to: 9 }, context(ada))).toThrow(RangeError);
    expect(() => addHighlight('abc', { from: 2, to: 1 }, context(ada))).toThrow(RangeError);
    expect(() => addHighlight('abc', { from: -1, to: 2 }, context(ada))).toThrow(RangeError);
  });

  it('leaves a ledger that can not be read alone, with an error', () => {
    const broken = 'a b\n\n<!-- redlines\nversion: 1\npeople: {ada: {name: Ada\n-->\n';
    let error: unknown;
    try {
      addHighlight(broken, { from: 0, to: 1 }, context(ada, ['h4kz']));
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(EditError);
    expect((error as EditError).code).toBe('unreadable-ledger');
    expect((error as EditError).message).toContain("can't be read");
  });
});

describe('where the markers of a highlight go', () => {
  it('moves them out of a link destination and an image, over the whole construct', () => {
    const link = file('See [the docs](https://example.com/x) now.');
    const from = link.indexOf('example');
    expect(bodyOf(highlight(link, { from, to: from + 7 }).result)).toBe(
      'See <!--hl h4kz-->[the docs](https://example.com/x)<!--/h4kz--> now.',
    );
    // The text of a link is fine.
    expect(bodyOf(highlight(link, at(link, 'the')).result)).toBe(
      'See [<!--hl h4kz-->the<!--/h4kz--> docs](https://example.com/x) now.',
    );
    const image = file('An ![alt text](a.png) here.');
    expect(bodyOf(highlight(image, at(image, 'alt')).result)).toBe(
      'An <!--hl h4kz-->![alt text](a.png)<!--/h4kz--> here.',
    );
    // A range that starts in a link and ends in an image takes both.
    const both = file('See [a link](https://example.com/x) and ![alt](b.png).');
    expect(
      bodyOf(
        highlight(both, { from: both.indexOf('example'), to: both.indexOf('alt') + 1 }).result,
      ),
    ).toBe('See <!--hl h4kz-->[a link](https://example.com/x) and ![alt](b.png)<!--/h4kz-->.');
  });

  it('moves them off a delimiter whose flanking a marker would change', () => {
    const text = file('A **bold** word.');
    // Inside the `**` where a letter follows it: the marker would be punctuation to the delimiter.
    expect(bodyOf(highlight(text, { from: 2, to: 6 }).result)).toBe(
      'A <!--hl h4kz-->**bo<!--/h4kz-->ld** word.',
    );
    // At the outer edges of the whole run, and its text, a marker is fine.
    expect(bodyOf(highlight(text, at(text, '**bold**')).result)).toBe(
      'A <!--hl h4kz-->**bold**<!--/h4kz--> word.',
    );
    expect(bodyOf(highlight(text, at(text, 'bold')).result)).toBe(
      'A **<!--hl h4kz-->bold<!--/h4kz-->** word.',
    );
  });

  it('starts the highlight of a block on a line of its own, and ends it where the block does', () => {
    const body =
      'Para one.\n\n- first item\n- second item\n\n> quote text\n\n## A heading\n\nLast.';
    const text = file(body);
    const where = (needle: string) => body.indexOf(needle);
    // The range of whole blocks, from the first column of one to the first column of the next.
    const whole = (from: number, to: number) =>
      bodyOf(highlight(text, { from, to }).result).replace(/\n+$/, '');
    expect(whole(0, where('- first'))).toBe(
      body.replace('Para one.', '<!--hl h4kz-->\n\nPara one.<!--/h4kz-->'),
    );
    expect(whole(where('- first'), where('- second'))).toBe(
      body.replace('first item', '<!--hl h4kz-->\n  first item<!--/h4kz-->'),
    );
    expect(whole(where('> quote'), where('## A'))).toBe(
      body.replace('> quote text', '> <!--hl h4kz-->\n>\n> quote text<!--/h4kz-->'),
    );
    expect(whole(where('## A'), where('Last.'))).toBe(
      body.replace('A heading', '<!--hl h4kz-->A heading<!--/h4kz-->'),
    );
  });

  it('starts a wrapped line at the end of the line before, over the line break', () => {
    const text = file('One two\nthree four.');
    expect(bodyOf(highlight(text, { from: 8, to: 13 }).result)).toBe(
      'One two<!--hl h4kz-->\nthree<!--/h4kz--> four.',
    );
  });

  it('runs across blocks as one segment, and across a list', () => {
    const text = file('Para one.\n\nPara two.');
    const { result } = highlight(text, { from: 5, to: 15 });
    expect(bodyOf(result)).toBe('Para <!--hl h4kz-->one.\n\nPara<!--/h4kz--> two.');
    const list = file('- one\n- two\n- three');
    expect(bodyOf(highlight(list, { from: 2, to: 15 }).result)).toBe(
      '- <!--hl h4kz-->\n  one\n- two\n- t<!--/h4kz-->hree',
    );
  });

  it('starts on the text of the block after a blank line, and keeps the blank line in both views', () => {
    // Alone on the blank line, the opener would take the line break after it for its carrier, and
    // the blank line would go from both views (format §3.3).
    for (const [body, from, written] of [
      ['\nFirst words.', 0, '\n<!--hl h4kz-->\n\nFirst<!--/h4kz--> words.'],
      ['\n\nFirst words.', 0, '\n\n<!--hl h4kz-->\n\nFirst<!--/h4kz--> words.'],
      ['One.\n\n\nFirst words.', 6, 'One.\n\n\n<!--hl h4kz-->\n\nFirst<!--/h4kz--> words.'],
      ['\n\n- First words.', 1, '\n\n- <!--hl h4kz-->\n  First<!--/h4kz--> words.'],
      [
        '> One\n>\n>\n> Two three.',
        8,
        '> One\n>\n>\n> <!--hl h4kz-->\n>\n> Two<!--/h4kz--> three.',
      ],
    ] as const) {
      const text = file(body);
      const word = /Two|First/.exec(body)![0];
      const { result } = highlight(text, { from, to: body.indexOf(word) + word.length });
      expect(bodyOf(result).replace(/\n+$/, ''), JSON.stringify(body)).toBe(written);
    }
  });

  it('writes the line breaks of the file: a file with CRLF line breaks keeps them', () => {
    const crlf = file('One two.\n\nThree four.\n\n- five\n- six').replaceAll('\n', '\r\n');
    // At the start of a block, its opener has a line of its own, with the file's line breaks.
    const block = highlight(crlf, at(crlf, 'Three'));
    expect(bodyOf(block.result)).toContain('<!--hl h4kz-->\r\n\r\nThree<!--/h4kz--> four.');
    expect(block.result.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    // In a list item, the item's text goes on a line of its own, indented, as the file writes it.
    const item = highlight(crlf, at(crlf, 'six'));
    expect(bodyOf(item.result)).toContain('- five\r\n- <!--hl h4kz-->\r\n  six<!--/h4kz-->');
    expect(item.result.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    // Across a break, and with the ledger that is written with them.
    const across = highlight(crlf, { from: 4, to: crlf.indexOf('four') + 4 });
    expect(bodyOf(across.result)).toContain('One <!--hl h4kz-->two.\r\n\r\nThree four<!--/h4kz-->');
    expect(across.result.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    // A file with a ledger of its own: the entry is written with CRLF too.
    const plain = highlight(crlf, at(crlf, 'two'));
    expect(ledgerOf(plain.result)).toContain('  h4kz: {by: ada, at: 2026-10-31T09:00Z}\r\n');
  });

  it('dismisses to the file it came from, whatever the file holds', () => {
    // Files with no ledger, with a ledger, with a comment, and with no line break at the end.
    for (const text of [
      'One two three.\n',
      'One two three.',
      '# Title\n\nOne two three.\n\n- a\n- b\n',
      file('One two three.'),
      file('One <!--ins k3x9-->two<!--/k3x9--> three.', { k3x9: 'bo' }),
      file('One <!--cmt c8d2-->two<!--/c8d2--> three.', {}, thread('c8d2')),
      fixture,
    ]) {
      const first = text.search(/two|importer/);
      const word = /two|importer/.exec(text)![0];
      highlight(text, { from: first, to: first + word.length });
    }
  });
});

describe('a highlight in code, an HTML comment and front matter', () => {
  it('refuses a range whose ends are in a code span or an HTML comment, in words about highlights', () => {
    for (const [text, range] of [
      ['Use `code` here.', { from: 6, to: 8 }],
      ['Use `code` here.', { from: 1, to: 8 }],
      ['Use `code` here.', { from: 6, to: 14 }],
      ['A <!-- a note -->b.', { from: 6, to: 10 }],
      ['Para.\n\n```\ncode line\n```\n\nAfter.', { from: 14, to: 18 }],
    ] as const) {
      let error: unknown;
      try {
        addHighlight(file(text), range, context(ada, ['h4kz']));
      } catch (thrown) {
        error = thrown;
      }
      expect(error, JSON.stringify([text, range])).toBeInstanceOf(EditError);
      expect((error as EditError).code, JSON.stringify([text, range])).toBe('inside-code');
      expect((error as EditError).message, JSON.stringify([text, range])).toBe(IN_CODE);
      expect((error as EditError).message).not.toMatch(/comment can't|anchored/);
    }
    // The whole code span is fine.
    const text = file('Use `code` here.');
    expect(bodyOf(highlight(text, at(text, '`code`')).result)).toBe(
      'Use <!--hl h4kz-->`code`<!--/h4kz--> here.',
    );
    // And so is the whole HTML comment.
    const html = file('A <!-- a note --> b.');
    expect(bodyOf(highlight(html, at(html, '<!-- a note -->')).result)).toBe(
      'A <!--hl h4kz--><!-- a note --><!--/h4kz--> b.',
    );
  });

  it('refuses a range in front matter, or one that starts there, saying so', () => {
    const text = file('---\ntitle: Notes\n---\nBody text here.');
    for (const range of [
      { from: 8, to: 12 },
      { from: 0, to: 4 },
      { from: 0, to: text.indexOf('here') },
      { from: text.indexOf('---', 3), to: text.indexOf('Body') + 4 },
    ]) {
      let error: unknown;
      try {
        addHighlight(text, range, context(ada, ['h4kz']));
      } catch (thrown) {
        error = thrown;
      }
      expect(error, JSON.stringify(range)).toBeInstanceOf(EditError);
      expect((error as EditError).code, JSON.stringify(range)).toBe('front-matter');
      expect((error as EditError).message).toBe(
        "A highlight can't be made in front matter yet. Select text in the body instead.",
      );
    }
    // The body after it is fine, and reads as a file of its own: its first block's opener has a
    // line of its own, right under the closing line (format §3.8).
    const { result } = highlight(text, at(text, 'Body text'));
    expect(bodyOf(result)).toBe(
      '---\ntitle: Notes\n---\n<!--hl h4kz-->\n\nBody text<!--/h4kz--> here.',
    );
  });

  /** The same code, indented and fenced: a line of words, a line of `>` alone, a blank line and
   * another line of words, at the top level, in list items (four columns past the start of their
   * text) and in a quote. The fenced blocks are what the indented ones are measured against. */
  const BLOCKS: readonly (readonly [string, string])[] = [
    ['indented', 'Para.\n\n    code line\n    >\n\n    more code\n\nAfter.'],
    ['indented in an item', '- Item.\n\n      code line\n      >\n\n      more code\n\n  After.'],
    [
      'indented eight spaces in an item',
      '-   Item.\n\n        code line\n        >\n\n        more code\n\n    After.',
    ],
    [
      'indented in a numbered item',
      '1. Item.\n\n       code line\n       >\n\n       more code\n\n   After.',
    ],
    [
      'indented in a quote',
      '> Para.\n>\n>     code line\n>     >\n>\n>     more code\n>\n> After.',
    ],
    ['fenced', 'Para.\n\n```\ncode line\n>\n\nmore code\n```\n\nAfter.'],
    ['fenced in an item', '- Item.\n\n  ```\n  code line\n  >\n\n  more code\n  ```\n\n  After.'],
  ];

  const endOf = (text: string, needle: string) => text.indexOf(needle) + needle.length;
  const quoteLine = (text: string) => {
    const start = endOf(text, 'code line\n');
    return { start, end: text.indexOf('\n', start) };
  };
  const lineAt = (text: string, position: number) => text.lastIndexOf('\n', position - 1) + 1;

  /** The ranges of a highlight that has a marker inside the code, by what they cover. */
  const RANGES: readonly (readonly [string, (text: string) => Range])[] = [
    ['a word', (t) => at(t, 'more')],
    ['a word at the end of a line', (t) => ({ from: endOf(t, 'code') - 2, to: endOf(t, 'code') })],
    ['a whole line', (t) => ({ from: lineAt(t, t.indexOf('more')), to: endOf(t, 'more code') })],
    ['the text of a line', (t) => at(t, 'code line')],
    [
      'from the blank line between its lines',
      (t) => ({ from: quoteLine(t).end + 1, to: endOf(t, 'more') }),
    ],
    ['from the line of `>` alone', (t) => ({ from: quoteLine(t).end, to: endOf(t, 'more') })],
    ['from the text before it', (t) => ({ from: t.search(/Para|Item/), to: endOf(t, 'more') })],
    ['into the text after it', (t) => ({ from: t.indexOf('more'), to: endOf(t, 'After') })],
    [
      'the whole block',
      (t) => ({
        from: lineAt(t, t.search(/```|code line/)),
        to: lineAt(t, t.indexOf('After')),
      }),
    ],
  ];

  /** The error of a highlight on `range`, or undefined when it is made. */
  function refusal(text: string, range: Range): EditError | undefined {
    try {
      addHighlight(text, range, context(ada, ['h4kz']));
    } catch (error) {
      if (error instanceof EditError) return error;
      throw error;
    }
    return undefined;
  }

  it('is refused in indented code, in the words of fenced code, wherever the code is', () => {
    for (const [what, body] of BLOCKS) {
      const text = file(body);
      for (const [where, range] of RANGES) {
        const label = `${what}, ${where}`;
        const error = refusal(text, range(text));
        // The ranges that reach outside the code, to text before it and after it, are made, and
        // go around the whole block.
        if (error === undefined) {
          const { changes } = addHighlight(text, range(text), context(ada, ['h4kz']));
          expect(markersInIndentedCode(applyChanges(text, changes)), label).toEqual([]);
          continue;
        }
        if (what.startsWith('fenced')) {
          // Fenced code takes no marker either, and a fence line none at all.
          expect(['inside-code', 'no-legal-placement'], label).toContain(error.code);
          continue;
        }
        expect(error.code, label).toBe('inside-code');
        expect(error.message, label).toBe(IN_CODE);
      }
      // Every indented block is refused somewhere, in these words.
      if (!what.startsWith('fenced')) {
        expect(
          RANGES.some(([, range]) => refusal(text, range(text))?.message === IN_CODE),
          what,
        ).toBe(true);
      }
    }
  });

  it('goes around the whole block, as it does around fenced code', () => {
    for (const [what, body] of BLOCKS) {
      const text = file(body);
      const range = { from: body.search(/Para|Item/), to: endOf(body, 'After.') };
      const { result } = highlight(text, range);
      expect(markersInIndentedCode(result), what).toEqual([]);
    }
  });

  it('is made on a line indented four spaces that goes on a paragraph, or that is the text of an item', () => {
    // Indented code can't interrupt a paragraph, and four spaces are two past an item's text.
    for (const body of [
      'Para.\n    text more',
      '- Item.\n\n    text more',
      '> Para.\n>     text more',
    ]) {
      const text = file(body);
      const { result } = highlight(text, at(text, 'more'));
      expect(bodyOf(result).replace(/\n+$/, ''), body).toBe(
        body.replace('more', '<!--hl h4kz-->more<!--/h4kz-->'),
      );
    }
  });

  it('is refused on a line that is indented code once a pending change is decided', () => {
    // Bo's line break makes the line indented code once it is accepted, and Bo's deletion of the
    // blank line above it keeps it code until it is accepted.
    const split = file('Para.\n    text more');
    const broken = applyChanges(
      split,
      trackedEdit(split, { from: 5, to: 5, insert: '\n\n' }, context(bo, ['w8nn'])),
    );
    const code = file('Para.\n\n    text more');
    const joined = applyChanges(
      code,
      trackedEdit(code, { from: 5, to: code.indexOf('text'), insert: '' }, context(bo, ['w8nn'])),
    );
    for (const [what, text] of [
      ['a line break that makes it code', broken],
      ['a deletion that makes it a line of the paragraph', joined],
    ] as const) {
      expect(markersInIndentedCode(text), what).toEqual([]);
      const error = refusal(text, at(text, 'more'));
      expect(error?.code, what).toBe('inside-code');
      expect(error?.message, what).toBe(IN_CODE);
    }
  });
});

describe('a highlight in every order of decisions', { timeout: 60_000 }, () => {
  /** What each order of deciding the changes of a file comes to, as micromark reads each state's
   * blocks, by the changes decided. A highlight is no change: it stays pending in every state. */
  function reads(text: string) {
    const { outcomes, stuck } = everyOrder(text);
    expect(stuck, 'no order gets stuck').toEqual([]);
    return new Map([...outcomes].map(([decided, results]) => [decided, [...results]]));
  }

  const CASES: readonly (readonly [string, string, (text: string) => Range])[] = [
    [
      'a range that holds an insertion',
      file('One <!--ins k3x9-->two<!--/k3x9--> three <!--del w2rf four--> five.', {
        k3x9: 'bo',
        w2rf: 'bo',
      }),
      (t) => ({ from: 0, to: endOf(t, 'three') }),
    ],
    [
      'a range that starts in an insertion and ends past a deletion',
      file('One <!--ins k3x9-->two three<!--/k3x9--> <!--del w2rf four--> five.', {
        k3x9: 'bo',
        w2rf: 'bo',
      }),
      (t) => ({ from: t.indexOf('three'), to: endOf(t, 'five') }),
    ],
    [
      'a range across blocks, with a deletion and an insertion in it',
      file('First <!--ins k3x9-->para<!--/k3x9-->.\n\n- <!--del w2rf gone-->item two\n\nLast.', {
        k3x9: 'bo',
        w2rf: 'bo',
      }),
      (t) => ({ from: t.indexOf('para'), to: endOf(t, 'item') }),
    ],
    [
      'a range of whole blocks over a substitution',
      file('One.\n\nTwo <!--sub p7qd old-->new<!--/p7qd--> three.\n\nFour.', { p7qd: 'bo' }),
      (t) => ({ from: t.indexOf('Two'), to: t.indexOf('Four') }),
    ],
    [
      'a range over a link and a deletion inside it',
      file('See [the <!--del w2rf old -->docs](https://example.com/x) now and **bold**.', {
        w2rf: 'bo',
      }),
      (t) => ({ from: t.indexOf('docs') + 2, to: t.indexOf('bold') + 2 }),
    ],
  ];
  const endOf = (text: string, needle: string) => text.indexOf(needle) + needle.length;

  it('reads the same, as micromark reads it, in every order of accepting and rejecting', () => {
    for (const [what, before, range] of CASES) {
      const { result, id } = highlight(before, range(before));
      const states = expectEveryDecision(what, before, result, [id]);
      expect(states, what).toBeGreaterThan(0);
      // Both walk the same decisions, and more than one.
      expect(reads(before).size, what).toBeGreaterThan(1);
      expect(reads(result), what).toEqual(reads(before));
    }
  });
});

describe('a highlight in a table', { timeout: 60_000 }, () => {
  const FRUIT =
    '| Fruit  | Count |\n| ------ | ----- |\n| Apples | 3     |\n| Pears  | 5     |\n| Plums  | 7     |';
  const BARE = 'Fruit | Count\n----- | -----\nApples | 3\nPears | 5\nPlums | 7';

  /** The table of `text` with ada's move of its row `row` to the top, pending. */
  function moved(text: string, row: number): string {
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const op: TableOp = { kind: 'moveRows', table, rows: [row], to: 0 };
    return applyChanges(text, tableEdit(text, op, context(ada, ['m2bd', 'n3cd'])).changes);
  }

  const said = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return error instanceof EditError ? error : String(error);
    }
    return 'no error';
  };

  it('goes in a cell, across the cells of a row, and across rows, and is decided in every order', () => {
    const text = file(FRUIT, {});
    expect(bodyOf(highlight(text, at(text, 'Pears')).result)).toContain(
      '| <!--hl h4kz-->Pears<!--/h4kz-->  | 5     |',
    );
    expect(
      bodyOf(highlight(text, { from: text.indexOf('Pears'), to: text.indexOf('5') + 1 }).result),
    ).toContain('| <!--hl h4kz-->Pears  | 5<!--/h4kz-->     |');
    const rows = highlight(text, { from: text.indexOf('Pears'), to: text.indexOf('Plums') + 5 });
    expect(bodyOf(rows.result)).toContain(
      '| <!--hl h4kz-->Pears  | 5     |\n| Plums<!--/h4kz-->  | 7     |',
    );
    // Over the cells of the whole table, from the text of the first to the text of the last.
    const cells = { from: text.indexOf('Fruit'), to: text.indexOf('7') + 1 };
    expect(bodyOf(highlight(text, cells).result)).toContain('| <!--hl h4kz-->Fruit  | Count |');
  });

  it('is refused across rows while a move of rows is pending, naming who moved them, as a comment is', () => {
    for (const table of [FRUIT, BARE]) {
      const text = moved(file(table), 3);
      const across = { from: text.indexOf('Apples'), to: text.indexOf('Pears') + 5 };
      const error = said(() => addHighlight(text, across, context(bo, ['h4kz'])));
      expect(error, table).toBeInstanceOf(EditError);
      expect((error as EditError).code).toBe('no-legal-placement');
      expect((error as EditError).message).toBe(
        "Ada Lovelace's move of rows in this table is pending, and this highlight would run from one row into the next. Decide the move first, or highlight inside one row.",
      );
    }
    // Inside one row it is made, and the move is decided in every order, with it there.
    const text = moved(file(FRUIT), 3);
    const { result } = highlight(text, at(text, 'Apples'));
    expect(expectNoDecisionRefused('inside one row', result)).toBeGreaterThan(0);
    const both = highlight(text, {
      from: text.indexOf('Apples'),
      to: text.indexOf('3') + 1,
    }).result;
    expect(expectNoDecisionRefused('across the cells of one row', both)).toBeGreaterThan(0);
  });

  it('is made across rows when no row is moved: rows inserted or deleted are decided in every order', () => {
    const base = file(FRUIT);
    const table = readTables(base, parse(base))[0]?.from ?? 0;
    const ops: TableOp[] = [
      { kind: 'deleteRows', table, rows: [3] },
      { kind: 'insertRows', table, after: 2, count: 1 },
    ];
    for (const op of ops) {
      const text = applyChanges(base, tableEdit(base, op, context(ada, ['m2bd'])).changes);
      const { result } = highlight(text, {
        from: text.indexOf('Apples'),
        to: text.indexOf('Pears') + 5,
      });
      expect(expectNoDecisionRefused(op.kind, result), op.kind).toBeGreaterThan(0);
    }
  });
});

describe('on random documents', { timeout: 60_000 }, () => {
  it('changes no view, keeps the file in order, and is dismissed to the text it came from', () => {
    const documents = fuzzCount(150);
    let made = 0;
    let refused = 0;
    let wholeBlocks = 0;
    let wholeRefused = 0;
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 6007);
      const below = (n: number) => Math.floor(random() * n);
      const text = randomDocument(seeded(seed));
      const view = newestView(text);
      const blocks = viewBlocks(view.text);
      const threads = parse(text).ledger.comments.map((t) => t.id);
      for (let attempt = 0; attempt < 3; attempt++) {
        // Either end may fall inside a marker. A third of the ranges are whole blocks, from the
        // first column of the first to the first column of the block after the last.
        let from = below(text.length + 1);
        let to = Math.min(text.length, from + below(40));
        const whole = blocks.length > 0 && below(3) === 0;
        if (whole) {
          const first = blocks[below(blocks.length)] as ViewBlock;
          from = view.map.toSource(first.line, 1);
          to = view.map.toSource(first.next, -1);
        }
        const label = `seed ${seed}, attempt ${attempt}, range ${JSON.stringify([from, to])}`;
        const ctx = {
          author: [ada, bo, claudeAda][below(3)] ?? ada,
          time: TIME,
          random: (n: number) => Uint8Array.from({ length: n }, () => below(256)),
        };
        let added: ReturnType<typeof addHighlight>;
        try {
          added = addHighlight(text, { from, to }, ctx);
        } catch (error) {
          // A range with no text, or no place for its markers, or markers that code would hide.
          if (
            error instanceof EditError &&
            [...REFUSALS, 'empty-range'].includes(error.code ?? '')
          ) {
            refused++;
            if (whole) wholeRefused++;
            continue;
          }
          throw new Error(`${label}: ${String(error)}`, { cause: error });
        }
        made++;
        if (whole) wholeBlocks++;
        const result = applyChanges(text, added.changes);
        const parsed = expectInOrder(label, threads, result);
        expectNoNewLineStarts(label, parse(text), parsed);
        expect(
          parsed.marks.some((m) => m.id === added.id && m.kind === 'hl'),
          label,
        ).toBe(true);
        expect(trimmed(newestView(result).text), label).toBe(trimmed(view.text));
        expect(trimmed(originalView(result).text), label).toBe(trimmed(originalView(text).text));
        for (const decide of [accept, reject]) {
          expect(applyChanges(result, decide(result, added.id)), label).toBe(text);
        }
      }
    }
    expect(made + refused).toBe(documents * 3);
    expect(made).toBeGreaterThan(refused);
    // A highlight on whole blocks goes through, but where a construct has no place for its marker.
    expect(wholeRefused).toBeLessThanOrEqual(Math.ceil((wholeBlocks + wholeRefused) / 20));
  });
});
