// A long selection stays drawn as the document scrolls (#1160). The editor draws a long document
// as a window of lines with gaps for the rest, and the selection is the browser's own. WebKit works
// out which lines a selection covers when the selection is set, and not again for lines that come
// to be drawn between its ends afterwards, not even when the selection is set again to the same
// place: scroll a selection that reaches beyond the window, and the lines that come into view are
// not drawn selected (none of them, or some of them, as which were drawn when it was set). It does
// work them out again when the content's boxes are made again. So after the window moves, with a
// selection that reaches out of it, the content's `display` is changed and changed back in one
// frame, with nothing laid out or drawn between: the lines, the selection and the scroll are
// untouched, and the boxes are new.

import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

export const longSelection = ViewPlugin.fromClass(
  class {
    frame = 0;
    down = false;
    private readonly onDown = () => (this.down = true);
    private readonly onUp = () => (this.down = false);

    private readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      view.dom.addEventListener('mousedown', this.onDown);
      view.dom.ownerDocument.addEventListener('mouseup', this.onUp);
    }

    update(update: ViewUpdate) {
      if (!update.viewportChanged || update.state.selection.main.empty || this.frame) return;
      const { anchor, head } = update.state.selection.main;
      const { from, to } = update.view.viewport;
      // Only a selection with an end out of the window has lines the browser has not seen.
      if (anchor >= from && anchor <= to && head >= from && head <= to) return;
      const win = this.view.dom.ownerDocument.defaultView;
      if (!win?.requestAnimationFrame) return;
      this.frame = win.requestAnimationFrame(() => {
        this.frame = 0;
        this.refresh();
      });
    }

    refresh() {
      const { view } = this;
      if (this.down || view.composing || !view.hasFocus) return;
      const content = view.contentDOM;
      content.style.display = 'flex';
      // Reading a size makes the browser lay out the changed boxes before they are changed back.
      void content.offsetHeight;
      content.style.display = '';
    }

    destroy() {
      this.view.dom.removeEventListener('mousedown', this.onDown);
      this.view.dom.ownerDocument.removeEventListener('mouseup', this.onUp);
      if (this.frame) this.view.dom.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    }
  },
);
