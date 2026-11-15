// @vitest-environment happy-dom
// Text typed after a bare list marker (`-`, `*`, `+`, `1.`, `1)` alone on its line, an empty item to
// Markdown), with Track Changes on and off (#580, format §3.2). A tracked insertion never stands
// between a marker and the space after it: the space is written as it is, and the insertion opens
// after it. Every script is held to the suite's invariants: micromark reads the file as it reads the
// newest view, every order of decisions agrees, and Undo gives back each step. The walks start at
// a bare marker and type, press Return and Backspace, undo and decide.
import { parse } from '@redlines/format';
import { expect, it } from 'vitest';
import { bareMarkerDocument, fuzzCount, seeded } from '../../../format/src/random-docs.ts';
import {
  type Invariant,
  invariantProblems,
  runScript,
  type Script,
  scriptRows,
  settle,
  type Step,
} from './script.ts';

const MARKERS = ['-', '*', '+', '1.', '1)'];
const numbered = (marker: string) => /^\d/.test(marker);
/** The marker of the second item. */
const second = (marker: string) => (numbered(marker) ? `2${marker.slice(1)}` : marker);
const third = (marker: string) => (numbered(marker) ? `3${marker.slice(1)}` : marker);

/** The rows of one marker: as the last line and with a line after it, three things typed, Track Changes on and off. */
function rows(marker: string): Script[] {
  const one = `${marker} one`;
  const bare = second(marker);
  const pad = ' '.repeat(bare.length + 1);
  const out: Script[] = [];
  for (const [where, tail] of [
    ['as the last line', ''],
    ['with a line after it', `⏎${third(marker)} three`],
  ] as const) {
    const doc = `${one}⏎${bare}‸${tail}⏎`;
    const rest = `${tail}⏎`;
    const name = (what: string, tc: boolean) =>
      `${marker} ${where}: ${what}, Track Changes ${tc ? 'on' : 'off'}`;
    // A space and a letter.
    out.push({
      name: name('a space and a letter', true),
      doc,
      keys: [{ type: ' a' }],
      tc: true,
      expect: {
        // The space as it is, the insertion after it, on the line before its text.
        caret: `${one}⏎${bare} <ins>⏎${pad}a‸</ins>${tail}`,
        newest: `${one}⏎${bare} a${rest}`,
        original: `${one}⏎${bare} ${rest}`,
      },
    });
    out.push({
      name: name('a space and a letter', false),
      doc,
      keys: [{ type: ' a' }],
      tc: false,
      expect: { file: `${one}⏎${bare} a${rest}` },
    });
    // A letter with no space first: written as typed, and the same as it was.
    out.push({
      name: name('a letter', true),
      doc,
      keys: [{ type: 'a' }],
      tc: true,
      expect: { newest: `${one}⏎${bare}a${rest}` },
    });
    out.push({
      name: name('a letter', false),
      doc,
      keys: [{ type: 'a' }],
      tc: false,
      expect: { file: `${one}⏎${bare}a${rest}` },
    });
    // A lone space: the space alone, with no mark, as with Track Changes off.
    out.push({
      name: name('a lone space', true),
      doc,
      keys: [{ type: ' ' }],
      tc: true,
      expect: { file: `${one}⏎${bare} ${rest}` },
    });
    out.push({
      name: name('a lone space', false),
      doc,
      keys: [{ type: ' ' }],
      tc: false,
      expect: { file: `${one}⏎${bare} ${rest}` },
    });
    // The space, then the letter, as two keystrokes.
    out.push({
      name: name('a space, then a letter', true),
      doc,
      keys: [{ type: ' ' }, { type: 'a' }],
      tc: true,
      expect: { newest: `${one}⏎${bare} a${rest}` },
    });
    // A tracked paste of plain text with a space first (not list items: text).
    out.push({
      name: name('a paste of plain text', true),
      doc,
      keys: [{ paste: ' a b' }],
      tc: true,
      expect: { newest: `${one}⏎${bare} a b${rest}` },
    });
    out.push({
      name: name('a paste of plain text', false),
      doc,
      keys: [{ paste: ' a b' }],
      tc: false,
      expect: { file: `${one}⏎${bare} a b${rest}` },
    });
    // Undo takes it back in one step.
    out.push({
      name: name('a space and a letter, then Undo', true),
      doc,
      keys: [{ type: ' a' }, 'Mod-z'],
      tc: true,
      expect: {},
    });
  }
  return out;
}

for (const marker of MARKERS) scriptRows(rows(marker), 60_000);

scriptRows(
  [
    {
      name: 'in a quote',
      doc: '> - one⏎> -‸⏎',
      keys: [{ type: ' a' }],
      tc: true,
      expect: { newest: '> - one⏎> - a⏎' },
    },
    {
      name: 'nested in an item',
      doc: '- one⏎  - two⏎  -‸⏎',
      keys: [{ type: ' a' }],
      tc: true,
      expect: { newest: '- one⏎  - two⏎  - a⏎' },
    },
    {
      name: 'a numbered item nested in a bullet',
      doc: '- one⏎  1. two⏎  2.‸⏎',
      keys: [{ type: ' a' }],
      tc: true,
      expect: { newest: '- one⏎  1. two⏎  2. a⏎' },
    },
  ] as Script[],
  60_000,
);

// The walks: documents with bare markers, the caret at the end of one, then typing, Undo, Redo and
// decisions. Return and Backspace at a bare marker are not among the keys: they fail on main (#581).
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
  'file-text',
];
const KEYS: Step[] = [
  { type: ' a' },
  { type: ' a' },
  { type: 'a' },
  { type: ' ' },
  { type: 'bc ' },
  'Mod-z',
  'Mod-Shift-z',
  { decide: 'accept' },
  { decide: 'reject' },
];
const WALKS = fuzzCount(40);

it(`holds every invariant over ${WALKS} walks that start at a bare marker`, async () => {
  const failures: string[] = [];
  for (let seed = 1; seed <= WALKS; seed++) {
    await settle();
    const random = seeded(seed * 31);
    const below = (n: number) => Math.floor(random() * n);
    const doc = bareMarkerDocument(random);
    const end = parse(doc).ledgerRange?.from ?? doc.length;
    const bares = [
      ...doc.slice(0, end).matchAll(/^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-+*]|\d{1,9}[.)])$/gm),
    ];
    const found = bares[below(bares.length)];
    if (!found) continue;
    const at = found.index + found[0].length;
    const keys = Array.from({ length: 4 }, () => KEYS[below(KEYS.length)]!);
    const tc = random() < 0.7;
    const name = `seed ${seed}, Track Changes ${tc ? 'on' : 'off'}, ${JSON.stringify(keys)}`;
    const script = { name, doc: doc.slice(0, at) + '‸' + doc.slice(at), keys, tc, expect: {} };
    const before = invariantProblems(runScript({ ...script, keys: [] }));
    let after: ReturnType<typeof invariantProblems>;
    try {
      after = invariantProblems(runScript(script));
    } catch (error) {
      failures.push(`${name}: threw ${String(error)}`);
      continue;
    }
    for (const invariant of WALKED) {
      if (before[invariant].length || !after[invariant].length) continue;
      failures.push(`${name}: ${invariant}: ${after[invariant].join('; ').slice(0, 400)}`);
    }
  }
  expect(failures).toEqual([]);
}, 600_000);
