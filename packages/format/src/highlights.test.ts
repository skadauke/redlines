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
  expectMarkersBeforeLedger,
  expectNoDecisionRefused,
  endsInClosingUnderscore,
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

/** What a person is told when the range of a highlight covers no text. */
const NO_TEXT = 'Select some text to highlight.';

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
  // Every marker of it is in the body: none is in the ledger or after it (format §5.1).
  expectMarkersBeforeLedger(label, result, id);
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

  it('covers a deletion that the range holds, but is refused on one alone', () => {
    const text = file('a b <!--del b4rt gone-->c d', { b4rt: 'bo' });
    const { result } = highlight(text, { from: 2, to: text.indexOf(' d') + 2 });
    expect(bodyOf(result)).toBe('a <!--hl h4kz-->b <!--del b4rt gone-->c d<!--/h4kz-->');
    // From inside the payload of the deletion: its text is in no view of the file, so the highlight
    // would cover the whole marker, which reads as nothing: no text to highlight.
    const marker = at(text, '<!--del b4rt gone-->');
    expect(() =>
      addHighlight(text, { from: marker.from + 12, to: marker.to - 2 }, context(ada, ['h4kz'])),
    ).toThrow(NO_TEXT);
    // With text of the line beside it, it is a range of text that holds the deletion.
    const beside = highlight(text, { from: marker.from + 12, to: text.indexOf('c d') + 1 }).result;
    expect(bodyOf(beside)).toBe('a b <!--hl h4kz--><!--del b4rt gone-->c<!--/h4kz--> d');
  });

  it('refuses a range that covers no text that reads in the newest view, in the words of no text', () => {
    const errorOf = (text: string, range: Range): EditError => {
      try {
        addHighlight(text, range, context(ada, ['h4kz']));
      } catch (thrown) {
        if (thrown instanceof EditError) return thrown;
        throw thrown;
      }
      throw new Error(
        `A highlight was made on ${JSON.stringify(range)} of ${JSON.stringify(text)}`,
      );
    };
    const insertion = file('a<!--ins k3x9-->bc<!--/k3x9-->d', { k3x9: 'bo' });
    const point = file('a<!--cmt c9qf-->bc d', {}, thread('c9qf'));
    const commented = file('One <!--cmt c8d2-->two<!--/c8d2--> three.', {}, thread('c8d2'));
    const highlighted = file('a<!--hl w8nn-->bc<!--/w8nn-->d', { w8nn: 'bo' });
    const deleted = file('a b <!--del b4rt gone-->c d', { b4rt: 'bo' });
    const both = file(
      'One <!--cmt c8d2--><!--del w2rf gone--><!--/c8d2--> two three.',
      { w2rf: 'bo' },
      thread('c8d2'),
    );
    const block = file('One.\n\n<!--del b4rt Two.-->\n\nThree.', { b4rt: 'bo' });
    const split = file('One. <!--split s3vb-->\n\nTwo.', { s3vb: 'bo' });
    for (const [what, text, range] of [
      ['the opener of an insertion', insertion, at(insertion, '<!--ins k3x9-->')],
      ['the closer of an insertion', insertion, at(insertion, '<!--/k3x9-->')],
      ['the point of a point comment', point, at(point, '<!--cmt c9qf-->')],
      ['the opener of a comment', commented, at(commented, '<!--cmt c8d2-->')],
      ['the closer of a comment', commented, at(commented, '<!--/c8d2-->')],
      ['the opener of a highlight', highlighted, at(highlighted, '<!--hl w8nn-->')],
      ['a deletion', deleted, at(deleted, '<!--del b4rt gone-->')],
      [
        'a comment and a deletion that is all it covers',
        both,
        { from: both.indexOf('<!--cmt'), to: both.indexOf('<!--/c8d2-->') + 12 },
      ],
      ['a deleted block', block, at(block, '<!--del b4rt Two.-->')],
      [
        'a deleted block with the line breaks around it',
        block,
        { from: 4, to: block.indexOf('Three') },
      ],
      ['a split', split, at(split, '<!--split s3vb-->')],
      ['the break between two blocks', block, { from: 4, to: 6 }],
    ] as const) {
      const error = errorOf(text, range);
      expect(error.code, what).toBe('empty-range');
      expect(error.message, what).toBe(NO_TEXT);
    }
    // With a word of the text beside the markers it is a range of text, whose markers it covers.
    const withText = highlight(both, {
      from: both.indexOf('<!--cmt'),
      to: both.indexOf(' two') + 1,
    }).result;
    expect(bodyOf(withText)).toBe(
      'One <!--hl h4kz--><!--cmt c8d2--><!--del w2rf gone--><!--/c8d2--> <!--/h4kz-->two three.',
    );
    // The comment is still a range comment on its text, which the highlight did not make a point.
    expect(parse(withText).marks.find((m) => m.id === 'c8d2')?.segments[0]?.close).toBeDefined();
    const whole = {
      from: insertion.indexOf('<!--ins'),
      to: insertion.indexOf('<!--/k3x9-->') + 12,
    };
    expect(bodyOf(highlight(insertion, whole).result)).toBe(
      'a<!--hl h4kz--><!--ins k3x9-->bc<!--/k3x9--><!--/h4kz-->d',
    );
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

  it('ends where the body does for a range to the end of the file, whatever the body ends in', () => {
    // As select all does. A body that ends in a closer, of an insertion, a comment or a highlight,
    // or in a line break, has the highlight's closer in front of the ledger and nothing after it.
    for (const [what, text] of [
      ['text', file('One two three.')],
      ['an insertion', file('One two <!--ins k3x9-->three<!--/k3x9-->', { k3x9: 'bo' })],
      ['a comment', file('One two <!--cmt c8d2-->three<!--/c8d2-->', {}, thread('c8d2'))],
      ['a highlight', file('One two <!--hl w8nn-->three<!--/w8nn-->', { w8nn: 'bo' })],
      ['a bold word', file('One two **three**')],
      ['a deletion', file('One two three <!--del w2rf four-->', { w2rf: 'bo' })],
      ['text, with no ledger', 'One two three.\n'],
    ] as const) {
      for (const from of [4, 0]) {
        const { result, id } = highlight(text, { from, to: text.length });
        expectMarkersBeforeLedger(what, result, id);
      }
    }
  });

  it('refuses a range that ends in the closing underscore that ends the body, where no place is left', () => {
    // A marker next to the `_` would change how it flanks (format §3.1), and at the end of the body
    // the next place is after the ledger, where the editor writes nothing (§5.1): the closer has
    // no place. Selecting the word inside the underscores does, and that is what is told.
    const text = file('Three.\n\nOne _two_');
    const bodyEnd = text.indexOf('\n\n<!-- redlines');
    for (const range of [
      at(text, '_two_'),
      { from: text.indexOf('One'), to: bodyEnd },
      { from: 0, to: bodyEnd },
      { from: text.indexOf('One'), to: text.length },
      { from: 0, to: text.length },
    ]) {
      let error: unknown;
      try {
        addHighlight(text, range, context(ada, ['h4kz']));
      } catch (thrown) {
        error = thrown;
      }
      const label = JSON.stringify(range);
      expect(error, label).toBeInstanceOf(EditError);
      expect((error as EditError).code, label).toBe('no-legal-placement');
      expect((error as EditError).message, label).toBe(
        'There is no place for the markers of this highlight. Select other text to highlight.',
      );
    }
    expect(bodyOf(highlight(text, at(text, 'two')).result)).toBe(
      'Three.\n\nOne _<!--hl h4kz-->two<!--/h4kz-->_',
    );
    // In the middle of the file the same words end in another block, and are refused as well.
    const middle = file('One _two_\n\nThree.');
    expect(() => addHighlight(middle, at(middle, '_two_'), context(ada, ['h4kz']))).toThrow(
      'There is no place for the markers of this highlight.',
    );
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
  /** A table with text before it and after it, as a person highlights across its edges. */
  const around = (table: string) => file(`Intro words.\n\n${table}\n\nOutro words.`);

  /** The table of `text` with ada's move of its row `row` to the top, pending. */
  function moved(text: string, row: number): string {
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const op: TableOp = { kind: 'moveRows', table, rows: [row], to: 0 };
    return applyChanges(text, tableEdit(text, op, context(ada, ['m2bd', 'n3cd'])).changes);
  }

  /** The table of `text` with ada's new row after its row `after`, pending, with `texts` in it. */
  function inserted(text: string, after: number, texts?: string[][]): string {
    const table = readTables(text, parse(text))[0]?.from ?? 0;
    const op: TableOp = { kind: 'insertRows', table, after, count: 1, ...(texts ? { texts } : {}) };
    return applyChanges(text, tableEdit(text, op, context(ada, ['m2bd'])).changes);
  }

  /** The error that a highlight on `range` is refused with. */
  function refusedWith(text: string, range: Range): EditError {
    try {
      addHighlight(text, range, context(bo, ['h4kz']));
    } catch (error) {
      if (error instanceof EditError) return error;
      throw error;
    }
    throw new Error(`A highlight was made on ${JSON.stringify(text.slice(range.from, range.to))}`);
  }

  /** What deciding the pending changes of `text` gives: whether each decision of each is possible. */
  function decisions(text: string): Map<string, string> {
    const found = new Map<string, string>();
    const marks = parse(text).marks.filter((m) => m.kind !== 'cmt' && m.kind !== 'hl');
    for (const { id } of marks) {
      for (const [how, decide] of [
        ['accept', accept],
        ['reject', reject],
      ] as const) {
        try {
          applyChanges(text, decide(text, id));
          found.set(`${how} ${id}`, 'works');
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
          found.set(`${how} ${id}`, error.code ?? 'refused');
        }
      }
    }
    return found;
  }

  /** The words of a highlight that runs from one row of a table into another, or out of it. */
  const ACROSS =
    "Ada Lovelace's change of rows in this table is pending, and this highlight would run from one row into the next, or out of the table. Decide the change first, or highlight inside one row.";

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

  it('is made across rows when no row is inserted or moved: deleted rows are decided in every order', () => {
    const base = file(FRUIT);
    const table = readTables(base, parse(base))[0]?.from ?? 0;
    const op: TableOp = { kind: 'deleteRows', table, rows: [3] };
    const text = applyChanges(base, tableEdit(base, op, context(ada, ['m2bd'])).changes);
    const { result } = highlight(text, {
      from: text.indexOf('Apples'),
      to: text.indexOf('Pears') + 5,
    });
    expect(expectNoDecisionRefused(op.kind, result), op.kind).toBeGreaterThan(0);
  });

  it('is refused across rows, and out of the table, while a row is inserted or moved, naming who did', () => {
    for (const table of [FRUIT, BARE]) {
      for (const [what, text] of [
        ['a move of rows', moved(around(table), 3)],
        ['an inserted row', inserted(around(table), 2)],
      ] as const) {
        const label = `${what}, ${table === FRUIT ? 'with' : 'without'} outer pipes`;
        // From one row into the next, from a cell to the text after the table, and from the text
        // before it into a cell.
        for (const range of [
          { from: text.indexOf('3'), to: text.indexOf('Pears') + 5 },
          { from: text.indexOf('Pears') + 3, to: text.indexOf('Outro') + 5 },
          { from: text.indexOf('Intro'), to: text.indexOf('Apples') + 3 },
        ]) {
          const error = refusedWith(text, range);
          expect(error.code, label).toBe('no-legal-placement');
          expect(error.message, `${label}: ${JSON.stringify(range)}`).toBe(ACROSS);
        }
      }
    }
  });

  it('is refused out of the table from a cell of a moved row, while the move is pending', () => {
    // The row that is moved, now at the top, and the text after the table: its decision would take
    // the cell away and leave the closer.
    for (const table of [FRUIT, BARE]) {
      const text = moved(around(table), 2);
      const cell = text.indexOf('5');
      expect(text.slice(cell - 2, cell + 1), table).toMatch(/\| ?5|\| 5/);
      const error = refusedWith(text, { from: cell, to: text.indexOf('Outro') + 5 });
      expect(error.message, table).toBe(ACROSS);
    }
  });

  it('says what fails, not what does not help, for the first cell of a row with no pipe at its start', () => {
    // The row has no pipe in front of its first cell to put an opener after: the highlight would
    // start at the end of the row above, which is the inserted row.
    const text = inserted(around(BARE), 2);
    const first =
      "Ada Lovelace's change of rows in this table is pending, and this highlight would start at the end of the row above, as a row with no pipe at its start can't hold a marker at its start. Decide the change first, or start the highlight after the first cell of the row.";
    for (const range of [
      at(text, 'Plums'),
      { from: text.indexOf('Plums'), to: text.indexOf('7') + 1 },
    ]) {
      expect(refusedWith(text, range).message, JSON.stringify(range)).toBe(first);
    }
    // The rows below, to the end of the table and past it, run out of the row, and are told so.
    const below = { from: text.indexOf('Plums'), to: text.indexOf('Outro') + 5 };
    expect(refusedWith(text, below).message).toBe(ACROSS);
    // After the first cell it does what the words say: it is made, and decided in every order.
    const { result } = highlight(text, at(text, '7'));
    expect(bodyOf(result)).toContain('Plums | <!--hl h4kz-->7<!--/h4kz-->');
    expect(expectNoDecisionRefused('after the first cell', result)).toBeGreaterThan(0);
    // A table with its outer pipes has a place for the opener inside the row.
    const piped = inserted(around(FRUIT), 2);
    const inside = highlight(piped, at(piped, 'Plums')).result;
    expect(bodyOf(inside)).toContain('| <!--hl h4kz-->Plums<!--/h4kz-->  | 7     |');
    expect(expectNoDecisionRefused('with outer pipes', inside)).toBeGreaterThan(0);
  });

  it('is made inside one row, over the whole table, and elsewhere, while a row is inserted or moved', () => {
    for (const table of [FRUIT, BARE]) {
      for (const [what, text] of [
        ['a move of rows', moved(around(table), 3)],
        ['an inserted row', inserted(around(table), 2)],
      ] as const) {
        const label = `${what}, ${table === FRUIT ? 'with' : 'without'} outer pipes`;
        // Inside one row, from after its first cell (a first cell with no pipe in front of it
        // can't hold the opener), across its cells.
        const row = text.indexOf('Pears');
        for (const range of [
          { from: text.indexOf('5', row), to: text.indexOf('5', row) + 1 },
          { from: text.indexOf('|', row) + 1, to: text.indexOf('5', row) + 1 },
        ]) {
          const { result } = highlight(text, range);
          expect(expectNoDecisionRefused(label, result), label).toBeGreaterThan(0);
        }
        // Over the whole table, from the text before it to the text after it, and over the text
        // around it: no marker is in the table.
        for (const range of [
          { from: text.indexOf('Intro'), to: text.indexOf('Outro') + 5 },
          at(text, 'Intro words.'),
          at(text, 'Outro words.'),
        ]) {
          const { result } = highlight(text, range);
          expect(expectNoDecisionRefused(label, result), label).toBeGreaterThan(0);
        }
      }
    }
  });

  it('is refused at the very start of a row that is inserted or moved, in front of its mark', () => {
    // A marker in front of the mark of a row hides it from the table: neither accepting nor
    // rejecting the row could be done. The text of the row is fine.
    const hides =
      "Claude's change of rows in this table is pending, and this highlight would start in front of the mark of a row that is inserted or moved, at the very start of its first cell. Decide the change first, or start the highlight at the text of the row.";
    for (const table of [FRUIT, BARE]) {
      const base = around(table);
      const at2 = readTables(base, parse(base))[0]?.from ?? 0;
      const op: TableOp = {
        kind: 'insertRows',
        table: at2,
        after: 2,
        count: 1,
        texts: [['Kiwis', '9']],
      };
      const text = applyChanges(base, tableEdit(base, op, context(claudeAda, ['m2bd'])).changes);
      const mark = text.indexOf('<!--ins m2bd row-->');
      const row = { from: mark, to: text.indexOf('Kiwis') + 5 };
      expect(refusedWith(text, row).message, table).toBe(hides);
      // Or just the space in front of it, which the opener would stand in.
      expect(refusedWith(text, { from: mark - 1, to: mark }).message, table).toBe(hides);
      // From its text on, it is made, and the row is decided in every order.
      const { result } = highlight(text, {
        from: text.indexOf('Kiwis'),
        to: text.indexOf('9') + 1,
      });
      expect(expectNoDecisionRefused(table, result), table).toBeGreaterThan(0);
    }
  });

  it('never makes a decision of a pending row impossible that the table allows without it', () => {
    // Every highlight that is made, on the words of the file and on a coarse grid of offsets, in
    // tables with rows inserted, moved and deleted: each pending change is decided as it was.
    const checked = { made: 0, refused: 0 };
    for (const table of [FRUIT, BARE]) {
      const base = around(table);
      const start = readTables(base, parse(base))[0]?.from ?? 0;
      const ops: TableOp[] = [
        { kind: 'insertRows', table: start, after: 0, count: 1 },
        { kind: 'insertRows', table: start, after: 2, count: 1 },
        { kind: 'insertRows', table: start, after: 4, count: 1 },
        { kind: 'moveRows', table: start, rows: [3], to: 0 },
        { kind: 'moveRows', table: start, rows: [2], to: 4 },
        { kind: 'deleteRows', table: start, rows: [3] },
      ];
      for (const op of ops) {
        let text: string;
        try {
          text = applyChanges(base, tableEdit(base, op, context(ada, ['m2bd', 'n3cd'])).changes);
        } catch (error) {
          if (error instanceof EditError) continue;
          throw error;
        }
        const body = bodyOf(text);
        const markers = parse(text).marks.flatMap((mark) =>
          mark.segments.flatMap((s) => [s.open, ...(s.close ? [s.close] : [])]),
        );
        const words: Range[] = [];
        for (const match of body.matchAll(/[A-Za-z0-9]+/g)) {
          const range = { from: match.index, to: match.index + match[0].length };
          if (!markers.some((m) => m.from < range.to && range.from < m.to)) words.push(range);
        }
        const ranges: Range[] = [];
        for (let i = 0; i < words.length; i++) {
          for (const j of [i, i + 1, i + 2, i + 5, i + 9]) {
            const from = words[i];
            const to = words[j];
            if (from && to) ranges.push({ from: from.from, to: to.to });
          }
        }
        // And ranges that start and end anywhere, among the markers, the pipes and the spaces. (Not
        // for deleted rows: a marker in front of a deleted row's line, which a range from inside the
        // hidden line gives, makes a decision impossible for a comment as it does for a highlight.)
        if (op.kind !== 'deleteRows') {
          // (Nor after the closing pipe of the header row: the header would have a cell more than
          // the delimiter row, and the table would stop reading as one, with or without a pending
          // row, as it does for a comment.)
          const header = readTables(text, parse(text))[0]?.rows[0]?.to ?? -1;
          const unsafe = text[header - 1] === '|' ? header : -1;
          for (let from = text.indexOf('Intro'); from < body.length; from += 3) {
            for (let to = from + 1; to <= body.length; to += 5) {
              if (from !== unsafe && to !== unsafe) ranges.push({ from, to });
            }
          }
        }
        const baseline = decisions(text);
        for (const range of ranges) {
          let result: string;
          try {
            const { changes } = addHighlight(text, range, context(bo, ['h4kz']));
            result = applyChanges(text, changes);
          } catch (error) {
            if (!(error instanceof EditError)) throw error;
            checked.refused++;
            continue;
          }
          checked.made++;
          const now = decisions(result);
          for (const [decision, was] of baseline) {
            expect(
              now.get(decision),
              `${op.kind}, ${table === FRUIT ? 'piped' : 'bare'}, ${JSON.stringify(text.slice(range.from, range.to))} ${JSON.stringify(range)}: ${decision}`,
            ).toBe(was);
          }
        }
      }
    }
    // Some are made, and more are refused: those across rows and out of the table, and those
    // that cover no text.
    expect(checked.made).toBeGreaterThan(400);
    expect(checked.refused).toBeGreaterThan(checked.made);
  });
});

describe('on random documents', { timeout: 60_000 }, () => {
  it('changes no view, keeps the file in order, and is dismissed to the text it came from', () => {
    const documents = fuzzCount(150);
    let made = 0;
    // No place for the markers, or markers that code would hide.
    let refused = 0;
    // A range that covers no text that reads in the newest view, which is none by design: random
    // ranges are in the ledger, and in the markers of the file, as often as in its text.
    let textless = 0;
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
            if (error.code === 'empty-range') {
              textless++;
              continue;
            }
            refused++;
            // A body that ends in a closing `_` has no place for a closer at its end (format §4).
            if (whole && !endsInClosingUnderscore(text, to)) wholeRefused++;
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
        // It covers text that reads in the newest view, and every marker of it is in the body.
        const shown = newestView(result);
        const segment = parsed.marks.find((m) => m.id === added.id)?.segments[0];
        expect(
          shown.text.slice(
            shown.map.fromSource(segment?.open.to ?? 0),
            shown.map.fromSource(segment?.close?.from ?? 0),
          ),
          label,
        ).toMatch(/[^\r\n]/);
        expectMarkersBeforeLedger(label, result, added.id);
        for (const decide of [accept, reject]) {
          expect(applyChanges(result, decide(result, added.id)), label).toBe(text);
        }
      }
    }
    expect(made + refused + textless).toBe(documents * 3);
    expect(made).toBeGreaterThan(refused);
    // A highlight on whole blocks goes through, but where a construct has no place for its marker.
    expect(wholeRefused).toBeLessThanOrEqual(Math.ceil((wholeBlocks + wholeRefused) / 20));
  });
});
