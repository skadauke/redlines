// @vitest-environment happy-dom
// What Return, typing and Backspace cost (design: block editing, "Cost"), measured against main's
// own build. The same file runs in a checkout of main (`REDLINES_COST=record` prints the numbers
// in the form `MAIN` below holds), where the keys are CodeMirror's own; here the keys are the block
// keys. Both go through `runScopeHandlers`, on 16 KB and 150 KB documents with 200 marks, in one
// process, Track Changes on and off. The recorded numbers are scaled by how fast this machine runs
// a fixed piece of work next to the one they were recorded on (`CALIBRATION`), and a key may take
// at most twice what main's takes (plus a millisecond for noise).
import { EditorSelection } from '@codemirror/state';
import { type EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { idFor, longDocument } from '../test-documents.ts';

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


import { appendFileSync } from 'node:fs';
const ROUNDS = 20;
const sp = (view: EditorView, key: string, shiftKey=false) => runScopeHandlers(view, new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }), 'editor');
it('t', () => {
  for (const bytes of [16000,150000]) {
    const doc = documentOf(bytes, 200);
    for (const tracking of [true,false]) {
      const parent = document.createElement('div'); document.body.append(parent);
      const editor = createEditor(parent, { doc, author: ada, tracking }); open.push(editor);
      const text = editor.view.state.doc.toString();
      const at = text.indexOf('more.', text.length >> 1) + 5;
      for (const mode of ['return','shift','type']) {
        const view = editor.view; const t=[];
        for (let r=0;r<2;r++){ const s = performance.now();
        for (let i=0;i<ROUNDS;i++){
          view.dispatch({ selection: EditorSelection.cursor(at) });
          if (mode==='return') sp(view,'Enter'); else if (mode==='shift') sp(view,'Enter',true);
          else view.dispatch({changes:{from:at,insert:'x'},selection:EditorSelection.cursor(at+1),userEvent:'input.type'});
          sp(view,'Backspace');
        }
        t.push((performance.now()-s)/ROUNDS);}
        appendFileSync('/private/tmp/claude-501/-Users-skadauke-code-redlines/16add5be-20c1-4634-b3f9-465d5df80b4f/scratchpad/cost.txt', bytes+' '+tracking+' '+mode+' '+t.map(x=>x.toFixed(1)).join(',')+'\n');
      }
    }
  }
}, 120000);
