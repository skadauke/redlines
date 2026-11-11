// @vitest-environment happy-dom
// The empty line Shift-Return opens at a block's end: what the page can be asked of it that a
// keystroke script can't say (the view it holds, an input method's text, the file the host is
// given). The rows of the Shift-Return table are `shift-return.test.ts`.
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { editSourceFacet } from '../tracked/typing.ts';
import { openBlock, textWithoutOpen } from './open.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const mounted: Editor[] = [];

afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, tracking: boolean, changes: string[] = []): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  let n = 0;
  const editor = createEditor(parent, {
    doc,
    author: ada,
    tracking,
    onChange: (text) => changes.push(text),
    extensions: [
      editSourceFacet.of({
        now: () => new Date('2026-11-01T10:00Z'),
        random: (k) => Uint8Array.from({ length: k }, () => n++ % 19),
      }),
    ],
  });
  mounted.push(editor);
  editor.view.dispatch({ selection: { anchor: doc.indexOf('.') + 1 } });
  return editor;
}

function press(editor: Editor, key: string, shiftKey = false): void {
  runScopeHandlers(
    editor.view,
    new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    'editor',
  );
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('the empty line Shift-Return opens', () => {
  it('is open, and the file does not have it', () => {
    for (const tracking of [false, true]) {
      const editor = mount('One two.\n\nNext.', tracking);
      press(editor, 'Enter', true);
      expect(openBlock(editor.view.state)?.line).toBe(true);
      expect(editor.view.state.doc.toString()).toContain('\\\n ');
      expect(textWithoutOpen(editor.view.state)).toBe('One two.\n\nNext.');
    }
  });

  it('holds the switch to Redlines until the first character, which makes it', () => {
    const editor = mount('One two.\n\nNext.', true);
    expect(editor.getUiState().view).toBe('clean');
    press(editor, 'Enter', true);
    expect(editor.getUiState().view).toBe('clean');
    editor.view.dispatch(editor.view.state.replaceSelection('X'), { userEvent: 'input.type' });
    expect(editor.getUiState().view).toBe('redlines');
    expect(editor.view.state.doc.toString()).toContain('\\\nX');
    expect(editor.view.state.doc.toString()).not.toContain(' ');
  });

  it('is never given to the host: the text it is told of is the file', () => {
    const changes: string[] = [];
    const editor = mount('One two.\n\nNext.', false, changes);
    press(editor, 'Enter', true);
    expect(editor.getDoc()).toBe('One two.\n\nNext.');
    expect(changes.every((text) => !text.includes(' '))).toBe(true);
  });

  it('is replaced by the text an input method composes, when the composition ends', async () => {
    for (const tracking of [false, true]) {
      const editor = mount('One two.\n\nNext.', tracking);
      press(editor, 'Enter', true);
      const at = editor.view.state.selection.main.head;
      (editor.view as unknown as { inputState: { composing: number } }).inputState.composing = 1;
      editor.view.dispatch({
        changes: { from: at, insert: '¨' },
        selection: { anchor: at + 1 },
        userEvent: 'input.type.compose.start',
      });
      editor.view.dispatch({
        changes: { from: at, to: at + 1, insert: 'ö' },
        selection: { anchor: at + 1 },
        userEvent: 'input.type.compose',
      });
      (editor.view as unknown as { inputState: { composing: number } }).inputState.composing = -1;
      editor.view.contentDOM.dispatchEvent(new Event('compositionend', { bubbles: true }));
      await tick();
      const text = editor.view.state.doc.toString();
      expect(text).toContain('\\\nö');
      expect(text).not.toContain(' ');
      if (tracking) expect(editor.getUiState().view).toBe('redlines');
    }
  });

  it('is taken back by Backspace with the caret on either side of the space', () => {
    for (const tracking of [false, true]) {
      for (const how of ['before', 'after'] as const) {
        const editor = mount('One two.\n\nNext.', tracking);
        press(editor, 'Enter', true);
        const line = editor.view.state.doc.lineAt(editor.view.state.selection.main.head);
        if (how === 'after') {
          const end = line.text.indexOf('\u00a0') + 1 + line.from;
          editor.view.dispatch({ selection: { anchor: end } });
        }
        const label = `${how}, tracking ${tracking}`;
        press(editor, 'Backspace');
        expect(textWithoutOpen(editor.view.state), label).toBe('One two.\n\nNext.');
        expect(openBlock(editor.view.state), label).toBeNull();
        expect(editor.view.state.doc.toString().includes('\u00a0'), label).toBe(false);
        expect(editor.view.state.doc.lines, label).toBeLessThan(5);
      }
    }
  });

  it('stays open when the same file is loaded again, as an agent echo of it does', () => {
    // The WebKit block check loads each check's document over the last one's: with the empty
    // paragraph of the check before still open, the same text left it open (`throughOpen`).
    const editor = mount('One two.\n\nNext.', false);
    press(editor, 'Enter');
    editor.reloadDoc('One two.\n\nNext.');
    expect(openBlock(editor.view.state)).not.toBeNull();
    editor.reloadDoc('');
    editor.reloadDoc('One two.\n\nNext.');
    expect(openBlock(editor.view.state)).toBeNull();
    expect(editor.view.state.doc.toString()).toBe('One two.\n\nNext.');
  });
});
