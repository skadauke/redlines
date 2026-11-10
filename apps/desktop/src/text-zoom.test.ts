// @vitest-environment happy-dom
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { followTextZoom, type TextZoom } from './text-zoom.ts';

const DOC = ['first line', 'second line', 'third line', 'fourth line'].join('\n');
const SCALE = '--rl-text-scale';

let zooms: TextZoom[] = [];

/** A real editor whose layout is stubbed (as reading-place.test.ts does), the caret on line two. */
function setup(size = 1) {
  const scroller = document.createElement('div');
  document.body.append(scroller);
  scroller.getBoundingClientRect = () => new DOMRect(0, 52, 800, 720);
  Object.defineProperty(scroller, 'clientHeight', { value: 720 });
  const edits = vi.fn();
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      selection: { anchor: 14 },
      extensions: EditorView.updateListener.of((update) => {
        if (update.docChanged) edits();
      }),
    }),
    parent: scroller,
  });
  Object.defineProperty(view, 'documentTop', { get: () => 20 });
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
  view.coordsAtPos = () => ({ left: 0, right: 5, top: 100, bottom: 120 });
  view.posAtCoords = () => 25;
  const root = document.documentElement;
  root.style.removeProperty(SCALE);
  const calls = {
    holdRail: vi.fn(),
    save: vi.fn(),
    say: vi.fn(),
  };
  // What the page showed at each dispatch, and what the dispatch carried.
  const seen: { scale: string; effects: boolean }[] = [];
  const dispatch = view.dispatch.bind(view) as (...specs: TransactionSpec[]) => void;
  view.dispatch = ((...specs: TransactionSpec[]) => {
    const [spec] = specs;
    seen.push({ scale: root.style.getPropertyValue(SCALE), effects: !!spec?.effects });
    dispatch(...specs);
  }) as EditorView['dispatch'];
  const zoom = followTextZoom(window, { view, scroller, root, size: () => size, ...calls });
  zooms.push(zoom);
  return { zoom, view, root, edits, seen, ...calls };
}

function gesture(type: string, scale?: number): Event {
  const event = new Event(type, { cancelable: true });
  if (scale !== undefined) Object.defineProperty(event, 'scale', { value: scale });
  return event;
}
const send = (type: string, scale?: number) => window.dispatchEvent(gesture(type, scale));

