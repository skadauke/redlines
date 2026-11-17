// @vitest-environment happy-dom
// The own-line marker layer costs time linear in the marker blocks (#1025, from #20): a block whose
// opening marker is alone on its line (`<!--ins id-->`, a blank line, the text and the closing
// marker) used to scan every block before it, 190 ms at 4,000. The timing tests run with
// REDLINES_COST=check, as the other cost tests do, since a busy machine can't time them: the bounds
// are ratios between two sizes of the same document, which follow the machine.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, parsedField } from '../index.ts';
import { trackedStats } from '../tracked/decorations.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const L = 'bcdfghjkmnpqrstvwxz';
const idOf = (i: number) =>
  `b${L[Math.floor(i / 361) % 19]}${L[Math.floor(i / 19) % 19]}${L[i % 19]}`;

/** A document of `count` blocks, each inserted by Ada with its opening marker on a line of its own. */
function documentOf(count: number): string {
  const ids = Array.from({ length: count }, (_, i) => idOf(i));
  const blocks = ids.map(
    (id, i) => `<!--ins ${id}-->\n\nParagraph ${i} of the new text.<!--/${id}-->`,
  );
  const marks = ids.map((id) => `  ${id}: {by: ada, at: 2026-10-13T22:30Z}`);
  const ledger = [
    '<!-- redlines',
    'version: 1',
    'people:',
    '  ada: {name: Ada Lovelace}',
    'marks:',
    ...marks,
    '-->',
  ];
  return `${blocks.join('\n\n')}\n\n${ledger.join('\n')}\n`;
}

function editorFor(doc: string): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, view: 'redlines' });
  forceParsing(editor.view, editor.view.state.doc.length, 60_000);
  open.push(editor);
  return editor;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

function time(fn: () => void, runs: number): number {
  fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

/** The fastest of `runs`: what a busy machine adds is never negative, so the minimum is the cost. */
function best(fn: () => void, runs: number): number {
  fn();
  let fastest = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

const timed = it.skipIf(!process.env['REDLINES_COST']);

describe('a document of 4,000 own-line marker blocks', () => {
  it('has the marks it is measured for', () => {
    const state = editorFor(documentOf(4_000)).view.state;
    expect(state.field(parsedField).marks.length).toBe(4_000);
  });

  timed('opens in time linear in the blocks: 4,000 take at most 8 times what 1,000 take', () => {
    editorFor(documentOf(500)); // warm up
    const small = time(() => editorFor(documentOf(1_000)).destroy(), 3);
    const large = time(() => editorFor(documentOf(4_000)).destroy(), 3);
    expect(large).toBeLessThan(small * 8);
  });

  timed('updates its decorations for a caret move and a keystroke in bounded time', () => {
    const small = editorFor(documentOf(1_000)).view.state;
    const large = editorFor(documentOf(4_000)).view.state;
    const at = (state: typeof small) => state.doc.line(Math.floor(state.doc.lines / 2)).to;
    const keystroke = (state: typeof small) => () =>
      state.update({ changes: { from: at(state), insert: 'x' } }).state;
    const caret = (state: typeof small) => () =>
      state.update({ selection: { anchor: at(state) } }).state;
    // A caret move costs next to nothing, at any size.
    expect(time(caret(large), 15)).toBeLessThan(time(caret(small), 15) * 8 + 1);
    // A keystroke draws again only the window of the blocks it touches (`tracked/windows.ts`), where
    // it once drew the whole layer: about 40 ms at 4,000 blocks against 12 ms at 1,000. What still
    // grows is the parse and the incremental tree, about 3 times for 4 times the blocks. Timing
    // can't tell the two apart well on a busy machine, so this holds the growth to linear (8 times)
    // and the next test holds the window itself, which doesn't depend on the clock.
    expect(best(keystroke(large), 15)).toBeLessThan(best(keystroke(small), 15) * 8 + 5);
  });

  it('draws only the window of the blocks a keystroke touches, never the whole text', () => {
    const { view } = editorFor(documentOf(4_000));
    const at = view.state.doc.line(Math.floor(view.state.doc.lines / 2)).to;
    trackedStats.windowed = trackedStats.whole = 0;
    view.dispatch({ changes: { from: at, insert: 'x' } });
    view.dispatch({ changes: { from: at + 1, insert: 'y' } });
    expect(trackedStats.whole).toBe(0);
    expect(trackedStats.windowed).toBe(2);
  });
});
