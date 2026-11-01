// @vitest-environment happy-dom
import type { TextChange } from '@redlines/format';
import { afterEach, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '../index.ts';

// A format that writes the opener of a typed line break's text at the start of the new line,
// which a renderer would read as raw HTML (format §3.2). The editor must not write that.
vi.mock('@redlines/format', async (importOriginal) => {
  const format = await importOriginal<typeof import('@redlines/format')>();
  return {
    ...format,
    trackedEdit: (_text: string, edit: TextChange): TextChange[] => [
      { from: edit.from, to: edit.to, insert: '\n<!--ins q4gt-->x<!--/q4gt-->' },
    ],
  };
});

const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

it('refuses a tracked edit whose result starts a line with a marker', () => {
  const notices: string[] = [];
  const doc = 'One two.\n';
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada' },
    tracking: true,
    onNotice: (message) => notices.push(message),
  });
  open.push(editor);
  editor.view.dispatch({ selection: { anchor: 3 } });
  editor.view.dispatch(editor.view.state.replaceSelection('x'), { userEvent: 'input.type' });
  expect(editor.getDoc()).toBe(doc);
  expect(notices).toEqual(["Redlines can't make this change here yet."]);
});
