// Dragging selected blocks (#623): press on a selection that covers whole blocks and drag, and a
// line between blocks shows where they will land; letting go moves them (`move.ts`, one step to
// undo, tracked as a deletion and an insertion in one group with Track Changes on). A press that
// doesn't move is a click, which puts the caret there as ever. Escape lets the blocks go where they
// were.

import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type { BlockGap, BlockRun } from '@redlines/format';
import { asFile, type FileRead, moveRunTo, runOfSelection } from './move.ts';

/** The pointer must move this far from the press before it is a drag and not a click. */
export const DRAG_SLOP = 4;
/** The editor's edge, in pixels, where a drag scrolls. */
const SCROLL_EDGE = 36;

/** Where the page puts things, in client coordinates; tests have none. */
export interface DragGeometry {
  /** The y of the drop line for a gap: between the blocks it is between. */
  gapY(view: EditorView, gap: BlockGap): number;
  /** The vertical extent of the run being dragged. */
  extent(view: EditorView, run: BlockRun): { top: number; bottom: number };
}

export const pageGeometry: DragGeometry = {
  gapY(view, gap) {
    // The text's own edges: a block's line block holds the space above it too.
    const top = (pos: number) =>
      view.coordsAtPos(pos, 1)?.top ?? view.documentTop + view.lineBlockAt(pos).top;
    const bottom = (pos: number) =>
      view.coordsAtPos(pos, -1)?.bottom ?? view.documentTop + view.lineBlockAt(pos).bottom;
    if (gap.after) return bottom(gap.at) + 4;
    return gap.above === undefined ? top(gap.at) - 4 : (bottom(gap.above) + top(gap.at)) / 2;
  },
  extent: (view, run) => ({
    top: view.coordsAtPos(run.from, 1)?.top ?? view.documentTop + view.lineBlockAt(run.from).top,
    bottom:
      view.coordsAtPos(run.to, -1)?.bottom ?? view.documentTop + view.lineBlockAt(run.to).bottom,
  }),
};

/**
 * The gap whose line is nearest to the pointer's `y`, or undefined while the pointer is over the
 * blocks being dragged (letting go there moves nothing).
 */
export function pickGap(
  places: readonly { gap: BlockGap; y: number }[],
  extent: { top: number; bottom: number },
  y: number,
): BlockGap | undefined {
  if (y > extent.top && y < extent.bottom) return undefined;
  let best: { gap: BlockGap; y: number } | undefined;
  for (const place of places) {
    if (!best || Math.abs(place.y - y) < Math.abs(best.y - y)) best = place;
  }
  return best?.gap;
}

/** Whether the selection covers the text of whole blocks, and which. */
export function draggableRun(view: EditorView): BlockRun | undefined {
  return draggableRead(view)?.run;
}

/**
 * The run in the text as the file has it, with the empty paragraph that Return opened taken back
 * (#888), and the read that dropping it needs. Undefined with the caret in that paragraph.
 */
export function draggableRead(view: EditorView): { run: BlockRun; read: FileRead } | undefined {
  const { main } = view.state.selection;
  if (main.empty) return undefined;
  const read = asFile(view.state);
  if (!read) return undefined;
  const run = runOfSelection(read.file);
  // The run is in the file's text, so the selection is compared as the file has it.
  const sel = read.file.selection.main;
  return run && sel.from <= run.textFrom && sel.to >= run.to ? { run, read } : undefined;
}

/** A drag of blocks in progress: the line, and the gap it is at. */
export class BlockDrag {
  private line: HTMLElement | undefined;
  private target: BlockGap | undefined;
  private places: { gap: BlockGap; y: number }[] = [];
  private readonly view: EditorView;
  private readonly run: BlockRun;
  private readonly geometry: DragGeometry;
  private readonly read: FileRead | undefined;

  /** `run` is in the file's text; `read` says how the view's text differs from it (#888). */
  constructor(
    view: EditorView,
    run: BlockRun,
    geometry: DragGeometry = pageGeometry,
    read?: FileRead,
  ) {
    this.view = view;
    this.run = run;
    this.geometry = geometry;
    this.read = read;
    view.dom.classList.add('rl-block-dragging');
  }

  /** The gap the pointer is at now. */
  get gap(): BlockGap | undefined {
    return this.target;
  }

