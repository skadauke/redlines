// @vitest-environment happy-dom
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeBubble } from './place.ts';

afterEach(() => vi.restoreAllMocks());

const box = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top }) as DOMRect;

interface Layout {
  /** The scroller's window box, and how far it is scrolled. */
  scroller?: DOMRect;
  scrollTop?: number;
  /** The content's window box and its padding: the text column is between the paddings. */
  content?: DOMRect;
  padding?: { left: number; right: number };
  scale?: number;
  /** Where the selection is, in the window, or null when it isn't drawn. */
  coords?: { top: number; bottom: number } | null;
}

/** A view that has the layout and answers what `placeBubble` asks. */
function viewWith(layout: Layout = {}): EditorView {
  const scroller = layout.scroller ?? box(0, 52, 1400, 652);
  const content = layout.content ?? box(260, 0, 940, 3000);
  const padding = layout.padding ?? { left: 24, right: 24 };
  const coords = layout.coords === undefined ? { top: 300, bottom: 320 } : layout.coords;
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) =>
      name === '--rl-text-scale' ? String(layout.scale ?? 1) : '',
    paddingRight: `${padding.right}px`,
    paddingLeft: `${padding.left}px`,
  } as unknown as CSSStyleDeclaration);
  return {
    dom: document.body,
    scrollDOM: {
      getBoundingClientRect: () => scroller,
      scrollTop: layout.scrollTop ?? 0,
      scrollLeft: 0,
    },
    contentDOM: { getBoundingClientRect: () => content },
    coordsAtPos: () => coords,
    lineBlockAt: () => ({ top: 700, height: 24 }),
    documentTop: 52,
  } as unknown as EditorView;
}

function placed(view: EditorView) {
  const bubble = document.createElement('div');
  placeBubble(view, bubble, { from: 10, to: 20 });
  return { left: parseFloat(bubble.style.left), top: parseFloat(bubble.style.top) };
}

describe('placeBubble', () => {
  it('hangs beside the selection, in the margin right of the text column, level with its top', () => {
    // The column ends at 940 - 24 = 916; the rail's gap is 44.
    const { left, top } = placed(viewWith());
    expect(left).toBe(916 + 44);
    // In the scroller's coordinates: the selection's top less the scroller's.
    expect(top).toBe(300 - 52);
  });

  it('follows the scroll: the place is in the page, not in the window', () => {
    // The scroller shows the page 200 down: the same place on the page is 200 lower on it.
    const { top } = placed(viewWith({ scrollTop: 200 }));
    expect(top).toBe(300 - 52 + 200);
  });

  it('grows with the text size, as the notes do', () => {
    const { left } = placed(viewWith({ scale: 1.5 }));
    expect(left).toBe(916 + 44 * 1.5);
  });

  it('goes under the selection, within the column, where the window leaves no room beside it', () => {
    const view = viewWith({ scroller: box(0, 52, 1000, 652) });
    const { left, top } = placed(view);
    expect(left).toBe(260 + 24);
    expect(top).toBe(320 + 8 - 52);
  });

  it('keeps inside the window when the column is far to the right', () => {
    const view = viewWith({
      scroller: box(0, 52, 600, 652),
      content: box(500, 0, 1000, 3000),
      padding: { left: 24, right: 24 },
    });
    const { left } = placed(view);
    // 600 wide, a bubble of 248 and 16 of margin: the most left is 336.
    expect(left).toBe(600 - 248 - 16);
  });

  it('finds the line by its block when the selection is not drawn', () => {
    const { top } = placed(viewWith({ coords: null }));
    // The block's top in the window is the document's top (52) plus 700.
    expect(top).toBe(52 + 700 - 52);
  });
});
