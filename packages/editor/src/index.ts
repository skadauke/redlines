import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import type { Ledger, Parsed } from '@redlines/format';
import type { Editor, EditorOptions, EditorUiState, ViewMode } from './api.ts';
import { markdownPreview } from './preview/decorations.ts';
import { baseTheme } from './preview/theme.ts';

export type * from './api.ts';

const EMPTY_LEDGER: Ledger = { version: 1, people: [], marks: {}, comments: [] };

/** The document's line break: CRLF when its first line break is CRLF, else LF. */
function lineBreakOf(doc: string): string {
  const lf = doc.indexOf('\n');
  return lf > 0 && doc[lf - 1] === '\r' ? '\r\n' : '\n';
}

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
  const state = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        // The document keeps its own line breaks, so an untouched file saves byte for byte.
        EditorState.lineSeparator.of(lineBreakOf(doc)),
        EditorView.clipboardInputFilter.of((text, state) =>
          text.replace(/\r\n?|\n/g, state.lineBreak),
        ),
        markdown({ extensions: GFM }),
        markdownPreview(),
        baseTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange?.(update.state.sliceDoc());
        }),
        options.extensions ?? [],
      ],
    });
  const view = new EditorView({ parent, state: state(options.doc) });

  return {
    view,
    // sliceDoc joins lines with the document's line break; doc.toString() would use LF.
    getDoc: () => view.state.sliceDoc(),
    setDoc: (doc) => view.setState(state(doc)),
    getParsed: (): Parsed => ({
      text: view.state.sliceDoc(),
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
