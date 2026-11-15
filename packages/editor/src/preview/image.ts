// Images in the preview (design, Rendering): a local path relative to the document, or a URL,
// drawn in place of its syntax, except while the caret is on it (but for a link a paste or a drop
// has just added, which is drawn while the caret is still at its end: `fresh.ts`). What a pending
// change contains is never fetched: an agent misled by text it read could otherwise leak what it
// read through an image URL the moment its edit lands, so the image shows its alt text until the
// change is accepted.

import type { EditorState, Extension } from '@codemirror/state';
import { Facet, StateEffect } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import {
  type ImageAlign,
  IMAGE_NODES,
  imageOfNode,
  noticeFacet,
  setImageLook,
} from '../image-size.ts';
import { parsedField } from '../tracked/field.ts';
import { textPx } from './theme.ts';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/** Turns a local image path, as written in the document, into a URL the page can load, or null. */
export type ImageResolver = (src: string) => string | null;

/** The host's resolver (`EditorOptions.resolveImage`). */
export const imageResolver = Facet.define<ImageResolver, ImageResolver | null>({
  combine: (values) => values[0] ?? null,
});

/** The host's resolver would answer differently now: images are drawn again. */
export const refreshImagesEffect = StateEffect.define<null>();

const REMOTE = /^https?:\/\//i;
const SCHEME = /^[a-z][a-z0-9+.-]*:|^\/\//i;

/** Where an image's file is, as a URL or a path written in the document. */
type Source = { kind: 'remote'; url: string } | { kind: 'local'; path: string } | { kind: 'none' };

function sourceOf(written: string): Source {
  let url = written.trim();
  if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1);
  if (REMOTE.test(url)) return { kind: 'remote', url };
  if (!url || SCHEME.test(url)) return { kind: 'none' };
  return { kind: 'local', path: decodePath(url) };
}

/**
 * A path written as a link destination, with every percent code decoded, those of `#` and `?`
 * included, which a path in a document is never a fragment or a query of: `Photo%20%232.png` is
 * `Photo #2.png`. A name whose codes are broken, such as a lone `%`, stays as it is written.
 */
function decodePath(url: string): string {
  return url
    .split('/')
    .map((name) => {
      try {
        return decodeURIComponent(name);
      } catch {
        return name;
      }
    })
    .join('/');
}

/** Whether a pending change covers any of `from`–`to`: its markers or what they hold. */
function pending(state: EditorState, from: number, to: number): boolean {
  for (const mark of state.field(parsedField).marks) {
    // Highlights and comments change nothing in the text.
    if (mark.kind === 'hl' || mark.kind === 'cmt') continue;
    for (const { open, content, close, carrier } of mark.segments) {
      // Touching counts: a deletion or a split has no text of its own, and an image next to one,
      // with nothing but space between, may be what the change brings in.
      const end = Math.max(open.to, content.to, close?.to ?? 0, carrier?.to ?? 0);
      if (open.from < to && end > from) return true;
      if (close || content.from !== content.to) continue;
      const before = from >= end && !state.sliceDoc(end, from).trim();
      const after = open.from >= to && !state.sliceDoc(to, open.from).trim();
      if (before || after) return true;
    }
  }
  return false;
}

/** Warnings that mean a marker was read as plain text, so that `pending` can't know its range. */
const UNRELIABLE = new Set(['unclosed-mark', 'duplicate-id', 'kind-mismatch', 'unopened-close']);

/**
 * Whether the parse left out a marker it couldn't read, such as an opener never closed. A change
 * may hide there, so a document like that fetches no remote image at all.
 */
function misread(state: EditorState): boolean {
  return state.field(parsedField).warnings.some((warning) => UNRELIABLE.has(warning.code));
}

/** The least width of an image that is dragged smaller, in px at the theme's own text size. */
const LEAST_WIDTH = 24;

/** How near the image's own size a drag ends to give the image its own size again, in px. */
const SNAP = 4;

/** The text column's width at `line`, in px as it is on screen: what an image may fill. */
function columnPx(view: EditorView, line: Element | null): number {
  const el = line ?? view.contentDOM;
  const style = getComputedStyle(el);
  return (
    el.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0')
  );
}

