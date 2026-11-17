// A probe of the edits that the fine writer refuses, over other people's marks (#808, #251): random
// documents with pending marks of Bo and others, a random edit of the newest text (a word, a break,
// a block key, a deletion), and `trackedEdits` for Ada. It counts, of the edits that the fine form
// refuses, those written as a replacement and those still refused, and of the written ones those
// where deciding every mark in a random order, all accepted or all rejected, does not read as the
// newest or the original view, or leaves a decision stuck. `PROBE_SEEDS=n` runs n documents.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { payloadMarksOf } from './payload-marks.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import { ada, context, randomEdit } from './test-helpers.ts';
import { fineEdits, trackedEdits } from './track.ts';
import { newestView, originalView } from './views.ts';

const INSERTS = ['x', 'new words', ' and more', '\n', '\n\n', '## ', '- ', '> ', '1. ', '', '\t'];
const IDS = ['m2bd', 'n8fx', 'p5qm', 'q6rs'];

/** Decides every mark in a random order, all one way: the file it ends with, or the problem. */
function decideAll(text: string, how: 'a' | 'r', below: (n: number) => number): string | string[] {
  let current = text;
  for (let step = 0; step < 80; step++) {
    const read = parse(current);
    const left = [...read.marks, ...payloadMarksOf(read).map((found) => found.mark)].filter(
      (mark) => mark.kind !== 'cmt' && mark.kind !== 'hl',
    );
    if (left.length === 0) return current;
    let moved = false;
    for (const mark of left.toSorted(() => below(3) - 1)) {
      try {
        current = applyChanges(current, (how === 'a' ? accept : reject)(current, mark.id));
        moved = true;
        break;
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
      }
    }
    if (!moved) return [`stuck: ${left.map((mark) => mark.id).join(' ')}`];
  }
  return ['more than 80 decisions'];
}

describe('edits that the fine writer refuses, over other people’s marks', () => {
  it('are written as replacements that read alike in every order, or still refused', () => {
    const documents = Number(process.env['PROBE_SEEDS'] ?? fuzzCount(150));
    const seen = { edits: 0, fineRefused: 0, written: 0, refused: 0, unsound: 0 };
    const unsound: string[] = [];
    for (let seed = 1; seed <= documents; seed++) {
      const random = seeded(seed * 7919 + 808);
      const below = (n: number) => Math.floor(random() * n);
      const doc = randomDocument(random);
      const read = parse(doc);
      if (read.warnings.length > 0 || doc.startsWith('---')) continue;
      const view = newestView(doc);
      if (view.text.length === 0) continue;
      for (let round = 0; round < 6; round++) {
        const wanted = randomEdit(below, view.text, INSERTS);
        const edit = {
          from: view.map.toSource(wanted.from, 1),
          to: Math.max(view.map.toSource(wanted.from, 1), view.map.toSource(wanted.to, -1)),
          insert: wanted.insert,
        };
        seen.edits++;
        try {
          fineEdits(doc, [edit], context(ada, IDS));
          continue;
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
        }
        seen.fineRefused++;
        let written: string;
        try {
          written = applyChanges(doc, trackedEdits(doc, [edit], context(ada, IDS)).changes);
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
          seen.refused++;
          continue;
        }
        seen.written++;
        const problems: string[] = [];
        const accepted = decideAll(written, 'a', below);
        if (typeof accepted !== 'string') problems.push(...accepted);
        else if (newestView(accepted).text !== newestView(written).text)
          problems.push('accept all reads otherwise than the newest view');
        const rejected = decideAll(written, 'r', below);
        if (typeof rejected !== 'string') problems.push(...rejected);
        else if (newestView(rejected).text !== originalView(written).text)
          problems.push('reject all reads otherwise than the original view');
        if (problems.length > 0) {
          seen.unsound++;
          unsound.push(`seed ${seed} round ${round}: ${problems.join('; ')}`);
        }
      }
    }
    if (process.env['PROBE_SEEDS']) console.log(`edit probe: ${JSON.stringify(seen)}`);
    expect(unsound).toEqual([]);
  }, 600_000);
});
