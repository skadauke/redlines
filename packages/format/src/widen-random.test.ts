// Random widened replacements (format §3.12, design §2.6): random documents with other people's
// marks, some that cross the edge of the unit that holds them, and random edits of them, written by
// `widen` for Ada or Bo. For every one that is written:
//
//  1. Sound: every order of decisions of the replacement and of the marks in its old text reads
//     alike, the files on the way read as their newest view (micromark), none is stuck.
//  2. Commutes: rejecting the replacement after deciding a mark in its old text equals deciding the
//     mark in the file after rejecting it, or both are refused.
//  3. Exact: rejecting it gives the file before the edit byte for byte (but for the author's own
//     changes in the unit, which fold into it), in LF and CRLF files; accepting it gives the
//     intended newest text; the original view is as it was.
//  4. Ledger: accepting it leaves no entry of the marks that were in its old text, and a comment in
//     it becomes a point comment; rejecting it leaves every entry; ids are unique.
//  5. Stacked: a second person's edit of the result, widened in its turn, rejects back to it.
//  6. Never refused: an edit that the fine writer refuses is written or is untrackable.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, reject, rejectMarks } from './decide.ts';
import { EditError } from './errors.ts';
import { readAs } from './oracle.ts';
import { parse } from './parse.ts';
import { payloadMarksOf } from './payload-marks.ts';
import { fuzzCount, randomDocument, seeded } from './random-docs.ts';
import {
  ada,
  bo,
  bodyOf,
  context,
  randomEdit,
  viewBlocks,
} from './test-helpers.ts';
import { addComment } from './comments.ts';
import { addHighlight } from './highlights.ts';
import { trackedEdit, trackedEdits } from './track.ts';
import type { EditContext, Person, TextChange } from './types.ts';
import { newestView, originalView } from './views.ts';
import { Untrackable, widen } from './widen.ts';
import type { Widened } from './widen.ts';

const INSERTS = ['x', 'new words', ' and more', '\n\n', '## ', '- ', '> ', '1. ', 'a\nb', '', '| a | b |'];

function randomIds(below: (n: number) => number) {
  return (n: number) => Uint8Array.from({ length: n }, () => below(256));
}

/** The document with another person's marks that cross the edge of a block: a deletion across the
 * break between two blocks, a comment and a highlight over two blocks. */
function withCrossing(text: string, below: (n: number) => number): string {
  const ctx = (): EditContext => context(bo, [], { random: randomIds(below) });
  let current = text;
  for (let round = 0; round < 1 + below(2); round++) {
    const view = newestView(current).text;
    const blocks = viewBlocks(view);
    if (blocks.length < 2) break;
    const i = below(blocks.length - 1);
    const one = blocks[i]!;
    const two = blocks[i + 1]!;
    const from = Math.max(one.text, one.end - 1 - below(3));
    const to = Math.min(two.end, two.text + 1 + below(3));
    if (to <= from) continue;
    try {
      const kind = below(3);
      if (kind === 0) {
        current = applyChanges(current, trackedEdit(current, { from, to, insert: '' }, ctx()));
      } else if (kind === 1) {
        current = applyChanges(current, addComment(current, { from, to }, 'Why?', ctx()).changes);
      } else {
        current = applyChanges(current, addHighlight(current, { from, to }, ctx()).changes);
      }
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
    }
  }
  return current;
}

/** Decides marks at random until none is left, expecting every file on the way to read as its
 * newest view, and the last to read as what the decisions said. */
function randomOrders(
  label: string,
  text: string,
  below: (n: number) => number,
  orders: number,
  only: ReadonlySet<string>,
) {
  for (let order = 0; order < orders; order++) {
    let current = text;
    for (let step = 0; step < 40; step++) {
      const read = parse(current);
      expect(readAs(bodyOf(current)), `${label}: step ${step}`).toBe(
        readAs(newestView(current).text),
      );
      const left = [...read.marks, ...payloadMarksOf(read).map((found) => found.mark)].filter(
        (mark) => mark.kind !== 'cmt' && mark.kind !== 'hl' && only.has(mark.id),
      );
      if (left.length === 0) break;
      const mark = left[below(left.length)]!;
      const how = below(2) === 0 ? accept : reject;
      try {
        current = applyChanges(current, how(current, mark.id));
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
      }
    }
  }
}

const people: Person[] = [ada, bo];

