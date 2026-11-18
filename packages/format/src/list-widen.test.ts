// What the fine rules refuse in a list, written as a replacement of the list item or the list
// (lane R3, format §3.12): over random lists with other people's pending changes, every edit and
// block change that the fine form refuses is written, reads alike in every order of decisions, and
// rejects back to the text before it (your own pending changes folded in).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { fineFormat, trackedFormat } from './formatting.ts';
import type { FormatOp } from './formatting.ts';
import { expectWidened } from './oracle.ts';
import { parse } from './parse.ts';
import { fuzzCount, listDocument, seeded } from './random-docs.ts';
import { fineEdits, trackedEdits } from './track.ts';
import { ada, context } from './test-helpers.ts';
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

describe('a refused edit in a list, written as a replacement of its item or list', () => {
  const runs = fuzzCount(120);
  // Seeds that failed in a deeper run, kept in the default one: 121 types in the indentation of a
  // fenced code line that stands less deep than its item, which ends the item and its code, and
  // leaves the closer of the replacement inside a fence that nothing closes; 166 breaks a line in
  // indented code of a deep item, so that the blocks after it read otherwise beside the closer (#586).
  const KEPT = [121, 166];

  it('types, breaks and deletes: written, reads alike in every order, rejects back', () => {
    let widened = 0;
    const seeds = new Set([...Array.from({ length: runs }, (_, i) => i + 1), ...KEPT]);
    for (const seed of seeds) {
      const random = seeded(seed * 7 + 1);
      const text = listDocument(random);
      if (parse(text).warnings.length > 0) continue;
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
        if (attempt(() => fineEdits(text, [source], context(ada, IDS)))) continue;
        const done = attempt(() => trackedEdits(text, [source], context(ada, IDS)));
        if (!done) continue;
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
  }, 600_000);

  it('indents, outdents and changes the type of items: written and every order alike', () => {
    let widened = 0;
    const ops: FormatOp[] = [
      { kind: 'indent', by: 1 },
      { kind: 'indent', by: -1 },
      { kind: 'block', to: 'ol' },
      { kind: 'block', to: 'ul' },
      { kind: 'block', to: 'task' },
    ];
    for (let seed = 1; seed <= runs; seed++) {
      const random = seeded(seed * 5 + 3);
      const text = listDocument(random);
      if (parse(text).warnings.length > 0) continue;
      const view = newestView(text);
      if (view.text.length === 0) continue;
      // At the first words of each of the first lines that are items.
      const starts = [...view.text.matchAll(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?=\S)/gm)]
        .slice(0, 6)
        .map((found) => found.index + found[0].length);
      for (const at of starts)
        for (const op of ops) {
          const range = { from: view.map.toSource(at, 1), to: view.map.toSource(at, 1) };
          if (attempt(() => fineFormat(text, range, op, context(ada, IDS)))) continue;
          const done = attempt(() => trackedFormat(text, range, op, context(ada, IDS)));
          if (!done) continue;
          widened++;
          expectWidened(`seed ${seed} ${JSON.stringify(op)} at ${at}`, text, done.changes, 'ada');
          expect(applyChanges(text, done.changes)).not.toBe(text);
        }
    }
    expect(widened, 'changes written as replacements').toBeGreaterThan(0);
  }, 600_000);
});
