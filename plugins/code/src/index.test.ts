// @vitest-environment happy-dom
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { codeHighlight, codeLanguages, codeSpans } from './index.ts';
import { loadCodeLanguage } from './highlight.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function editorWith(doc: string, cursor = 0): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, codeLanguages, extensions: [codeHighlight] });
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

/** The text of each stretch the code colors reach, in the whole document. */
function colored(editor: Editor): string[] {
  const { state } = editor.view;
  ensureSyntaxTree(state, state.doc.length, 10_000);
  return codeSpans(state, 0, state.doc.length).map((span) =>
    state.doc.sliceString(span.from, span.to),
  );
}

/**
 * Waits until the fenced block at `at` (a position inside its code) is parsed as its own language,
 * not as plain fence text. That is what the colors need, and it can come after the language has
 * loaded: the Markdown parser reparses the block when the load resolves. The wait is for the tree,
 * not for the clock; a block that never parses fails with the test's own timeout.
 */
async function parsedAs(editor: Editor, at: number): Promise<void> {
  for (;;) {
    const { state } = editor.view;
    ensureSyntaxTree(state, state.doc.length, 10_000);
    const name = syntaxTree(editor.view.state).resolveInner(at, 1).name;
    // Until the language loads, the block holds an empty placeholder tree with no name.
    if (name !== '' && name !== 'CodeText' && name !== 'FencedCode' && name !== 'Document') return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const TS = '```ts\nconst answer: number = 42; // yes\n```\n';

describe('code blocks', () => {
  // The first load imports the TypeScript grammar, which can take longer than the default 5 s on a
  // busy machine; the load is awaited here once, with room, so no test races it.
  beforeAll(() => loadCodeLanguage('ts'), 60_000);

  it('colors a fenced TypeScript block once its language loads', async () => {
    const editor = editorWith(TS);
    await parsedAs(editor, 10);
    const spans = colored(editor);
    expect(spans).toContain('const');
    expect(spans).toContain('42');
    expect(spans).toContain('// yes');
  });

  it('leaves a block with an unknown language plain', () => {
    const editor = editorWith('```nosuchlang\nconst a = 1;\n```\n');
    expect(codeLanguages('nosuchlang')).toBeNull();
    expect(colored(editor)).toEqual([]);
  });

  it('leaves a block with no language plain', () => {
    expect(codeLanguages('')).toBeNull();
    expect(colored(editorWith('```\nconst a = 1;\n```\n'))).toEqual([]);
  });

  it('colors a block whose language loads after the editor opened, without an edit', async () => {
    const doc = '```json\n{"a": 12}\n```\n';
    const editor = editorWith(doc);
    expect(colored(editor)).toEqual([]);
    await loadCodeLanguage('json');
    await parsedAs(editor, 12);
    // The plugin redraws on the new tree: the colors are in the page, not only in the tree.
    expect(colored(editor)).toContain('12');
    const drawn = [...editor.view.contentDOM.querySelectorAll('span[class]')].map(
      (el) => el.textContent,
    );
    expect(drawn).toContain('12');
  });

  it('leaves the Markdown comments that hold marks to the editor', async () => {
    const doc = 'a <!--cmt c8d2-->b<!--/cmt c8d2--> and <!-- mine -->\n\n<!--ins x1-->\n\n' + TS;
    const editor = editorWith(doc);
    await parsedAs(editor, doc.length - 10);
    const spans = colored(editor);
    expect(spans.filter((span) => span.includes('<!--'))).toEqual([]);
    // The code's own comment still is one.
    expect(spans).toContain('// yes');
  });

  it('colors a Markdown comment shown while the caret is in it as before: not at all', () => {
    expect(colored(editorWith('a <!--cmt c8d2-->b<!--/cmt c8d2-->\n', 4))).toEqual([]);
  });

  it('keeps hidden markers working around a code block', () => {
    const doc = `**bold** and\n\n${TS}\nafter *it*\n`;
    // The caret is at the end: the fences and the emphasis marks are hidden.
    const editor = editorWith(doc, doc.length - 1);
    expect(editor.view.contentDOM.querySelectorAll('.rl-syntax').length).toBeGreaterThan(0);
    // The fenced lines are still drawn as one code block.
    expect(editor.view.contentDOM.querySelectorAll('.rl-codeblock').length).toBe(3);
    expect(editor.getDoc()).toBe(doc);
  });
});
