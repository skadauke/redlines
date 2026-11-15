// What the existing writers and decisions write must not change (lane R1: widening adds the engine
// and calls it nowhere). This runs them over a fixed corpus of random documents and random edits,
// and holds a digest of everything they write: the text of each tracked edit or the words of its
// refusal, each decision, the three views, and the warnings of the parse. The digest was worked out
// on `main` before the engine of format §3.12 was added; a change to it means an existing edit now
// writes something else, which needs a reason of its own, written in the commit that changes it.
//
// To work the digest out again (after a change that is meant to alter what is written), run with
// `REDLINES_DIGEST=print`.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, reject, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { listDocument, randomDocument, seeded } from './random-docs.ts';
import { parse } from './parse.ts';
import { ada, bo, context, randomEdit } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView, originalView, reviewView } from './views.ts';

/** The digest that `main` gives, with this corpus. */
const EXPECTED = '760e887016eacf15dcd1e579f0d7996e63847ca424d4708a2504ff160e1787eb';

const INSERTS = ['x', 'new words', ' and more', '\n\n', '## ', '- ', '> ', '1. ', 'a\nb', '', '| a | b |'];

function written(make: () => string): string {
  try {
    return make();
  } catch (error) {
    if (error instanceof EditError) return `refused ${error.code ?? ''}: ${error.message}`;
    throw error;
  }
}

describe('what the existing writers write', () => {
  it('is what main wrote, for a fixed corpus of random documents and edits', () => {
    const hash = createHash('sha256');
    const add = (label: string, text: string) => hash.update(`${label}\u0000${text}\u0001`);
    for (let seed = 1; seed <= 150; seed++) {
      const random = seeded(seed * 13 + 5);
      const below = (n: number) => Math.floor(random() * n);
      const text = seed % 4 === 0 ? listDocument(random) : randomDocument(random);
      const view = newestView(text).text;
      add(`${seed} newest`, view);
      add(`${seed} original`, originalView(text).text);
      add(`${seed} review`, reviewView(text));
      add(
        `${seed} warnings`,
        parse(text)
          .warnings.map((w) => `${w.code} ${w.id ?? ''}`)
          .join(','),
      );
      for (const [index, author] of [ada, bo].entries()) {
        const ids = Array.from({ length: 8 }, () => Uint8Array.from({ length: 4 }, () => below(256)));
        let at = 0;
        const ctx = context(author, [], { random: () => ids[at++ % ids.length] ?? new Uint8Array(4) });
        const edit = randomEdit(below, view, INSERTS);
        add(
          `${seed} edit ${index}`,
          written(() => applyChanges(text, trackedEdits(text, [edit], ctx).changes)),
        );
      }
      const marks = parse(text).marks.filter((mark) => mark.kind !== 'cmt');
      for (const mark of marks.slice(0, 3)) {
        add(`${seed} accept ${mark.id}`, written(() => applyChanges(text, accept(text, mark.id))));
        add(`${seed} reject ${mark.id}`, written(() => applyChanges(text, reject(text, mark.id))));
      }
      add(`${seed} accept all`, written(() => applyChanges(text, acceptAll(text))));
      add(`${seed} reject all`, written(() => applyChanges(text, rejectAll(text))));
    }
    const digest = hash.digest('hex');
    if (process.env['REDLINES_DIGEST'] === 'print') console.log(`DIGEST ${digest}`);
    expect(digest).toBe(EXPECTED);
  }, 120_000);
});
