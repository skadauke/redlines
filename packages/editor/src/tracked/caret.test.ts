// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';

// A path rather than a URL: under happy-dom, `URL` is the DOM's class, which node:fs rejects.
const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../format/src/fixtures/launch-plan.md'),
  'utf8',
);

const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' }, ...options });
  open.push(editor);
  return editor;
}

const head = (editor: Editor) => editor.view.state.selection.main.head;

function caret(editor: Editor, at: number): void {
  editor.view.dispatch({ selection: { anchor: at }, userEvent: 'select' });
}

const mac = /Mac/.test(navigator.platform);

/** Presses a key, with any of Shift, Alt and Ctrl before it, through the editor's keymaps. */
function press(editor: Editor, key: string): void {
  const parts = key.split('-');
  const name = parts.pop()!;
  const event = new KeyboardEvent('keydown', {
    key: name,
    shiftKey: parts.includes('Shift'),
    altKey: parts.includes('Alt'),
    ctrlKey: parts.includes('Ctrl'),
    bubbles: true,
    cancelable: true,
  });
  runScopeHandlers(editor.view, event, 'editor');
}

/** `the <!--ins k3x9-->new <!--/k3x9-->importer`: where the opener and its text start. */
const opener = fixture.indexOf('<!--ins k3x9-->');
const text = fixture.indexOf('new ');

describe('arrow keys', () => {
  it('one arrow press crosses a run of hidden markers', () => {
    const editor = load(fixture);
    // After "the ", before the opener.
    caret(editor, opener);
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(text + 1);
    press(editor, 'ArrowLeft');
    expect(head(editor)).toBe(text);
    // Past the opener and the space before it, in one press.
    press(editor, 'ArrowLeft');
    expect(head(editor)).toBe(opener - 1);
  });

  it('crosses the closer after inserted text', () => {
    const editor = load(fixture);
    const closer = fixture.indexOf('<!--/k3x9-->');
    caret(editor, closer);
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(closer + '<!--/k3x9-->'.length + 1);
    press(editor, 'ArrowLeft');
    press(editor, 'ArrowLeft');
    expect(head(editor)).toBe(closer - 1);
  });

  it('stops after deleted text, which takes a press of its own', () => {
    const editor = load(fixture);
    caret(editor, fixture.indexOf('<!--sub p7qd'));
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(fixture.indexOf('April'));
  });

  it('extends a selection across hidden markers', () => {
    const editor = load(fixture);
    caret(editor, opener);
    press(editor, 'Shift-ArrowRight');
    expect(editor.view.state.selection.main).toMatchObject({ anchor: opener, head: text + 1 });
  });

  it('moves by word across hidden markers', () => {
    const editor = load(fixture);
    caret(editor, opener);
    press(editor, mac ? 'Alt-ArrowRight' : 'Ctrl-ArrowRight');
    expect(head(editor)).toBe(text + 'new'.length);
  });

  it('moves over every character of the source in Raw', () => {
    const editor = load(fixture, { view: 'raw' });
    caret(editor, opener);
    press(editor, 'ArrowRight');
    expect(head(editor)).toBe(opener + 1);
  });
});
