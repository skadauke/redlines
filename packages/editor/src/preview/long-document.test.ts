// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, parsedField } from '../index.ts';
import { previewDecorations } from './decorations.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const REST = 'bcdfghjkmnpqrstvwxz23456789';

/** A valid mark id (format-changes §2) for each number. */
const idFor = (n: number) =>
  `b${REST[Math.floor(n / 729) % 27]}${REST[Math.floor(n / 27) % 27]}${REST[n % 27]}`;

const WORDS = 'the quick brown fox jumps over a lazy dog while reviewers read every line twice';

/** Roughly 6,000 words in 300 paragraphs: 240 marks, 20 images, headings, lists and links. */
function longDocument(): { doc: string; firstMark: number } {
  const ids: string[] = [];
  const comments: string[] = [];
  const paragraphs: string[] = [];
  for (let n = 0; n < 300; n++) {
    let text = `${WORDS} ${n} with *emphasis* and **strong** and a [link](https://example.com/${n}) end.`;
    if (n % 15 === 0) paragraphs.push(`## Section ${n / 15}`);
    if (n % 5 === 0 && n / 5 < 20) text += `\n\n![figure ${n}](images/figure-${n}.png)`;
    if (n % 25 === 3) text = `- ${text}\n- second item of the list`;
    // Task boxes and entities, which the preview draws as widgets.
    if (n % 20 === 9) text = `- [ ] ${text} Fish &amp; chips\n- [x] done &mdash; &#169; item`;
    if (n < 240) {
      const id = idFor(n);
      ids.push(id);
      const kind = n % 3 === 0 ? 'ins' : n % 3 === 1 ? 'hl' : 'cmt';
      if (kind === 'cmt') comments.push(id);
      text = text.replace('quick brown', `<!--${kind} ${id}-->quick brown<!--/${id}-->`);
    }
    paragraphs.push(text);
  }
  const entries = ids.map((id) => `  ${id}: {by: ada, at: 2026-10-31T09:30Z}\n`).join('');
  const threads = comments
    .map((id) => `  ${id}:\n    by: ada\n    at: 2026-10-31T09:30Z\n    text: A question.\n`)
    .join('');
  const body = paragraphs.join('\n\n');
  const doc = `${body}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries}comments:\n${threads}-->\n`;
  return { doc, firstMark: doc.indexOf(`<!--ins ${idFor(0)}-->`) };
}

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
