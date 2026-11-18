// @vitest-environment happy-dom
// Return and Backspace at a bare list marker (`-`, `*`, `+`, `1.`, `1)` alone on its line, an empty
// item to Markdown), with Track Changes on and off (#581, format §3.2). Two writes were wrong:
// Backspace at a bare marker right under another one wrote the deletion of the break right behind
// the marker above (`  -<del ⏎->`), which reads as text; Return at a bare marker of another kind of
// list than the item above it (`-` under `1. text`) was taken for a Return in that item's text and
// split it, right behind the marker (`-<split>⏎2. `). Every script is held to the suite's
// invariants: micromark reads the file as it reads the newest view, every order of decisions
// agrees, and Undo gives back each step.
import { scriptRows, type Script } from './script.ts';

const MARKERS = ['-', '*', '+', '1.', '1)'];
const numbered = (marker: string) => /^\d/.test(marker);
/** The marker of the n-th item of a list. */
const nth = (marker: string, n: number) => (numbered(marker) ? `${n}${marker.slice(1)}` : marker);
/** A marker of the other kind of list than `marker`'s, for the item above it. */
const other = (marker: string) => (numbered(marker) ? '-' : '1.');
/** An item with text and the white space of its marker, as an ordered item of the other kind. */
const item = (marker: string) => `${marker} text`;

/** Backspace at a bare marker right under another bare marker (the first bug). */
function underBare(marker: string): Script[] {
  const out: Script[] = [];
  for (const [shape, one, bare, caret, indent] of [
    ['top level', `${nth(marker, 1)} one`, nth(marker, 2), nth(marker, 3), ''],
    [
      'nested',
      `${other(marker)} one⏎  ${nth(marker, 1)} two`,
      `  ${nth(marker, 2)}`,
      `  ${nth(marker, 3)}`,
      '  ',
    ],
    [
      'nested, the caret one level out',
      `${nth(marker, 1)} one⏎  ${nth(marker, 1)} two`,
      `  ${nth(marker, 2)}`,
      nth(marker, 2),
      '',
    ],
  ] as const) {
    for (const [where, tail] of [
      ['as the last line', ''],
      ['with a line after it', `⏎${indent}${nth(marker, 4)} three`],
    ] as const) {
      for (const tc of [true, false]) {
        out.push({
          name: `Backspace under a bare ${marker}, ${shape}, ${where}, Track Changes ${tc ? 'on' : 'off'}`,
          doc: `${one}⏎${bare}⏎${caret}‸${tail}⏎`,
          keys: ['Backspace'],
          tc,
          expect: {},
        });
      }
    }
  }
  return out;
}

/** The words of the refusals that Return meets at a bare marker with Track Changes on: no write of the
 * Return that reads alike in every order is known for these shapes yet (lane R widens the edit). */
const NOT_IN_INDENTATION =
  "A marker can't go in a line's indentation, or in front of or inside its list marker, quote marker or heading #s.";

/** Return at a bare marker under an item of another kind of list (the second bug). */
function returnAtBare(marker: string): Script[] {
  const out: Script[] = [];
  for (const [shape, above, bare] of [
    ['top level', item(other(marker)), marker],
    ['nested', `- one⏎  ${item(other(marker))}`, `  ${marker}`],
    ['in a quote', `> ${item(other(marker))}`, `> ${marker}`],
  ] as const) {
    for (const [where, tail] of [
      ['as the last line', ''],
      ['with a line after it', '⏎⏎after'],
    ] as const) {
      for (const tc of [true, false]) {
        const refusal =
          !tc || shape === 'in a quote'
            ? undefined
            : shape === 'nested'
              ? NOT_IN_INDENTATION
              : undefined;
        out.push({
          name: `Return at a bare ${marker} under another kind of item, ${shape}, ${where}, Track Changes ${tc ? 'on' : 'off'}`,
          doc: `${above}⏎${bare}‸${tail}⏎`,
          keys: ['Enter'],
          tc,
          expect: refusal ? { refusal } : {},
        });
      }
    }
  }
  return out;
}

for (const marker of MARKERS) {
  scriptRows([...underBare(marker), ...returnAtBare(marker)], 60_000);
}

