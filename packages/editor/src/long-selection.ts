// A long selection stays drawn as the document scrolls (#1160). The editor draws a long document
// as a window of lines with gaps for the rest, and the selection is the browser's own. WebKit works
// out which lines a selection covers when the selection is set, and not again for lines that come
// to be drawn between its ends afterwards, not even when the selection is set again to the same
// place: scroll a selection that reaches beyond the window, and the lines that come into view are
// not drawn selected (none of them, or some of them, as which were drawn when it was set). It does
// work them out again when the content's boxes are made again. So after the window moves, with a
// selection that reaches out of it, the content's `display` is changed and changed back in one
// frame, with nothing laid out or drawn between: the lines, the selection and the scroll are
// untouched, and the boxes are new. It costs a layout of the window, so it runs at most once in
// `EVERY_MS` while the document scrolls, and once more when the scroll stops.

import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/** The shortest time between two refreshes while the document scrolls. */
const EVERY_MS = 150;

export const longSelection = ViewPlugin.fromClass(
  class {
    timer = 0;
    frame = 0;
    last = -Infinity;
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
      // The window moved, or what is drawn in it changed with no edit or new selection (a widget
      // drawn late): the lines the browser has not seen.
      if (update.docChanged || update.selectionSet) return;
      if (update.state.selection.main.empty || this.timer) return;
      const { anchor, head } = update.state.selection.main;
      const { from, to } = update.view.viewport;
      // Only a selection with an end out of the window has lines the browser has not seen.
      if (anchor >= from && anchor <= to && head >= from && head <= to) return;
      const win = this.view.dom.ownerDocument.defaultView;
      if (!win?.requestAnimationFrame) return;
      // Soon, in a frame, when none ran lately; else when the gap since the last one is over.
      const wait = Math.max(0, this.last + EVERY_MS - win.performance.now());
      this.timer = win.setTimeout(() => {
        this.frame = win.requestAnimationFrame(() => {
          this.timer = 0;
          this.frame = 0;
          this.last = win.performance.now();
          this.refresh();
        });
      }, wait);
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
      const win = this.view.dom.ownerDocument.defaultView;
      if (this.timer) win?.clearTimeout(this.timer);
      if (this.frame) win?.cancelAnimationFrame(this.frame);
    }
  },
);
