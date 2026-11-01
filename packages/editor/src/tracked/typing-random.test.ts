// @vitest-environment happy-dom
// Random typing with Track Changes on: wherever text is typed or pasted, the caret ends right
// after it in the newest text. Seeded, so a failure repeats.
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newestView } from '@redlines/format';
import { afterEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { editSourceFacet } from './typing.ts';

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../format/src/fixtures/launch-plan.md'),
  'utf8',
);

const ledger = (marks: string) =>
  `\n\n<!-- redlines\nversion: 1\npeople:\n  bo: {name: Bo Chen}\nmarks:\n${marks}-->\n`;

const documents = [
  'Hello world',
  'Hello world\n',
  'Hello world\n\n',
  '# Title\n\nFirst para, with words.\n\n- one\n- two\n\n> a quote\n',
  '# Title\n\nFirst para, with words.\n\n- one\n- two\n\n> a quote\n\n',
  `One <!--ins b2b2-->two<!--/b2b2--> three.\n\n- alpha\n- beta${ledger('  b2b2: {by: bo, at: 2026-10-31T09:30Z}\n')}`,
  // Blocks inserted whole, whose openers stand on lines of their own (format §3.3).
  `Intro.\n\n<!--ins b2b2-->\n\nA new paragraph.<!--/b2b2-->\n\n<!--ins c3c3-->\n\n## A new heading<!--/c3c3-->\n\nEnd.${ledger('  b2b2: {by: bo, at: 2026-10-31T09:30Z}\n  c3c3: {by: bo, at: 2026-10-31T09:31Z}\n')}`,
  fixture,
];

const typings = [
  'x',
  'ab',
  ' ',
  ', ',
  'a',
  'e',
  '- ',
  'new text',
  'two\nlines',
  'z.',
  // Ending in line breaks.
  'x\n',
  'end.\n\n',
];

/** A block's marker at the start of a line: a heading's, a list item's or a quote's. */
const BLOCK_MARKER = /^(?:#{1,6}|[-*+]|\d{1,9}[.)]|>)[ \t]+/gm;

/** Mulberry32: a small seeded random source. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

it('puts the caret right after typed and pasted text, in random places', () => {
  const random = seeded(20261101);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const bytes = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(random() * 256));
  const misses: string[] = [];
  let checked = 0;
  for (const doc of documents) {
    for (let session = 0; session < 8; session++) {
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, {
        doc,
        author: { handle: 'ada', name: 'Ada Lovelace' },
        tracking: true,
        extensions: [
          editSourceFacet.of({ now: () => new Date('2026-11-01T10:00Z'), random: bytes }),
        ],
      });
      open.push(editor);
      for (let step = 0; step < 6; step++) {
        const before = newestView(editor.getParsed().text);
        // A caret or a selection in the newest text, on either side of hidden markers; or now and
        // then a caret inside a block's marker, such as between a bullet and the space after it.
        let x = Math.floor(random() * (before.text.length + 1));
        let y = random() < 0.5 ? x : Math.floor(random() * (before.text.length + 1));
        const blockMarkers = [...before.text.matchAll(BLOCK_MARKER)];
        if (blockMarkers.length && random() < 0.2) {
          const { index, 0: marker } = pick(blockMarkers);
          x = y = index + 1 + Math.floor(random() * (marker.length - 1));
        }
        const anchor = before.map.toSource(Math.min(x, y), random() < 0.5 ? -1 : 1);
        const head = before.map.toSource(Math.max(x, y), random() < 0.5 ? -1 : 1);
        editor.view.dispatch({ selection: { anchor, head }, userEvent: 'select' });
        const { from, to } = editor.view.state.selection.main;
        const a = before.map.fromSource(from);
        const b = before.map.fromSource(to);
        const typed = pick(typings);
        const text = editor.view.state.doc.toString();
        editor.view.dispatch(editor.view.state.replaceSelection(typed), {
          userEvent: random() < 0.5 ? 'input.type' : 'input.paste',
        });
        if (editor.view.state.doc.toString() === text) continue; // Refused: nothing to check.
        checked++;
        const after = newestView(editor.getParsed().text);
        const caret = after.map.fromSource(editor.view.state.selection.main.head);
        // Right after the typed text, and followed by what followed the edit, though the line
        // breaks that end the text may differ (the first tracked edit writes the ledger), typed
        // text that joins two blocks drops the second one's prefix (format §3.4), and text typed
        // inside a block's marker goes after the marker.
        const tail = before.text.slice(b).trimEnd();
        const joined = tail.replace(/^\n*(?:[-*+] |\d{1,9}[.)] |> |#{1,6} )?/, '');
        const marker = blockMarkers.find(({ index, 0: m }) => index < a && b < index + m.length);
        const past = marker ? before.text.slice(marker.index + marker[0].length).trimEnd() : null;
        const rest = after.text.slice(caret).trimEnd();
        const ok =
          after.text.slice(0, caret).endsWith(typed) &&
          (rest === tail || rest === joined || rest === past);
        if (!ok) {
          misses.push(
            `${JSON.stringify(before.text)} [${a}, ${b}) + ${JSON.stringify(typed)} -> ` +
              `${JSON.stringify(after.text.slice(0, caret))}|${JSON.stringify(after.text.slice(caret))}`,
          );
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(200);
  expect(misses).toEqual([]);
});
