// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { marginFor, placeAt, placeBack, readingPlace } from './reading-place.ts';

const DOC = ['first line', 'second line', 'third line', 'fourth line'].join('\n');
const DOCUMENT_TOP = 20;

/** A real editor whose layout is stubbed: each line 30 px tall, the document's top at 20. */
function setup(head: number) {
  const scroller = document.createElement('div');
  document.body.append(scroller);
  scroller.getBoundingClientRect = () => new DOMRect(0, 52, 800, 720);
  Object.defineProperty(scroller, 'clientHeight', { value: 720 });
  const view = new EditorView({
    state: EditorState.create({ doc: DOC, selection: { anchor: head } }),
    parent: scroller,
  });
  Object.defineProperty(view, 'documentTop', { get: () => DOCUMENT_TOP });
  Object.defineProperty(view, 'defaultLineHeight', { get: () => 27 });
  view.lineBlockAt = (pos: number) => {
    const line = view.state.doc.lineAt(pos);
    return { from: line.from, top: (line.number - 1) * 30 } as ReturnType<
      EditorView['lineBlockAt']
    >;
  };
  view.lineBlockAtHeight = (height: number) => {
    const index = Math.max(0, Math.min(3, Math.floor(height / 30)));
    return view.lineBlockAt(view.state.doc.line(index + 1).from);
  };
  return { view, scroller };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('readingPlace', () => {
  it("is the caret's line while the caret is on screen", () => {
    const { view, scroller } = setup(14); // in the second line
    view.coordsAtPos = () => ({ left: 0, right: 5, top: 100, bottom: 120 });
    const place = readingPlace(view, scroller);
    // The caret's own row: its position, and its row's top, not the line block's.
    expect(place.pos).toBe(14);
    expect(place.top).toBe(100 - 52);
  });

  it("keeps the caret's row deep in a wrapped line, not the line block's top", () => {
    const { view, scroller } = setup(5);
    // The line's block starts far above the scroller; the caret is in its fifth row.
    view.lineBlockAt = () => ({ from: 0, top: -600 }) as ReturnType<EditorView['lineBlockAt']>;
    view.coordsAtPos = () => ({ left: 0, right: 5, top: 250, bottom: 270 });
    const place = readingPlace(view, scroller);
    expect(place).toEqual({ pos: 5, top: 250 - 52 });
  });

  it('is the line at the top when the caret is off screen', () => {
    const { view, scroller } = setup(14);
    // The caret is far below; the second line's first glyph is drawn 4 px below its block's top.
    view.coordsAtPos = (pos) =>
      pos === 14
        ? { left: 0, right: 5, top: 900, bottom: 920 }
        : { left: 0, right: 5, top: DOCUMENT_TOP + 30 + 4, bottom: DOCUMENT_TOP + 30 + 24 };
    const place = readingPlace(view, scroller);
    // The scroller's top is 52, the document's 20: the height 32 is in the second line (30..60).
    // What CodeMirror scrolls to the margin is the position's coordinates, so those are kept.
    expect(place.pos).toBe(view.state.doc.line(2).from);
    expect(place.top).toBe(DOCUMENT_TOP + 30 + 4 - 52);
    // A line it can't draw coordinates for is kept by its block.
    view.coordsAtPos = () => null;
    const blockOnly = readingPlace(view, scroller);
    expect(blockOnly.pos).toBe(view.state.doc.line(2).from);
    expect(blockOnly.top).toBe(DOCUMENT_TOP + 30 - 52);
  });
});

describe('placeAt', () => {
  it('takes the line under a point, the line at its height beside the text, and the top line outside the editor', () => {
    const { view, scroller } = setup(0);
    view.posAtCoords = ((point: { x: number; y: number }) =>
      point.x < 400 ? view.state.doc.line(3).from + 2 : null) as EditorView['posAtCoords'];
    expect(placeAt(view, scroller, { x: 100, y: 300 }).pos).toBe(view.state.doc.line(3).from);
    // Beside the text: height 140 - 20 = 120 is the fifth 30 px step, so the last line.
    expect(placeAt(view, scroller, { x: 700, y: 140 }).pos).toBe(view.state.doc.line(4).from);
    expect(placeAt(view, scroller, { x: 700, y: 10 }).pos).toBe(view.state.doc.line(2).from);
    expect(placeAt(view, scroller, null).pos).toBe(view.state.doc.line(2).from);
  });
});

describe('placeAt, the line it keeps', () => {
  it("keeps the line's first glyph where it is drawn, which is what a scroll target aligns", () => {
    const { view, scroller } = setup(0);
    view.posAtCoords = () => view.state.doc.line(3).from + 2;
    view.coordsAtPos = (pos) =>
      pos === view.state.doc.line(3).from
        ? { left: 0, right: 5, top: 130, bottom: 150 }
        : { left: 0, right: 5, top: 0, bottom: 0 };
    // The third line's block starts at 20 + 60 = 80, its glyph at 130.
    expect(placeAt(view, scroller, { x: 100, y: 300 })).toEqual({
      pos: view.state.doc.line(3).from,
      top: 130 - 52,
    });
  });
});

describe('marginFor', () => {
  it('puts the line back as many points below the top at another zoom', () => {
    expect(marginFor({ pos: 0, top: 120 }, 1 / 1.5, 600)).toBeCloseTo(80, 9);
    expect(marginFor({ pos: 0, top: 120 }, 1, 600)).toBe(120);
  });

  it('keeps a line near the bottom on screen, and a line above the top where it was', () => {
    expect(marginFor({ pos: 0, top: 700 }, 1, 693)).toBe(693);
    expect(marginFor({ pos: 0, top: -12 }, 1, 693)).toBe(-12);
    const { view, scroller } = setup(0);
    const spy = vi.spyOn(EditorView, 'scrollIntoView');
    placeBack(view, scroller, { pos: 5, top: 700 });
    expect(spy).toHaveBeenCalledWith(5, { y: 'start', yMargin: 693 });
    placeBack(view, scroller, { pos: 5, top: 120 }, 0.5);
    expect(spy).toHaveBeenLastCalledWith(5, { y: 'start', yMargin: 60 });
  });
});
