// @vitest-environment happy-dom
// Random walks of the block keys (design: block editing, Tests): on the format's random documents,
// which hold every kind of mark by other people, keys at random block edges and inside blocks and
// typing, with Track Changes on and off, held after the keys to every invariant of the suite that
// the starting document holds. A refusal is allowed (other people's marks refuse some edits), but
// nothing else. Seeded, so a failure repeats; `REDLINES_FUZZ` for more walks.
import { parse } from '@redlines/format';
import { expect, it } from 'vitest';
import {
  adjacentListsDocument,
  fuzzCount,
  listDocument,
  randomDocument,
  seeded,
} from '../../../format/src/random-docs.ts';
import { type Invariant, invariantProblems, runScript, type Step } from './script.ts';

const KEYS: Step[] = [
  'Enter',
  'Enter',
  'Backspace',
  'Backspace',
  'Delete',
  'Shift-Enter',
  'ArrowLeft',
  'ArrowRight',
  { type: 'x' },
  { type: 'new words ' },
  'Mod-z',
  'Mod-Shift-z',
  'Shift-ArrowRight',
  'Shift-ArrowLeft',
  { agent: 'The agent wrote this.' },
  { decide: 'accept' },
  { decide: 'reject' },
];

/** Where a walk may start: the start of a line's text, or a line's end, in the body. */
function edges(doc: string): number[] {
  const end = parse(doc).ledgerRange?.from ?? doc.length;
  const found: number[] = [];
  let from = 0;
  for (const line of doc.slice(0, end).split('\n')) {
    const syntax =
      /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(?:#{1,6}[ \t]+)?/.exec(line)?.[0] ?? '';
    // Not on a blank line, which is no block: the caret is always in a block's text.
    const blank = /^[ \t>]*$/.test(line);
    for (const at of blank ? [] : [from + syntax.length, from + line.length]) {
      // Not inside a marker.
      const before = doc.slice(0, at);
      if (before.lastIndexOf('<!--') <= before.lastIndexOf('-->')) found.push(at);
    }
    from += line.length + 1;
  }
  return found;
}

/** The invariants a walk is held to: those the starting document holds. */
const WALKED: Invariant[] = [
  'hidden-caret',
  'empty-paragraph',
  'stray-blank-line',
  'render',
  'format',
  'line-start',
  'decisions',
  'undo',
  'open-caret',
  'history',
];

/**
 * Return at a soft line break with Track Changes on writes the design's probed form, two line
 * breaks that read as one after the split (chunk C's deviation, `paragraph-keys.test.ts`): a
 * stray blank line in the file that no reader sees, which the walks leave to that form's own row
 * (in a quote, with its markers on the blank lines: walk seed 157).
 */
const TWO_BREAKS = /<!--split [a-z0-9]+-->\n(?:[ \t>]*\n){2}/;

const WALKS = fuzzCount(24);
/** Walks over lists of different markers side by side (their own seeds). */
const ADJACENT = fuzzCount(12);
const STEPS = 5;

/** Plays the walks of seeds 1 to `count`, over `adjacent` documents or the usual ones. */
function walk(count: number, adjacent: boolean): void {
  const failures: string[] = [];
  for (let seed = 1; seed <= count; seed++) {
    const random = seeded(seed);
    const below = (n: number) => Math.floor(random() * n);
    const doc = adjacent
      ? adjacentListsDocument(random)
      : seed % 3 === 0
        ? listDocument(random)
        : randomDocument(random);
    const starts = edges(doc);
    if (!starts.length) continue;
    const at = starts[below(starts.length)]!;
    const keys = Array.from({ length: STEPS }, () => KEYS[below(KEYS.length)]!);
    const tc = random() < 0.5;
    const name = `seed ${seed}, Track Changes ${tc ? 'on' : 'off'}, ${JSON.stringify(keys)}`;
    const script = { name, doc: doc.slice(0, at) + '‸' + doc.slice(at), keys, tc, expect: {} };
    if (process.env['WALK_SEED'] && Number(process.env['WALK_SEED']) !== seed) continue;
    if (process.env['WALK_SEED']) {
      // One walk, step by step, for a person to read: `WALK_SEED=146 pnpm exec vitest run …`.
      for (let k = 0; k <= keys.length; k++) {
        try {
          const step = runScript({ ...script, keys: keys.slice(0, k) });
          console.log(`${k ? JSON.stringify(keys[k - 1]) : 'start'}: ${step.caret}`);
        } catch (error) {
          console.log(`${JSON.stringify(keys[k - 1])}: threw ${String(error)}`);
        }
      }
    }
    const before = invariantProblems(runScript({ ...script, keys: [] }));
    let after: ReturnType<typeof invariantProblems>;
    let result: ReturnType<typeof runScript>;
    try {
      result = runScript(script);
      after = invariantProblems(result);
    } catch (error) {
      failures.push(`${name}: threw ${String(error)}`);
      continue;
    }
    for (const invariant of WALKED) {
      if (before[invariant].length || !after[invariant].length) continue;
      if (invariant === 'stray-blank-line' && tc && TWO_BREAKS.test(result.file)) continue;
      failures.push(`${name}: ${invariant}: ${after[invariant].join('; ').slice(0, 400)}`);
    }
  }
  expect(failures).toEqual([]);
}

it(
  `holds every invariant over ${WALKS} random walks of ${STEPS} keys`,
  () => walk(WALKS, false),
  600_000,
);

it(
  `holds every invariant over ${ADJACENT} walks over lists side by side`,
  () => walk(ADJACENT, true),
  600_000,
);
