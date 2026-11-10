// @vitest-environment happy-dom
// What Return and Backspace cost (design: block editing, "Cost"): the block keys against main's
// keys, CodeMirror's Enter and Backspace through the same editor and tracked layer, on 16 KB and
// 150 KB documents with 200 marks, in one process. A key makes one block lookup and one format
// call, as typing does: the block keys may take at most twice what main's take.
import { deleteCharBackward, insertNewlineAndIndent } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { EditorSelection } from '@codemirror/state';
import { type EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { idFor } from '../test-documents.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const WORDS = 'the quick brown fox jumps over a lazy dog while reviewers read every line twice';

/** A document of about `bytes` bytes, with `marks` of Bo's marks spread over its paragraphs. */
function documentOf(bytes: number, marks: number): string {
  const paragraphs: string[] = [];
  for (let n = 0; paragraphs.join('\n\n').length < bytes; n++) {
    paragraphs.push(n % 12 === 0 ? `## Section ${n}` : `${WORDS} ${n}, with *emphasis* and more.`);
  }
  // Every word a mark can go on, spread evenly over the paragraphs: 200 of them.
  const slots: [number, string][] = [];
  paragraphs.forEach((text, p) => {
    for (const word of ['quick', 'lazy', 'reviewers']) {
      if (text.includes(` ${word} `)) slots.push([p, word]);
    }
  });
  const ids: string[] = [];
  for (let k = 0; k < marks; k++) {
    const [p, word] = slots[Math.floor((k * slots.length) / marks)]!;
    const id = idFor(k);
    ids.push(id);
    paragraphs[p] = paragraphs[p]!.replace(` ${word} `, ` <!--ins ${id}-->${word}<!--/${id}--> `);
  }
  const entries = ids.map((id) => `  ${id}: {by: bo, at: 2026-10-31T09:30Z}\n`).join('');
  return `${paragraphs.join('\n\n')}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries}-->\n`;
}

const press = (view: EditorView, key: string) =>
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, bubbles: true }), 'editor');

/** Main's keys: CodeMirror's Enter and Backspace, which the block keys replace. */
const mainKeys = {
  enter: (view: EditorView) => insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view),
  backspace: (view: EditorView) => deleteMarkupBackward(view) || deleteCharBackward(view),
};
const blockKeys = {
  enter: (view: EditorView) => press(view, 'Enter'),
  backspace: (view: EditorView) => press(view, 'Backspace'),
};

const ROUNDS = 8;

/** Milliseconds for `ROUNDS` of Return then Backspace at `at` (the middle or the end of a paragraph). */
function time(editor: Editor, at: number, keys: typeof mainKeys): number {
  const { view } = editor;
  const start = performance.now();
  for (let i = 0; i < ROUNDS; i++) {
    view.dispatch({ selection: EditorSelection.cursor(at) });
    keys.enter(view);
    keys.backspace(view);
  }
  return performance.now() - start;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

describe('the cost of Return and Backspace', () => {
  it.each([
    ['16 KB', 16_000],
    ['150 KB', 150_000],
  ] as const)(
    'costs at most twice what main’s keys cost, on %s with 200 marks',
    (size, bytes) => {
      const doc = documentOf(bytes, 200);
      expect((doc.match(/<!--ins /g) ?? []).length).toBe(200);
      for (const tracking of [true, false]) {
        // One editor for each set of keys, so that neither leaves the other a different text.
        const editors = [0, 1].map(() => {
          const parent = document.createElement('div');
          document.body.append(parent);
          const editor = createEditor(parent, { doc, author: ada, tracking });
          open.push(editor);
          return editor;
        });
        const [mainEditor, ourEditor] = editors as [Editor, Editor];
        const text = ourEditor.view.state.doc.toString();
        const middle = text.indexOf('brown fox', text.length >> 1) + 'brown '.length;
        const end = text.indexOf('more.', text.length >> 1) + 'more.'.length;
        for (const [where, at] of [
          ['middle', middle],
          ['end', end],
        ] as const) {
          // Once each first, to warm up; then alternating, the median of 5.
          time(mainEditor, at, mainKeys);
          time(ourEditor, at, blockKeys);
          const main: number[] = [];
          const ours: number[] = [];
          for (let i = 0; i < 5; i++) {
            main.push(time(mainEditor, at, mainKeys));
            ours.push(time(ourEditor, at, blockKeys));
          }
          expect(ourEditor.view.state.doc.toString(), 'Return then Backspace').toBe(text);
          const label = `${size}, Track Changes ${tracking ? 'on' : 'off'}, ${where}`;
          const [m, o] = [median(main) / ROUNDS, median(ours) / ROUNDS];
          console.log(
            `cost: ${label}: main ${m.toFixed(2)} ms, block keys ${o.toFixed(2)} ms per Return and Backspace`,
          );
          expect(o, label).toBeLessThan(2 * m + 1);
        }
      }
    },
    300_000,
  );
});
