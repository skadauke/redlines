// @vitest-environment happy-dom
// A table's caption in a pandoc file is drawn as a caption, with its label and its attributes as a
// chip, and not as source (#1212).

import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { setViewModeEffect } from '../tracked/field.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const DOC = [
  'See @tbl-owners.',
  '',
  '| Milestone | Owner |',
  '|-----------|-------|',
  '| Review    | Ada   |',
  '',
  ': Who owns what {#tbl-owners}',
  '',
  ': Not a caption, no table beside it',
  '',
  'Last.',
  '',
].join('\n');

function editorOf(doc: string, dialect: 'gfm' | 'pandoc' = 'pandoc'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, dialect });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: 0 } });
  open.push(editor);
  return editor;
}

const text = (editor: Editor) => editor.view.contentDOM.textContent ?? '';

describe('a table caption', () => {
  it('is drawn as a caption, with its label and a chip, in each look', () => {
    const editor = editorOf(DOC);
    for (const mode of ['redlines', 'simple', 'clean'] as const) {
      editor.view.dispatch({ effects: setViewModeEffect.of(mode) });
      const caption = editor.view.contentDOM.querySelector('.rl-table-caption');
      expect(caption, mode).not.toBeNull();
      expect(caption?.querySelector('.rl-table-caption-label')?.textContent).toBe('Table 1: ');
      expect(caption?.querySelector('.rl-attr-chip')?.textContent).toBe('#tbl-owners');
      expect(caption?.textContent).not.toContain('{#tbl-owners}');
      expect(caption?.textContent).not.toMatch(/^:/);
    }
    // A colon line with no table beside it is text.
    expect(text(editor)).toContain(': Not a caption');
  });

  it('shows its source while the caret is on it', () => {
    const editor = editorOf(DOC);
    editor.view.dispatch({ selection: { anchor: DOC.indexOf('Who owns') + 2 } });
    expect(editor.view.contentDOM.querySelector('.rl-table-caption')?.textContent).toBe(
      ': Who owns what {#tbl-owners}',
    );
  });

  it('is text in a Markdown file', () => {
    const editor = editorOf(DOC, 'gfm');
    expect(editor.view.contentDOM.querySelector('.rl-table-caption')).toBeNull();
  });
});
