// Crop an image (#624): the Image menu's Crop… puts a crop box over the picture, with a handle at each
// corner and edge. Return or Done keeps what is inside the box, Escape (or a press outside) leaves the
// picture as it was. The crop itself is a copy: the host writes a cropped copy of the file beside the
// original, in the project's folder for images, and the document's reference is pointed at the copy
// (`setImageSrc`, an ordinary change: tracked with Track Changes on, and one Undo takes it back). The
// original file stays where it is, so rejecting the change gets it back, and the copy is a plain image
// that renders the same everywhere, GitHub included. The width and the alignment are not touched.

import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { imageAt, imageInSelection, setImageSrc } from './image-size.ts';
import { localImageAt } from './preview/image.ts';

/** The part of an image that is kept, as fractions (0 to 1) of its width and height from its top left. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the host does with a crop (`EditorOptions.cropImage`): makes the cropped copy of the local
 * image `src` (its path as the document writes it, decoded), and answers with the path the document
 * links the copy by, relative to the document and decoded. May reject with a sentence for the person.
 */
export type ImageCropper = (src: string, crop: CropRect) => Promise<string>;

/** The least width and height of the box, in px of the picture as it is drawn. */
const MIN_PX = 24;
/** The most of a picture that still counts as the whole of it: no copy is made for that. */
const WHOLE = 0.995;

type Side = 'n' | 's' | 'e' | 'w';
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const HANDLE_NAMES: Record<(typeof HANDLES)[number], string> = {
  nw: 'Top left corner',
  n: 'Top edge',
  ne: 'Top right corner',
  e: 'Right edge',
  se: 'Bottom right corner',
  s: 'Bottom edge',
  sw: 'Bottom left corner',
  w: 'Left edge',
};
/** The pause after the last arrow key press before the box's size and place are spoken, in ms. */
const ANNOUNCE_MS = 400;

/** The box's name, and its hint, which describes it (`aria-describedby`) and is not its label. */
export const CROP_LABEL = 'Crop box';
export const CROP_HINT =
  'Arrow keys move the box. Tab to a handle and the arrow keys resize it from that side or corner, ' +
  'Shift with the arrows takes larger steps. Return crops, Escape cancels.';
export const CROP_NO_IMAGE = 'Select an image to crop it.';
export const CROP_REMOTE = 'Only a picture kept in a file can be cropped.';
export const CROP_RAW = 'Crop works on the picture as it reads. Show Clean or Redlines first.';
export const CROP_NOT_POINTED =
  'The image could not be pointed at the cropped copy, so it was left as it was.';
export const CROP_MOVED = 'The image moved before it was cropped, so it was left as it was.';

const STYLE_ID = 'rl-crop-style';
const STYLE = `
.rl-crop { position: absolute; z-index: 30; overflow: hidden; touch-action: none; user-select: none; }
.rl-crop-box { position: absolute; box-sizing: border-box; cursor: move; border: 1px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 0 100vmax rgba(0, 0, 0, 0.5);
  background-image: linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255, 255, 255, 0.55) calc(33.33% - 0.5px), rgba(255, 255, 255, 0.55) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255, 255, 255, 0.55) calc(66.66% - 0.5px), rgba(255, 255, 255, 0.55) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)),
    linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255, 255, 255, 0.55) calc(33.33% - 0.5px), rgba(255, 255, 255, 0.55) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255, 255, 255, 0.55) calc(66.66% - 0.5px), rgba(255, 255, 255, 0.55) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)); }
.rl-crop-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.rl-crop-handle:focus-visible { outline: 2px solid var(--rl-ink); outline-offset: 2px; }
.rl-crop-box:focus-visible { outline: 2px solid var(--rl-ink); outline-offset: 2px; }
.rl-crop-handle { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; box-sizing: border-box;
  background: #fff; border-radius: 3px; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 1px 3px rgba(0, 0, 0, 0.35); }
.rl-crop-handle[data-side='nw'], .rl-crop-handle[data-side='se'] { cursor: nwse-resize; }
.rl-crop-handle[data-side='ne'], .rl-crop-handle[data-side='sw'] { cursor: nesw-resize; }
.rl-crop-handle[data-side='n'], .rl-crop-handle[data-side='s'] { cursor: ns-resize; }
.rl-crop-handle[data-side='e'], .rl-crop-handle[data-side='w'] { cursor: ew-resize; }
.rl-crop-bar { position: absolute; z-index: 31; display: flex; align-items: center; gap: 4px; padding: 4px 6px;
  border-radius: var(--rl-radius-card, 8px); background: var(--rl-card, #fff); color: var(--rl-ink);
  box-shadow: var(--rl-shadow, 0 2px 10px rgba(0, 0, 0, 0.25)); font: inherit; font-family: var(--rl-font-ui); }
.rl-crop-size { margin-right: 8px; color: var(--rl-ink-2); font-size: var(--rl-size-ui-small); font-variant-numeric: tabular-nums; }
.rl-crop-button { height: 26px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--rl-ink-2);
  font: inherit; font-size: var(--rl-size-ui); cursor: default; }
.rl-crop-button:hover { background: var(--rl-pressed); color: var(--rl-ink); }
.rl-crop-button:focus-visible { outline: 2px solid var(--rl-ink-3); outline-offset: -2px; }
.rl-crop-button[data-primary] { color: var(--rl-ink); font-weight: 600; }
.rl-crop-button[aria-disabled='true'] { opacity: 0.5; }
`;