scriptRows(
  [
    // The shapes of the issue, with what they leave in the views.
    {
      name: 'Backspace at a bare - under a bare -, nested, in the file of the issue',
      doc: '- a⏎  - b⏎  -⏎-‸⏎',
      keys: ['Backspace'],
      tc: true,
      expect: { newest: '- a⏎  - b⏎', original: '- a⏎  - b⏎  -⏎-⏎' },
    },
    {
      name: 'Backspace at a bare * under a bare *, nested',
      doc: '* a⏎  * b⏎  *⏎*‸⏎',
      keys: ['Backspace'],
      tc: true,
      expect: { newest: '* a⏎  * b⏎', original: '* a⏎  * b⏎  *⏎*⏎' },
    },
    {
      name: 'Backspace at a bare - under a bare -, with Track Changes off the item above stays',
      doc: '- a⏎  - b⏎  -⏎-‸⏎',
      keys: ['Backspace'],
      tc: false,
      expect: { file: '- a⏎  - b⏎  -⏎' },
    },
    {
      name: 'Backspace at a bare - under a bare - at the start of the file',
      doc: '-⏎-‸⏎',
      keys: ['Backspace'],
      tc: true,
      expect: {},
    },
    {
      name: 'Backspace at an item with a space under a bare -',
      doc: '- a⏎  - b⏎  -⏎- ‸⏎',
      keys: ['Backspace'],
      tc: true,
      expect: {},
    },
    {
      name: 'Return at a bare - under a numbered item, Track Changes on: no split behind the marker',
      doc: '1. text⏎-‸⏎',
      keys: ['Enter'],
      tc: true,
      expect: { original: '1. text⏎-⏎' },
    },
    {
      name: 'Return at a bare - under a numbered item, then Undo',
      doc: '1. text⏎-‸⏎',
      keys: ['Enter', 'Mod-z'],
      tc: true,
      expect: {},
    },
    {
      name: 'Backspace under a bare -, then Undo',
      doc: '- a⏎  - b⏎  -⏎-‸⏎',
      keys: ['Backspace', 'Mod-z'],
      tc: true,
      expect: {},
    },
  ] as Script[],
  60_000,
);

// Runs of bare markers, and the contexts where a bare line is no empty item to Return.
const both = (rows: [string, string, 'Enter' | 'Backspace'][]): Script[] =>
  rows.flatMap(([name, doc, key]) =>
    [true, false].map((tc) => ({
      name: `${name}, Track Changes ${tc ? 'on' : 'off'}`,
      doc,
      keys: [key],
      tc,
      // (Return with its content on the next line was refused; the unit is written now, #1104)
      expect: {},
    })),
  );

scriptRows(
  both([
    ['Backspace, run of three, top level', '- a⏎-⏎-⏎-‸⏎', 'Backspace'],
    ['Backspace, run of three, nested', '- a⏎  -⏎  -⏎-‸⏎', 'Backspace'],
    ['Backspace, run of three, same indent nested', '- a⏎  - b⏎  -⏎  -⏎  -‸⏎', 'Backspace'],
    ['Backspace, run of three, numbers', '1. a⏎2.⏎3.⏎4.‸⏎', 'Backspace'],
    ['Backspace, run of three, 1)', '1) a⏎2)⏎3)⏎4)‸⏎', 'Backspace'],
    ['Backspace, run of three, star', '* a⏎*⏎*⏎*‸⏎', 'Backspace'],
    ['Backspace, run of four', '- a⏎-⏎-⏎-⏎-‸⏎', 'Backspace'],
    ['Backspace, run of four, plus, a line after', '+ a⏎+⏎+⏎+⏎+‸⏎+ b⏎', 'Backspace'],
    ['Backspace, run of four, nested numbers', '- a⏎  1. b⏎  2.⏎  3.⏎  4.‸⏎', 'Backspace'],
    ['Backspace in a quote', '> - a⏎> -‸⏎', 'Backspace'],
    ['Backspace in a quote, run of three', '> - a⏎> -⏎> -⏎> -‸⏎', 'Backspace'],
    ['Return under text is no empty item (setext)', 'text⏎-‸⏎', 'Enter'],
    ['Return in the content column is no empty item', '1. a⏎   -‸⏎', 'Enter'],
    ['Return after a tab is no empty item', '1. a⏎\t-‸⏎', 'Enter'],
    ['Return under a second line of the text', '1. text⏎   more⏎   -‸⏎', 'Enter'],
    ['Return with its content on the next line', '1. a⏎-‸⏎  more⏎', 'Enter'],
    ['Return at a bare number of the same list', '1. a⏎2.‸⏎', 'Enter'],
    ['Return at a bare number of the other delimiter', '1. a⏎1)‸⏎', 'Enter'],
    ['Return at a bare bullet of another kind', '- a⏎*‸⏎', 'Enter'],
  ]),
  60_000,
);
