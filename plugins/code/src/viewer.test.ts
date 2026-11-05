// @vitest-environment happy-dom
import { language } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileViewer, type FileViewer } from './viewer.ts';

const open: FileViewer[] = [];
afterEach(() => {
  for (const viewer of open.splice(0)) viewer.destroy();
  document.body.replaceChildren();
});

function show(file: { name: string; text: string | null; line?: number }) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const viewer = createFileViewer(parent, file);
  open.push(viewer);
  const dom = parent.querySelector<HTMLElement>('.cm-editor');
  return { parent, viewer, view: dom ? EditorView.findFromDOM(dom) : null };
}

describe('createFileViewer', () => {
  it('is read-only', () => {
    const { view } = show({ name: 'a.ts', text: 'const a = 1;\n' });
    expect(view!.state.readOnly).toBe(true);
    expect(view!.contentDOM.getAttribute('contenteditable')).toBe('false');
    expect(view!.state.doc.toString()).toBe('const a = 1;\n');
  });

  it('shows line numbers', () => {
    const { parent } = show({ name: 'a.txt', text: 'one\ntwo\n' });
    expect(parent.querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  it('opens at the line, and marks it', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const { view } = show({ name: 'a.txt', text, line: 30 });
    const marked = view!.contentDOM.querySelectorAll('.rl-viewer-line');
    expect([...marked].map((el) => el.textContent)).toEqual(['line 30']);
  });

  it('keeps a line past the end to the last line', () => {
    const { view } = show({ name: 'a.txt', text: 'one\ntwo', line: 99 });
    const marked = view!.contentDOM.querySelectorAll('.rl-viewer-line');
    expect([...marked].map((el) => el.textContent)).toEqual(['two']);
  });

  it('picks the language from the name', async () => {
    const { view, viewer } = show({ name: 'main.ts', text: 'const a: number = 1;\n' });
    await viewer.ready;
    expect(view!.state.facet(language)?.name).toBe('typescript');
  });

  it('leaves a file of unknown kind plain', async () => {
    const { view, viewer } = show({ name: 'notes.unknownext', text: 'hello\n' });
    await viewer.ready;
    expect(view!.state.facet(language)).toBeNull();
  });

  it('shows a message for a file that isn’t UTF-8 text', () => {
    const { parent, view } = show({ name: 'blob.txt', text: null });
    expect(view).toBeNull();
    expect(parent.textContent).toContain('isn’t UTF-8 text');
  });
});
