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
import { ada, bodyOf, context, exactly, expectEveryOrderAlike, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { originalView } from './views.ts';
import { readsAsNewest } from './oracle.ts';

/** The first line's list or quote marker, with the white space after it, or null. */
const PREFIX = /^[ \t]*(?:[-+*]|\d{1,9}[.)]|>)[ \t]+(?=\S)/;

/**
 * A first item with items below it whose text another person's pending change may hide: a deletion
 * of all of it (an empty item in the newest view, one with text in the file), an insertion in it,
 * a deletion that leaves a space, a comment, an empty item, plain lines, in LF or CRLF files, with
 * bullets, numbers, quotes and task boxes (#248 review C1).
 */
function hiddenEmptyDocument(random: () => number): string {
  const below = (n: number) => Math.floor(random() * n);
  const ids = ['k3x9', 'q4rt', 'w5vz', 'x6cb', 'y7dm', 'z8fn'];
  const marks: Record<string, string> = {};
  const mark = () => {
    const id = ids[Object.keys(marks).length] as string;
    marks[id] = 'bo';
    return id;
  };
  const first = ['- ', '* ', '1. ', '> ', '- [ ] '][below(5)] as string;
  const lines = [`${first}one`];
  for (let n = 1 + below(3); n > 0; n--) {
    const m = ['- ', '- ', '1. ', '2. ', '> ', ''][below(6)] as string;
    const body = [
      'two',
      'two',
      () => `<!--del ${mark()} two-->`,
      () => `<!--del ${mark()} two--> `,
      () => `<!--ins ${mark()}-->two<!--/${'$'}-->`,
      () => `two <!--del ${mark()} more-->`,
      '',
      'text',
    ][below(8)] as string | (() => string);
    let text = typeof body === 'function' ? body() : body;
    if (text.includes('$')) {
      const id = mark();
      text = `<!--ins ${id}-->two<!--/${id}-->`;
    }
    // A marker never starts a line of text (format §3.2).
    lines.push(m === '' && text.startsWith('<!--') ? `x ${text}` : `${m}${text}`);
    if (below(5) === 0 && lines.at(-1) === '') lines.pop();
    if (below(5) === 0) lines.push('');
  }
  const eol = below(3) === 0 ? '\r\n' : '\n';
  return file(lines.join(eol), marks);
}

describe('the deletion of the first line’s prefix on random documents', () => {
  const runs = fuzzCount(60);
  const makers = [
    randomDocument,
    listDocument,
    adjacentListsDocument,
    hiddenEmptyDocument,
  ] as const;
  for (const [index, make] of makers.entries()) {
    it(`${make.name}: written soundly or refused (${runs} documents)`, () => {
      let written = 0;
      for (let seed = 1; seed <= runs; seed++) {
        const random = seeded(seed * 3 + index);
        const text = make(random);
        const body = bodyOf(text);
        const prefix = PREFIX.exec(body)?.[0];
        if (prefix === undefined || parse(text).warnings.length > 0) continue;
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
        expect(bodyOf(applyChanges(after, reject(after, mine[0]!.id))).trimEnd(), label).toBe(
          body.trimEnd(),
        );
      }
      expect(written, 'documents written').toBeGreaterThan(0);
    }, 600_000);
  }
});
