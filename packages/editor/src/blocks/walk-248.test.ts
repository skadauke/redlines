// @vitest-environment happy-dom
// Random walks of #248's keys: documents that hold the shapes the issue names (a setext heading
// with a block after it, a list before another of other markers, a list or a quote at the very
// start of the file, an empty item first in the file, a nested list's first item under its
// item's text, a soft break after a pending deletion) with the caret at a block's edge and a few
// keys, Track Changes on and off, held to the block suite's invariants the starting document
// holds. A refusal is allowed; nothing else is. Seeded, so a failure repeats; `REDLINES_FUZZ` for
// more walks, `WALK_SEED` for one.
import { expect, it } from 'vitest';
import { fuzzCount, seeded } from '../../../format/src/random-docs.ts';
import {
  type Invariant,
  invariantProblems,
  runScript,
  type Step,
  type StepResult,
} from './script.ts';

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'plan', 'ship', 'café', 'note'];

const KEYS: Step[] = [
  'Enter',
  'Backspace',
  'Backspace',
  'Delete',
  'Delete',
  'Shift-Enter',
  'ArrowLeft',
  'ArrowRight',
  { type: 'x' },
  'Mod-z',
  { decide: 'accept' },
  { decide: 'reject' },
];

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
  'list-reads',
];

/** A document in the script's notation, of the shapes #248 names; `<del a>` is another person's. */
export function issueDocument(random: () => number): string {
  const below = (n: number) => Math.floor(random() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  /** Words, now and then with a pending deletion of another person at the end of a line. */
  const text = () => {
    const base = words(1 + below(3));
    return below(4) === 0 ? `${base}<del ${pick(['a', ' ', 'z'])}>` : base;
  };
  const markers = ['- ', '+ ', '* ', '1. ', '1) ', '3. '];
  // A nested list right under text starts with a bullet or 1: other numbers are text there.
  const nestable = markers.filter((marker) => !marker.startsWith('3'));
  const list = (indent: string, marker: string, items: number): string => {
    const pad = indent + ' '.repeat(marker.length);
    return Array.from({ length: items }, (_, i) => {
      const own = /^\d/.test(marker)
        ? marker.replace(/^\d+/, String(Number.parseInt(marker, 10) + i))
        : marker;
      let item = `${indent}${own}${text()}`;
      if (below(4) === 0) item += `⏎${pad}${text()}`;
      return item;
    }).join('⏎');
  };
  const block = (first: boolean): string => {
    const roll = below(14);
    if (roll < 2) return text();
    if (roll < 4) return `${text()}⏎${pick(['===', '---'])}`;
    if (roll < 6) return list('', pick(markers), 1 + below(3));
    if (roll < 7)
      return `${list('', pick(markers), 1 + below(2))}⏎⏎${list('', pick(markers), 1 + below(2))}`;
    if (roll < 8) {
      const outer = pick(['- ', '1. ']);
      const pad = ' '.repeat(outer.length);
      return `${outer}${text()}${below(2) ? `⏎${pad}${text()}` : ''}⏎${list(pad, pick(nestable), 1 + below(2))}`;
    }
    if (roll < 9) return `> ${text()}⏎>⏎> ${text()}`;
    if (roll < 10) return `${text()}⏎${text()}`;
    if (roll < 11 && first) return pick(['- ', '1. ']) + `⏎${list('', '- ', 1)}`;
    if (roll < 12) return `## ${text()}`;
    if (roll < 13) return `${text()}<del ${pick(['a', ' '])}>⏎x ${words(1)}`;
    return `> ${text()}`;
  };
  return Array.from({ length: 2 + below(2) }, (_, i) => block(i === 0)).join('⏎⏎');
}

/** The places a walk may start: a text's start or a line's end, outside every marker. */
function edges(doc: string): number[] {
  const found: number[] = [];
  const spans = [...doc.matchAll(/<del [^>]*>/g)].map((m) => [m.index, m.index + m[0].length]);
  const inside = (at: number) => spans.some(([a, b]) => at > a! && at < b!);
  let from = 0;
  for (const line of doc.split('⏎')) {
    const syntax =
      /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(?:#{1,6}[ \t]+)?/.exec(line)?.[0] ?? '';
    const blank = /^[ \t>]*$/.test(line);
    // A list marker alone: the caret goes after it, as Return on an empty item has it.
    const alone = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]*$/.test(line);
    for (const at of blank && !alone ? [] : [from + syntax.length, from + line.length]) {
      if (!inside(at)) found.push(at);
    }
    from += line.length + 1;
  }
  return found;
}

/**
 * Return at a soft line break with Track Changes on writes the design's probed form, two line
 * breaks that read as one after the split (`walk.test.ts`): a stray blank line in the file that no
 * reader sees.
 */
const TWO_BREAKS = /<!--split [a-z0-9]+-->\n(?:[ \t>]*\n){2}/;

/**
 * Whether a step took a character out of a list marker with the caret inside it (`3.‸ ship`,
 * Backspace): with Track Changes off that is the person editing the syntax, and the item and the
 * ones after it read as Markdown reads them (the next numbered item is a line of the text), in the
 * file and in the editor alike. No key wrote it: the tracked key is refused (format rule 5), and
 * 'list-reads' is for what keys write (#292, seed 1140). A key that takes a marker away from the
 * caret at an item's text (Backspace at its start) or moves it (an outdent, which writes the
 * indentation) is not that, and is held to it.
 */
function editedMarker(step: StepResult): boolean {
  if (step.after.length >= step.before.length) return false;
  const { text, col } = step.caretLine;
  const marker = /^([ \t>]*)(\d{1,9}[.)]|[-+*])(?=[ \t]|$)/.exec(text);
  return !!marker && col >= marker[1]!.length && col <= marker[1]!.length + marker[2]!.length;
}

const WALKS = fuzzCount(40);
const STEPS = 3;

it(`holds every invariant over ${WALKS} walks of #248's shapes`, () => {
  const failures: string[] = [];
  for (let seed = 1; seed <= WALKS; seed++) {
    if (process.env['WALK_SEED'] && Number(process.env['WALK_SEED']) !== seed) continue;
    const random = seeded(seed);
    const below = (n: number) => Math.floor(random() * n);
    const doc = issueDocument(random);
    const starts = edges(doc);
    if (!starts.length) continue;
    const at = starts[below(starts.length)]!;
    const keys = Array.from({ length: STEPS }, () => KEYS[below(KEYS.length)]!);
    const tc = random() < 0.6;
    const name = `seed ${seed}, Track Changes ${tc ? 'on' : 'off'}, ${JSON.stringify(keys)}: ${doc.slice(0, at)}‸${doc.slice(at)}`;
    const script = { name, doc: doc.slice(0, at) + '‸' + doc.slice(at), keys, tc, expect: {} };
    try {
      const before = invariantProblems(runScript({ ...script, keys: [] }));
      const result = runScript(script);
      const after = invariantProblems(result);
      for (const invariant of WALKED) {
        if (before[invariant].length || !after[invariant].length) continue;
        if (invariant === 'stray-blank-line' && tc && TWO_BREAKS.test(result.file)) continue;
        if (invariant === 'list-reads' && !tc && result.steps.some(editedMarker)) {
          continue;
        }
        failures.push(`${name}: ${invariant}: ${after[invariant].join('; ').slice(0, 300)}`);
      }
    } catch (error) {
      failures.push(`${name}: threw ${String(error).slice(0, 300)}`);
    }
  }
  expect(failures).toEqual([]);
}, 600_000);
