// The place a person is reading, kept across a change that rewraps the text: a zoom, a text size.
// It is taken from CodeMirror's layout before the change and handed back as a scroll target after
// it, so the next measure lays the text out and scrolls the line back before the frame is drawn.

import { EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';

/** A line to keep in place: where it starts, and its top's distance below the scroller's top, in CSS px. */
export interface ReadingPlace {
  pos: number;
  top: number;
}

function placeOfLine(view: EditorView, scroller: HTMLElement, pos: number): ReadingPlace {
  const block = view.lineBlockAt(pos);
  const rect = scroller.getBoundingClientRect();
  // What a scroll target puts at the margin is the position's own coordinates (its first glyph,
  // a little below its block's top), so those are kept; the block's top only for a line CodeMirror
  // has no coordinates for, one it hasn't drawn.
  const coords = view.coordsAtPos(block.from);
  return {
    pos: block.from,
    top: coords ? coords.top - rect.top : view.documentTop + block.top - rect.top,
  };
}

function topLine(view: EditorView, scroller: HTMLElement): ReadingPlace {
  const block = view.lineBlockAtHeight(scroller.getBoundingClientRect().top - view.documentTop);
  return placeOfLine(view, scroller, block.from);
}

/** The caret's visual row while the caret is on screen, else the line at the top. */
export function readingPlace(view: EditorView, scroller: HTMLElement): ReadingPlace {
  const rect = scroller.getBoundingClientRect();
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  if (coords && coords.top >= rect.top && coords.bottom <= rect.bottom) {
    // The caret's own row, not its line's: in a wrapped paragraph the line block starts rows above.
    return { pos: head, top: coords.top - rect.top };
  }
  return topLine(view, scroller);
}

/** The line under `point`: by position over the text, by height beside it, else the top line. */
export function placeAt(
  view: EditorView,
  scroller: HTMLElement,
  point: { x: number; y: number } | null,
): ReadingPlace {
  if (!point) return topLine(view, scroller);
  const rect = scroller.getBoundingClientRect();
  if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) {
    return topLine(view, scroller);
  }
  const pos = view.posAtCoords(point);
  if (pos !== null) return placeOfLine(view, scroller, pos);
  const block = view.lineBlockAtHeight(point.y - view.documentTop);
  return placeOfLine(view, scroller, block.from);
}

/** `place.top` times `factor` (the old zoom over the new), kept at most `room`. */
export function marginFor(place: ReadingPlace, factor: number, room: number): number {
  return Math.min(place.top * factor, room);
}

/** The scroll target that puts the line back: `EditorView.scrollIntoView(place.pos, { y: 'start', yMargin })`. */
export function placeBack(
  view: EditorView,
  scroller: HTMLElement,
  place: ReadingPlace,
  factor = 1,
): StateEffect<unknown> {
  const room = scroller.clientHeight - view.defaultLineHeight;
  const pos = Math.min(place.pos, view.state.doc.length);
  return EditorView.scrollIntoView(pos, { y: 'start', yMargin: marginFor(place, factor, room) });
}
