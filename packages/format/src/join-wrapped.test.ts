// A wrapped paragraph, list item or quote rewritten by an agent is one suggestion (format §3.11,
// design §8.3): the marks of its new line breaks share the substitution's group, which the review
// bar decides as one, and a line's prefix that comes back as it was is no reason to refuse it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { suggestReplaceAsOne } from './agent.ts';
import { applyChanges } from './changes.ts';
import { acceptMarks, rejectMarks } from './decide.ts';
import { eolOf, inEol } from './edit-support.ts';
import { parse } from './parse.ts';
import { seeded } from './random-docs.ts';
import { suggestions } from './suggestion.ts';
import { TIME, claudeAda, expectEveryOrderAlike, expectInOrder } from './test-helpers.ts';
import type { EditContext } from './types.ts';
import { newestView, originalView } from './views.ts';

const design = readFileSync(new URL('../../../docs/design.md', import.meta.url), 'utf8');

const contextOf = (seed: number): EditContext => {
  const random = seeded(seed);
  return {
    author: claudeAda,
    time: TIME,
    note: 'Rewrite',
    random: (n) => Uint8Array.from({ length: n }, () => Math.floor(random() * 256)),
  };
};

/**
 * Rewrites `oldStr` as `newStr` in `text` as an agent does, and checks what the review bar and the
 * decisions see: the file reads as asked, the new marks are one suggestion in the bar's terms (one
 * group, one author and note), accepting it decides every mark of it and gives the text as asked,
 * rejecting it decides every mark and gives the text back, and every order of deciding the marks
 * reads alike.
 */
function rewriteAsOne(text: string, oldStr: string, newStr: string, seed = 1) {
  const edits = suggestReplaceAsOne(text, oldStr, newStr, contextOf(seed));
  const out = applyChanges(text, edits.changes);
  const asked = newestView(text).text.replace(inEol(oldStr, eolOf(text)), () => newStr);
  expect(newestView(out).text.replace(/\n+$/, '')).toBe(asked.replace(/\n+$/, ''));
  expectInOrder('after the edit', [], out);
  const marks = parse(out).marks.filter((mark) => edits.markIds.includes(mark.id));
  const found = suggestions(parse(out).marks).filter((suggestion) =>
    suggestion.some((mark) => edits.markIds.includes(mark.id)),
  );
  expect(found).toHaveLength(1);
  expect(found[0]?.map((mark) => mark.id).toSorted()).toEqual(edits.markIds.toSorted());
  const ids = found[0]?.map((mark) => mark.id) ?? [];
  const accepted = applyChanges(out, acceptMarks(out, ids));
  expect(parse(accepted).marks).toEqual([]);
  expect(newestView(accepted).text).toBe(newestView(out).text);
  const rejected = applyChanges(out, rejectMarks(out, ids));
  expect(parse(rejected).marks).toEqual([]);
  expect(newestView(rejected).text).toBe(newestView(text).text);
  expect(originalView(out).text).toBe(originalView(text).text);
  expectEveryOrderAlike('every order', out);
  return { out, marks, edits };
}

describe('a wrapped paragraph rewritten whole', () => {
  it('is one suggestion for the review bar: a substitution and a split per new line break', () => {
    // §3 of docs/design.md: wrapped at 100 columns, rewritten and wrapped again by an agent.
    const old =
      'These share three needs: every change carries an author and a time; changes survive round trips\nthrough other tools; and the final document comes out both as clean Markdown and as a Word file\nwith its changes intact.';
    expect(design).toContain(old);
    const added =
      'All of this rests on three needs. Each change names who made it and when. Changes must survive a\ntrip through other tools. And the finished document must export as clean Markdown and as Word,\nwith the changes kept.';
    const { marks } = rewriteAsOne(design, old, added);
    expect(marks.map((mark) => mark.kind)).toEqual(['sub', 'split', 'split']);
    expect(marks[0]?.entry.group).toBeDefined();
    expect(new Set(marks.map((mark) => mark.entry.group)).size).toBe(1);
  });
});