/**
 * The width of the text column in the unit a width is written in: px at the theme's own text size,
 * which the text size multiplies when the image is drawn. What the Small, Medium and Large of an
 * Image menu are fractions of.
 */
export function columnWidth(view: EditorView): number {
  const scale = parseFloat(getComputedStyle(view.contentDOM).getPropertyValue('--rl-text-scale'));
  const width = columnPx(view, null) / (scale || 1);
  return width > 0 ? width : 720;
}

/** The picture, or its alt text. */
class ImageWidget extends WidgetType {
  readonly alt: string;
  /** What the image loads from; null draws the alt text. */
  readonly url: string | null;
  /** The image is a line of its own, which centers it. */
  readonly own: boolean;
  /** The width the document gives it, in px at the theme's own text size, or null. */
  readonly width: number | null;
  readonly align: ImageAlign;

  constructor(
    alt: string,
    url: string | null,
    own: boolean,
    width: number | null = null,
    align: ImageAlign = 'center',
  ) {
    super();
    this.alt = alt;
    this.url = url;
    this.own = own;
    this.width = width;
    this.align = align;
  }

  override eq(other: ImageWidget): boolean {
    return (
      other.alt === this.alt &&
      other.url === this.url &&
      other.own === this.own &&
      other.width === this.width &&
      other.align === this.align
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = this.own ? 'rl-image rl-image-own' : 'rl-image';
    if (this.own && this.align !== 'center') wrap.classList.add(`rl-image-${this.align}`);
    const showAlt = () => {
      wrap.className += ' rl-image-missing';
      wrap.replaceChildren(this.alt || 'image');
      view.requestMeasure();
    };
    if (this.url === null) {
      showAlt();
      return wrap;
    }
    const img = document.createElement('img');
    img.alt = this.alt;
    img.draggable = false;
    // A remote image learns nothing of the document it is in.
    img.referrerPolicy = 'no-referrer';
    // The width that is written, times the text size, which a CSS max-width keeps within the column.
    if (this.width !== null) img.style.setProperty('width', textPx(this.width));
    img.addEventListener('load', () => {
      // At its natural width times the text size, unless the document says another.
      if (this.width === null && img.naturalWidth > 0) {
        img.style.setProperty('width', textPx(img.naturalWidth));
      }
      view.requestMeasure();
    });
    img.addEventListener('error', showAlt);
    img.src = this.url;
    // An image on a line of its own sits in a frame as wide as it is, so that its handles are at
    // its edges and not at the text column's.
    const frame = this.own ? document.createElement('span') : wrap;
    if (this.own) {
      frame.className = 'rl-image-frame';
      wrap.append(frame);
    }
    frame.append(img);
    for (const side of ['left', 'right'] as const) {
      const handle = document.createElement('span');
      handle.className = `rl-image-handle rl-image-handle-${side}`;
      handle.title = 'Drag to resize';
      handle.addEventListener('pointerdown', (event) =>
        beginResize(view, { wrap, frame, img, side, event, own: this.own, align: this.align }),
      );
      // The press is the handle's: the caret stays where it is, and the source stays hidden.
      handle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      frame.append(handle);
    }
    return wrap;
  }

  /** A drag on a handle ends with the widget, whose pointer events then have nowhere to go. */
  override destroy(dom: HTMLElement): void {
    drags.get(dom)?.();
  }

  /** Clicking the image puts the caret on it, which shows its source; a handle is pressed instead. */
  override ignoreEvent(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.rl-image-handle') !== null;
  }
}

/** The drags that are going on, by the image they resize, which a widget that goes ends. */
const drags = new WeakMap<HTMLElement, () => void>();

/** What a drag on a handle is told about the image it resizes. */
interface Drag {
  wrap: HTMLElement;
  frame: HTMLElement;
  img: HTMLImageElement;
  side: 'left' | 'right';
  event: PointerEvent;
  own: boolean;
  align: ImageAlign;
}

/**
 * A drag on a handle: the image takes the width of the pointer as it moves (nothing is written),
 * and the width is written when the pointer is released, as one change that one Undo takes back. It
 * keeps its aspect, as its height follows its width. A centered image grows at both edges, so its
 * edge follows the pointer at twice the distance. A drag that ends at the image's own size, or
 * beyond what the column holds, gives it no width, so that it is `![]()` again; Escape gives the
 * size it had.
 */
function beginResize(view: EditorView, drag: Drag): void {
  const { wrap, frame, img, side, event, own, align } = drag;
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget as HTMLElement;
  const scale =
    parseFloat(getComputedStyle(view.contentDOM).getPropertyValue('--rl-text-scale')) || 1;
  const column = columnPx(view, wrap.closest('.cm-line'));
  const startWidth = img.getBoundingClientRect().width;
  const startX = event.clientX;
  const written = img.style.getPropertyValue('width');
  // The edge follows the pointer when the image grows at both of its edges.
  const gain = own && align === 'center' ? 2 : 1;
  const least = Math.min(LEAST_WIDTH * scale, column);
  const natural = img.naturalWidth * scale;
  let width = startWidth;
  const badge = document.createElement('span');
  badge.className = 'rl-image-badge';
  frame.append(badge);
  const show = () => {
    badge.textContent = `${Math.round(width / scale)} px`;
  };
  show();
  wrap.classList.add('rl-image-resizing');
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    // A pointer that is gone already: the drag has nothing to follow.
  }

