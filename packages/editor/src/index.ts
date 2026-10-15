import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export interface EditorOptions {
  /** The Markdown text to start with. */
  doc: string;
}

export interface Editor {
  /** The CodeMirror view, for now. A stable editor API comes with the tracked-change layer. */
  view: EditorView;
  /** Removes the editor from the page. */
  destroy(): void;
}

/** Mounts a Markdown editor in `parent`. A stub: plain CodeMirror with Markdown support. */
export function createEditor(parent: HTMLElement, options: EditorOptions): Editor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [markdown(), EditorView.lineWrapping],
    }),
  });
  return { view, destroy: () => view.destroy() };
}