  /** The pointer is at client `y`: the line goes to the nearest gap. */
  move(y: number): void {
    const { view, geometry } = this;
    // The page lays out the view's text, which has the open paragraph in it.
    const shown = this.shown.bind(this);
    this.places = this.run.gaps.map((gap) => ({ gap, y: geometry.gapY(view, shown(gap)) }));
    // The run's extent is measured now, not at the press: the editor may have scrolled since.
    this.target = pickGap(this.places, geometry.extent(view, this.shownRun()), y);
    const at = this.places.find((place) => place.gap === this.target);
    if (!at) {
      this.line?.remove();
      this.line = undefined;
      return;
    }
    const line = (this.line ??= this.makeLine());
    const scroller = view.scrollDOM.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    line.style.top = `${at.y - scroller.top + view.scrollDOM.scrollTop - 1.5}px`;
    line.style.left = `${content.left - scroller.left + view.scrollDOM.scrollLeft}px`;
    line.style.width = `${content.width}px`;
  }

  private place(pos: number): number {
    return this.read?.back ? this.read.back.invertedDesc.mapPos(pos, 1) : pos;
  }

  private shown(gap: BlockGap): BlockGap {
    if (!this.read?.back) return gap;
    const { above } = gap;
    return {
      ...gap,
      at: this.place(gap.at),
      ...(above === undefined ? {} : { above: this.place(above) }),
    };
  }

  private shownRun(): BlockRun {
    if (!this.read?.back) return this.run;
    return { ...this.run, from: this.place(this.run.from), to: this.place(this.run.to) };
  }

  private makeLine(): HTMLElement {
    const line = document.createElement('div');
    line.className = 'rl-drop-line';
    line.setAttribute('aria-hidden', 'true');
    this.view.scrollDOM.append(line);
    return line;
  }

  /** Scrolls the editor a step when the pointer is at its top or bottom edge, and says whether it
   * is there (the caller keeps scrolling while it is, though the pointer holds still). */
  scrollFor(y: number): boolean {
    const { scrollDOM } = this.view;
    const rect = scrollDOM.getBoundingClientRect();
    if (y < rect.top + SCROLL_EDGE) scrollDOM.scrollTop -= 14;
    else if (y > rect.bottom - SCROLL_EDGE) scrollDOM.scrollTop += 14;
    else return false;
    return true;
  }

  /** Lets go: the blocks move to the gap, if there is one. Whether they moved. */
  drop(): boolean {
    const gap = this.target;
    this.end();
    return gap ? moveRunTo(this.view, this.run, gap, this.read) : false;
  }

  /** Lets the blocks go where they were. */
  cancel(): void {
    this.end();
  }

  private end(): void {
    this.line?.remove();
    this.line = undefined;
    this.view.dom.classList.remove('rl-block-dragging');
  }
}

/** The drags in progress, by view: what ends one when its view is destroyed. */
const ending = new WeakMap<EditorView, () => void>();

/** The press, the drag and the drop of selected blocks, and the look of the line. */
export function blockDrag(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        private readonly view: EditorView;
        constructor(view: EditorView) {
          this.view = view;
        }
        destroy() {
          ending.get(this.view)?.();
        }
      },
    ),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || event.detail > 1) return false;
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
        // Nothing moves in a document that can't be edited.
        if (view.state.readOnly || !view.contentDOM.isContentEditable) return false;
        const found = draggableRead(view);
        if (!found) return false;
        const { run, read } = found;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
        const { main } = view.state.selection;
        if (pos < main.from || pos > main.to) return false;
        event.preventDefault();
        view.focus();
        const doc = view.dom.ownerDocument;
        const win = doc.defaultView;
        const start = { x: event.clientX, y: event.clientY };
        // The document the press was made on: if it changes (an agent's edit, an undo), the run's
        // offsets are stale and the drag lets go.
        const pressed = view.state.doc;
        let drag: BlockDrag | undefined;
        let y = event.clientY;
        let frame = 0;
        const finish = () => {
          doc.removeEventListener('mousemove', onMove, true);
          doc.removeEventListener('mouseup', onUp, true);
          doc.removeEventListener('keydown', onKey, true);
          win?.removeEventListener('blur', abandon);
          if (frame) win?.cancelAnimationFrame(frame);
          frame = 0;
          ending.delete(view);
        };
        function abandon() {
          finish();
          drag?.cancel();
        }
        // While the pointer is at the edge the editor keeps scrolling, and the line follows.
        const tick = () => {
          frame = 0;
          if (!drag) return;
          if (!view.state.doc.eq(pressed)) return abandon();
          if (drag.scrollFor(y)) {
            drag.move(y);
            frame = win?.requestAnimationFrame(tick) ?? 0;
          }
        };
        const onMove = (e: MouseEvent) => {
          y = e.clientY;
          if (!drag && Math.hypot(e.clientX - start.x, y - start.y) < DRAG_SLOP) return;
          if (!view.state.doc.eq(pressed)) return abandon();
          drag ??= new BlockDrag(view, run, pageGeometry, read);
          drag.move(y);
          if (!frame && win) frame = win.requestAnimationFrame(tick);
        };
        const onUp = () => {
          finish();
          const same = view.state.doc.eq(pressed);
          if (drag) {
            if (same) drag.drop();
            else drag.cancel();
          } else if (same) {
            view.dispatch({ selection: EditorSelection.cursor(pos), userEvent: 'select.pointer' });
          }
        };
        const onKey = (e: KeyboardEvent) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          abandon();
        };
        doc.addEventListener('mousemove', onMove, true);
        doc.addEventListener('mouseup', onUp, true);
        doc.addEventListener('keydown', onKey, true);
        // The window lost the pointer (focus moved away, the button was let go outside): as Escape.
        win?.addEventListener('blur', abandon);
        ending.set(view, abandon);
        return true;
      },
    }),
    EditorView.baseTheme({
      '.rl-drop-line': {
        position: 'absolute',
        height: '3px',
        borderRadius: '2px',
        // The theme's gray, never red: the table and image drop lines share this class.
        backgroundColor: 'var(--rl-ink-2, #6a6a6f)',
        pointerEvents: 'none',
        zIndex: '5',
      },
      '&.rl-block-dragging, &.rl-block-dragging .cm-content': { cursor: 'grabbing' },
    }),
  ];
}

