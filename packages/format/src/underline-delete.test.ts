// Deleting a setext underline with the line break in front of it, Track Changes on (#441). The
// break that holds the underline (`breakLength`) holds the blank lines after it, and a change that
// touches a break takes all of it (format §3.4), so the deletion of an underline took the blank
// lines after it too and joined the text above to the block below: `- one⏎  - ⏎⏎After.`, whose
// empty bullet CommonMark reads as the underline of `one`, gave `- oneAfter.` in the newest view.
// A range that takes the underline whole, with the break in front of it, and ends where the
// underline does, leaves the break after it: the text above is a paragraph without its underline,
// and the blocks stay as far apart as they were.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { ada, blockLeaves, bodyOf, context, expectEveryOrderAlike, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView, originalView } from './views.ts';

/** The body of a file without the line breaks that end it. */
const bodyText = (text: string) => bodyOf(text).replace(/\n+$/, '');

/** The leaf blocks of a text as CommonMark reads them, as a string. */
const leaves = (text: string) => JSON.stringify(blockLeaves(text));

/** Ada deletes `from` to `to` of the body, with Track Changes on: the file before and after. */
function deleteRange(body: string, from: number, to: number) {
  const before = file(body);
  const result = trackedEdits(before, [{ from, to, insert: '' }], context(ada, ['m2bd']));
  return { before, after: applyChanges(before, result.changes) };
}

/** What `deleted` is in `body`: the range of its first occurrence. */
function rangeOf(body: string, deleted: string): [number, number] {
  const from = body.indexOf(deleted);
  expect(from, `${JSON.stringify(deleted)} is in ${JSON.stringify(body)}`).toBeGreaterThanOrEqual(
    0,
  );
  return [from, from + deleted.length];
}

/**
 * Checks what the deletion leaves, in every state: `kept` is the text that stays. The file as
 * other renderers read it and the newest view read as `kept` does, accepting gives `kept`, and
 * rejecting gives every byte of `body` back.
 */
function expectKept(label: string, body: string, deleted: string, kept: string): void {
  const [from, to] = rangeOf(body, deleted);
  const { after } = deleteRange(body, from, to);
  const wanted = leaves(file(kept));
  expect(leaves(after), `${label}: the file as other readers read it`).toBe(wanted);
  expect(bodyText(newestView(after).text), `${label}: the newest view`).toBe(kept);
  expect(leaves(newestView(after).text), `${label}: the newest view's blocks`).toBe(wanted);
  const accepted = applyChanges(after, accept(after, 'm2bd'));
  expect(bodyText(accepted), `${label}: accepting`).toBe(kept);
  const rejected = applyChanges(after, reject(after, 'm2bd'));
  expect(bodyText(rejected), `${label}: rejecting`).toBe(body);
  expect(bodyText(originalView(after).text), `${label}: the original view`).toBe(body);
  expect(parse(after).warnings, label).toEqual([]);
  expectEveryOrderAlike(label, after);
}

describe('a deletion of a setext underline with the break in front of it (#441)', () => {
  it('leaves the blank line after it: the text above is a paragraph, the block below stays apart', () => {
    // [the text, what is deleted, what stays]
    const cases: [string, string, string][] = [
      ['Title\n===\n\nNext.', '\n===', 'Title\n\nNext.'],
      ['Title\n---\n\nNext.', '\n---', 'Title\n\nNext.'],
      ['Intro\n\nTitle\n=====\n\nOne', '\n=====', 'Intro\n\nTitle\n\nOne'],
      // Two blank lines stay two.
      ['Title\n===\n\n\nNext.', '\n===', 'Title\n\n\nNext.'],
      // The block below is an item, a heading, a quote.
      ['Title\n===\n\n- one', '\n===', 'Title\n\n- one'],
      ['Title\n===\n\n# Head', '\n===', 'Title\n\n# Head'],
      ['Title\n===\n\n> quoted', '\n===', 'Title\n\n> quoted'],
      // An underline in an item, in a quote.
      ['- one\n  ---\n\nNext.', '\n  ---', '- one\n\nNext.'],
      ['> one\n> ---\n>\n> Next.', '\n> ---', '> one\n>\n> Next.'],
    ];
    for (const [body, deleted, kept] of cases)
      expectKept(JSON.stringify(body), body, deleted, kept);
  });

  it('is the same for the empty bullet that Markdown reads as the underline of the text above', () => {
    // `  - ` right under the text of an item is its setext underline, and the editor draws an empty
    // item: Backspace in it deletes the break and the line.
    const cases: [string, string, string][] = [
      ['- one\n  - \n\nNext.', '\n  - ', '- one\n\nNext.'],
      ['- one\n  - \n\n- two', '\n  - ', '- one\n\n- two'],
      ['- one\n  - \n\n# Head', '\n  - ', '- one\n\n# Head'],
      ['- one\n  - \n\n> quoted', '\n  - ', '- one\n\n> quoted'],
      ['- one\n  - \n\n\nNext.', '\n  - ', '- one\n\n\nNext.'],
      ['Intro\n\n1. one\n   - \n\nNext.', '\n   - ', 'Intro\n\n1. one\n\nNext.'],
      ['> - one\n>   - \n>\n> Next.', '\n>   - ', '> - one\n>\n> Next.'],
    ];
    for (const [body, deleted, kept] of cases)
      expectKept(JSON.stringify(body), body, deleted, kept);
  });

  it('writes the blank line outside the deletion', () => {
    const [from, to] = rangeOf('- one\n  - \n\nNext.', '\n  - ');
    const { after } = deleteRange('- one\n  - \n\nNext.', from, to);
    // The deleted text is in the marker, its line break written as a backslash and an n; the blank
    // line is outside.
    expect(bodyText(after)).toBe('- one<!--del m2bd \\n  - -->\n\nNext.');
  });

  it('is the same as before where nothing follows the underline, or a line directly does', () => {
    // No blank line: the break after the underline is the one line break, as it was.
    expectKept('tight', '- one\n  - \n- two', '\n  - ', '- one\n- two');
    expectKept('end of the body', 'Title\n===', '\n===', 'Title');
  });

  it('still takes the break after the underline, where the range goes past it', () => {
    // The range ends inside the break after the underline, or takes the block below: a change that
    // touches a break takes all of it (format §3.4), as it did.
    for (const [body, deleted] of [
      ['Title\n===\n\nNext.', '\n===\n'],
      ['Title\n===\n\nNext.', '\n===\n\n'],
      ['- one\n  - \n\nNext.', '\n  - \n'],
    ] as const) {
      const [from, to] = rangeOf(body, deleted);
      const { after } = deleteRange(body, from, to);
      expect(bodyText(newestView(after).text), JSON.stringify([body, deleted])).toBe(
        body.slice(0, from) + body.slice(body.indexOf('Next.')),
      );
      expectEveryOrderAlike(JSON.stringify([body, deleted]), after);
    }
  });

  it('still refuses a range that starts inside the underline and does not take all of it', () => {
    const body = 'Title\n=====\n\nNext.';
    const from = body.indexOf('===') + 1;
    const before = file(body);
    expect(() =>
      trackedEdits(before, [{ from, to: from + 2, insert: '' }], context(ada, ['m2bd'])),
    ).toThrow(EditError);
  });
});
