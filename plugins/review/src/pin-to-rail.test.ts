// @vitest-environment happy-dom
import type { Editor } from '@redlines/editor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PinnedElement, ReviewController } from './index.ts';
import {
  button,
  file,
  frame,
  mount,
  PEOPLE,
  stubHeights,
  stubWidth,
  thread,
  tick,
  unmountAll,
} from './test-helpers.ts';

// An element the host has the rail lay out among its notes (`pinToRail`): Ask's bubble. The rail
// lays it out level with its anchor, as a new comment's box is, and the notes around it make room.

const restores: (() => void)[] = [];
afterEach(() => {
  unmountAll();
  for (const restore of restores.splice(0).reverse()) restore();
  vi.restoreAllMocks();
});

/** Five paragraphs, on lines 1, 3, 5, 7 and 9, with a thread on all but the third. */
const DOC = file(
  [
    'One <!--cmt c2dk-->alpha<!--/c2dk-->.',
    'Two <!--cmt c3fm-->beta<!--/c3fm-->.',
    'Three target words.',
    'Four <!--cmt c4gn-->delta<!--/c4gn-->.',
    'Five <!--cmt c5hp-->epsilon<!--/c5hp-->.',
  ].join('\n\n'),
  [
    ...PEOPLE,
    'comments:',
    ...thread('c2dk', 'bo', 'A'),
    ...thread('c3fm', 'bo', 'B'),
    ...thread('c4gn', 'bo', 'D'),
    ...thread('c5hp', 'bo', 'E'),
  ],
);

/** Two threads level with the third paragraph's word, one before it and one after it. */
const SAME_LINE = file(
  [
    'One <!--cmt c2dk-->alpha<!--/c2dk-->.',
    'Three <!--cmt c3fm-->before<!--/c3fm--> target <!--cmt c4gn-->after<!--/c4gn--> words.',
    'Five <!--cmt c5hp-->epsilon<!--/c5hp-->.',
  ].join('\n\n'),
  [
    ...PEOPLE,
    'comments:',
    ...thread('c2dk', 'bo', 'A'),
    ...thread('c3fm', 'bo', 'B'),
    ...thread('c4gn', 'bo', 'C'),
    ...thread('c5hp', 'bo', 'E'),
  ],
);

/** A file with no comment in it: its rail has no note. */
const NO_NOTES = file('One.\n\nTwo target words.', PEOPLE);

const NOTE = 60;
const GAP = 8;

/**
 * An editor whose paragraphs stand 100 px apart from 100 (line 1, 3, 5...), notes 60 px high, in a
 * window wide enough for the rail, with the notes laid out.
 */
async function load(doc = DOC) {
  restores.push(stubHeights({ 'rl-note': NOTE, 'rl-note-actions': 22 }));
  const { editor, review } = mount(doc);
  stubWidth(editor.view.scrollDOM, 1200);
  const scroll = { by: 0 };
  vi.spyOn(editor.view, 'coordsAtPos').mockImplementation((pos) => {
    const line = editor.view.state.doc.lineAt(pos).number;
    const top = 100 + 100 * ((line - 1) / 2) - scroll.by;
    return { left: 0, right: 5, top, bottom: top + 20 };
  });
  // A move of the selection that is on no anchor makes the rail place its notes again.
  editor.view.dispatch({ selection: { anchor: 0 } });
  await frame();
  const scrollTo = async (by: number) => {
    scroll.by = by;
    editor.view.scrollDOM.scrollTop = by;
    editor.view.scrollDOM.dispatchEvent(new Event('scroll'));
    await frame();
  };
  return { editor, review, scrollTo };
}

const notes = (editor: Editor) => [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-note')];
const top = (el: HTMLElement) => parseFloat(el.style.top);
const tops = (editor: Editor) => notes(editor).map(top);
const railOf = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-rail')!;
const at = (editor: Editor, word: string) => editor.view.state.doc.toString().indexOf(word);

/** An element of the host's, `height` high, in the editor's scroller, where Ask puts its bubble. */
function hostElement(editor: Editor, height: number) {
  const el = document.createElement('div');
  el.className = 'host-box';
  el.append(document.createTextNode('The host’s own words'));
  editor.view.scrollDOM.append(el);
  const box = { height };
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => box.height });
  return { el, box };
}

