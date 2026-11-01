import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import type { Ledger, Parsed } from '@redlines/format';
import type { Editor, EditorOptions, EditorUiState, ViewMode } from './api.ts';
import { fileText, type LoadedFile, loadFile } from './line-breaks.ts';
import { markdownPreview } from './preview/decorations.ts';
import { baseTheme } from './preview/theme.ts';

export type * from './api.ts';

const EMPTY_LEDGER: Ledger = { version: 1, people: [], marks: {}, comments: [] };

/**
 * Mounts a Markdown editor in `parent`, with the live preview. The view, tracking, accept and
 * reject only update the UI state until the tracked-change layer is written (plan Track E).
 */
export function createEditor(parent: HTMLElement, options: EditorOptions): Editor {
  let ui: EditorUiState = {
    view: options.view ?? 'clean',
    tracking: options.tracking ?? false,
    hasRedlines: false,
    changes: [],
  };
  const setUi = (next: Partial<EditorUiState>) => {
    ui = { ...ui, ...next };
    options.onUiState?.(ui);
  };
  let file = loadFile(options.doc);
  const extensions = [
    markdown({ extensions: GFM }),
    markdownPreview(),
    baseTheme,
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange?.(fileText(file, update.state));
    }),
    options.extensions ?? [],
  ];
  const stateFor = (loaded: LoadedFile) =>
    EditorState.create({ doc: loaded.doc, extensions: [loaded.extension, extensions] });
  const view = new EditorView({ parent, state: stateFor(file) });

  return {
    view,
    getDoc: () => fileText(file, view.state),
    setDoc: (doc) => {
      file = loadFile(doc);
      view.setState(stateFor(file));
    },
    getParsed: (): Parsed => ({
      text: view.state.doc.toString(),
      marks: [],
      ledger: EMPTY_LEDGER,
      ledgerRange: null,
      warnings: [],
    }),
    getUiState: () => ui,
    setViewMode: (mode: ViewMode) => setUi({ view: mode }),
    setTracking: (on) => setUi({ tracking: on }),
    accept: () => {},
    reject: () => {},
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
