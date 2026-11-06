// Images in the preview (design, Rendering): a local path relative to the document, or a URL,
// drawn in place of its syntax, except while the caret is on it. What a pending change contains is
// never fetched: an agent misled by text it read could otherwise leak what it read through an image
// URL the moment its edit lands, so the image shows its alt text until the change is accepted.

import type { EditorState } from '@codemirror/state';
import { Facet, StateEffect } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, type EditorView, WidgetType } from '@codemirror/view';
import { parsedField } from '../tracked/field.ts';

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
  try {
    return { kind: 'local', path: decodeURI(url) };
  } catch {
    return { kind: 'local', path: url };
  }
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
    img.addEventListener('load', () => view.requestMeasure());
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
  const line = state.doc.lineAt(node.from);
  const own = line.text.trim() === state.sliceDoc(node.from, node.to) && node.to <= line.to;
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
