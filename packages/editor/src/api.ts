// The editor's public interface. Hosts (the desktop app, the React component, VS Code) and
// plugins such as @redlines/review use only what is here.

import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Handle, MarkRange, Parsed } from '@redlines/format';

/** How the document is shown (design §5.3). */
export type ViewMode = 'clean' | 'redlines' | 'raw';

/** The person editing, whose changes and comments carry this identity. */
export interface Author {
  handle: Handle;
  name: string;
  email?: string;
  agent?: boolean;
  for?: Handle;
}

/** What the host's controls need to show. */
export interface EditorUiState {
  view: ViewMode;
  /** Whether your edits are tracked (design §5.4). */
  tracking: boolean;
  /** The file has pending changes or comment threads. */
  hasRedlines: boolean;
  /** Pending changes in document order, for the review bar. */
  changes: MarkRange[];
}

export interface EditorOptions {
  doc: string;
  author: Author;
  /** Default: 'redlines' when the document has redlines, else 'clean' (design §5.3). */
  view?: ViewMode;
  /** Default: true when the ledger says `tracking: everyone` (format §5.6). */
  tracking?: boolean;
  /** Extra CodeMirror extensions, such as @redlines/review's. */
  extensions?: Extension[];
  /** Called after every change to the document. */
  onChange?: (doc: string) => void;
  /** Called when the view, tracking or the pending changes change. */
  onUiState?: (state: EditorUiState) => void;
}

export interface Editor {
  /** The CodeMirror view, for plugins. */
  readonly view: EditorView;
  getDoc(): string;
  /** Replaces the whole document and clears the undo history, as when a file is reloaded. */
  setDoc(doc: string): void;
  getParsed(): Parsed;
  getUiState(): EditorUiState;
  setViewMode(mode: ViewMode): void;
  setTracking(on: boolean): void;
  /** Accepts a pending change by its mark id. */
  accept(id: string): void;
  /** Rejects a pending change by its mark id. */
  reject(id: string): void;
  focus(): void;
  /** Removes the editor from the page. */
  destroy(): void;
}
