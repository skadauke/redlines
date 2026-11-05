// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { createFormatting } from './index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const mounted: { editor: Editor; remove: () => void }[] = [];

afterEach(() => {
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

function mount(doc: string, tracking: boolean): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, tracking });
  const remove = createFormatting(editor, { author, notice: () => {} });
  mounted.push({ editor, remove });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
  return editor;
}

function click(editor: Editor, index: number): void {
  const box = editor.view.dom.querySelectorAll('.rl-box')[index];
  box?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
}

const DOC = '- [ ] Buy milk\n- [x] Call Ada\n\nEnd.\n';

describe('task boxes', () => {
  it('clicking writes +check with tracking on and edits the bracket with it off', () => {
    const on = mount(DOC, true);
    click(on, 0);
    expect(on.getDoc()).toMatch(/^- \[x\] Buy milk<!--fmt \w+ \+check-->\n- \[x\] Call Ada\n/);

    const off = mount(DOC, false);
    click(off, 0);
    expect(off.getDoc()).toBe('- [x] Buy milk\n- [x] Call Ada\n\nEnd.\n');
    click(off, 1);
    expect(off.getDoc()).toBe('- [x] Buy milk\n- [ ] Call Ada\n\nEnd.\n');
  });

  it('rejecting +check restores the bytes', () => {
    const editor = mount(DOC, true);
    click(editor, 0);
    const id = /<!--fmt (\w+) \+check-->/.exec(editor.getDoc())?.[1];
    expect(id).toBeTruthy();
    editor.reject(id ?? '');
    expect(editor.getDoc()).toBe(DOC);
  });

  it('does nothing without the plugin', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: DOC, author, tracking: false });
    forceParsing(editor.view, DOC.length, 5000);
    editor.view.dispatch({ selection: { anchor: DOC.length } });
    mounted.push({ editor, remove: () => {} });
    click(editor, 0);
    expect(editor.getDoc()).toBe(DOC);
  });
});