/** The image written as `written`, nearest to `at`, in the text now; where the text is as it was, the one at `at`. */
function findAgain(view: EditorView, before: Text, at: number, written: string) {
  const state = view.state;
  if (state.doc === before) return imageAt(state, Math.min(at + 1, state.doc.length));
  const text = state.doc.toString();
  let best: ReturnType<typeof imageAt> = null;
  let bestDistance = Infinity;
  for (let i = text.indexOf(written); i >= 0; i = text.indexOf(written, i + 1)) {
    const found = imageAt(state, i + 1);
    if (found?.from === i && Math.abs(i - at) < bestDistance) {
      best = found;
      bestDistance = Math.abs(i - at);
    }
  }
  return best;
}

function addStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  doc.head.append(style);
}

/** The rendered `<img>` of the image whose text starts at `from`, or null where it isn't drawn. */
function drawnImage(view: EditorView, from: number, to: number): HTMLImageElement | null {
  for (const img of view.contentDOM.querySelectorAll<HTMLImageElement>('.rl-image img')) {
    const at = view.posAtDOM(img);
    if (at >= from && at <= to) return img;
  }
  return null;
}

/** An open crop: what the view shows now. */
export interface CropSession {
  isOpen(): boolean;
  close(): void;
}

/**
 * Opens the crop box over the image under the caret or in the selection, and, on Done, hands the
 * crop to `crop` and points the image at the copy it answers with. Null where there is no image
 * drawn to crop (the notice says why).
 */
