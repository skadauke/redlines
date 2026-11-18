// @vitest-environment happy-dom
// What a block move (⌥↑, ⌥↓) costs (#1062): the move reads the file for the run, writes the move,
// and reads the file again for the new selection, and each read is the size of the file. Measured in
// a document of 2,000 blocks with 200 pending changes, against a plain key typed in the same
// document, which is what an edit costs there. The timing tests run with REDLINES_COST=check, as
// the other cost tests do, since a busy machine can't time them: the bounds are ratios. A move is
// the format's own work (the widened write checks its replacement by reading and deciding it), which
// a CI runner does 2.5 times slower than this machine, where a key is 1.6 times slower: the same move
// stood at 13 keys here and 21.6 there (a push run of main, #1114), so the bound is 24.
import { forceParsing } from '@codemirror/language';
import { parseStats } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, moveBlocks, parsedField } from '../index.ts';
import { idFor } from '../test-documents.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const WORDS = 'the quick brown fox jumps over a lazy dog while reviewers read every line twice';

/** `blocks` paragraphs, with `marks` of Bo's insertions spread over them. */
function documentOf(blocks: number, marks: number): string {
  const paragraphs = Array.from({ length: blocks }, (_, n) =>
    n % 12 === 0 ? `## Section ${n}` : `${WORDS} ${n}, with *emphasis* and more.`,
  );
  const ids: string[] = [];
  for (let k = 0; k < marks; k++) {
    const p = Math.floor(((k + 0.5) * blocks) / marks);
    if (!paragraphs[p]!.includes(' quick ')) continue;
    const id = idFor(k);
    ids.push(id);
    paragraphs[p] = paragraphs[p]!.replace(' quick ', ` <!--ins ${id}-->quick<!--/${id}--> `);
  }
  const entries = ids.map((id) => `  ${id}: {by: bo, at: 2026-10-31T09:30Z}\n`).join('');
  return `${paragraphs.join('\n\n')}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries}-->\n`;
}

function editorFor(doc: string, caret: number): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, tracking: true });
  forceParsing(editor.view, editor.view.state.doc.length, 60_000);
  editor.view.dispatch({ selection: { anchor: caret } });
  open.push(editor);
  return editor;
}

const best = (fn: () => void, runs: number): number => {
  fn();
  let fastest = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
};

const timed = it.skipIf(!process.env['REDLINES_COST']);

describe('a block move in 2,000 blocks with 200 pending changes', () => {
  const doc = documentOf(2_000, 200);
  const caret = doc.indexOf('Section 1000') + 3;

  it('has the changes it is measured for', () => {
    const editor = editorFor(doc, caret);
    expect(editor.view.state.field(parsedField).marks.length).toBeGreaterThanOrEqual(150);
  });

  it('reads the texts of the file in full at most 8 times (it was 54 reads, 20 of the same text)', () => {
    const editor = editorFor(doc, caret);
    moveBlocks(editor.view, false);
    parseStats.long = 0;
    moveBlocks(editor.view, true);
    expect(parseStats.long).toBeLessThanOrEqual(8);
  });

  timed(
    'costs at most 24 times a plain key typed in the same document (13 where it is measured, 21 on CI)',
    () => {
      const editor = editorFor(doc, caret);
      const { view } = editor;
      const key = () => {
        // At the caret, which a move keeps in its block, since the turns alternate with moves.
        const at = view.state.selection.main.head;
        view.dispatch({ changes: { from: at, insert: 'x' }, selection: { anchor: at + 1 } });
      };
      let down = true;
      // A letter at the top before each move, so that each is made on a text no memo has seen (the
      // first move after an edit is the one that happens); the caret keeps its block.
      const move = () => {
        view.dispatch({ changes: { from: 0, insert: 'y' } });
        moveBlocks(view, down);
        down = !down;
      };
      // The move and its yardstick take turns (#432): the median of five turns, each the best of a
      // few runs of both, so that a runner slowed for a few seconds slows both and not the ratio.
      const plain: number[] = [];
      const moved: number[] = [];
      for (let turn = 0; turn < 5; turn++) {
        plain.push(best(key, 5));
        moved.push(best(move, 5));
      }
      const middle = (xs: number[]) => [...xs].sort((x, y) => x - y)[xs.length >> 1]!;
      console.log(`MOVE plain ${middle(plain).toFixed(2)} moved ${middle(moved).toFixed(2)}`);
      expect(middle(moved)).toBeLessThan(middle(plain) * 24 + 5);
    },
    // Twenty-five moves at about 115 ms each on a CI runner, with their keys: more than the 5 s default.
    60_000,
  );
});
