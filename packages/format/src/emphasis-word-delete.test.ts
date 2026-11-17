// Deleting the first or last word inside an emphasis with Track Changes on (#814): the deletion
// leaves a space on the inner side of the delimiter in the newest view, where it doesn't flank.
// The file must read as its newest view does (§3.1, rule 5), so the deletion takes the space.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectSound, readsAsNewest } from './oracle.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { ada, context, file } from './test-helpers.ts';
import { trackedEdit } from './track.ts';

describe('deleting the first or last word inside an emphasis, Track Changes on', () => {
  it.each([
    ['**a b ⟦c⟧**', 'last word of bold'],
    ['**⟦a⟧ b c**', 'first word of bold'],
    ['*a b ⟦c⟧*', 'last word of italic'],
    ['x ~~a b ⟦c⟧~~ y', 'last word of strike'],
    ['**a b ⟦c d⟧**', 'last two words of bold'],
  ])('%s (%s) reads as its newest view', (marked) => {
    const body = marked.replace('⟦', '').replace('⟧', '');
    const from = marked.indexOf('⟦');
    const to = marked.indexOf('⟧') - 1;
    const before = file(body);
    const after = applyChanges(
      before,
      trackedEdit(before, { from, to, insert: '' }, context(ada, ['m2bd', 'n8fx'])),
    );
    expect(readsAsNewest(after)).toBe(true);
    expectSound(body, after);
  });
});

describe('deleting words inside emphasis, at random', () => {
  it('reads as the newest view and in every order of decisions', () => {
    const delimiters = ['**', '*', '~~', '***', '_'];
    for (let seed = 1; seed <= fuzzCount(150); seed++) {
      const next = seeded(seed);
      const pick = (n: number) => Math.floor(next() * n);
      const words = (n: number) => Array.from({ length: n }, () => 'abcdefg'.slice(0, 1 + pick(5)));
      const delimiter = delimiters[pick(delimiters.length)] ?? '**';
      const inside = words(2 + pick(4)).join(' ');
      const head = pick(2) === 0 ? '' : `${words(1 + pick(2)).join(' ')} `;
      const tail = pick(2) === 0 ? '' : ` ${words(1 + pick(2)).join(' ')}`;
      const body = `${head}${delimiter}${inside}${delimiter}${tail}`;
      const start = head.length + delimiter.length;
      // A run of words of the emphasis, from a word's start to a word's end.
      const spans = [...inside.matchAll(/\S+/g)].map((m) => [
        start + m.index,
        start + m.index + m[0].length,
      ]);
      const a = pick(spans.length);
      const b = a + pick(spans.length - a);
      // Nothing left inside the delimiters is no emphasis to keep.
      if (a === 0 && b === spans.length - 1) continue;
      const from = spans[a]?.[0] ?? 0;
      const to = spans[b]?.[1] ?? 0;
      const before = file(body);
      const after = applyChanges(
        before,
        trackedEdit(before, { from, to, insert: '' }, context(ada, ['m2bd', 'n8fx'])),
      );
      const where = `seed ${seed}: ${body} [${from},${to}]`;
      expect(readsAsNewest(after), where).toBe(true);
      expectSound(body, after);
    }
  });
});
