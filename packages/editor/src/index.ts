import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Ledger, Parsed } from '@redlines/format';
import type { Editor, EditorOptions, EditorUiState, ViewMode } from './api.ts';

export type * from './api.ts';

const EMPTY_LEDGER: Ledger = { version: 1, people: [], marks: {}, comments: [] };

/**
 * Mounts a Markdown editor in `parent`. A stub for now: plain CodeMirror with Markdown support.
 * The view, tracking, accept and reject only update the UI state until the preview and the
 * tracked-change layer are written (plan Tracks B and E).
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
  const state = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        markdown(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange?.(update.state.doc.toString());
        }),
        options.extensions ?? [],
      ],
    });
  const view = new EditorView({ parent, state: state(options.doc) });

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc: (doc) => view.setState(state(doc)),
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
