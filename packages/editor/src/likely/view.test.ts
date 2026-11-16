// @vitest-environment happy-dom
import { markdown } from '@codemirror/lang-markdown';
import { Language, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { likelyParsing } from './parse.ts';

const text = Array.from(
  { length: 12000 },
  (_, i) => `${i % 50 === 0 ? '## ' : ''}para ${i} with *words* and a [link](x${i}) here`,
).join('\n\n');

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function viewOf(restMs = 60): EditorView {
  const support = markdown({ extensions: [GFM] });
  const state = EditorState.create({
    doc: text,
    extensions: [support, likelyParsing(support.language.parser, restMs)],
  });
  const view = new EditorView({ state, parent: document.body });
  views.push(view);
  return view;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the tree has styled nodes (an emphasis) between `from` and `to`. */
function styled(tree: Tree, from: number, to: number): boolean {
  let found = false;
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name === 'Emphasis') found = true;
    },
  });
  return found;
}

async function jumpTo(view: EditorView, pos: number): Promise<void> {
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
  await wait(20);
}

describe('a far jump in a view', () => {
  it('draws the viewport from a likely parse within a moment', async () => {
    expect(text.length).toBeGreaterThan(300_000);
    const view = viewOf(60_000);
    await jumpTo(view, Math.floor(text.length / 2));
    const { from, to } = view.viewport;
    expect(from).toBeGreaterThan(100_000);
    // Before CodeMirror's own worker would start (it waits 100 to 500 ms).
    await wait(30);
    expect(styled(syntaxTree(view.state), from, to)).toBe(true);
    // Nothing before it is parsed.
    expect(styled(syntaxTree(view.state), 0, 2000)).toBe(false);
  });

  it('parses the exact tree again from the start once the viewport has rested', async () => {
    const view = viewOf(100);
    await jumpTo(view, Math.floor(text.length / 2));
    const { from, to } = view.viewport;
    await wait(30);
    expect(styled(syntaxTree(view.state), 0, 2000)).toBe(false);
    // The pause of CodeMirror's worker, and the parse in its slices.
    await wait(4000);
    const cxx = (view.state.field((Language as any).state) as any).context;
    console.log(
      'DBG',
      JSON.stringify(cxx.skipped),
      cxx.treeLen,
      !!cxx.parse,
      cxx.parse?.parsedPos,
      syntaxTree(view.state).length,
    );
    expect(styled(syntaxTree(view.state), 0, 2000)).toBe(true);
    expect(styled(syntaxTree(view.state), from, to)).toBe(true);
  }, 10_000);

  it('is exact at the end, and a scroll up from it draws too', async () => {
    const view = viewOf(60_000);
    await jumpTo(view, text.length);
    await wait(30);
    const { from, to } = view.viewport;
    expect(from).toBeGreaterThan(text.length - 5000);
    expect(styled(syntaxTree(view.state), from, to)).toBe(true);
    const up = Math.floor(text.length * 0.6);
    await jumpTo(view, up);
    await wait(30);
    expect(styled(syntaxTree(view.state), view.viewport.from, view.viewport.to)).toBe(true);
    // And to the top.
    await jumpTo(view, 0);
    await wait(700);
    expect(styled(syntaxTree(view.state), 0, view.viewport.to)).toBe(true);
  });
});
