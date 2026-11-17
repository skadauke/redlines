// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { createEditor, type Editor } from './index.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };

// What a code file may hold that Markdown would read as marks: a tracked insertion and a ledger.
const CODE = 'const a = 1; // <!--ins k3x9-->x<!--/ins k3x9-->\nlet b = "<!-- redlines";\n';
const WITH_LEDGER = 'text\n\n<!-- redlines\nv: 1\ntracking: everyone\nview: redlines\n-->\n';

function open(doc: string, kind: 'markdown' | 'plain-only'): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, kind });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  return editor;
}

describe('a Plain-only document', () => {
  it('shows in Plain, reads no marks or ledger, and writes the text as it is', () => {
    const editor = open(CODE, 'plain-only');
    expect(editor.getUiState()).toMatchObject({
      kind: 'plain-only',
      view: 'raw',
      tracking: false,
      hasRedlines: false,
      canAcceptAll: false,
    });
    expect(editor.getUiState().changes).toEqual([]);
    expect(editor.getDoc()).toBe(CODE);
    editor.destroy();
  });

  it('keeps a file that has a ledger as text: its tracking is not switched on, and Save writes it as it was', () => {
    const editor = open(WITH_LEDGER, 'plain-only');
    expect(editor.getUiState()).toMatchObject({ view: 'raw', tracking: false });
    // The save's records change nothing.
    editor.recordTracking();
    editor.recordView();
    editor.setTracking(true, { inFile: true });
    editor.recordTracking();
    expect(editor.getUiState().tracking).toBe(false);
    expect(editor.getDoc()).toBe(WITH_LEDGER);
    // Typing is plain text, untracked.
    editor.view.dispatch({ changes: { from: 0, insert: 'more ' }, userEvent: 'input.type' });
    expect(editor.getDoc()).toBe(`more ${WITH_LEDGER}`);
    editor.destroy();
  });

  it('has no other view, whoever asks', () => {
    const editor = open('a\n', 'plain-only');
    for (const mode of ['clean', 'redlines', 'simple'] as const) editor.setViewMode(mode);
    editor.showView('clean');
    editor.showView('redlines');
    expect(editor.getUiState().view).toBe('raw');
    editor.destroy();
  });

  it('disables every command that makes marks or Markdown, with its reason, and keeps Edit and find', () => {
    const editor = open('a\n', 'plain-only');
    editor.commands.register([
      { id: 'format.bold', title: 'Bold', run: () => true },
      { id: 'comment.add', title: 'Add Comment', run: () => true },
      { id: 'find.open', title: 'Find', run: () => true },
    ]);
    const ui = editor.getUiState();
    expect(ui.disabledReasons['format.bold']).toBe('Only Markdown files have formatting.');
    expect(ui.disabledReasons['comment.add']).toBe(
      'Only Markdown files have comments, highlights and Ask.',
    );
    expect(ui.enabledCommands).toContain('find.open');
    expect(ui.enabledCommands).not.toContain('format.bold');
    editor.destroy();
  });

  it('is a Markdown document again when the next file is', () => {
    const editor = open(CODE, 'plain-only');
    editor.setDoc(WITH_LEDGER, 'markdown');
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    expect(editor.getUiState()).toMatchObject({ kind: 'markdown', tracking: true });
    editor.setDoc(CODE);
    expect(editor.getUiState().kind).toBe('markdown');
    editor.setDoc(CODE, 'plain-only');
    expect(editor.getUiState()).toMatchObject({ kind: 'plain-only', view: 'raw' });
    editor.destroy();
  });

  it('changes kind with the name of its file, reading the same text again', () => {
    const editor = open(WITH_LEDGER, 'markdown');
    expect(editor.getUiState()).toMatchObject({ kind: 'markdown', tracking: true });
    editor.setKind('plain-only');
    expect(editor.getUiState()).toMatchObject({ kind: 'plain-only', view: 'raw', tracking: false });
    expect(editor.getParsed().ledgerRange).toBeNull();
    expect(editor.getDoc()).toBe(WITH_LEDGER);
    editor.setKind('markdown');
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    expect(editor.getParsed().ledgerRange).not.toBeNull();
    expect(editor.getUiState().kind).toBe('markdown');
    editor.destroy();
  });

  it('leaves a Markdown document as it was', () => {
    const editor = open(WITH_LEDGER, 'markdown');
    expect(editor.getUiState()).toMatchObject({ kind: 'markdown', tracking: true });
    editor.destroy();
  });
});
