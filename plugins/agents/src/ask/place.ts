// Where the bubble hangs: level with the selection, in the margin to the right of the text column,
// where the comment rail's notes are, so that it reads as a note does; and under the selection when
// the window leaves no room beside the column. It is placed in the editor's scroller, in the page's
// coordinates, so that it scrolls with the text.

import type { EditorView } from '@codemirror/view';
import { BUBBLE_WIDTH } from './styles.ts';

/** The rail's gap from the text column, at the theme's own size (`RAIL_GAP` of the review plugin). */
const GAP = 44;
/** The least space to the window's edge. */
const EDGE = 16;
/** The space between the selection and a bubble under it. */
const BELOW = 8;

/** The top and bottom of `from`–`to` in the window's coordinates, or null when it isn't drawn. */
function boxOf(view: EditorView, from: number, to: number): { top: number; bottom: number } | null {
  const start = view.coordsAtPos(from, 1);
  const end = view.coordsAtPos(to, -1);
  if (start && end)
    return { top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) };
  // Not drawn (far from what is on screen): the block that holds it knows where it is.
  const block = view.lineBlockAt(from);
  const top = view.documentTop + block.top;
  return { top, bottom: top + block.height };
}

/** Places `bubble` by the text `from`–`to` of `view`. */
export function placeBubble(
  view: EditorView,
  bubble: HTMLElement,
  range: { from: number; to: number },
): void {
  const win = view.dom.ownerDocument.defaultView ?? window;
  const scroller = view.scrollDOM.getBoundingClientRect();
  const originTop = scroller.top - view.scrollDOM.scrollTop;
  const originLeft = scroller.left - view.scrollDOM.scrollLeft;
  const box = boxOf(view, range.from, range.to);
  if (!box) return;
  const content = view.contentDOM.getBoundingClientRect();
  const style = win.getComputedStyle(view.contentDOM);
  const scale = Math.max(1, parseFloat(style.getPropertyValue('--rl-text-scale')) || 1);
  // The right edge of the text column: the content's padding on its right keeps the rail's room.
  const columnRight = content.right - (parseFloat(style.paddingRight) || 0);
  const width = BUBBLE_WIDTH * scale;
  const beside = columnRight + GAP * scale;
  if (beside + width + EDGE <= scroller.right) {
    bubble.style.left = `${beside - originLeft}px`;
    bubble.style.top = `${box.top - originTop}px`;
    return;
  }
  // Under the selection, within the column.
  const columnLeft = content.left + (parseFloat(style.paddingLeft) || 0);
  const left = Math.min(Math.max(columnLeft, scroller.left + EDGE), scroller.right - width - EDGE);
  bubble.style.left = `${Math.max(left, scroller.left + EDGE) - originLeft}px`;
  bubble.style.top = `${box.bottom + BELOW - originTop}px`;
}
