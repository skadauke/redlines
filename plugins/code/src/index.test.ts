// @vitest-environment happy-dom
import { ensureSyntaxTree } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { codeHighlight, codeLanguages, codeStyle } from './index.ts';
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

/** The text of each span the code style colors. */
function colored(editor: Editor): string[] {
  const { state } = editor.view;
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000)!;
  const found: string[] = [];
  highlightTree(tree, codeStyle, (from, to, classes) => {
    if (classes) found.push(state.doc.sliceString(from, to));
  });
  return found;
}

const TS = '```ts\nconst answer: number = 42; // yes\n```\n';

describe('code blocks', () => {
  it('colors a fenced TypeScript block once its language loads', async () => {
    await loadCodeLanguage('ts');
    const spans = colored(editorWith(TS));
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

  it('keeps hidden markers working around a code block', async () => {
    await loadCodeLanguage('ts');
    const doc = `**bold** and\n\n${TS}\nafter *it*\n`;
    // The caret is at the end: the fences and the emphasis marks are hidden.
    const editor = editorWith(doc, doc.length - 1);
    expect(editor.view.contentDOM.querySelectorAll('.rl-syntax').length).toBeGreaterThan(0);
    // The fenced lines are still drawn as one code block.
    expect(editor.view.contentDOM.querySelectorAll('.rl-codeblock').length).toBe(3);
    expect(editor.getDoc()).toBe(doc);
  });
});
