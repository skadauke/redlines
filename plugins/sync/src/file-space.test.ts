// @vitest-environment happy-dom
// Changes of the file's text made in a window's document (src/file-space.ts), including the ones
// that touch half of a CRLF, which the document, with one LF there, can't make as they are. A
// change of a break's kind alone leaves the record as it was: the binding loads the file again.

import { createEditor } from '@redlines/editor';
import type { Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { between, fileOf, intoDoc } from './file-space.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function editorOn(doc: string): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' } });
  open.push(editor);
  return editor;
}

/** The file's text after `to` is made in the editor as a change of its file. */
function made(from: string, to: string): string {
  const editor = editorOn(from);
  const change = between(from, to);
  if (change) editor.view.dispatch({ ...intoDoc(editor.view.state, change), filter: false });
  return fileOf(editor.view.state);
}

describe('changes of the file made in the document', () => {
  it.each([
    ['takes out a CRLF', 'x\r\ny', 'xy'],
    ['brings an LF after a CR', 'x\r\ny\r\n', 'x\r\n\ny\r\n'],
    ['types between two lines', 'x\r\n\r\ny\r\n', 'x\r\nTEXT\r\n\r\ny\r\n'],
  ])('%s', (_name, from, to) => {
    expect(made(from, to)).toBe(to);
  });
});
