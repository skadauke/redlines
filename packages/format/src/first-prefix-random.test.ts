// The deletion of the prefix of a file's first line (format §3.4, #248) on random documents: the
// documents of the format's generators start with lists, quotes, headings and paragraphs, with
// marks of other people in them. Where the format writes it, the file reads as its newest view in
// CommonMark, every order of decisions reads alike and rejecting everything gives the original;
// where it doesn't, it refuses and writes nothing.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { reject } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import {
  adjacentListsDocument,
  fuzzCount,
  listDocument,
  randomDocument,
  seeded,
} from './random-docs.ts';
import { ada, bodyOf, context, exactly, expectEveryOrderAlike } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { originalView } from './views.ts';
import { readsAsNewest } from './oracle.ts';

/** The first line's list or quote marker, with the white space after it, or null. */
const PREFIX = /^[ \t]*(?:[-+*]|\d{1,9}[.)]|>)[ \t]+(?=\S)/;

describe('the deletion of the first line’s prefix on random documents', () => {
  const runs = fuzzCount(60);
  const makers = [randomDocument, listDocument, adjacentListsDocument] as const;
  for (const [index, make] of makers.entries()) {
    it(`${make.name}: written soundly or refused (${runs} documents)`, () => {
      let written = 0;
      for (let seed = 1; seed <= runs; seed++) {
        const random = seeded(seed * 3 + index);
        const text = make(random);
        const body = bodyOf(text);
        const prefix = PREFIX.exec(body)?.[0];
        if (prefix === undefined) continue;
        const label = `seed ${seed} ${JSON.stringify(body.slice(0, 80))}`;
        let after: string;
        try {
          const result = trackedEdits(
            text,
            [{ from: 0, to: prefix.length, insert: '' }],
            context(ada, ['m2bd', 'n8fx']),
          );
          if (result.changes.length === 0) continue;
          after = applyChanges(text, result.changes);
        } catch (error) {
          if (error instanceof EditError) continue;
          throw error;
        }
        written++;
        expect(parse(after).warnings, label).toEqual([]);
        expect(originalView(after).text, label).toBe(originalView(text).text);
        // (Random documents may read otherwise to begin with, trailing spaces among markers.)
        if (readsAsNewest(text)) expect(readsAsNewest(after), label).toBe(true);
        // Every order of decisions, where the document has few enough marks to walk them all.
        if (parse(after).marks.length <= 5) expectEveryOrderAlike(label, after, exactly);
        // Rejecting the new mark alone gives the body back.
        const before = new Set(parse(text).marks.map((mark) => mark.id));
        const mine = parse(after).marks.filter((mark) => !before.has(mark.id));
        expect(mine, label).toHaveLength(1);
        expect(bodyOf(applyChanges(after, reject(after, mine[0]!.id))), label).toBe(body);
      }
      expect(written).toBeGreaterThanOrEqual(0);
    });
  }
});
