// A tracked move of blocks on random documents (format §3.14): where the format writes it, the
// move is one group, rejecting it gives the original, the newest view is the plain move's, and
// every order of decisions reads alike, judged by micromark; where not even the widened write can
// be made it throws Untrackable and writes nothing.

import { describe, expect, it, vi } from 'vitest';
import { blockRunAt, moveBlockEdits, trackedBlockMove } from './block-move.ts';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { expectEveryOrderRead, readsAsNewest } from './oracle.ts';
import { parse } from './parse.ts';
import { payloadMarksOf } from './payload-marks.ts';
import { fuzzCount, listDocument, randomDocument, seeded } from './random-docs.ts';
import { ada, context } from './test-helpers.ts';
import { Untrackable } from './widen.ts';
import { newestView, originalView } from './views.ts';

vi.setConfig({ testTimeout: 60_000 });

/** The text with ordered-list numbers as written (known gap: they are not renumbered), and with
 * blank lines collapsed: a replacement's closer stands alone on the line after a fence, indented
 * code or other line it can't join (format §3.12), so the newest view keeps a blank line there
 * that the plain move has not. Markdown reads both alike (the every-order check judges that). */
const numberless = (text: string) =>
  text
    .trimEnd()
    .replace(/^(\s*(?:>\s*)*)\d{1,9}([.)])/gm, '$1N$2')
    .replace(/\n(?:[ \t]*\n)+/g, '\n');

/** The marks of a file, and those inside the payloads of its substitutions. */
const marksIn = (text: string) => parse(text).marks.length + payloadMarksOf(parse(text)).length;

describe('the tracked move of blocks on random documents', () => {
  const runs = fuzzCount(40);
  for (const [index, make] of [randomDocument, listDocument].entries()) {
    it(`${make.name}: sound where written (${runs} documents)`, () => {
      let written = 0;
      for (let seed = 1; seed <= runs; seed++) {
        const random = seeded(seed * 7 + index);
        const text = make(random);
        if (parse(text).warnings.length > 0) continue;
        const view = newestView(text);
        const at = Math.floor(random() * (view.text.length + 1));
        const run = blockRunAt(text, {
          from: view.map.toSource(at, 1),
          to: view.map.toSource(at, 1),
        });
        if (!run || run.gaps.length === 0) continue;
        const gap = run.gaps[Math.floor(random() * run.gaps.length)]!;
        const label = `seed ${seed} gap ${gap.index} ${JSON.stringify(text.slice(0, 80))}`;
        let after: string;
        try {
          const result = trackedBlockMove(text, run, gap, {
            ...context(ada),
            random: (n) => Uint8Array.from({ length: n }, () => Math.floor(random() * 19)),
          });
          if (!result || result.changes.length === 0) continue;
          after = applyChanges(text, result.changes);
        } catch (error) {
          if (error instanceof EditError || error instanceof Untrackable) continue;
          throw error;
        }
        written++;
        expect(parse(after).warnings, label).toEqual([]);
        // A blank line above a list (written where a move would leave an empty item, or a number
        // other than 1, first under a line of text, #1103) is no text of either view.
        const blanks = (view: string) => view.replace(/\n{2,}/g, '\n');
        expect(blanks(originalView(after).text), label).toBe(blanks(originalView(text).text));
        // The newest view is what the plain move makes (in a file with no marks: the plain edits
        // don't carry others' marks).
        const plain = moveBlockEdits(text, run, gap);
        if (plain && parse(text).marks.length === 0) {
          expect(numberless(newestView(after).text), label).toBe(
            numberless(newestView(applyChanges(text, plain.edits)).text),
          );
        }
        if (readsAsNewest(text) && marksIn(after) <= 3) {
          expectEveryOrderRead(label, after);
        }
      }
      expect(written, 'documents written').toBeGreaterThan(0);
    }, 600_000);
  }
});