afterEach(() => {
  for (const zoom of zooms) zoom.stop();
  zooms = [];
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('followTextZoom', () => {
  it('applies each size with its place in one call, so that no frame shows one without the other', () => {
    const { seen } = setup();
    send('gesturestart');
    send('gesturechange', 1.1);
    send('gesturechange', 1.2);
    send('gesturechange', 1.2);
    // One dispatch for each new size; the size is on the page, and the dispatch carries the place.
    expect(seen).toEqual([
      { scale: '1.1', effects: true },
      { scale: '1.2', effects: true },
    ]);
    send('gestureend');
  });

  it('holds the rail from the first event until the fingers lift, and saves once', () => {
    const { holdRail, save, say } = setup();
    send('gesturestart');
    expect(holdRail).toHaveBeenCalledTimes(1);
    expect(holdRail).toHaveBeenLastCalledWith(true);
    send('gesturechange', 1.2);
    send('gesturechange', 1.37);
    expect(save).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    send('gestureend');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(1.37);
    expect(holdRail).toHaveBeenCalledTimes(2);
    expect(holdRail).toHaveBeenLastCalledWith(false);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith('Text size 137%');
  });

  it('lets the rail go when the window loses the focus with the fingers down', () => {
    const { holdRail, save } = setup();
    send('gesturestart');
    send('gesturechange', 1.5);
    window.dispatchEvent(new Event('blur'));
    send('gestureend');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(1.5);
    expect(holdRail).toHaveBeenLastCalledWith(false);
    expect(holdRail).toHaveBeenCalledTimes(2);
  });

  it("steps from a size between rungs to the next, keeping the caret's line", () => {
    const { zoom, root, seen, save, say } = setup(1.37);
    zoom.step(1);
    expect(save).toHaveBeenCalledWith(1.5);
    expect(root.style.getPropertyValue(SCALE)).toBe('1.5');
    expect(seen).toEqual([{ scale: '1.5', effects: true }]);
    expect(say).toHaveBeenCalledWith('Text size 150%');
    // From 150% the next one down is 125%.
    zoom.step(-1);
    expect(save).toHaveBeenLastCalledWith(1.25);
    // The top of the ladder.
    const top = setup(2);
    top.zoom.step(1);
    expect(top.save).not.toHaveBeenCalled();
    expect(top.seen).toEqual([]);
  });

  it('goes back to 100% with reset, and says nothing at 100%', () => {
    const { zoom, root, save, say } = setup(1.37);
    zoom.reset();
    expect(root.style.getPropertyValue(SCALE)).toBe('1');
    expect(save).toHaveBeenCalledWith(1);
    expect(say).toHaveBeenCalledWith('Text size 100%');
    zoom.reset();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('takes the place before applying a size another window saved', () => {
    const { zoom, view, root, seen, save, say } = setup(1);
    const scaleWhenRead: string[] = [];
    view.coordsAtPos = () => {
      scaleWhenRead.push(root.style.getPropertyValue(SCALE));
      return { left: 0, right: 5, top: 100, bottom: 120 };
    };
    root.style.setProperty(SCALE, '1');
    zoom.follow(1.37);
    expect(scaleWhenRead).toEqual(['1']);
    expect(root.style.getPropertyValue(SCALE)).toBe('1.37');
    expect(seen).toEqual([{ scale: '1.37', effects: true }]);
    // Not saved again, nor said: it is another window's.
    expect(save).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    // The size it already has changes nothing.
    zoom.follow(1.37);
    expect(seen).toHaveLength(1);
  });

  it('leaves a size from another window until the fingers lift', () => {
    const { zoom, root } = setup(1);
    send('gesturestart');
    send('gesturechange', 1.2);
    zoom.follow(1.75);
    expect(root.style.getPropertyValue(SCALE)).toBe('1.2');
    send('gestureend');
  });

  it("puts right what is left of the line's place once CodeMirror has measured", async () => {
    const { zoom, view } = setup(1);
    const scroller = view.dom.parentElement!;
    scroller.scrollTop = 0;
    zoom.follow(1.1);
    // CodeMirror's scroll left the caret's row 2 px low.
    view.coordsAtPos = () => ({
      left: 0,
      right: 5,
      top: 102 - scroller.scrollTop,
      bottom: 122 - scroller.scrollTop,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scroller.scrollTop).toBe(2);
    // Where it is wanted, nothing moves.
    view.coordsAtPos = () => ({ left: 0, right: 5, top: 100, bottom: 120 });
    zoom.follow(1.25);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scroller.scrollTop).toBe(2);
  });

  it('rounds the correction to whole pixels, which is all WebKit keeps of a scroll', async () => {
    const { zoom, view } = setup(1);
    const scroller = view.dom.parentElement!;
    scroller.scrollTop = 0;
    zoom.follow(1.1);
    view.coordsAtPos = () => ({
      left: 0,
      right: 5,
      top: 100.6 - scroller.scrollTop,
      bottom: 120.6 - scroller.scrollTop,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scroller.scrollTop).toBe(1);
  });

  it("aims every change of a run at the first one's place, so that errors do not pile up", async () => {
    const { zoom, view } = setup(1);
    const scroller = view.dom.parentElement!;
    scroller.scrollTop = 0;
    let extra = 0;
    view.coordsAtPos = () => ({
      left: 0,
      right: 5,
      top: 100 + extra - scroller.scrollTop,
      bottom: 120 + extra - scroller.scrollTop,
    });
    zoom.follow(1.1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The line was left 0.4 px low, under a correction. A second change aims at the first place
    // (the row at 100), not at 100.4: landing 0.6 low it moves the scroll by a pixel, where a
    // place taken again would have found 0.2 and left it.
    extra = 0.4;
    zoom.follow(1.25);
    extra = 0.6;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scroller.scrollTop).toBe(1);
    // The person scrolls: the next change takes a place of its own.
    scroller.scrollTop = 30;
    extra = 0;
    zoom.follow(1.5);
    extra = 0.4;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scroller.scrollTop).toBe(30);
  });

  it('is never an edit', () => {
    const { zoom, view, edits, seen } = setup(1);
    const doc = view.state.doc;
    send('gesturestart');
    send('gesturechange', 1.3);
    send('gestureend');
    zoom.step(1);
    zoom.reset();
    zoom.follow(0.8);
    expect(seen.length).toBeGreaterThan(3);
    expect(view.state.doc).toBe(doc);
    expect(edits).not.toHaveBeenCalled();
  });
});
