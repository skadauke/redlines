// The read-only viewer for text files other than Markdown (v0.2 design: The file sidebar): the
// file as it is, in the document's mono font, with line numbers and syntax colors. It opens at a
// line when a citation names one.

import { type LanguageDescription } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import { codeHighlight, languageForFile } from './highlight.ts';

export interface FileViewer {
  /** Measures the text again, after its size changed. */
  requestMeasure(): void;
  /** Resolves once the file's language has loaded and colors it; at once for a file with none. */
  ready: Promise<void>;
  destroy(): void;
}

/** What the viewer shows for a file that can't be read as text. */
export const NOT_TEXT = 'Redlines can’t show this file: it isn’t UTF-8 text.';

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
  file: { name: string; text: string | null; line?: number },
): FileViewer {
  if (file.text === null) {
    const message = document.createElement('p');
    message.className = 'rl-viewer-message';
    message.textContent = NOT_TEXT;
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
    codeHighlight,
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
  const description: LanguageDescription | null = languageForFile(file.name);
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
