// What judges a block change of your own new text (format §2.6, #173), for the tests that try it: the
// words of a file as micromark 4.0.2 reads them, in every state of every order of deciding its marks,
// next to the same state of the file without the change, or in random orders where there are more
// marks than every order can be tried for. Not part of the package.

import { micromark } from 'micromark';
import { expect } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import type { FormatOp } from './format-ops.ts';
import { parse } from './parse.ts';
import { seeded } from './random-docs.ts';
import { bodyOf, expectBlocksAs, reading } from './test-helpers.ts';

/** The words of a file as micromark reads them: its text, without the tags, the markers and a task's
 * box, as one run of words. */
export const micromarkText = (text: string): string =>
  micromark(bodyOf(text), { allowDangerousHtml: true })
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, '?')
    .replace(/\s+/g, ' ')
    .replace(/\[[ xX]\] /g, '')
    .trim();

/** The file with one decision made, or undefined where it has no form. */
export function decided(text: string, id: string, how: 'a' | 'r'): string | undefined {
  try {
    return applyChanges(text, how === 'a' ? accept(text, id) : reject(text, id));
  } catch (error) {
    if (error instanceof EditError) return undefined;
    throw error;
  }
}

/** The marks of a file that are decided one at a time: not the threads of comments. */
export const decidable = (text: string) => parse(text).marks.filter((mark) => mark.kind !== 'cmt');

/**
 * Every state of every order of deciding the marks of `after`, each next to the same state of
 * `before` (the same marks): the words that micromark reads are the same, and a decision works in
 * one where it works in the other. Not the reader of the format: the check that the syntax stands
 * where it is read as syntax does not rest on it alone. Returns how many states it looked at, none
 * where there are more marks than `limit`.
 */
export function expectSameWords(label: string, before: string, after: string, limit = 6): number {
  if (decidable(after).length > limit) return 0;
  const seen = new Set<string>();
  const visit = (a: string, b: string, path: string) => {
    if (seen.has(`${a}\u0000${b}`)) return;
    seen.add(`${a}\u0000${b}`);
    expect(micromarkText(a), `${label}:${path} => ${JSON.stringify(bodyOf(a))}`).toBe(
      micromarkText(b),
    );
    for (const { id } of decidable(a)) {
      for (const how of ['a', 'r'] as const) {
        const nextA = decided(a, id, how);
        const nextB = decided(b, id, how);
        expect(nextA === undefined, `${label}:${path} ${how}${id} works in one only`).toBe(
          nextB === undefined,
        );
        if (nextA !== undefined && nextB !== undefined) visit(nextA, nextB, `${path} ${how}${id}`);
      }
    }
  };
  visit(after, before, '');
  return seen.size;
}

/**
 * Random orders of deciding the marks of `after`, for a document with more marks than every order
 * can be tried for: each state next to the same state of `before`, the same words (the format's
 * reading and micromark's), the same blocks but for `changed` of them, as `op` makes them.
 */
export function expectSampledDecisions(
  label: string,
  before: string,
  after: string,
  op: FormatOp,
  seed: number,
  walks: number,
  changed = 1,
): void {
  const random = seeded(seed);
  for (let walk = 0; walk < walks; walk++) {
    let a = after;
    let b = before;
    for (let step = 0; ; step++) {
      const state = `${label}: walk ${walk} step ${step} => ${JSON.stringify(bodyOf(a))}`;
      expect(reading(a), state).toEqual(reading(b));
      expect(micromarkText(a), state).toBe(micromarkText(b));
      expectBlocksAs(state, a, b, op, changed);
      const marks = decidable(a);
      const mark = marks[Math.floor(random() * marks.length)];
      if (!mark) break;
      const how = random() < 0.5 ? 'a' : 'r';
      const nextA = decided(a, mark.id, how);
      const nextB = decided(b, mark.id, how);
      expect(nextA === undefined, `${state} ${how}${mark.id} works in one only`).toBe(
        nextB === undefined,
      );
      if (nextA === undefined || nextB === undefined) continue;
      a = nextA;
      b = nextB;
    }
  }
}
