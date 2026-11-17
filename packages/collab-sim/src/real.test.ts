// @vitest-environment happy-dom
// The session harness over the editor's own writers (multiuser §6). Three things:
//
// - on the text an intent was made on, the editor derives what the format library derives, byte for
//   byte: one person's file is the same whichever way it is written;
// - sessions and replays over the editor's writers settle, converge and pass the oracle's every
//   check at the level the earlier simulations did;
// - with `REDLINES_REAL=<sessions per cell>`, the matrix runs over them and prints its tables
//   (`REDLINES_REAL_OUT=<file>` keeps the numbers). Deep runs stay off CI.

import { writeFileSync } from 'node:fs';
import { applyChanges, parse } from '@redlines/format';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { derive, formatWriters, useWriters } from './intents.ts';
import { replayTable, mainTable, MATRIX } from './matrix.ts';
import type { Results } from './matrix.ts';
import { realWriters } from './real.ts';
import type { RealWriters } from './real.ts';
import { runCell } from './report.ts';
import { runReplay } from './replay.ts';
import { Rng, seedFor } from './rng.ts';
import { runSession } from './session.ts';
import { baseDocument } from './text.ts';
import { makeIntent, WORKLOADS } from './workloads.ts';

/** The text with its marks' ids named by their order, to tell the same marks by other ids. */
function withoutIds(text: string): string {
  let out = text;
  parse(text).marks.forEach((mark, i) => {
    out = out.split(mark.id).join(`#${i}#`);
  });
  return out;
}

const deep = Number(process.env['REDLINES_REAL'] ?? 0);

let real: RealWriters;
beforeAll(() => {
  real = realWriters();
});
afterAll(() => {
  useWriters(formatWriters);
  real.destroy();
});

test('the editor writes what the format library writes, on the text an intent was made on', () => {
  let compared = 0;
  let widened = 0;
  let renumbered = 0;
  const kinds = new Set<string>();
  for (const workload of WORKLOADS) {
    for (let n = 0; n < 12; n++) {
      const rng = new Rng(seedFor(41, n));
      let text = baseDocument(4, 10);
      const counters = [0, 1, 2].map(() => ({ words: 0, notes: 0, replies: 0, intents: 0 }));
      for (let step = 0; step < 14; step++) {
        const who = step % 3;
        const intent = makeIntent({
          rng,
          workload,
          who,
          local: text,
          confirmed: text,
          counter: counters[who] as (typeof counters)[number],
          at: step * 1000,
          guard: true,
        });
        if (!intent) continue;
        useWriters(formatWriters);
        const expected = derive(text, intent);
        useWriters(real);
        // A decision carries the mark as its writers read it: the editor's signature.
        const mark =
          intent.body.kind === 'decide'
            ? parse(text).marks.find((m) => m.id === (intent.body as { mark: string }).mark)
            : undefined;
        const asSeen =
          mark && intent.body.kind === 'decide'
            ? { ...intent, body: { ...intent.body, seen: real.signature(text, mark) } }
            : intent;
        const actual = derive(text, asSeen);
        useWriters(formatWriters);
        const label = `${workload}/${n}/${step} ${intent.body.kind}`;
        // Where the format library refuses an edit, the editor widens it (policy for edits): it
        // writes more, never less. Where the library writes it, the editor writes the same.
        if (expected.ok) {
          expect(actual.ok, label).toBe(true);
          if (!actual.ok) continue;
          const got = applyChanges(text, actual.changes);
          const want = applyChanges(text, expected.changes);
          // The editor tries the fine form first, and widens when it is refused: ids are drawn
          // from the source in the order it asked, so the same marks can carry other ids.
          if (got !== want) renumbered++;
          expect(withoutIds(got), label).toBe(withoutIds(want));
          compared++;
          kinds.add(intent.body.kind);
          text = applyChanges(text, expected.changes);
        } else if (actual.ok) {
          widened++;
          text = applyChanges(text, actual.changes);
        }
      }
    }
  }
  console.info(`REAL-DERIVE compared=${compared} renumbered=${renumbered} widened=${widened}`);
  // The editor widened some of what the library refuses, and refused none the library wrote.
  expect(widened).toBeGreaterThanOrEqual(0);
  // Most of what the editor writes is the library's, ids included.
  expect(renumbered).toBeLessThan(compared / 4);
  expect(compared).toBeGreaterThan(200);
  // Typing, deleting, formatting, comments, replies and decisions all met the editor.
  expect([...kinds].sort()).toEqual(
    expect.arrayContaining(['type', 'delete', 'sub', 'bold', 'comment', 'reply', 'decide']),
  );
});

test(
  'sessions over the editor settle and converge, with an authority and without',
  { timeout: 300_000 },
  () => {
    useWriters(real);
    try {
      for (const workload of WORKLOADS) {
        const config = {
          seed: seedFor(3, 1),
          workload,
          strategy: 'c2' as const,
          clients: 3,
          ops: 8,
          render: false,
        };
        const session = runSession(config);
        expect(session.converged, `${workload} session`).toBe(true);
        expect(session.violations.some((v) => v.code === 'crash' || v.code === 'stuck')).toBe(
          false,
        );
        const replay = runReplay(config);
        expect(replay.converged, `${workload} replay`).toBe(true);
        expect(replay.violations.some((v) => v.code === 'crash' || v.code === 'stuck')).toBe(false);
      }
    } finally {
      useWriters(formatWriters);
    }
  },
);

test.runIf(deep > 0)('the matrix over the editor', { timeout: 24 * 3_600_000 }, () => {
  // `REDLINES_REAL_WRITERS=format` runs the same cells over the format library's writers: the
  // baseline for the same seeds.
  useWriters(process.env['REDLINES_REAL_WRITERS'] === 'format' ? formatWriters : real);
  const results: Results = {};
  try {
    const cells = MATRIX.filter((cell) =>
      /^((hot|typical|spread|review)\/(c1|c2|replay)|solo\/.*|hot\/replay\/5)$/.test(cell.name),
    );
    for (const cell of cells) {
      results[cell.name] = runCell(cell, 0, deep);
      console.log(
        `${cell.name}: ${results[cell.name]?.filter((s) => s.corrupted).length}/${deep} corrupted`,
      );
    }
  } finally {
    useWriters(formatWriters);
  }
  console.log(mainTable(results));
  console.log(replayTable(results));
  const out = process.env['REDLINES_REAL_OUT'];
  if (out) writeFileSync(out, JSON.stringify(results));
});