/** Pins an element of the host's `height` high at the start of `word`. */
function pinAt(
  { editor, review }: { editor: Editor; review: ReviewController },
  word: string,
  height: number,
) {
  const { el, box } = hostElement(editor, height);
  const lost = vi.fn();
  const pin: PinnedElement | null = review.pinToRail(el, () => at(editor, word), lost);
  return { el, box, pin, lost };
}

/** Whether any two of the boxes, each as `[top, height]`, are closer than the gap or overlap. */
function crowded(boxes: [number, number][]): boolean {
  const sorted = [...boxes].sort((a, b) => a[0] - b[0]);
  return sorted.some(([start, height], i) => {
    const next = sorted[i + 1];
    return next !== undefined && next[0] < start + height + GAP;
  });
}

describe('pinToRail', () => {
  it('lays the element out level with its anchor, as a note is, at the rail’s left', async () => {
    const loaded = await load();
    const { editor } = loaded;
    // The notes without it: each level with its own anchor.
    expect(tops(editor)).toEqual([95, 195, 395, 495]);
    const { el, pin } = pinAt(loaded, 'target', 200);
    expect(pin).not.toBeNull();
    await frame();
    // The anchor's line is at 300, and a note is raised by 5 so that the first lines align.
    expect(top(el)).toBe(295);
    expect(el.style.left).not.toBe('');
    expect(el.style.left).toBe(railOf(editor).style.left);
  });

  it('pushes the notes below it down by its height and the gap, and leaves those above alone', async () => {
    const loaded = await load();
    const { editor } = loaded;
    pinAt(loaded, 'target', 200);
    await frame();
    // Alpha and beta, above, stay where they were; delta goes below the element (295 + 200 + 8),
    // and epsilon below delta.
    expect(tops(editor)).toEqual([95, 195, 295 + 200 + GAP, 295 + 200 + GAP + NOTE + GAP]);
  });

  it('lays the notes out again when its height changes', async () => {
    const loaded = await load();
    const { editor } = loaded;
    const { box, pin } = pinAt(loaded, 'target', 200);
    await frame();
    expect(tops(editor).slice(2)).toEqual([503, 571]);
    box.height = 300;
    pin?.resized();
    await frame();
    expect(tops(editor).slice(2)).toEqual([603, 671]);
    // Short, it leaves the notes where their anchors are.
    box.height = 20;
    pin?.resized();
    await frame();
    expect(tops(editor)).toEqual([95, 195, 395, 495]);
  });

  it('returns the notes to their places on release, and leaves the element as it is', async () => {
    const loaded = await load();
    const { editor } = loaded;
    const { el, pin, lost } = pinAt(loaded, 'target', 200);
    await frame();
    expect(tops(editor).slice(2)).toEqual([503, 571]);
    pin?.release();
    await frame();
    expect(tops(editor)).toEqual([95, 195, 395, 495]);
    // The rail never owned it: it is in the page where the host put it, with its content, and
    // never was inside the rail.
    expect(el.parentElement).toBe(editor.view.scrollDOM);
    expect(el.textContent).toBe('The host’s own words');
    expect(railOf(editor).contains(el)).toBe(false);
    // A release is the host's own doing: the rail doesn't say that it let go.
    await tick();
    expect(lost).not.toHaveBeenCalled();
    // Once released, the handle does nothing more.
    expect(() => {
      pin?.resized();
      pin?.reveal();
      pin?.release();
    }).not.toThrow();
    await frame();
    expect(tops(editor)).toEqual([95, 195, 395, 495]);
  });

  it('keeps two notes level with the selection, and covers none', async () => {
    const loaded = await load(SAME_LINE);
    const { editor } = loaded;
    const { el } = pinAt(loaded, 'target', 200);
    await frame();
    const shown = notes(editor);
    expect(shown).toHaveLength(4);
    // The element is level with the selection (200, raised by 5). The note on the word before it
    // goes up, clear of it, and the note on the word after it down, below it; alpha, above, makes
    // room for the first, and epsilon, below, for the second.
    expect(top(el)).toBe(195);
    expect(shown.map(top)).toEqual([
      195 - GAP - NOTE - GAP - NOTE,
      195 - GAP - NOTE,
      195 + 200 + GAP,
      195 + 200 + GAP + NOTE + GAP,
    ]);
    expect(
      crowded([...shown.map((note): [number, number] => [top(note), NOTE]), [top(el), 200]]),
    ).toBe(false);
  });

  it('puts a note on the same text above it, as it does for a new comment’s box', async () => {
    const loaded = await load();
    const { editor } = loaded;
    const { el } = pinAt(loaded, 'delta', 100);
    await frame();
    // Delta's own note and the element have one anchor: the note goes up, clear of the element
    // (395 - 8 - 60), and epsilon goes below it (395 + 100 + 8).
    expect(top(el)).toBe(395);
    expect(tops(editor)).toEqual([95, 195, 327, 503]);
  });

  it('keeps it level with its anchor wherever the page is scrolled to, as a new comment is', async () => {
    const loaded = await load();
    const { editor, scrollTo } = loaded;
    const { el } = pinAt(loaded, 'target', 200);
    await frame();
    expect(tops(editor)).toEqual([95, 195, 503, 571]);
    // Scrolled far past every anchor: the notes are not arranged around the last one instead.
    await scrollTo(1000);
    expect(top(el)).toBe(295);
    expect(tops(editor)).toEqual([95, 195, 503, 571]);
    await scrollTo(0);
    expect(top(el)).toBe(295);
    expect(tops(editor)).toEqual([95, 195, 503, 571]);
  });

  it('follows its anchor through edits', async () => {
    const loaded = await load();
    const { editor } = loaded;
    const { el } = pinAt(loaded, 'target', 200);
    await frame();
    expect(top(el)).toBe(295);
    // A paragraph above it: everything is two lines, 100 px, lower, and the anchor went with the text.
    editor.view.dispatch({ changes: { from: 0, insert: 'A new first paragraph.\n\n' } });
    await frame();
    expect(top(el)).toBe(395);
    expect(tops(editor).slice(2)).toEqual([603, 671]);
  });

  it('keeps clear of a new comment being written, which is laid out too', async () => {
    const loaded = await load();
    const { editor, review } = loaded;
    const { el } = pinAt(loaded, 'target', 200);
    const from = at(editor, 'delta');
    editor.view.dispatch({ selection: { anchor: from, head: from + 5 } });
    expect(review.startComment()).toBe(true);
    await frame();
    // Alpha, beta, the new comment, delta and epsilon: none touches the element or another note.
    const shown = notes(editor);
    expect(shown).toHaveLength(5);
    expect(top(el)).toBe(295);
    expect(
      crowded([...shown.map((note): [number, number] => [top(note), NOTE]), [top(el), 200]]),
    ).toBe(false);
  });

  it('makes the page as long as the element needs', async () => {
    const loaded = await load();
    const { editor } = loaded;
    pinAt(loaded, 'epsilon', 400);
    await frame();
    // At epsilon's line (500, raised by 5), 400 high, with a foot of 24 under it.
    expect(parseFloat(editor.view.scrollDOM.style.minHeight)).toBeGreaterThanOrEqual(
      495 + 400 + 24,
    );
  });

  it('scrolls it into view once the rail has placed it', async () => {
    const loaded = await load();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { el, pin } = pinAt(loaded, 'target', 200);
    pin?.reveal();
    expect(scroll).not.toHaveBeenCalled();
    await frame();
    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll.mock.contexts[0]).toBe(el);
    expect(top(el)).toBe(295);
  });

  it('writes its place again when the host placed it in between', async () => {
    const loaded = await load();
    const { editor, review } = loaded;
    const { el, pin } = pinAt(loaded, 'target', 200);
    await frame();
    expect(top(el)).toBe(295);
    pin?.release();
    // The host hangs it by the selection itself, as it does where the rail doesn't hold it.
    el.style.top = '999px';
    const again = review.pinToRail(
      el,
      () => at(editor, 'target'),
      () => {},
    );
    expect(again).not.toBeNull();
    await frame();
    expect(top(el)).toBe(295);
  });

  it('takes an anchor past the end of the text', async () => {
    const loaded = await load();
    const { editor, review } = loaded;
    const { el } = hostElement(editor, 100);
    expect(
      review.pinToRail(
        el,
        () => 10_000_000,
        () => {},
      ),
    ).not.toBeNull();
    await frame();
    expect(top(el)).not.toBeNaN();
  });

  describe('where the rail does not show its notes in full', () => {
    it('takes nothing in a narrow editor, where the notes are dots', async () => {
      const loaded = await load();
      const { editor, review } = loaded;
      stubWidth(editor.view.scrollDOM, 700);
      editor.view.dispatch({ selection: { anchor: 1 } });
      await frame();
      await tick();
      expect(railOf(editor).classList).toContain('rl-rail-compact');
      const { el, pin, lost } = pinAt({ editor, review }, 'target', 200);
      expect(pin).toBeNull();
      await frame();
      expect(lost).not.toHaveBeenCalled();
      // It is left as it is: no place was written.
      expect(el.style.top).toBe('');
      expect(el.style.left).toBe('');
    });

    it('takes nothing in Clean or Raw, where the rail shows no note', async () => {
      const loaded = await load();
      loaded.editor.setViewMode('clean');
      expect(pinAt(loaded, 'target', 200).pin).toBeNull();
      loaded.editor.setViewMode('raw');
      expect(pinAt(loaded, 'target', 200).pin).toBeNull();
      loaded.editor.setViewMode('redlines');
      expect(pinAt(loaded, 'target', 200).pin).not.toBeNull();
    });

    it('takes nothing while it has no note of its own: the column makes no room for one', async () => {
      const bare = await load(NO_NOTES);
      bare.editor.setViewMode('redlines');
      expect(bare.editor.view.dom.classList).not.toContain('rl-has-rail');
      const { el, pin } = pinAt(bare, 'target', 200);
      expect(pin).toBeNull();
      await frame();
      expect(el.style.top).toBe('');
      expect(bare.editor.view.dom.classList).not.toContain('rl-has-rail');
    });

    it('lets go of it when the editor turns narrow, and says so once, for the host to place it', async () => {
      const loaded = await load();
      const { editor } = loaded;
      const { el, pin, lost } = pinAt(loaded, 'target', 200);
      await frame();
      expect(top(el)).toBe(295);
      stubWidth(editor.view.scrollDOM, 700);
      editor.view.dispatch({ selection: { anchor: 1 } });
      await frame();
      await tick();
      expect(railOf(editor).classList).toContain('rl-rail-compact');
      expect(lost).toHaveBeenCalledOnce();
      // The dots are the notes' alone: one for each note, and none for the element.
      expect(editor.view.dom.querySelectorAll('.rl-note-dot')).toHaveLength(4);
      // Nothing of the host's is removed, and what it holds does nothing now.
      expect(el.parentElement).toBe(editor.view.scrollDOM);
      pin?.release();
      pin?.resized();
      await frame();
      expect(lost).toHaveBeenCalledOnce();
      // The rail is whole again, and takes it.
      stubWidth(editor.view.scrollDOM, 1200);
      editor.view.dispatch({ selection: { anchor: 2 } });
      await frame();
      await tick();
      expect(railOf(editor).classList).not.toContain('rl-rail-compact');
      expect(pinAt(loaded, 'target', 200).pin).not.toBeNull();
    });

    it('lets go of it when the view is Clean, and when the last note goes', async () => {
      const loaded = await load();
      const { editor } = loaded;
      const first = pinAt(loaded, 'target', 200);
      await frame();
      editor.setViewMode('clean');
      // After the update that did it, not in it: the host places the element by reading the
      // layout, which an update doesn't allow.
      expect(first.lost).not.toHaveBeenCalled();
      await tick();
      expect(first.lost).toHaveBeenCalledOnce();
      editor.setViewMode('redlines');
      await frame();
      expect(tops(editor)).toEqual([95, 195, 395, 495]);
      // A rail whose last note is gone is no rail: the column takes its room back.
      const second = pinAt(loaded, 'target', 200);
      expect(second.pin).not.toBeNull();
      await frame();
      expect(tops(editor).slice(2)).toEqual([503, 571]);
      for (let left = 4; left > 0; left--) {
        expect(second.lost).not.toHaveBeenCalled();
        button(notes(editor)[0]!, 'Resolve').click();
      }
      await tick();
      expect(notes(editor)).toHaveLength(0);
      expect(second.lost).toHaveBeenCalledOnce();
    });

    it('says so, once, when the rail goes with its document', async () => {
      const loaded = await load();
      const { editor } = loaded;
      const { lost } = pinAt(loaded, 'target', 200);
      await frame();
      editor.setDoc(NO_NOTES);
      await tick();
      expect(lost).toHaveBeenCalledOnce();
    });
  });
});
