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
    expect(place.pos).toBe(view.state.doc.line(2).from);
    expect(place.top).toBe(DOCUMENT_TOP + 30 - 52);
  });

  it('is the line at the top when the caret is off screen', () => {
    const { view, scroller } = setup(14);
    view.coordsAtPos = () => ({ left: 0, right: 5, top: 900, bottom: 920 });
    const place = readingPlace(view, scroller);
    // The scroller's top is 52, the document's 20: the height 32 is in the second line (30..60).
    expect(place.pos).toBe(view.state.doc.line(2).from);
    expect(place.top).toBe(DOCUMENT_TOP + 30 - 52);
    view.coordsAtPos = () => null;
    expect(readingPlace(view, scroller).pos).toBe(view.state.doc.line(2).from);
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
