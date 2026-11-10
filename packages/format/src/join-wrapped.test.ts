// A wrapped paragraph, list item or quote rewritten by an agent is one suggestion (format §3.11,
// design §8.3): the marks of its new line breaks share the substitution's group, which the review
// bar decides as one, and a line's prefix that comes back as it was is no reason to refuse it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { suggestReplaceAsOne } from './agent.ts';
import { applyChanges } from './changes.ts';
import { acceptMarks, rejectMarks } from './decide.ts';
import { eolOf, inEol } from './edit-support.ts';
import { EditError } from './errors.ts';
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

describe('a wrapped paragraph rewritten whole', { timeout: 60_000 }, () => {
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

/** A file with `body` as its text. */
const doc = (body: string) => `${body}\n`;

describe('a wrapped list item or quote rewritten whole', { timeout: 60_000 }, () => {
  it('is one suggestion when the lines keep their prefixes: the "Quitting never loses work" bullet', () => {
    const old =
      'However the app is asked to quit (the menu, the Dock, logging out)\n  or to restart for an update, each window with unsaved edits comes forward in turn and asks whether\n  to save them. Cancel stops there and keeps every window open. Closing the last window quits.';
    expect(design).toContain(old);
    const added =
      'Whatever asks the app to quit or restart, whether the menu, the\n  Dock, a logout or an update, makes every window with unsaved edits step forward one at a time and\n  offer to save. Choosing Cancel halts the quit and leaves all windows open. The last window closing\n  quits the app.';
    const { marks } = rewriteAsOne(design, old, added);
    expect(marks.map((mark) => mark.kind)).toEqual(['sub', 'split', 'split', 'split']);
  });

  it('is one suggestion with its own marker in the old text, however many lines the new text has', () => {
    const text = doc(
      '- Keep this.\n- A sync service or accounts of our own. Files, git and the apps that embed Redlines are the\n  storage.\n- Keep that.',
    );
    const old =
      '- A sync service or accounts of our own. Files, git and the apps that embed Redlines are the\n  storage.';
    const wrapped =
      '- Accounts or a sync service run by us. Storage is left to files, git and the apps that\n  embed Redlines.';
    expect(rewriteAsOne(text, old, wrapped).marks.map((mark) => mark.kind)).toEqual([
      'sub',
      'split',
    ]);
    const one =
      '- Accounts or a sync service run by us. Storage is left to files, git and the apps that embed Redlines.';
    expect(rewriteAsOne(text, old, one).marks.map((mark) => mark.kind)).toEqual(['sub']);
    const more =
      '- Accounts or a sync service run by us.\n  Storage is left to files,\n  git and the apps that\n  embed Redlines.';
    expect(rewriteAsOne(text, old, more).marks.map((mark) => mark.kind)).toEqual([
      'sub',
      'split',
      'split',
      'split',
    ]);
  });

  it('is one suggestion for a numbered item, whose number stays', () => {
    const text = doc(
      '1. First, as it was.\n2. Second item that has quite a few words in it and\n   goes on to a second line.\n3. Third.',
    );
    const old = '2. Second item that has quite a few words in it and\n   goes on to a second line.';
    const added =
      '2. An item that now says something else entirely, in other\n   words altogether.';
    const { out } = rewriteAsOne(text, old, added);
    expect(newestView(out).text).toContain('1. First, as it was.\n2. An item');
  });

  it('is one suggestion for a quote of two lines, with its `> ` on each', () => {
    const text = doc(
      'Before.\n\n> Second item that has quite a few words in it and\n> goes on to a second line.\n\nAfter.',
    );
    const old = 'Second item that has quite a few words in it and\n> goes on to a second line.';
    const added = 'An item that now says something else entirely, in other\n> words altogether.';
    const { marks } = rewriteAsOne(text, old, added);
    expect(marks.map((mark) => mark.kind)).toEqual(['sub', 'split']);
  });

  it('is one suggestion for a quote in a list item, and for a nested quote', () => {
    const nested = doc(
      '> > Second item that has quite a few words in it and\n> > goes on to a second line.',
    );
    const old = 'Second item that has quite a few words in it and\n> > goes on to a second line.';
    const added = 'An item that now says something else entirely, in other\n> > words altogether.';
    expect(rewriteAsOne(nested, old, added).marks.map((mark) => mark.kind)).toEqual([
      'sub',
      'split',
    ]);
  });
});

describe('a wrapped list item or quote whose prefix would change', { timeout: 60_000 }, () => {
  /** The kinds of the marks written, or none where the edit is refused. */
  const kindsOf = (text: string, old: string, added: string) => {
    try {
      const edits = suggestReplaceAsOne(text, old, added, contextOf(1));
      return parse(applyChanges(text, edits.changes)).marks.map((mark) => mark.kind);
    } catch (error) {
      if (error instanceof EditError) return [];
      throw error;
    }
  };
  const whole = ['sub', 'split'];

  it('is not replaced whole when the number of the item changes', () => {
    const text = doc(
      '1. Before.\n2. Second item that has quite a few words in it and\n   goes on to a second line.',
    );
    const old = '2. Second item that has quite a few words in it and\n   goes on to a second line.';
    const kinds = kindsOf(
      text,
      old,
      '3. An item that now says something else entirely, in other\n   words altogether.',
    );
    expect(kinds).not.toEqual(whole);
  });

  it('is not replaced whole when a continuation line is indented otherwise', () => {
    const text = doc(
      '- Second item that has quite a few words in it and\n  goes on to a second line.',
    );
    const old = 'Second item that has quite a few words in it and\n  goes on to a second line.';
    const kinds = kindsOf(
      text,
      old,
      'An item that now says something else entirely, in other\n   words altogether.',
    );
    expect(kinds).not.toEqual(whole);
  });

  it('is not replaced whole when a quote line loses a depth', () => {
    const text = doc(
      '> > Second item that has quite a few words in it and\n> > goes on to a second line.',
    );
    const old = 'Second item that has quite a few words in it and\n> > goes on to a second line.';
    const kinds = kindsOf(
      text,
      old,
      'An item that now says something else entirely, in other\n> words altogether.',
    );
    expect(kinds).not.toEqual(whole);
  });
});
