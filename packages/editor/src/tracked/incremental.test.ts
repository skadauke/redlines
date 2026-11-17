// @vitest-environment happy-dom
// The tracked layer's display, kept and drawn again only in the windows a change can touch (#744),
// is what drawing the whole text again gives: after edits that open and close marks and comments,
// moves of the caret, changes of view and steps of the parse, in a document of every kind of block
// and mark.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { setViewModeEffect } from './field.ts';
import { createEditor, type Editor } from '../index.ts';
import { freshDisplay, keptDisplay, trackedStats } from './decorations.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const WORDS = 'the quick brown fox jumps over a lazy dog while reviewers read every line';
const IDS = Array.from(
  { length: 400 },
  (_, i) =>
    `b${'cdfghjkmnpqrstvwxz23456789'[i % 26]}${'cdfg'[Math.floor(i / 26) % 4]}${'hjkm'[Math.floor(i / 104)]}`,
);

/** A document of every kind of block, with marks of every kind, and the ledger that goes with them. */
function documentOf(blocks: number): string {
  const parts: string[] = [];
  let m = 0;
  const id = () => IDS[m++ % IDS.length]!;
  for (let n = 0; n < blocks; n++) {
    const a = id();
    const b = id();
    parts.push(
      [
        `## Section ${n}`,
        `${WORDS} ${n}, with <!--ins ${a}-->an insertion<!--/${a}--> and <!--del ${b} some old words--> here.`,
        `- ${WORDS}\n- second <!--hl ${a}-->item<!--/${a}-->\n  1. nested one\n  2. nested two`,
        `| a | b |\n| - | - |\n| ${n} | <!--ins ${a}-->${WORDS}<!--/${a}--> |`,
        `> ${WORDS}\n> more <!--sub ${a} old-->new<!--/${a}-->`,
        '```ts\nconst x = 1;\n\nconst y = 2;\n```',
        `<!--del ${a} \n\nA whole deleted paragraph.\n-->\n\n${WORDS} after it`,
        `<!-- an ordinary comment -->\n\n${WORDS} <!-- and another --> text`,
        `plain ${WORDS}\n\nand another plain paragraph ${n}`,
        `line one <!--split ${a}-->\nline two ${n} <!--cmt ${b}-->commented<!--/${b}-->`,
        // Blocks inserted whole, the opening marker on a line of its own (#1025): a run of them has
        // no plain paragraph between, and each is a firm stretch of its own.
        `<!--ins ${a}-->\n\nAn inserted block ${n}.<!--/${a}-->\n\n<!--ins ${b}-->\n\nAnd another, ${WORDS}.<!--/${b}-->`,
        `<!--ins ${a}-->\n\nA block ${n} that holds a comment <!-- aside --> in it.<!--/${a}-->`,
      ][n % 12]!,
    );
  }
  const ids = IDS.slice(0, Math.min(m, IDS.length));
  const entries = ids.map((id) => `  ${id}: {by: ada, at: 2026-10-31T09:30Z}\n`).join('');
  return `${parts.join('\n\n')}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries}-->\n`;
}

