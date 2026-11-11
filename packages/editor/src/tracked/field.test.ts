// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorOptions, type EditorUiState } from '../index.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, ...options });
  open.push(editor);
  return editor;
}

const plain = '# Plain\n\nNo marks.\n';
const marked =
  'We ship in <!--ins b2b2-->April<!--/b2b2-->.\n\n<!-- redlines\nversion: 1\nmarks:\n  b2b2: {by: ada, at: 2026-10-31T09:30Z}\n-->\n';

describe('the markup view', () => {
  it.each(['simple', 'redlines'] as const)('opens a document with redlines in %s', (markupView) => {
    const editor = load(marked, { markupView });
    expect(editor.getUiState()).toMatchObject({ view: markupView, markupView });
  });

  it('is Redlines when the host gives none', () => {
    expect(load(marked).getUiState().markupView).toBe('redlines');
  });

  it.each(['simple', 'redlines'] as const)(
    'switches a Clean document that gains redlines to %s',
    (markupView) => {
      const editor = load(plain, { markupView });
      expect(editor.getUiState().view).toBe('clean');
      editor.reloadDoc(marked);
      expect(editor.getUiState().view).toBe(markupView);
    },
  );

  it('keeps the markup view across setDoc', () => {
    const editor = load(marked);
    editor.setViewMode('simple');
    editor.setDoc(plain);
    expect(editor.getUiState()).toMatchObject({ view: 'clean', markupView: 'simple' });
    editor.reloadDoc(marked);
    expect(editor.getUiState().view).toBe('simple');
    editor.setDoc(marked);
    expect(editor.getUiState().view).toBe('simple');
  });

  it('makes Simple or Redlines, when chosen, the markup view and reports it', () => {
    const reports: EditorUiState[] = [];
    const editor = load(marked, { onUiState: (state) => reports.push(state) });
    editor.setViewMode('simple');
    expect(editor.getUiState()).toMatchObject({ view: 'simple', markupView: 'simple' });
    expect(reports.at(-1)).toMatchObject({ view: 'simple', markupView: 'simple' });
    editor.setViewMode('clean');
    editor.setViewMode('redlines');
    expect(reports.at(-1)).toMatchObject({ view: 'redlines', markupView: 'redlines' });
  });

  it('setMarkupView changes what an automatic switch shows, never the view shown', () => {
    const editor = load(plain);
    editor.setMarkupView('simple');
    expect(editor.getUiState()).toMatchObject({ view: 'clean', markupView: 'simple' });
    editor.reloadDoc(marked);
    expect(editor.getUiState().view).toBe('simple');
    editor.setViewMode('redlines');
    editor.setMarkupView('simple');
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'simple' });
  });

  it('does not change the markup view when Clean or Raw is chosen', () => {
    const editor = load(marked, { markupView: 'simple' });
    editor.setViewMode('clean');
    expect(editor.getUiState().markupView).toBe('simple');
    editor.setViewMode('raw');
    expect(editor.getUiState().markupView).toBe('simple');
  });
});
