// @vitest-environment happy-dom
// The crop box's keys (#851): every handle can be reached with Tab, named, and moved with the arrow
// keys, the box's size is spoken once a run of key presses has ended, and Return and Escape work from
// any of them.
import { forceParsing } from '@codemirror/language';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CROP_HINT, CROP_LABEL, startCrop, type CropRect } from './image-crop.ts';
import { createEditor, type Editor } from './index.ts';

const open: Editor[] = [];
const sessions: { close(): void }[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  for (const session of sessions.splice(0)) session.close();
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** An editor with one picture drawn 200 by 100 px (800 by 400 px natural), selected. */
function load() {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = '![A cat](cat.png)\n\nWords';
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    resolveImage: (src) => `app://${src}`,
  });
  open.push(editor);
  forceParsing(editor.view, doc.length, 5000);
  editor.view.dispatch({ selection: { anchor: 0, head: 17 } });
  const img = editor.view.contentDOM.querySelector<HTMLImageElement>('.rl-image img');
  if (!img) throw new Error('the picture is not drawn');
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: 800 });
  Object.defineProperty(img, 'naturalHeight', { value: 400 });
  img.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
  const crops: CropRect[] = [];
  const session = startCrop(
    editor.view,
    async (_src, crop) => {
      crops.push(crop);
      return 'cat-crop.png';
    },
    () => {},
  );
  if (!session) throw new Error('no crop box');
  sessions.push(session);
  return { editor, session, crops };
}

const handles = () => [...document.querySelectorAll<HTMLElement>('.rl-crop-handle')];
const handle = (side: string) => document.querySelector<HTMLElement>(`[data-side='${side}']`)!;
const box = () => document.querySelector<HTMLElement>('.rl-crop-box')!;
const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
  const options = { key, bubbles: true, cancelable: true, ...init };
  target.dispatchEvent(new KeyboardEvent('keydown', options));
  target.dispatchEvent(new KeyboardEvent('keyup', options));
};
/** The box in px of the picture as drawn: left, top, width, height. */
const rect = () => {
  const style = box().style;
  return [style.left, style.top, style.width, style.height].map((v) => Number.parseFloat(v));
};

describe('The crop box for the keyboard and a screen reader', () => {
  it('names the box, and gives the hint as its description, not its label', () => {
    load();
    expect(box().getAttribute('aria-label')).toBe(CROP_LABEL);
    const described = document.getElementById(box().getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe(CROP_HINT);
  });

  it('makes each of the eight handles a stop for Tab, in order round the box, with its own name', () => {
    load();
    const found = handles();
    expect(found.map((h) => h.dataset['side'])).toEqual([
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
    ]);
    for (const h of found) expect(h.tabIndex).toBe(0);
    expect(found.map((h) => h.getAttribute('aria-label'))).toEqual([
      'Top left corner, crop handle',
      'Top edge, crop handle',
      'Top right corner, crop handle',
      'Right edge, crop handle',
      'Bottom right corner, crop handle',
      'Bottom edge, crop handle',
      'Bottom left corner, crop handle',
      'Left edge, crop handle',
    ]);
  });

  it('resizes from the focused handle: the top left corner grows up and left, and only there', () => {
    load();
    expect(rect()).toEqual([20, 10, 160, 80]);
    press(handle('nw'), 'ArrowLeft');
    press(handle('nw'), 'ArrowUp', { shiftKey: true });
    expect(rect()).toEqual([19, 0, 161, 90]);
    press(handle('nw'), 'ArrowRight', { shiftKey: true });
    expect(rect()).toEqual([29, 0, 151, 90]);
  });

  it('moves one edge with its own arrows and ignores the others', () => {
    load();
    press(handle('e'), 'ArrowRight');
    expect(rect()).toEqual([20, 10, 161, 80]);
    press(handle('e'), 'ArrowDown');
    expect(rect()).toEqual([20, 10, 161, 80]);
    press(handle('w'), 'ArrowLeft');
    expect(rect()).toEqual([19, 10, 162, 80]);
    press(handle('s'), 'ArrowUp');
    expect(rect()).toEqual([19, 10, 162, 79]);
    press(handle('n'), 'ArrowUp');
    expect(rect()).toEqual([19, 9, 162, 80]);
  });

  it('keeps the box as it was: arrows on the box move it, Shift resizes it from the corner', () => {
    load();
    press(box(), 'ArrowRight');
    expect(rect()).toEqual([21, 10, 160, 80]);
    press(box(), 'ArrowDown', { shiftKey: true });
    expect(rect()).toEqual([21, 10, 160, 81]);
  });

  it('speaks the size and place once, after the last key press of a run', () => {
    load();
    const status = document.querySelector('.rl-crop-sr[role="status"]')!;
    expect(document.querySelector('.rl-crop [aria-live]')).toBeNull();
    for (let i = 0; i < 5; i++) press(handle('se'), 'ArrowRight');
    expect(status.textContent).toBe('');
    vi.advanceTimersByTime(500);
    expect(status.textContent).toBe(
      '660 by 320 pixels, 10 percent from the left, 10 percent from the top',
    );
  });

  it('crops with Return and leaves with Escape from a handle', async () => {
    const { session, crops } = load();
    press(handle('s'), 'Enter');
    await vi.advanceTimersByTimeAsync(10);
    expect(crops).toHaveLength(1);
    expect(session.isOpen()).toBe(false);
    const again = load();
    press(handle('ne'), 'Escape');
    expect(again.session.isOpen()).toBe(false);
    expect(again.crops).toHaveLength(0);
  });
});
