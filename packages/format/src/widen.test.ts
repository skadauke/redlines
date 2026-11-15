// The widened replacement (format §3.12): an edit that no fine form writes soundly is the
// substitution of the smallest unit that holds it, with other people's pending changes in its old
// text. Each case reads alike in every order of decisions (micromark 4.0.2 with GFM), rejecting the
// replacement gives the file before the edit byte for byte, and accepting it the intended text.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { readsAsNewest, expectSound } from './oracle.ts';
import { parse } from './parse.ts';
import { ada, bo, bodyOf, context, file } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';
import { Untrackable, WIDEN_MOST_BLOCKS, widen } from './widen.ts';
import type { TextChange } from './types.ts';

/** The edit that replaces `find`, as the newest view reads, with `insert`. */
function replacing(text: string, find: string, insert: string): TextChange[] {
  const view = newestView(text).text;
  const from = view.indexOf(find);
  if (from < 0) throw new Error(`"${find}" is not in the newest text`);
  return [{ from, to: from + find.length, insert }];
}

/** Widens the edit, and holds the result to what the format says of every replacement. */
function check(label: string, text: string, find: string, insert: string, kind: string) {
  const edits = replacing(text, find, insert);
  const wanted = applyChanges(newestView(text).text, edits);
  const done = widen(text, edits, context(ada, ['r2zd']));
  expect(done.unit.kind, label).toBe(kind);
  const after = done.text;
  expect(applyChanges(text, done.changes), label).toBe(after);
  expect(parse(after).warnings, label).toEqual([]);
  expect(newestView(after).text.replace(/\n+$/, ''), label).toBe(wanted.replace(/\n+$/, ''));
  expect(originalView(after).text, label).toBe(originalView(text).text);
  expect(readsAsNewest(after), `${label}: reads as the newest text`).toBe(true);
  expectSound(label, after);
  // Rejecting it gives the file before the edit, byte for byte.
  const rejected = applyChanges(after, reject(after, done.id));
  // A ledger that holds no mark, comment or setting is not kept, so a file with none comes back
  // without it.
  if (parse(text).marks.length > 0) expect(rejected, label).toBe(text);
  else expect(rejected, label).toBe(`${bodyOf(text).replace(/\n+$/, '')}\n`);
  // Accepting it gives the new text, whatever was decided inside.
  const accepted = applyChanges(after, accept(after, done.id));
  expect(parse(accepted).marks, label).toEqual([]);
  expect(bodyOf(accepted).replace(/\n+$/, ''), label).toBe(wanted.replace(/\n+$/, ''));
  return done;
}

describe('widening an edit to the unit that holds it', () => {
  it('a paragraph that another person changed, made a heading', () => {
    const body =
      'Intro.\n\n<!--ins k3x9-->\n\nFast <!--/k3x9-->importer ships <!--del w2rf very -->April.\n\nOutro.';
    const text = file(body, { k3x9: 'bo', w2rf: 'bo' });
    const done = check('heading', text, 'Fast importer ships April.', '## Fast importer ships April.', 'block');
    expect(done.held).toEqual(['k3x9', 'w2rf']);
  });

  it('a paragraph with no other marks', () => {
    const text = file('Intro.\n\nThe importer ships in April.\n\nOutro.');
    check('plain', text, 'ships in April', 'ships in May, after the review', 'block');
  });
});

describe('what no unit can hold', () => {
  it('is untrackable in front matter', () => {
    const text = file('---\ntitle: One\n---\n\nBody.');
    expect(() => widen(text, replacing(text, 'One', 'Two'), context(ada, ['r2zd']))).toThrow(
      Untrackable,
    );
  });

  it('is untrackable past the cap', () => {
    const paragraphs = Array.from({ length: WIDEN_MOST_BLOCKS + 1 }, (_, i) => `Paragraph ${i}.`);
    const text = file(paragraphs.join('\n\n'));
    const view = newestView(text).text;
    const edits = [{ from: 0, to: view.indexOf('\n\nParagraph 8.') + 14, insert: 'Everything.' }];
    expect(() => widen(text, edits, context(bo, ['r2zd']))).toThrow(/replace 9 blocks/);
  });
});