export function startCrop(
  view: EditorView,
  crop: ImageCropper,
  notice: (message: string) => void,
): CropSession | null {
  const image = imageInSelection(view.state);
  // The command is disabled, with its reason (`disabledReason`), where there is no picture to crop:
  // none selected, a remote one, or one not drawn (yet), so none of these is a refusal here.
  if (!image) return null;
  const local = localImageAt(view.state);
  if (local === null) return null;
  const img = drawnImage(view, image.from, image.to);
  if (!img || !img.complete || img.naturalWidth === 0) return null;
  const { from: at, to: end } = image;
  const written = view.state.sliceDoc(at, end);
  const path: string = local;
  const doc = view.dom.ownerDocument;
  const win = doc.defaultView ?? window;
  addStyle(doc);
  img.scrollIntoView({ block: 'nearest' });

  const root = doc.createElement('div');
  root.className = 'rl-crop';
  const box = doc.createElement('div');
  box.className = 'rl-crop-box';
  box.tabIndex = 0;
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', CROP_LABEL);
  const hint = doc.createElement('span');
  hint.className = 'rl-crop-sr';
  hint.id = `rl-crop-hint-${Math.random().toString(36).slice(2, 8)}`;
  hint.textContent = CROP_HINT;
  box.setAttribute('aria-describedby', hint.id);
  // One polite voice, written once a run of key presses has ended, not at every step.
  const status = doc.createElement('span');
  status.className = 'rl-crop-sr';
  status.setAttribute('role', 'status');
  root.append(box, hint, status);
  for (const side of HANDLES) {
    const handle = doc.createElement('span');
    handle.className = 'rl-crop-handle';
    handle.dataset['side'] = side;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', `${HANDLE_NAMES[side]}, crop handle`);
    handle.title = `Drag the ${HANDLE_NAMES[side].toLowerCase()}`;
    handle.style.left = side.includes('w') ? '0%' : side.includes('e') ? '100%' : '50%';
    handle.style.top = side.includes('n') ? '0%' : side.includes('s') ? '100%' : '50%';
    box.append(handle);
  }
  const bar = doc.createElement('div');
  bar.className = 'rl-crop-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Crop');
  const size = doc.createElement('span');
  size.className = 'rl-crop-size';
  size.setAttribute('aria-hidden', 'true');
  const button = (label: string, primary: boolean, run: () => void) => {
    const made = doc.createElement('button');
    made.type = 'button';
    made.className = 'rl-crop-button';
    if (primary) made.dataset['primary'] = '';
    made.textContent = label;
    made.addEventListener('mousedown', (event) => event.preventDefault());
    made.addEventListener('click', () => {
      if (made.getAttribute('aria-disabled') !== 'true') run();
    });
    return made;
  };
  const cancel = button('Cancel', false, () => close(true));
  const done = button('Done', true, () => void apply());
  bar.append(size, cancel, done);
  view.scrollDOM.append(root, bar);

  // The box, as fractions of the picture, so that it follows the picture when its size changes.
  let f: CropRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  let busy = false;
  let gone = false;
  let announce: ReturnType<typeof setTimeout> | undefined;
  /** Whether a key press moved the box since it was last spoken of: other arrow keys are not its. */
  let moved = false;

  const say = () => {
    moved = false;
    const percent = (n: number) => Math.round(n * 100);
    status.textContent =
      `${Math.round(f.width * img.naturalWidth)} by ${Math.round(f.height * img.naturalHeight)} pixels, ` +
      `${percent(f.x)} percent from the left, ${percent(f.y)} percent from the top`;
  };

  const place = () => {
    if (gone) return;
    const scroller = view.scrollDOM.getBoundingClientRect();
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || !img.isConnected) return close();
    const left = rect.left - scroller.left + view.scrollDOM.scrollLeft;
    const top = rect.top - scroller.top + view.scrollDOM.scrollTop;
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.width = `${rect.width}px`;
    root.style.height = `${rect.height}px`;
    box.style.left = `${f.x * rect.width}px`;
    box.style.top = `${f.y * rect.height}px`;
    box.style.width = `${f.width * rect.width}px`;
    box.style.height = `${f.height * rect.height}px`;
    bar.style.left = `${left}px`;
    bar.style.top = `${top + rect.height + 8}px`;
    size.textContent = `${Math.round(f.width * img.naturalWidth)} × ${Math.round(f.height * img.naturalHeight)}`;
  };

  /** Moves the box, or one of its sides, to fractions that stay inside the picture and no smaller than the least. */
  const set = (next: CropRect) => {
    const rect = img.getBoundingClientRect();
    const minW = Math.min(1, MIN_PX / Math.max(rect.width, 1));
    const minH = Math.min(1, MIN_PX / Math.max(rect.height, 1));
    const width = Math.min(1, Math.max(minW, next.width));
    const height = Math.min(1, Math.max(minH, next.height));
    f = {
      width,
      height,
      x: Math.min(1 - width, Math.max(0, next.x)),
      y: Math.min(1 - height, Math.max(0, next.y)),
    };
    place();
  };

  /** Resizes by the sides that `sides` names, `dx` and `dy` being the pointer's travel in fractions. */
  const resize = (from: CropRect, sides: readonly Side[], dx: number, dy: number): CropRect => {
    let { x, y, width, height } = from;
    const right = x + width;
    const bottom = y + height;
    const rect = img.getBoundingClientRect();
    const minW = MIN_PX / Math.max(rect.width, 1);
    const minH = MIN_PX / Math.max(rect.height, 1);
    if (sides.includes('w')) {
      x = Math.min(Math.max(0, x + dx), right - minW);
      width = right - x;
    }
    if (sides.includes('e')) width = Math.min(Math.max(minW, width + dx), 1 - x);
    if (sides.includes('n')) {
      y = Math.min(Math.max(0, y + dy), bottom - minH);
      height = bottom - y;
    }
    if (sides.includes('s')) height = Math.min(Math.max(minH, height + dy), 1 - y);
    return { x, y, width, height };
  };

  const drag = (event: PointerEvent, sides: readonly Side[] | null) => {
    if (busy || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const start = f;
    const rect = img.getBoundingClientRect();
    const move = (now: PointerEvent) => {
      const dx = (now.clientX - event.clientX) / rect.width;
      const dy = (now.clientY - event.clientY) / rect.height;
      if (sides === null) set({ ...start, x: start.x + dx, y: start.y + dy });
      else set(resize(start, sides, dx, dy));
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };
  box.addEventListener('pointerdown', (event) => {
    if (event.target === box) drag(event, null);
  });
  const handleEls = [...box.querySelectorAll<HTMLElement>('.rl-crop-handle')];
  for (const handle of handleEls) {
    const sides = [...(handle.dataset['side'] ?? '')] as Side[];
    handle.addEventListener('pointerdown', (event) => drag(event, sides));
  }

  function close(refocus = false): void {
    if (gone) return;
    gone = true;
    clearTimeout(announce);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('keyup', onKeyUp, true);
    doc.removeEventListener('pointerdown', onPress, true);
    win.removeEventListener('resize', place);
    observer?.disconnect();
    root.remove();
    bar.remove();
    if (refocus) view.focus();
  }

  async function apply(): Promise<void> {
    if (busy || gone) return;
    const whole = f.width >= WHOLE && f.height >= WHOLE;
    if (whole) return close(true);
    busy = true;
    done.setAttribute('aria-disabled', 'true');
    cancel.setAttribute('aria-disabled', 'true');
    size.textContent = 'Cropping…';
    status.textContent = 'Cropping…';
    const doc0 = view.state.doc;
    try {
      const copy = await crop(path, { ...f });
      if (gone) return;
      // The text may have moved while the copy was written (an edit above the image shifts it): the
      // image is found again by what it was written as, the nearest one to where it was, and left
      // alone when there is none.
      const now = findAgain(view, doc0, at, written);
      if (!now) notice(CROP_MOVED);
      else if (!setImageSrc(view, copy, now.from)) notice(CROP_NOT_POINTED);
      close(true);
    } catch (error) {
      busy = false;
      done.removeAttribute('aria-disabled');
      cancel.removeAttribute('aria-disabled');
      notice(error instanceof Error ? error.message : String(error));
      place();
    }
  }

  /** The side or corner of the handle that `target` is, or null where it is not a handle. */
  const handleOf = (target: EventTarget | null): string | null =>
    handleEls.find((handle) => handle === target)?.dataset['side'] ?? null;
  const onKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) close(true);
      return;
    }
    const inBar = event.target instanceof Node && bar.contains(event.target);
    if (event.key === 'Enter' && !inBar) {
      event.preventDefault();
      event.stopPropagation();
      void apply();
      return;
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const arrow = arrows[event.key];
    const handleSide = handleOf(event.target);
    const onHandle = handleSide !== null;
    if (!arrow || busy || (event.target !== box && event.target !== doc.body && !onHandle)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = img.getBoundingClientRect();
    if (onHandle) {
      // A handle moves its own sides: the arrow toward the outside grows the box, away from it shrinks it.
      const sides = [...(handleSide ?? '')] as Side[];
      const step = event.shiftKey || event.altKey ? 10 : 1;
      const before = f;
      set(resize(f, sides, (arrow[0] * step) / rect.width, (arrow[1] * step) / rect.height));
      moved ||=
        f.x !== before.x ||
        f.y !== before.y ||
        f.width !== before.width ||
        f.height !== before.height;
      return;
    }
    const step = event.altKey ? 10 : 1;
    const dx = (arrow[0] * step) / rect.width;
    const dy = (arrow[1] * step) / rect.height;
    if (event.shiftKey) set({ ...f, width: f.width + dx, height: f.height + dy });
    else set({ ...f, x: f.x + dx, y: f.y + dy });
    moved = true;
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (!moved || !event.key.startsWith('Arrow')) return;
    clearTimeout(announce);
    announce = setTimeout(say, ANNOUNCE_MS);
  };
  const onPress = (event: PointerEvent) => {
    const target = event.target;
    if (busy || !(target instanceof Node) || root.contains(target) || bar.contains(target)) return;
    close();
  };
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('keyup', onKeyUp, true);
  doc.addEventListener('pointerdown', onPress, true);
  win.addEventListener('resize', place);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place());
  observer?.observe(img);
  place();
  box.focus({ preventScroll: true });
  return { isOpen: () => !gone, close: () => close() };
}
