// An image's size and alignment (#526, format §3.5, "Image size"). Markdown's `![alt](src)` has no
// size, so the first size an image is given turns it into an HTML `<img>` tag with a `width`, and
// giving it back its own size turns the tag into `![alt](src)` again, when nothing else in the tag
// would be lost. The same goes for the alignment, an `align` of `left` or `right` (centered is how
// an image alone in its line is drawn, and is the absence of the attribute).
//
// A change of size is a change of the whole image's text: with Track Changes on the editing rules
// write it as a substitution of the image, which is how they take any change to atomic content
// (format §3.5), and one Undo takes it back.

import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { Facet, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { refusedEditEffect } from './tracked/typing.ts';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/** Where an image is placed in its line. */
export type ImageAlign = 'left' | 'center' | 'right';

/** One attribute of an `<img>` tag: its name in lowercase, its value read, and its text. */
interface Attribute {
  name: string;
  /** The value with its quotes taken off and its character references read; null for none. */
  value: string | null;
  /** The attribute as it is written, kept when the attribute stays as it was. */
  source: string;
}

/** An image in the document, as a Markdown image or as an `<img>` tag. */
export interface ImageElement {
  /** The range of the image's text: `![alt](src)` or the tag. */
  from: number;
  to: number;
  form: 'markdown' | 'tag';
  src: string;
  alt: string;
  title: string | null;
  /** The width in px as written, or null for none or one that isn't a number of pixels. */
  width: number | null;
  /** The width as written, when it isn't a number of pixels (`50%`). */
  widthText: string | null;
  align: ImageAlign;
  /** For a tag, its attributes; empty for a Markdown image. */
  attributes: Attribute[];
}

/** A change to the document's text. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  /** The edit parts the paragraph below the image from it, which Track Changes may refuse. */
  parts?: boolean;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Text with its character references read: `&amp;`, `&#38;` and `&#x26;`. */
function readReferences(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g,
    (all: string, dec?: string, hex?: string, name?: string) => {
      if (name) return ENTITIES[name] ?? all;
      const code = dec ? Number(dec) : parseInt(hex ?? '', 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    },
  );
}

/** Text as an attribute value in double quotes. */
function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** The ASCII punctuation that a backslash in front of makes literal in Markdown. */
const ESCAPABLE = /\\([!-/:-@[-`{-~])/g;

/** An image's destination, alt text or title as the document writes it, read as text. */
function readMarkdown(written: string): string {
  return readReferences(written.replace(ESCAPABLE, '$1'));
}

const TAG = /^<img((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>$/i;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The attributes of an `<img>` tag as it is written, or null when `text` is no one whole tag. */
function readTag(text: string): Attribute[] | null {
  const match = TAG.exec(text.trim());
  if (!match) return null;
  const attributes: Attribute[] = [];
  for (const found of (match[1] ?? '').matchAll(ATTRIBUTE)) {
    const value = found[2] ?? found[3] ?? found[4];
    attributes.push({
      name: found[1]!.toLowerCase(),
      value: value === undefined ? null : readReferences(value),
      source: found[0],
    });
  }
  return attributes;
}

const valueOf = (attributes: readonly Attribute[], name: string) =>
  attributes.find((attribute) => attribute.name === name)?.value ?? null;

/** A width attribute: a number of pixels (`200`, `200px`) or something else, such as `50%`. */
function readWidth(value: string | null): { width: number | null; text: string | null } {
  if (value === null) return { width: null, text: null };
  const pixels = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value);
  if (pixels && Number(pixels[1]) > 0) return { width: Math.round(Number(pixels[1])), text: null };
  return { width: null, text: value.trim() || null };
}

function readAlign(value: string | null): ImageAlign {
  const align = value?.trim().toLowerCase();
  return align === 'left' || align === 'right' ? align : 'center';
}

/** A tag's image, from the tag's attributes. */
function tagImage(from: number, to: number, attributes: Attribute[]): ImageElement | null {
  const src = valueOf(attributes, 'src');
  if (!src) return null;
  const { width, text } = readWidth(valueOf(attributes, 'width'));
  return {
    from,
    to,
    form: 'tag',
    src,
    alt: valueOf(attributes, 'alt') ?? '',
    title: valueOf(attributes, 'title'),
    width,
    widthText: text,
    align: readAlign(valueOf(attributes, 'align')),
    attributes,
  };
}

/** The image that a node is: an `Image`, an `<img>` tag, or a block that is no more than one. */
export function imageOfNode(state: EditorState, node: SyntaxNode): ImageElement | null {
  if (node.name === 'Image') {
    const marks = node.getChildren('LinkMark');
    const url = node.getChild('URL');
    const [open, close] = marks;
    // A reference-style image has no destination here.
    if (!url || !open || !close) return null;
    const title = node.getChild('LinkTitle');
    const src = state.sliceDoc(url.from, url.to).trim();
    const unwrapped = src.startsWith('<') && src.endsWith('>') ? src.slice(1, -1) : src;
    return {
      from: node.from,
      to: node.to,
      form: 'markdown',
      src: readMarkdown(unwrapped),
      alt: readMarkdown(state.sliceDoc(open.to, close.from)),
      title: title ? readMarkdown(state.sliceDoc(title.from + 1, title.to - 1)) : null,
      width: null,
      widthText: null,
      align: 'center',
      attributes: [],
    };
  }
  if (node.name === 'HTMLTag' || node.name === 'HTMLBlock') {
    const attributes = readTag(state.sliceDoc(node.from, node.to));
    return attributes ? tagImage(node.from, node.to, attributes) : null;
  }
  return null;
}

/** The node names an image can be. */
export const IMAGE_NODES = new Set(['Image', 'HTMLTag', 'HTMLBlock']);

/** The image whose text holds or touches `pos`, or null. */
export function imageAt(state: EditorState, pos: number): ImageElement | null {
  for (const side of [1, -1] as const) {
    for (
      let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      if (!IMAGE_NODES.has(node.name)) continue;
      const image = imageOfNode(state, node);
      if (image) return image;
    }
  }
  return null;
}

/** The image under the caret, or the first in the selection. */
export function imageInSelection(state: EditorState): ImageElement | null {
  const { from, to, empty } = state.selection.main;
  if (empty) return imageAt(state, from);
  let found: ImageElement | null = null;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (found || !IMAGE_NODES.has(node.name)) return;
      found = imageOfNode(state, node.node);
    },
  });
  return found;
}

/** The host's way to tell the person something (`EditorOptions.onNotice`), for a drag's refusal. */
export const noticeFacet = Facet.define<
  ((message: string) => void) | undefined,
  ((message: string) => void) | undefined
>({ combine: (values) => values[0] });

/** What the person asks for: a width in px (null for the image's own size) and an alignment. */
export interface ImageLook {
  width?: number | null;
  align?: ImageAlign;
}

/** The width an image is written with, an integer of at least 1. */
const clampWidth = (width: number) => Math.max(1, Math.round(width));

/** The attributes the image is written with: its own, with the new look, in the order of `ORDER`. */
function attributesWith(image: ImageElement, look: ImageLook): Attribute[] {
  const kept = new Map<string, Attribute>();
  const known = new Map<string, Attribute>();
  const named = (name: string, value: string | null): Attribute => ({
    name,
    value,
    source: value === null ? name : `${name}="${escapeAttribute(value)}"`,
  });
  if (image.form === 'tag') {
    for (const attribute of image.attributes) {
      // A repeated attribute: the first is the one that counts, as in HTML.
      if (!known.has(attribute.name)) known.set(attribute.name, attribute);
    }
  } else {
    known.set('src', named('src', image.src));
    if (image.alt) known.set('alt', named('alt', image.alt));
    if (image.title !== null) known.set('title', named('title', image.title));
  }
  const width = look.width === undefined ? image.width : look.width;
  const align = look.align ?? image.align;
  for (const [name, attribute] of known) kept.set(name, attribute);
  if (look.width !== undefined) {
    kept.delete('width');
    // A height of its own would no longer be the image's: the aspect follows the width.
    kept.delete('height');
    if (width !== null) kept.set('width', named('width', String(clampWidth(width))));
  }
  if (look.align !== undefined) {
    kept.delete('align');
    if (align !== 'center') kept.set('align', named('align', align));
  }
  return [...kept.values()];
}

/** The attributes that a Markdown image holds: all there is to an image without a tag. */
const MARKDOWN_ATTRIBUTES = new Set(['src', 'alt', 'title']);

/**
 * `![alt](src "title")` for a tag's attributes, or null when it would not be the same image: an
 * attribute that Markdown has no place for, or text that would need more than escaping to be
 * written there. A tag goes back to Markdown only where nothing is lost.
 */
function asMarkdown(attributes: readonly Attribute[]): string | null {
  if (!attributes.every((attribute) => MARKDOWN_ATTRIBUTES.has(attribute.name))) return null;
  const src = valueOf(attributes, 'src');
  const alt = valueOf(attributes, 'alt') ?? '';
  const title = valueOf(attributes, 'title');
  if (!src || /[\s<>\\\p{Cc}]/u.test(src) || /[()]/.test(src)) return null;
  // Plain text only: whatever Markdown would read as more than text stays a tag.
  if (/[[\]\\*_`<>&!\r\n]/.test(alt)) return null;
  if (title !== null && /["\\\r\n&<]/.test(title)) return null;
  // An empty title is a title: `""` is written too.
  return `![${alt}](${src}${title === null ? '' : ` "${title}"`})`;
}

/** An image's text with the look: a tag, or `![alt](src)` where nothing is left of the tag. */
export function imageText(image: ImageElement, look: ImageLook): string {
  const attributes = attributesWith(image, look);
  const plain = asMarkdown(attributes);
  if (plain !== null) return plain;
  return `<img ${attributes.map((attribute) => attribute.source).join(' ')}>`;
}

/**
 * Whether `<img …>`, written by itself on a line at the start of a block, begins an HTML block (a
 * tag alone on its line does, CommonMark's seventh kind), which runs to the next blank line and
 * takes what is below it as raw HTML. Not written for an image whose line has more in it, or that
 * a line of text is above.
 */
function startsBlockLine(state: EditorState, image: ImageElement): boolean {
  let paragraph: SyntaxNode | null = syntaxTree(state).resolveInner(image.from, 1);
  while (paragraph && paragraph.name !== 'Paragraph') paragraph = paragraph.parent;
  if (!paragraph) return false;
  const line = state.doc.lineAt(image.from);
  // It starts the paragraph, and nothing but a pending change's marker follows on its line.
  if (state.sliceDoc(paragraph.from, image.from).replace(MARKER, '').trim() !== '') return false;
  return state.sliceDoc(image.to, line.to).replace(MARKER, '').trim() === '';
}

/** A pending change's markers, which an image alone in its line may have around it. */
const MARKER =
  /<!--(?:\/[a-z0-9]{4}|(?:ins|del|sub|fmt|hl|cmt|split) [a-z0-9]{4}(?: (?:(?!-->).)*)?)-->/g;

/** The edit that gives `image` the look, or null where it changes nothing. */
export function lookEdit(
  state: EditorState,
  image: ImageElement,
  look: ImageLook,
): TextEdit | null {
  const insert = imageText(image, look);
  if (insert === state.sliceDoc(image.from, image.to)) return null;
  // A Markdown image alone at the start of a paragraph, with more lines under it, would become an
  // HTML block that takes those lines as raw HTML. The paragraph is parted after it instead, where
  // the break is the one it had, and a blank line is the new one.
  if (image.form === 'markdown' && insert.startsWith('<img') && startsBlockLine(state, image)) {
    const line = state.doc.lineAt(image.to);
    const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
    if (next && next.text.replace(/^[\s>]*/, '') !== '') {
      // The blank line has the quote markers of the line below it, and none of its indent.
      const prefix = /^[\s>]*/.exec(next.text)![0];
      const blank = prefix.includes('>') ? prefix.trimEnd() : '';
      return { from: image.from, to: next.from, insert: `${insert}\n${blank}\n`, parts: true };
    }
  }
  return { from: image.from, to: image.to, insert };
}

/**
 * What is said when Track Changes can't write the new size of an image whose paragraph goes on
 * under it: the tag would be an HTML block, and the lines under it would be raw HTML, so the
 * paragraph is parted after the image, and a break that parts a paragraph is not yet tracked there.
 */
export const IMAGE_PARTS_PARAGRAPH =
  'Resizing this image would turn the lines under it into HTML. Press Return after the image first, or turn off Track Changes.';

/**
 * Gives the image at `at` (default: the one under the caret or in the selection) the look, as one
 * change: with Track Changes on, the editing rules write it as the substitution of the image, and
 * they may refuse it as any edit (`onNotice` says why); one Undo takes it back. False when there
 * is no such image or it changes nothing.
 */
export function setImageLook(
  view: EditorView,
  look: ImageLook,
  at?: number,
  notice?: (message: string) => void,
): boolean {
  const image = at === undefined ? imageInSelection(view.state) : imageAt(view.state, at);
  if (!image) return false;
  const edit = lookEdit(view.state, image, look);
  if (!edit) return false;
  const before = view.state.doc;
  const { parts, ...changes } = edit;
  const spec = {
    changes,
    userEvent: 'input.image.size',
    annotations: isolateHistory.of('full'),
  };
  // The editing rules' words for a refusal of this one are about line breaks, which the person
  // didn't type: it is asked first, and said in words about the image.
  if (parts && notice && view.state.update(spec).effects.some((e) => e.is(refusedEditEffect))) {
    notice(IMAGE_PARTS_PARAGRAPH);
    return false;
  }
  view.dispatch(spec);
  return view.state.doc !== before;
}