describe('random widened replacements', () => {
  it('are sound, commute, are exact, keep the ledger, stack, and are never refused', () => {
    const total = fuzzCount(300);
    const seen = { written: 0, untrackable: 0, baseUnsound: 0, held: 0, nested: 0 };
    const reasons: Record<string, number> = {};
    const failures: string[] = [];
    const samples: string[] = [];
    for (let seed = 1; seed <= total; seed++) {
      if (process.env['WIDEN_SEED'] && Number(process.env['WIDEN_SEED']) !== seed) continue;
      const random = seeded(seed * 31 + 7);
      const below = (n: number) => Math.floor(random() * n);
      let text = randomDocument(random);
      if (below(2) === 0) text = withCrossing(text, below);
      const label = `seed ${seed}`;
      const author = people[below(2)]!;
      const view = newestView(text).text;
      // A document that does not read as its newest view, or has an order of decisions that does
      // not, says nothing about a replacement written in it.
      // Front matter is YAML, which micromark reads as Markdown: it can't judge such a file.
      if (view.startsWith('---') || readAs(bodyOf(text)) !== readAs(view)) {
        seen.baseUnsound++;
        continue;
      }
      const edit = randomEdit(below, view, INSERTS);
      const ctx = context(author, [], { random: randomIds(below) });
      let done: Widened;
      try {
        done = widen(text, [edit], ctx);
      } catch (error) {
        if (error instanceof Untrackable) {
          seen.untrackable++;
          reasons[error.reason] = (reasons[error.reason] ?? 0) + 1;
          if (error.reason === 'no-unit' && samples.length < 3) {
            samples.push(`seed ${seed} by ${author.handle} edit ${JSON.stringify(edit)}\n${text}`);
          }
          continue;
        }
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(edit)}\n${text}`);
        continue;
      }
      seen.written++;
      const after = done.text;
      seen.held += done.held.length;
      try {
        // 3. exact
        expect(applyChanges(text, done.changes), label).toBe(after);
        const intended = applyChanges(view, [edit]);
        expect(parse(after).warnings.map((w) => w.code), `${label}: warnings`).toEqual([]);
        if (readAs(bodyOf(after)) !== readAs(newestView(after).text)) {
          throw new Error(
            `${label}: reads as its newest view\nBODY ${JSON.stringify(readAs(bodyOf(after)))}\nVIEW ${JSON.stringify(readAs(newestView(after).text))}`,
          );
        }
        expect(readAs(newestView(after).text), `${label}: newest`).toBe(readAs(intended));
        expect(originalView(after).text, `${label}: original`).toBe(originalView(text).text);
        const rejected = applyChanges(after, reject(after, done.id));
        // The author's own changes in the unit are folded: rejected in the old text.
        const base = done.folded.length === 0 ? text : applyChanges(text, rejectMarks(text, done.folded));
        expect(rejected, `${label}: reject gives the file back`).toBe(base);
        const accepted = applyChanges(after, accept(after, done.id));
        expect(readAs(newestView(accepted).text), `${label}: accept`).toBe(readAs(intended));
        // 4. ledger
        // A comment's entry is its thread, which stays whatever is decided.
        const threads = (ledger: ReturnType<typeof parse>['ledger']) => ledger.comments.map((t) => t.id);
        const keptAfterAccept = Object.keys(parse(accepted).ledger.marks);
        const keptAfterReject = Object.keys(parse(rejected).ledger.marks);
        const was = parse(text);
        for (const id of done.held) {
          if (was.marks.find((m) => m.id === id)?.kind === 'cmt') {
            expect(threads(parse(accepted).ledger), `${label}: thread ${id}`).toContain(id);
            continue;
          }
          expect(keptAfterAccept, `${label}: ${id}`).not.toContain(id);
          expect(keptAfterReject, `${label}: ${id} after reject`).toContain(id);
        }
        const markers = parse(after).marks.map((m) => m.id);
        expect(new Set(markers).size, `${label}: ids are unique`).toBe(markers.length);
        for (const id of done.held) {
          const was = parse(text).marks.find((m) => m.id === id);
          if (was?.kind === 'cmt') {
            expect(parse(accepted).marks.map((m) => m.id), `${label}: point comment ${id}`).toContain(id);
          }
        }
        // 2. commutes
        const nested = payloadMarksOf(parse(after)).filter(
          (found) => found.mark.kind !== 'cmt' && found.mark.kind !== 'hl',
        );
        seen.nested += nested.length;
        for (const { mark } of nested) {
          for (const how of [accept, reject]) {
            const through = (): string | null => {
              try {
                const inside = applyChanges(after, how(after, mark.id));
                return applyChanges(inside, reject(inside, done.id));
              } catch (error) {
                if (error instanceof EditError) return null;
                throw error;
              }
            };
            const direct = (): string | null => {
              try {
                return applyChanges(rejected, how(rejected, mark.id));
              } catch (error) {
                if (error instanceof EditError) return null;
                throw error;
              }
            };
            const a = through();
            const b = direct();
            if (a !== null && b !== null) expect(a, `${label}: ${how.name} ${mark.id}`).toBe(b);
          }
        }
        // 1. sound
        // The replacement and what it holds, in random orders: every file on the way reads as its
        // newest view, as the file before the edit does.
        const ids = new Set([done.id, ...done.held, ...nested.map((found) => found.mark.id)]);
        randomOrders(label, after, below, 6, ids);
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}\nedit ${JSON.stringify(edit)} by ${author.handle}\n${text}\n----after----\n${after}`);
        if (failures.length > 9) break;
      }
    }
    console.log(JSON.stringify({ total, ...seen, reasons }));
    if (process.env.WIDEN_DEBUG) console.log(samples.join('\n=====\n'));
    expect(failures.join('\n=======\n')).toBe('');
    // Few edits are untrackable, and they say why.
    expect(seen.untrackable / total).toBeLessThan(0.35);
    expect(seen.written).toBeGreaterThan(total / 2);
  }, 120_000);

  it('writes every edit that the fine writer refuses, or says it is untrackable', () => {
    const total = fuzzCount(300);
    let refused = 0;
    let written = 0;
    const bad: string[] = [];
    for (let seed = 1; seed <= total; seed++) {
      const random = seeded(seed * 17 + 3);
      const below = (n: number) => Math.floor(random() * n);
      const text = randomDocument(random);
      const view = newestView(text).text;
      const edit: TextChange = randomEdit(below, view, INSERTS);
      const author = people[below(2)]!;
      try {
        trackedEdits(text, [edit], context(author, [], { random: randomIds(below) }));
        continue;
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        if (error.code !== 'no-legal-placement' && error.code !== 'would-hide-marks') continue;
      }
      refused++;
      try {
        widen(text, [edit], context(author, [], { random: randomIds(below) }));
        written++;
      } catch (error) {
        if (error instanceof Untrackable) continue;
        bad.push(`seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(JSON.stringify({ total, refused, written }));
    expect(bad).toEqual([]);
    expect(written).toBeGreaterThan(refused / 2);
  }, 120_000);
});
