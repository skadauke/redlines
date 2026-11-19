// Dragging selected blocks (#623): press on a selection that covers whole blocks and drag, and a
// line between blocks shows where they will land; letting go moves them (`move.ts`, one step to
// undo, tracked as a deletion and an insertion in one group with Track Changes on). A press that
// doesn't move is a click, which puts the caret there as ever. Escape lets the blocks go where they
// were.

import { EditorSelection, type Extension, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import type { BlockGap, BlockRun } from '@redlines/format';
import { asFile, type FileRead, moveRunTo, runOfSelection } from './move.ts';

/** The pointer must move this far from the press before it is a drag and not a click. */
const DRAG_SLOP = 4;
/**
 * How far from the press a drag from a block's handle goes before it can drop anywhere: the handle is
 * beside the block, so every gap is a place the pointer is nearest to, and a few pixels of a shaking
 * hand would otherwise move the block.
 */
const HANDLE_ARM = 24;
/** The editor's edge, in pixels, where a drag scrolls. */
const SCROLL_EDGE = 36;

/** Where the page puts things, in client coordinates; tests have none. */
export interface DragGeometry {
  /** The y of the drop line for a gap: between the blocks it is between. */
  gapY(view: EditorView, gap: BlockGap): number;
  /** The vertical extent of the run being dragged. */
  extent(view: EditorView, run: BlockRun): { top: number; bottom: number };
}

const pageGeometry: DragGeometry = {
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

/** The room that opens at the drop place, in px at the theme's own text size (#1200). */
const DROP_SPACE = 24;

/** Where the drop place is: the position and the side of it the room opens on, or null for none. */
const setDropSpace = StateEffect.define<{ pos: number; side: -1 | 1 } | null>();

/**
 * The room that opens between blocks where the dragged ones would land: it grows from nothing to
 * `DROP_SPACE` (at once with reduced motion), and holds the drop line, in the middle of it, so that
 * line and room are one thing. Every widget is alike, so that moving the pointer along does not draw
 * it again and start the opening over.
 */
class DropSpace extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const space = document.createElement('div');
    space.className = 'rl-drop-space';
    space.setAttribute('aria-hidden', 'true');
    const line = document.createElement('div');
    line.className = 'rl-drop-line';
    space.append(line);
    return space;
  }
  override get estimatedHeight(): number {
    return DROP_SPACE;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

const dropSpaceField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setDropSpace)) continue;
      return effect.value
        ? Decoration.set([
            Decoration.widget({
              widget: new DropSpace(),
              block: true,
              side: effect.value.side,
            }).range(effect.value.pos),
          ])
        : Decoration.none;
    }
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** A drag of blocks in progress: the room and the line at the gap it is at. */
export class BlockDrag {
  /** The place the room is open at, as `pos:side`, so that it is changed only when it moves. */
  private spaceAt: string | undefined;
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
    // The page lays out the view's text, which has the open paragraph in it. The room open at the
    // target moves what is below it, and the line stands in it: the gaps are measured as they would be
    // with no room, or the pointer would be chasing what it opens.
    const shown = this.shown.bind(this);
    const open = this.openSpace();
    const natural = (position: number, y: number, half = false) =>
      open && position >= open.pos
        ? y - (half && position === open.pos ? open.height / 2 : open.height)
        : y;
    this.places = this.run.gaps.map((gap) => {
      const here = shown(gap);
      return { gap, y: natural(here.at, geometry.gapY(view, here), true) };
    });
    // The run's extent is measured now, not at the press: the editor may have scrolled since.
    const shownRun = this.shownRun();
    const measured = geometry.extent(view, shownRun);
    const extent =
      open && shownRun.from >= open.pos
        ? { top: measured.top - open.height, bottom: measured.bottom - open.height }
        : measured;
    this.target = pickGap(this.places, extent, y);
    this.showSpace(this.target ? shown(this.target) : undefined);
  }

  /** The room that is open now: where, and how tall it is just now (it grows). */
  private openSpace(): { pos: number; height: number } | undefined {
    const el = this.view.dom.querySelector<HTMLElement>('.rl-drop-space');
    if (!el || this.spaceAt === undefined) return undefined;
    return { pos: Number(this.spaceAt.split(':')[0]), height: el.offsetHeight };
  }

  /** Opens the room where `gap` is, closes it where there is no gap. */
  private showSpace(gap: BlockGap | undefined): void {
    if (!gap) return this.closeSpace();
    // A block widget stands at a line's edge: above the line the gap's text begins on, or below the
    // one a gap at the end of a block ends.
    const line = this.view.state.doc.lineAt(gap.at);
    const side = gap.after ? 1 : -1;
    const pos = side === 1 ? line.to : line.from;
    const key = `${pos}:${side}`;
    if (key === this.spaceAt) return;
    this.spaceAt = key;
    this.view.dispatch({ effects: setDropSpace.of({ pos, side }) });
  }

  private closeSpace(): void {
    if (this.spaceAt === undefined) return;
    this.spaceAt = undefined;
    this.view.dispatch({ effects: setDropSpace.of(null) });
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
    this.closeSpace();
    this.view.dom.classList.remove('rl-block-dragging');
  }
}

/** The drags in progress, by view: what ends one when its view is destroyed. */
const ending = new WeakMap<EditorView, () => void>();

/** The press, the drag and the drop of selected blocks, and the look of the line. */
export function blockDrag(): Extension {
  return [
    dropSpaceField,
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
      // The room that opens where the blocks would land, and the line in it (#1200).
      '.rl-drop-space': {
        position: 'relative',
        height: `calc(${DROP_SPACE}px * var(--rl-text-scale, 1))`,
        animation: 'rl-drop-open 0.14s ease-out',
        pointerEvents: 'none',
      },
      '@media (prefers-reduced-motion: reduce)': { '.rl-drop-space': { animation: 'none' } },
      '@keyframes rl-drop-open': { from: { height: '0' } },
      '.rl-drop-space .rl-drop-line': {
        position: 'absolute',
        left: '0',
        right: '0',
        top: '50%',
        height: '3px',
        marginTop: '-1.5px',
      },
      // A faint blue, the one marker of where a drop will land: the blocks', the table's and the
      // pictures' (`--rl-drop` in the theme).
      '.rl-drop-line': {
        position: 'absolute',
        height: '3px',
        borderRadius: '2px',
        backgroundColor: 'var(--rl-drop, rgba(10, 100, 255, 0.45))',
        pointerEvents: 'none',
        zIndex: '5',
      },
      '&.rl-block-dragging, &.rl-block-dragging .cm-content': { cursor: 'grabbing' },
    }),
  ];
}

/**
 * A press at the handle of a block that is drawn apart from its text, such as a table's (#1199), and
 * the drag from it: past `HANDLE_ARM`, which is clearly away from the handle, the block (`range`, its text) is dragged as selected blocks are,
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
      // Clearly away from the handle first: a press that shakes a little is a click.
      if (Math.hypot(e.clientX - start.x, y - start.y) < HANDLE_ARM) return;
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