/** A small deterministic random generator. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const SNIPPETS = [
  'x',
  ' word ',
  '\n\n',
  '\n',
  '```\n',
  '- ',
  '> ',
  '# ',
  '<!--',
  '-->',
  '<!--ins bddj-->',
  '<!--/bddj-->',
  '<!--del bddk gone-->',
  '\n<!--ins bdfj-->\n',
  '<!-- note -->',
  '\n\n\n',
];

describe('the tracked display, kept and drawn again in windows', () => {
  it.each([3, 7, 19, 31, 47, 61])(
    'is what drawing it all again gives, through edits, carets and the parse (seed %i)',
    (seed) => {
      const doc = documentOf(80);
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, { doc, author, view: 'redlines' });
      open.push(editor);
      const { view } = editor;
      const next = random(seed);
      const check = (what: string) => {
        const kept = keptDisplay(view.state);
        const fresh = freshDisplay(view.state);
        if (kept.length !== fresh.length || kept.some((line, i) => line !== fresh[i])) {
          const at = kept.findIndex((line, i) => line !== fresh[i]);
          expect(
            {
              at,
              kept: kept.slice(Math.max(0, at - 1), at + 3),
              fresh: fresh.slice(Math.max(0, at - 1), at + 3),
            },
            what,
          ).toEqual({});
        }
      };
      trackedStats.windowed = trackedStats.whole = 0;
      check('start');
      // The parse goes on in steps, with edits between.
      for (let at = 2000; at < view.state.doc.length + 2000; at += 2000) {
        forceParsing(view, Math.min(at, view.state.doc.length), 10_000);
        check(`parse to ${at}`);
        if (at % 6000 === 0) {
          const pos = Math.floor(next() * view.state.doc.length);
          view.dispatch({ changes: { from: pos, insert: 'e ' } });
          check(`edit during the parse at ${pos}`);
        }
      }
      for (let step = 0; step < 220; step++) {
        const length = view.state.doc.length;
        const pos = Math.floor(next() * length);
        const kind = next();
        if (kind < 0.35) {
          const insert = SNIPPETS[Math.floor(next() * SNIPPETS.length)]!;
          view.dispatch({
            changes: { from: pos, insert },
            selection: { anchor: pos + insert.length },
          });
          check(`insert ${JSON.stringify(insert)} at ${pos}`);
        } else if (kind < 0.55) {
          const to = Math.min(length, pos + Math.floor(next() * 60));
          view.dispatch({ changes: { from: pos, to } });
          check(`delete ${pos}-${to}`);
        } else if (kind < 0.85) {
          view.dispatch({
            selection: { anchor: pos, head: Math.min(length, pos + Math.floor(next() * 30)) },
          });
          check(`select ${pos}`);
        } else if (kind < 0.9) {
          const mode = (['clean', 'redlines', 'simple'] as const)[Math.floor(next() * 3)]!;
          view.dispatch({ effects: setViewModeEffect.of(mode) });
          check(`view ${mode}`);
        } else {
          forceParsing(view, view.state.doc.length, 10_000);
          check('parse to the end');
        }
      }
      // Most of the steps were drawn in windows, not whole.
      expect(trackedStats.windowed).toBeGreaterThan(trackedStats.whole * 3);
    },
    120_000,
  );

  it.each([5, 13, 29])(
    'is what drawing it all again gives in a text of blocks inserted whole, with no plain paragraph (seed %i)',
    (seed) => {
      const parts: string[] = [];
      const ids = IDS.slice(0, 120);
      ids.forEach((id, n) => {
        parts.push(`<!--ins ${id}-->\n\nInserted block ${n}, ${WORDS}.<!--/${id}-->`);
      });
      const entries = ids.map((id) => `  ${id}: {by: ada, at: 2026-10-31T09:30Z}\n`).join('');
      const doc = `${parts.join('\n\n')}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries}-->\n`;
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, { doc, author, view: 'redlines' });
      open.push(editor);
      const { view } = editor;
      forceParsing(view, view.state.doc.length, 10_000);
      const next = random(seed);
      trackedStats.windowed = trackedStats.whole = 0;
      for (let step = 0; step < 200; step++) {
        const length = view.state.doc.length;
        const pos = Math.floor(next() * length);
        const kind = next();
        let what: string;
        if (kind < 0.5) {
          const insert = SNIPPETS[Math.floor(next() * SNIPPETS.length)]!;
          view.dispatch({
            changes: { from: pos, insert },
            selection: { anchor: pos + insert.length },
          });
          what = `insert ${JSON.stringify(insert)} at ${pos}`;
        } else if (kind < 0.7) {
          const to = Math.min(length, pos + Math.floor(next() * 60));
          view.dispatch({ changes: { from: pos, to } });
          what = `delete ${pos}-${to}`;
        } else {
          view.dispatch({ selection: { anchor: pos } });
          what = `select ${pos}`;
        }
        expect(keptDisplay(view.state), what).toEqual(freshDisplay(view.state));
      }
      expect(trackedStats.windowed).toBeGreaterThan(trackedStats.whole * 3);
    },
    120_000,
  );

  it('draws again a mark far below an edit that swallows its marker, and one that repeats its id', () => {
    const doc =
      'first paragraph\n\n## A heading\n\nsecond\n\nthird\n\nfourth\n\n' +
      `fifth <!--ins ${IDS[0]}-->marked<!--/${IDS[0]}--> text\n\nlast\n\n` +
      `<!-- redlines\nversion: 1\nmarks:\n  ${IDS[0]}: {by: ada, at: 2026-10-31T09:30Z}\n-->\n`;
    for (const view of ['redlines', 'clean', 'simple'] as const) {
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, { doc, author, view });
      open.push(editor);
      forceParsing(editor.view, editor.view.state.doc.length, 10_000);
      editor.view.dispatch({ changes: { from: 5, insert: '<!-- unclosed ' } });
      expect(keptDisplay(editor.view.state), view).toEqual(freshDisplay(editor.view.state));
      editor.view.dispatch({
        changes: [
          { from: 0, insert: `<!--ins ${IDS[0]}-->x<!--/${IDS[0]}-->` },
          { from: 30, insert: `<!--ins ${IDS[0]}-->y<!--/${IDS[0]}-->` },
        ],
      });
      expect(keptDisplay(editor.view.state), view).toEqual(freshDisplay(editor.view.state));
    }
  });
});
