// @vitest-environment happy-dom
// An HTML heading drawn as a heading (#690): the line has the heading's size and the two tags are
// hidden unless the selection is inside one; the text between them is edited in place.

import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { previewDecorations } from './decorations.ts';

const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function editorAt(doc: string, cursor: number): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' } });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

function drawn(editor: Editor) {
  const lines: string[] = [];
  const hidden: string[] = [];
  const { state } = editor.view;
  previewDecorations(state).between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string };
    if (spec.class && /\brl-h[1-6]\b/.test(spec.class)) lines.push(spec.class);
    if (value.point && from < to) hidden.push(state.sliceDoc(from, to));
  });
  return { lines, hidden };
}

describe('an HTML heading', () => {
  const DOC = 'Intro.\n\n<h2>The title</h2>\n\nAfter.\n';

  it('takes the heading line and hides its tags with the caret in the text', () => {
    const editor = editorAt(DOC, DOC.indexOf('title'));
    const { lines, hidden } = drawn(editor);
    expect(lines.some((name) => name.includes('rl-h2'))).toBe(true);
    expect(hidden).toEqual(['<h2>', '</h2>']);
  });

  it('keeps the tags hidden with the caret at the edge of the text', () => {
    const editor = editorAt(DOC, DOC.indexOf('The title'));
    expect(drawn(editor).hidden).toEqual(['<h2>', '</h2>']);
  });

  it('shows the tag the selection is inside', () => {
    const editor = editorAt(DOC, DOC.indexOf('<h2>') + 2);
    expect(drawn(editor).hidden).toEqual(['</h2>']);
  });

  it('leaves other HTML and headings with attributes as they are', () => {
    for (const doc of ['<h2 align="center">T</h2>\n', '<div>T</div>\n', '<h2>a\nb</h2>\n']) {
      const editor = editorAt(doc, 1);
      expect(drawn(editor).lines, doc).toEqual([]);
    }
  });

  it('edits the text in place, tags untouched', () => {
    const editor = editorAt(DOC, DOC.indexOf('title'));
    editor.view.dispatch({ changes: { from: DOC.indexOf('title'), insert: 'new ' } });
    expect(editor.getDoc()).toBe(DOC.replace('title', 'new title'));
  });
});
