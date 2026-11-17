// What the fine rules refuse in a block (a paragraph, a heading, a quote), written as a replacement
// of the block (lane R4, format §3.12): over random documents with other people's pending changes,
// every edit and block change that the fine form refuses is written, reads alike in every order of
// decisions, and rejects back to the text before it (your own pending changes folded in).

import { describe, expect, it } from 'vitest';
import { EditError } from './errors.ts';
import { fineFormat, trackedFormat } from './formatting.ts';
import type { FormatOp } from './formatting.ts';
import { expectWidened } from './oracle.ts';
import { parse } from './parse.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import { scopeOf } from './widen-scope.ts';
import { ada, context } from './test-helpers.ts';
import { fineEdits, trackedEdits } from './track.ts';
import type { TextChange } from './types.ts';
import { newestView } from './views.ts';

const IDS = ['m2bd', 'n8fx', 'p5qm', 'q6rs'];

/** The document of the seed: two draws in three have no other person's pending change (theirs are
 * made the author's own), so that block widening itself is held to every order; the third keeps them, where the
 * guard of #808 keeps the refusal. */
function drawn(seed: number, random: () => number): string {
  const text = randomDocument(random);
  if (seed % 3 === 0) return text;
  // Every pending change is the author's own.
  return text.replace(/\bby: (?!ada\b)\w+/g, 'by: ada');
}

function attempt<T>(run: () => T): T | undefined {
  try {
    return run();
  } catch (error) {
    if (error instanceof EditError) return undefined;
    throw error;
  }
}

describe('a refused edit in a block, written as a replacement of the block', () => {
  const runs = fuzzCount(80);

  it('types, breaks and deletes: written, reads alike in every order, rejects back', () => {
    let widened = 0;
    let refused = 0;
    for (let seed = 1; seed <= runs; seed++) {
      const random = seeded(seed * 11 + 5);
      const text = drawn(seed, random);
      const read = parse(text);
      // Every order of decisions is walked: a document with many marks is left to the walks.
      if (read.warnings.length > 0 || read.marks.length > 5 || text.startsWith('---')) continue;
      // The writer keeps a highlight in the old text whoever's it is; the oracle rejects your own.
      if (read.marks.some((m) => m.kind === 'hl' && read.ledger.marks[m.id]?.by === 'ada'))
        continue;
      const view = newestView(text);
      if (view.text.length === 0) continue;
      const below = (n: number) => Math.floor(random() * n);
      for (let step = 0; step < 6; step++) {
        const at = below(view.text.length);
        const kind = below(4);
        const edit: TextChange =
          kind === 0
            ? { from: at, to: at, insert: 'x' }
            : kind === 1
              ? { from: at, to: at, insert: '\n' }
              : kind === 2
                ? { from: at, to: Math.min(view.text.length, at + 1 + below(6)), insert: '' }
                : { from: at, to: Math.min(view.text.length, at + 1 + below(3)), insert: 'y\n' };
        const source = {
          ...edit,
          from: view.map.toSource(edit.from, 1),
          to: view.map.toSource(edit.to, -1),
        };
        if (source.to < source.from) continue;
        if (scopeOf(text, source.from, source.to) !== 'block') continue;
        if (attempt(() => fineEdits(text, [source], context(ada, IDS)))) continue;
        const done = attempt(() => trackedEdits(text, [source], context(ada, IDS)));
        if (!done) {
          if (seed % 3 === 0) refused++;
          continue;
        }
        widened++;
        expectWidened(
          `seed ${seed} step ${step}: ${JSON.stringify(source)}`,
          text,
          done.changes,
          'ada',
        );
      }
    }
    expect(widened, 'edits written as replacements').toBeGreaterThan(0);
    expect(refused, 'edits kept refused by the guard').toBeGreaterThan(0);
  }, 600_000);

  it('changes the type of a block: written and every order alike', () => {
    let refused = 0;
    const ops: FormatOp[] = [
      { kind: 'block', to: 'h1' },
      { kind: 'block', to: 'h3' },
      { kind: 'block', to: 'quote' },
      { kind: 'block', to: 'p' },
      { kind: 'block', to: 'ul' },
      { kind: 'block', to: 'ol' },
    ];
    for (let seed = 1; seed <= runs; seed++) {
      const random = seeded(seed * 13 + 1);
      const text = drawn(seed, random);
      const read = parse(text);
      // Every order of decisions is walked: a document with many marks is left to the walks.
      if (read.warnings.length > 0 || read.marks.length > 5 || text.startsWith('---')) continue;
      // The writer keeps a highlight in the old text whoever's it is; the oracle rejects your own.
      if (read.marks.some((m) => m.kind === 'hl' && read.ledger.marks[m.id]?.by === 'ada'))
        continue;
      const view = newestView(text);
      if (view.text.length === 0) continue;
      // At the first word of each of the first lines.
      const starts = [...view.text.matchAll(/^[ \t>#]*(?=\S)/gm)]
        .slice(0, 8)
        .map((found) => found.index + found[0].length);
      for (const at of starts)
        for (const op of ops) {
          const range = { from: view.map.toSource(at, 1), to: view.map.toSource(at, 1) };
          if (scopeOf(text, range.from, range.to) !== 'block') continue;
          if (attempt(() => fineFormat(text, range, op, context(ada, IDS)))) continue;
          const done = attempt(() => trackedFormat(text, range, op, context(ada, IDS)));
          if (!done) {
            if (seed % 3 === 0) refused++;
            continue;
          }
          expectWidened(`seed ${seed} ${JSON.stringify(op)} at ${at}`, text, done.changes, 'ada');
        }
    }
    // The fine form writes every block change in a document with only the author's own changes
    // (what is refused there is a mark overlap, which a replacement can't set right), so what is
    // written as a replacement needs another person's change in the old text, which the guard of
    // #808 keeps refused: the refusals are what is held here, until that is open.
    expect(refused, 'block changes kept refused by the guard').toBeGreaterThan(0);
  }, 600_000);
});