  const move = (at: PointerEvent) => {
    const delta = (side === 'right' ? at.clientX - startX : startX - at.clientX) * gain;
    width = Math.min(Math.max(startWidth + delta, least), column);
    img.style.setProperty('width', `${width}px`);
    show();
  };
  const finish = (commit: boolean) => {
    drags.delete(wrap);
    handle.removeEventListener('lostpointercapture', cancel);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    badge.remove();
    wrap.classList.remove('rl-image-resizing');
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      // Released already.
    }
    img.style.setProperty('width', written);
    if (!commit || width === startWidth) return;
    // The image's own size, or the column's if that is less, is no width at all.
    const fit = natural > 0 ? Math.min(natural, column) : 0;
    const asked = fit > 0 && Math.abs(width - fit) <= SNAP ? null : Math.round(width / scale);
    let at: number;
    try {
      at = view.posAtDOM(wrap);
    } catch {
      // The widget was replaced while the pointer was down: the image is another now.
      return;
    }
    setImageLook(view, { width: asked }, at, view.state.facet(noticeFacet));
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  const key = (at: Event) => {
    if ((at as KeyboardEvent).key !== 'Escape') return;
    at.stopPropagation();
    finish(false);
  };
  drags.set(wrap, cancel);
  handle.addEventListener('lostpointercapture', cancel);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
}

/** A pending change's markers, as docs/format.md §2.1 defines them: `<!--ins k3x9-->`, `<!--/k3x9-->`,
 * `<!--del k3x9 payload-->` (the payload on one line, any text but `-->`). */
const ID = '[bcdfghjkmnpqrstvwxz][bcdfghjkmnpqrstvwxz2-9]{3}';
const MARKER = new RegExp(
  `<!--(?:/${ID}|(?:ins|del|sub|fmt|hl|cmt|split) ${ID}(?: (?:(?!-->).)*)?)-->`,
  'g',
);

/**
 * Whether the image stands alone in its paragraph's line: nothing but space and the markers of a
 * pending change around it. Track Changes on writes the markers beside an image it adds, which must
 * not draw it at the left where the same image is centered with it off.
 */
function aloneInItsLine(state: EditorState, node: SyntaxNode): boolean {
  const line = state.doc.lineAt(node.from);
  if (node.to > line.to) return false;
  const around = state.sliceDoc(line.from, node.from) + state.sliceDoc(node.to, line.to);
  return around.replace(MARKER, '').trim() === '';
}

/** The decoration that draws an image node, or null for one that stays source. */
export function imageDecoration(state: EditorState, node: SyntaxNode): Decoration | null {
  const image = imageOfNode(state, node);
  if (!image) return null;
  const source = sourceOf(image.src);
  let url: string | null = null;
  if (source.kind === 'remote') {
    url = misread(state) || pending(state, node.from, node.to) ? null : source.url;
  } else if (source.kind === 'local') {
    url = state.facet(imageResolver)?.(source.path) ?? null;
  }
  const own = aloneInItsLine(state, node);
  return Decoration.replace({
    widget: new ImageWidget(image.alt, url, own, image.width, image.align),
  });
}

