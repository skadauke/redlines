// Dragging rows or columns by their grip (design: tables, "Grips and +"): the rows (or columns) that
// are selected with the one dragged move to any boundary, the last included. The moving ones dim, a copy
// of them follows the pointer, a 2 px line in the theme's ink marks the drop, the page scrolls near its
// edges, and Esc cancels. The drop is the move command's operation with `to`.

import type { EditorView } from '@codemirror/view';

/** How far the pointer goes before a press on a grip is a drag, in px. */
export const DRAG_SLOP = 4;

/** How near the scroller's edge the page starts to scroll, in px. */
export const EDGE = 36;

/** The boundary a pointer at `y` is nearest to: `rowTops` are the tops of the rows and the bottom
 * of the last, `rows.length + 1` of them (for columns, `x` and the lefts of the columns). */
export function dropBoundary(y: number, rowTops: readonly number[]): number {
  let best = 0;
  let nearest = Infinity;
  rowTops.forEach((edge, index) => {
    const away = Math.abs(y - edge);
    if (away < nearest) {
      best = index;
      nearest = away;
    }
  });
  return best;
}

/** How fast the page scrolls for a pointer at `y` when the scroller spans `top`..`bottom`: negative
 * up, 0 away from the edges. */
export function scrollSpeed(y: number, top: number, bottom: number): number {
  if (y < top + EDGE) return -Math.min(24, Math.ceil((top + EDGE - y) / 2));
  if (y > bottom - EDGE) return Math.min(24, Math.ceil((y - (bottom - EDGE)) / 2));
  return 0;
}

/** A drag in progress. */
export interface Drag {
  /** The boundary the rows would be dropped at. */
  boundary(): number;
  /** The pointer moved. */
  move(x: number, y: number): void;
  /** Ends it: the boundary to drop at, or null when it was cancelled. */
  end(cancel?: boolean): number | null;
}

interface DragOptions {
  view: EditorView;
  /** Dims the dragged rows, or not: by a decoration of the editor, for the page redraws its lines and
   * wipes a class set on them from outside. */
  dim: (on: boolean) => void;
  /** The boundaries' `y`s (`x`s for columns), read again as the page scrolls. */
  boundaries: () => number[];
  /** Where the drop line goes: the table's box. */
  table: () => { left: number; right: number; top?: number; bottom?: number };
  /** Rows (the default) or columns: the line is horizontal or vertical, the page scrolls up and down
   * or the table's box sideways. */
  axis?: 'row' | 'col';
  /** The box that scrolls sideways, for columns. */
  scroller?: () => HTMLElement | null;
  layer: HTMLElement;
  /** The text the copy shows. */
  label: string;
}

/** Starts a drag: dims the rows, and draws the copy and the drop line in `layer`. */
export function beginDrag(options: DragOptions): Drag {
  const { view, layer } = options;
  const copy = document.createElement('div');
  copy.className = 'rl-drag-copy';
  copy.textContent = options.label;
  const line = document.createElement('div');
  line.className = 'rl-drop-line';
  layer.append(copy, line);
  options.dim(true);
  const columns = options.axis === 'col';
  let x = 0;
  let y = 0;
  let current = 0;
  let timer: number | undefined;
  const place = () => {
    const base = layer.getBoundingClientRect();
    const edges = options.boundaries();
    current = dropBoundary(columns ? x : y, edges);
    line.dataset['boundary'] = String(current);
    line.dataset['y'] = String(columns ? x : y);
    line.dataset['edges'] = edges.map((edge) => Math.round(edge)).join(',');
    const box = options.table();
    if (columns) {
      const top = box.top ?? 0;
      line.style.top = `${top - base.top}px`;
      line.style.height = `${Math.max(0, (box.bottom ?? top) - top)}px`;
      line.style.left = `${(edges[current] ?? 0) - base.left - 1}px`;
      line.style.width = '2px';
      return;
    }
    line.style.top = `${(edges[current] ?? 0) - base.top - 1}px`;
    line.style.left = `${box.left - base.left}px`;
    line.style.width = `${Math.max(0, box.right - box.left)}px`;
  };
  const scroll = () => {
    if (columns) {
      const scroller = options.scroller?.();
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();
      const speed = scrollSpeed(x, box.left, box.right);
      if (speed !== 0) {
        scroller.scrollLeft += speed;
        place();
      }
      return;
    }
    const box = view.scrollDOM.getBoundingClientRect();
    const speed = scrollSpeed(y, box.top, box.bottom);
    if (speed !== 0) {
      view.scrollDOM.scrollTop += speed;
      place();
    }
  };
  timer = window.setInterval(scroll, 16);
  return {
    boundary: () => current,
    move(nextX, nextY) {
      x = nextX;
      y = nextY;
      const base = layer.getBoundingClientRect();
      copy.style.left = `${nextX - base.left + 12}px`;
      copy.style.top = `${nextY - base.top + 8}px`;
      place();
    },
    end(cancel = false) {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      options.dim(false);
      copy.remove();
      line.remove();
      return cancel ? null : current;
    },
  };
}
