// The read-only viewer for text files other than Markdown (v0.2 design: The file sidebar): the
// file as it is, in the document's mono font, with line numbers and syntax colors. It opens at a
// line when a citation names one.

import { type LanguageDescription } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import { fileHighlight, languageForFile } from './highlight.ts';

export interface FileViewer {
  /** Measures the text again, after its size changed. */
  requestMeasure(): void;
  /** Resolves once the file's language has loaded and colors it; at once for a file with none. */
  ready: Promise<void>;
  destroy(): void;
}

/** What the viewer shows for a file that can't be read as text. */
export const NOT_TEXT = 'Redlines can’t show this file: it isn’t UTF-8 text.';

/** What it shows for a file over `MAX_VIEW_BYTES`. */
export const TOO_LARGE = 'This file is too large to show here.';

/** The largest file shown, in bytes. A log or a minified data file can be far larger. */
export const MAX_VIEW_BYTES = 2 * 1024 * 1024;

/** The largest file given a grammar, in bytes: parsing a bigger one would stall the window. */
export const MAX_COLORED_BYTES = 512 * 1024;

const markedLine = Decoration.line({ class: 'rl-viewer-line' });

const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--rl-page)',
    color: 'var(--rl-ink)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--rl-font-mono)',
    fontSize: 'calc(var(--rl-size-body) * var(--rl-text-scale, 1) * 0.86)',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '16px 0' },
  '.cm-line': { padding: '0 16px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    backgroundColor: 'var(--rl-page)',
    color: 'var(--rl-ink-3)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 16px' },
  '.rl-viewer-line': { backgroundColor: 'var(--rl-tint)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    { backgroundColor: 'var(--rl-pressed)' },
});

/**
 * Shows `file` in `parent`. `line`, counted from 1, is scrolled into view and marked; a line past
 * the end is the last one. A null `text` is a file that isn't UTF-8 text, which shows a message.
 */
export function createFileViewer(
  parent: HTMLElement,
  file: { name: string; text: string | null; line?: number; tooLarge?: true },
): FileViewer {
  // Counted in bytes, as the file is on disk; the text's length is the least it can be.
  const bytes = file.text === null ? 0 : sizeOf(file.text);
  if (file.text === null || file.tooLarge || bytes > MAX_VIEW_BYTES) {
    const message = document.createElement('p');
    message.className = 'rl-viewer-message';
    message.textContent = file.text === null && !file.tooLarge ? NOT_TEXT : TOO_LARGE;
    parent.append(message);
    return { ready: Promise.resolve(), requestMeasure: () => {}, destroy: () => message.remove() };
  }
  const languageSlot = new Compartment();
  const doc = EditorState.create({ doc: file.text }).doc;
  const at =
    file.line === undefined ? null : doc.line(Math.min(Math.max(file.line, 1), doc.lines)).from;
  const extensions: Extension[] = [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    lineNumbers(),
    // A single minified line would otherwise be a page of sideways scrolling.
    EditorView.lineWrapping,
    fileHighlight,
    theme,
    languageSlot.of([]),
  ];
  if (at !== null) {
    extensions.push(EditorView.decorations.of(Decoration.set([markedLine.range(at)])));
  }
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: file.text, extensions }),
  });
  if (at !== null) {
    view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'center' }) });
  }
  let gone = false;
  const description: LanguageDescription | null =
    bytes > MAX_COLORED_BYTES ? null : languageForFile(file.name);
  const ready = (description?.load() ?? Promise.resolve(null)).then(
    (support) => {
      if (support && !gone) view.dispatch({ effects: languageSlot.reconfigure(support) });
    },
    // A grammar that won't load leaves the file plain.
    () => undefined,
  );
  return {
    ready,
    requestMeasure: () => view.requestMeasure(),
    destroy() {
      gone = true;
      view.destroy();
    },
  };
}

/** The bytes of `text` in UTF-8, counted only when it could be over a limit. */
function sizeOf(text: string): number {
  // At most three bytes to a UTF-16 unit, so a text this short is under both limits.
  if (text.length * 3 <= MAX_COLORED_BYTES) return text.length;
  return new TextEncoder().encode(text).length;
}
