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
      const text = randomDocument(random);
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
          refused++;
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
    // What no unit holds is asked about and made untracked (§3.13), never refused for a mark.
    expect(refused, 'edits not written').toBeLessThan(widened / 10 + 1);
  }, 600_000);

  it('changes the type of a block: written and every order alike', () => {
    let formatted = 0;
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
      const text = randomDocument(random);
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
            continue;
          }
          formatted++;
          expectWidened(`seed ${seed} ${JSON.stringify(op)} at ${at}`, text, done.changes, 'ada');
        }
    }
    // What stays refused is not another person's mark: a block inside an alert, a heading over
    // several lines, a quote of several paragraphs, where no replacement is written yet.
    expect(formatted, 'block changes written as replacements').toBeGreaterThan(5);
  }, 600_000);
});