/**
 * A press at the handle of a block that is drawn apart from its text, such as a table's (#1199), and
 * the drag from it: past `DRAG_SLOP` the block (`range`, its text) is dragged as selected blocks are,
 * with the line between blocks, and letting go moves it there (one step to undo, tracked with Track
 * Changes on); Escape lets it go where it was. A press that doesn't move calls `onClick`. False
 * where the press is no drag at all (a document that can't be edited): `onClick` is then the
 * caller's to run.
 */
export function dragBlockAt(
  view: EditorView,
  range: { from: number; to: number },
  event: MouseEvent,
  onClick: () => void,
): boolean {
  if (view.state.readOnly || !view.contentDOM.isContentEditable) return false;
  const doc = view.dom.ownerDocument;
  const win = doc.defaultView;
  const start = { x: event.clientX, y: event.clientY };
  const pressed = view.state.doc;
  let drag: BlockDrag | undefined;
  let y = event.clientY;
  let frame = 0;
  const finish = () => {
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('mouseup', onUp, true);
    doc.removeEventListener('keydown', onKey, true);
    win?.removeEventListener('blur', abandon);
    if (frame) win?.cancelAnimationFrame(frame);
    frame = 0;
    ending.delete(view);
  };
  function abandon() {
    finish();
    drag?.cancel();
  }
  const tick = () => {
    frame = 0;
    if (!drag) return;
    if (!view.state.doc.eq(pressed)) return abandon();
    if (drag.scrollFor(y)) {
      drag.move(y);
      frame = win?.requestAnimationFrame(tick) ?? 0;
    }
  };
  const onMove = (e: MouseEvent) => {
    y = e.clientY;
    if (!drag) {
      if (Math.hypot(e.clientX - start.x, y - start.y) < DRAG_SLOP) return;
      if (!view.state.doc.eq(pressed)) return abandon();
      // The block is the selection, as it is for a drag of selected blocks.
      view.dispatch({
        selection: EditorSelection.range(range.from, range.to),
        userEvent: 'select',
      });
      const found = draggableRead(view);
      if (!found) return abandon();
      drag = new BlockDrag(view, found.run, pageGeometry, found.read);
    }
    drag.move(y);
    if (!frame && win) frame = win.requestAnimationFrame(tick);
  };
  const onUp = () => {
    finish();
    // The selection that made the drag is the document's; the text is what was pressed on.
    if (drag) {
      if (view.state.doc.eq(pressed)) drag.drop();
      else drag.cancel();
    } else if (view.state.doc.eq(pressed)) onClick();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    abandon();
  };
  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('mouseup', onUp, true);
  doc.addEventListener('keydown', onKey, true);
  win?.addEventListener('blur', abandon);
  ending.set(view, abandon);
  return true;
}
