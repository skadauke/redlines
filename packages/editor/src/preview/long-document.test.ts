// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, parsedField } from '../index.ts';
import { idFor, longDocument } from '../test-documents.ts';
import { previewDecorations } from './decorations.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

function time(fn: () => void, runs = 15): number {
  fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

function editorFor(doc: string, resolveImage?: (src: string) => string | null): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, resolveImage });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  open.push(editor);
  return editor;
}

// The budget for one update is a frame, 16 ms; doubled here for CI's slower machines. Measured
// on a development Mac it takes about 2 ms, with the parse a few ms more in the first read of a
// document and not at all in the update (the ledger is not read again, see `parsedField`).
const BUDGET_MS = 32;

describe('a long document', () => {
  const { doc, firstMark } = longDocument();
  const afterMark = firstMark + `<!--ins ${idFor(0)}-->quick brown<!--/${idFor(0)}-->`.length;
  const mid = Math.floor(doc.length / 2);

  function loaded() {
    const editor = editorFor(doc, (src) => `asset://${src}`);
    return editor.view.state;
  }

  it('is the size the budget is measured for', () => {
    const state = loaded();
    expect(doc.split(/\s+/).length).toBeGreaterThanOrEqual(5000);
    expect(state.field(parsedField).marks.length).toBeGreaterThanOrEqual(200);
    let images = 0;
    previewDecorations(state).between(0, state.doc.length, (from, _to, value) => {
      if ((value.spec as { widget?: unknown }).widget && state.sliceDoc(from, from + 2) === '![') {
        images++;
      }
    });
    expect(images).toBe(20);
    let boxes = 0;
    let entities = 0;
    previewDecorations(state).between(0, state.doc.length, (from, _to, value) => {
      if (!(value.spec as { widget?: unknown }).widget) return;
      if (/^[-*+] \[[ x]\] /.test(state.sliceDoc(from, from + 6))) boxes++;
      else if (state.sliceDoc(from, from + 1) === '&') entities++;
    });
    expect(boxes).toBe(30);
    expect(entities).toBe(45);
  });

  it('updates decorations for one keystroke in under 16 ms on the long document', () => {
    const state = loaded();
    const keystroke = time(() => state.update({ changes: { from: mid, insert: 'x' } }).state);
    const afterAMark = time(
      () => state.update({ changes: { from: afterMark, insert: 'x' } }).state,
    );
    expect(keystroke).toBeLessThan(BUDGET_MS);
    expect(afterAMark).toBeLessThan(BUDGET_MS);
  });

  it('updates decorations for a caret move in under 16 ms on the long document', () => {
    const state = loaded();
    expect(time(() => state.update({ selection: { anchor: mid } }).state)).toBeLessThan(BUDGET_MS);
  });
});
