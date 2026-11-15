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

/** The picture, or its alt text. */
class ImageWidget extends WidgetType {
  readonly alt: string;
  /** What the image loads from; null draws the alt text. */
  readonly url: string | null;
  /** The image is a line of its own, which centers it. */
  readonly own: boolean;

  constructor(alt: string, url: string | null, own: boolean) {
    super();
    this.alt = alt;
    this.url = url;
    this.own = own;
  }

  override eq(other: ImageWidget): boolean {
    return other.alt === this.alt && other.url === this.url && other.own === this.own;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = this.own ? 'rl-image rl-image-own' : 'rl-image';
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
    img.addEventListener('load', () => {
      // At its natural width times the text size, which a CSS max-width keeps within the column.
      if (img.naturalWidth > 0) img.style.setProperty('width', textPx(img.naturalWidth));
      view.requestMeasure();
    });
    img.addEventListener('error', showAlt);
    img.src = this.url;
    wrap.append(img);
    return wrap;
  }

  /** Clicking the image puts the caret on it, which shows its source. */
  override ignoreEvent(): boolean {
    return false;
  }
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

/** The decoration that draws an `Image` node, or null for one that stays source. */
export function imageDecoration(state: EditorState, node: SyntaxNode): Decoration | null {
  const marks = node.getChildren('LinkMark');
  const urlNode = node.getChild('URL');
  const [open, close] = marks;
  // A reference-style image has no destination here.
  if (!urlNode || !open || !close) return null;
  const alt = state.sliceDoc(open.to, close.from);
  const source = sourceOf(state.sliceDoc(urlNode.from, urlNode.to));
  let url: string | null = null;
  if (source.kind === 'remote') {
    url = misread(state) || pending(state, node.from, node.to) ? null : source.url;
  } else if (source.kind === 'local') {
    url = state.facet(imageResolver)?.(source.path) ?? null;
  }
  const own = aloneInItsLine(state, node);
  return Decoration.replace({ widget: new ImageWidget(alt, url, own) });
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
        if (node.name !== 'Image') return;
        const urlNode = node.node.getChild('URL');
        if (!urlNode) return;
        const source = sourceOf(state.sliceDoc(urlNode.from, urlNode.to));
        if (source.kind === 'remote' && pending(state, node.from, node.to)) held.add(source.url);
      },
    });
  }
  return held;
}

/** The local path, as the document writes it and decoded, of an `Image` node; null for a remote one. */
function localPathOf(state: EditorState, node: SyntaxNode): string | null {
  const urlNode = node.getChild('URL');
  if (!urlNode) return null;
  const source = sourceOf(state.sliceDoc(urlNode.from, urlNode.to));
  return source.kind === 'local' ? source.path : null;
}

/** The `Image` node that holds or touches `pos`, or null. */
function imageNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  for (const side of [1, -1] as const) {
    for (
      let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      if (node.name === 'Image') return node;
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
      if (found !== null || node.name !== 'Image') return;
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
