// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEditor,
  type Editor,
  type EditorOptions,
  type EditorUiState,
  menuViewOf,
  setViewModeEffect,
} from '../index.ts';

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

// Simple is Redlines' simple look, not a view of its own (#303): a View menu lists Clean, Redlines
// and Raw, and only a click on a change bar switches the two looks.
describe('the views a View menu lists', () => {
  it('names Simple as Redlines, since it is a look of Redlines', () => {
    expect((['clean', 'simple', 'redlines', 'raw'] as const).map(menuViewOf)).toEqual([
      'clean',
      'redlines',
      'redlines',
      'raw',
    ]);
  });

  it('shows Redlines in the look that a click on a change bar chose last', () => {
    const editor = load(marked, { markupView: 'simple' });
    expect(editor.getUiState().view).toBe('simple');
    for (const away of ['clean', 'raw'] as const) {
      editor.showView(away);
      expect(editor.getUiState().view).toBe(away);
      editor.showView('redlines');
      expect(editor.getUiState()).toMatchObject({ view: 'simple', markupView: 'simple' });
    }
    // The full markup, once a click chose it, is the look that comes back.
    editor.setViewMode('redlines');
    editor.showView('clean');
    editor.showView('redlines');
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'redlines' });
  });

  it('leaves Redlines as it is, in either look, when Redlines is shown already', () => {
    const editor = load(marked, { markupView: 'simple' });
    editor.showView('redlines');
    expect(editor.getUiState().view).toBe('simple');
    // The review bar shows the full markup without choosing it: the simple look stays the one
    // remembered, and choosing Redlines in the menu doesn't take it back to the simple look.
    editor.view.dispatch({ effects: setViewModeEffect.of('redlines') });
    editor.showView('redlines');
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'simple' });
  });

  it('brings back the look that was shown last, so that a trip through Clean or Raw comes back', () => {
    const editor = load(marked, { markupView: 'simple' });
    // The review bar shows the full markup without choosing it: the simple look stays the one
    // chosen, and what was shown is what comes back.
    editor.view.dispatch({ effects: setViewModeEffect.of('redlines') });
    editor.showView('clean');
    editor.showView('redlines');
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'simple' });
    editor.showView('raw');
    editor.showView('redlines');
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'simple' });
    // A click on a change bar chooses a look, and that is the one shown again.
    editor.setViewMode('simple');
    editor.showView('clean');
    editor.showView('redlines');
    expect(editor.getUiState()).toMatchObject({ view: 'simple', markupView: 'simple' });
  });

  it('brings back the look a document opened in, which its ledger may have chosen over the look remembered', () => {
    // `view: redlines` opens the full markup, and the app remembers the simple look: the menu goes
    // to Clean and back to what was shown, with nothing in between to have told the editor of it.
    const saved = marked.replace('version: 1\n', 'version: 1\nview: redlines\n');
    const editor = load(saved, { markupView: 'simple' });
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'simple' });
    editor.showView('clean');
    editor.showView('redlines');
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'simple' });
    // The same for the next document opened, and a document with no view of its own starts over.
    editor.setDoc(saved);
    editor.showView('raw');
    editor.showView('redlines');
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'simple' });
    editor.setDoc(marked);
    editor.showView('clean');
    editor.showView('redlines');
    expect(editor.getUiState().view).toBe('simple');
  });

  it('brings back the simple look a document was saved in, though the app remembers the full markup', () => {
    const saved = marked.replace('version: 1\n', 'version: 1\nview: simple\n');
    const editor = load(saved, { markupView: 'redlines' });
    expect(editor.getUiState()).toMatchObject({ view: 'simple', markupView: 'redlines' });
    editor.showView('clean');
    editor.showView('redlines');
    expect(editor.getUiState()).toMatchObject({ view: 'simple', markupView: 'redlines' });
    editor.setDoc(saved);
    editor.showView('raw');
    editor.showView('redlines');
    expect(editor.getUiState().view).toBe('simple');
  });

  it('starts another document from the look chosen, whatever was shown in the one before', () => {
    const editor = load(marked, { markupView: 'simple' });
    editor.view.dispatch({ effects: setViewModeEffect.of('redlines') });
    editor.setDoc(plain);
    editor.showView('redlines');
    expect(editor.getUiState().view).toBe('simple');
  });

  it('turns the simple look on and off while Redlines shows, and chooses the look as a click does (#330)', () => {
    const editor = load(marked, { markupView: 'redlines' });
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'redlines' });
    editor.switchLook();
    expect(editor.getUiState()).toMatchObject({ view: 'simple', markupView: 'simple' });
    editor.switchLook();
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', markupView: 'redlines' });
  });

  it('switches the look the review bar showed in the full markup without choosing it', () => {
    const editor = load(marked, { markupView: 'simple' });
    editor.view.dispatch({ effects: setViewModeEffect.of('redlines') });
    // The full markup is shown, the simple look is the one remembered: the switch turns it on.
    editor.switchLook();
    expect(editor.getUiState()).toMatchObject({ view: 'simple', markupView: 'simple' });
  });

  it('does nothing in Clean and Raw, which have no look to switch', () => {
    const editor = load(marked, { markupView: 'redlines' });
    for (const view of ['clean', 'raw'] as const) {
      editor.showView(view);
      editor.switchLook();
      expect(editor.getUiState()).toMatchObject({ view, markupView: 'redlines' });
    }
  });

  it('shows Clean and Raw as they are, and never changes the look', () => {
    const editor = load(marked, { markupView: 'simple' });
    editor.showView('raw');
    expect(editor.getUiState()).toMatchObject({ view: 'raw', markupView: 'simple' });
    editor.showView('clean');
    expect(editor.getUiState()).toMatchObject({ view: 'clean', markupView: 'simple' });
  });

  it('reports a view that Redlines is shown in, once, as the host asked', () => {
    const reports: EditorUiState[] = [];
    const editor = load(marked, {
      markupView: 'simple',
      onUiState: (state) => reports.push(state),
    });
    editor.showView('clean');
    editor.showView('redlines');
    expect(reports.map((state) => state.view)).toEqual(['clean', 'simple']);
  });
});