/**
 * The remote images the preview doesn't fetch, among the selected text of `state`: written
 * destinations of those in a pending change, or null when the file is misread, which holds back
 * every remote image. What the preview won't load, a copy won't hand to another app to load.
 */
export function heldRemoteImages(state: EditorState): Set<string> | null {
  if (misread(state)) return null;
  const held = new Set<string>();
  for (const { from, to } of state.selection.ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (!IMAGE_NODES.has(node.name)) return;
        const image = imageOfNode(state, node.node);
        if (!image) return;
        const source = sourceOf(image.src);
        if (source.kind === 'remote' && pending(state, node.from, node.to)) held.add(source.url);
      },
    });
  }
  return held;
}

/** The local path, as the document writes it and decoded, of an image node; null for a remote one. */
function localPathOf(state: EditorState, node: SyntaxNode): string | null {
  const image = imageOfNode(state, node);
  if (!image) return null;
  const source = sourceOf(image.src);
  return source.kind === 'local' ? source.path : null;
}

/** The image node, a `![]()` or an `<img>`, that holds or touches `pos`, or null. */
function imageNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  for (const side of [1, -1] as const) {
    for (
      let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      if (IMAGE_NODES.has(node.name) && imageOfNode(state, node)) return node;
    }
  }
  return null;
}

/**
 * The local image under the caret, or the first in the selection: its path as the document writes
 * it, decoded (`img/a b.png`). Null when there is none, or it is a remote one, which no other app
 * edits. What `openImage` is given, and what the command that edits an image answers to.
 */
export function localImageAt(state: EditorState): string | null {
  const { from, to, empty } = state.selection.main;
  if (empty) {
    const node = imageNodeAt(state, from);
    return node ? localPathOf(state, node) : null;
  }
  let found: string | null = null;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (found !== null || !IMAGE_NODES.has(node.name)) return;
      found = localPathOf(state, node.node);
    },
  });
  return found;
}

/** How long after the first click of a double-click the second may come, and how far it may move. */
const DOUBLE_CLICK_MS = 700;
const DOUBLE_CLICK_SLOP = 6;

/**
 * A double-click on an image hands its path to `open` (`EditorOptions.openImage`), the host's to
 * open in an app. The first click does what a click on an image does, puts the caret on it and so
 * shows its source, where the second lands; so the pair is told by the first click's image, and the
 * second press is taken whole: no word is selected. A remote image has no file: the pair does
 * nothing for it, not even select.
 */
export function imageOpening(open: (src: string) => void): Extension {
  return EditorView.domEventHandlers({ mousedown: imagePress(open) });
}

/** The press handler of `imageOpening`, for a test to call without the editor's own handling. */
export function imagePress(
  open: (src: string) => void,
): (event: MouseEvent, view: EditorView) => boolean {
  let first: { from: number; doc: EditorState['doc']; at: number; x: number; y: number } | null =
    null;
  return (event, view) => {
    if (event.button !== 0) return false;
    if (event.detail === 2 && first) {
      const press = first;
      first = null;
      const near =
        Date.now() - press.at <= DOUBLE_CLICK_MS &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) <= DOUBLE_CLICK_SLOP;
      if (!near || view.state.doc !== press.doc) return false;
      const node = imageNodeAt(view.state, press.from);
      if (!node) return false;
      const path = localPathOf(view.state, node);
      if (path !== null) {
        try {
          open(path);
        } catch (error) {
          console.warn('Could not open the image', error);
        }
      }
      return true;
    }
    first = null;
    const target = event.target;
    const wrap = target instanceof Element ? target.closest('.rl-image') : null;
    if (event.detail === 1 && wrap && view.contentDOM.contains(wrap)) {
      const node = imageNodeAt(view.state, view.posAtDOM(wrap));
      if (node) {
        first = {
          from: node.from,
          doc: view.state.doc,
          at: Date.now(),
          x: event.clientX,
          y: event.clientY,
        };
      }
    }
    return false;
  };
}
