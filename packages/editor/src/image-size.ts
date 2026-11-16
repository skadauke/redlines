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
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { Facet, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { MarkdownDialect } from './api.ts';
import { refusedEditEffect } from './tracked/typing.ts';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/** The open file's dialect (`EditorOptions.dialect`); default GitHub's. */
export const dialectFacet = Facet.define<MarkdownDialect, MarkdownDialect>({
  combine: (values) => values[0] ?? 'gfm',
});

/**
 * A pandoc attribute block right after an image, `{width=50%}`: `{`, anything but braces, angle
 * brackets and line breaks, `}`. The same text the format library keeps as one with the image.
 */
const ATTRIBUTE_BLOCK = /^\{[^{}<>\r\n]*\}/;

/** The tokens of an attribute block's inside: `width=50%`, `.class`, `#id`, `key="a b"`. */
const TOKEN = /(?:[^\s"'=]+=(?:"[^"]*"|'[^']*'|\S*)|"[^"]*"|'[^']*'|\S+)/g;

/** Where an image is placed in its line. */
export type ImageAlign = 'left' | 'center' | 'right';

/** One attribute of an `<img>` tag: its name in lowercase, its value read, and its text. */
export interface Attribute {
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
  /** A Markdown image of a pandoc file with its attribute block, as written (`{width=50%}`). */
  block: string | null;
  /** A Markdown image's own text, without its attribute block; null in a GitHub file. */
  base: string | null;
  /** The file is pandoc's (`.qmd`, `.Rmd`), where a size is written `{width=}`. */
  pandoc: boolean;
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
  /** The image is in a table cell, where a `|` in a value would end the cell. */
  inTable: boolean;
}

/** A change to the document's text. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
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
function escapeAttribute(text: string, inTable: boolean): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  // A pipe in a table cell would end it, as a character reference it doesn't.
  return inTable ? escaped.replace(/\|/g, '&#124;') : escaped;
}

/** Whether `node` is in a table. */
function inTableOf(node: SyntaxNode): boolean {
  for (let up: SyntaxNode | null = node; up; up = up.parent) if (up.name === 'Table') return true;
  return false;
}

/** The ASCII punctuation that a backslash in front of makes literal in Markdown. */
const ESCAPABLE = /\\([!-/:-@[-`{-~])/g;

/**
 * An image's destination, alt text or title as the document writes it, read as text: in one pass,
 * so that what a backslash made literal (`\&amp;`) is not read as a character reference.
 */
function readMarkdown(written: string): string {
  let text = '';
  let last = 0;
  for (const escape of written.matchAll(ESCAPABLE)) {
    text += readReferences(written.slice(last, escape.index)) + escape[1];
    last = escape.index + escape[0].length;
  }
  return text + readReferences(written.slice(last));
}

const TAG = /^<img((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>$/i;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The attributes of an `<img>` tag as it is written, or null when `text` is no one whole tag. */
export function readTag(text: string): Attribute[] | null {
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

/** The width and the height of an attribute block, as written, and its other tokens. */
function readBlock(block: string): { width: string | null; tokens: string[] } {
  const tokens = [...block.slice(1, -1).matchAll(TOKEN)].map((found) => found[0]);
  const width = tokens.find((token) => /^width=/i.test(token));
  return {
    width: width === undefined ? null : width.slice(6).replace(/^(["'])(.*)\1$/, '$2'),
    tokens,
  };
}

/** A tag's image, from the tag's attributes. */
function tagImage(
  from: number,
  to: number,
  attributes: Attribute[],
  inTable: boolean,
  pandoc: boolean,
): ImageElement | null {
  const src = valueOf(attributes, 'src');
  if (!src) return null;
  const { width, text } = readWidth(valueOf(attributes, 'width'));
  return {
    from,
    to,
    form: 'tag',
    block: null,
    base: null,
    pandoc,
    src,
    alt: valueOf(attributes, 'alt') ?? '',
    title: valueOf(attributes, 'title'),
    width,
    widthText: text,
    align: readAlign(valueOf(attributes, 'align')),
    attributes,
    inTable,
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
    // In a pandoc file the attribute block that follows with no space is the image's own.
    const pandoc = state.facet(dialectFacet) === 'pandoc';
    const block = pandoc
      ? (ATTRIBUTE_BLOCK.exec(state.sliceDoc(node.to, state.doc.lineAt(node.to).to))?.[0] ?? null)
      : null;
    const size = readWidth(block === null ? null : readBlock(block).width);
    const src = state.sliceDoc(url.from, url.to).trim();
    const unwrapped = src.startsWith('<') && src.endsWith('>') ? src.slice(1, -1) : src;
    return {
      from: node.from,
      to: node.to + (block?.length ?? 0),
      form: 'markdown',
      pandoc,
      block,
      base: pandoc ? state.sliceDoc(node.from, node.to) : null,
      src: readMarkdown(unwrapped),
      alt: readMarkdown(state.sliceDoc(open.to, close.from)),
      title: title ? readMarkdown(state.sliceDoc(title.from + 1, title.to - 1)) : null,
      width: size.width,
      widthText: size.text,
      align: 'center',
      attributes: [],
      inTable: inTableOf(node),
    };
  }
  if (node.name === 'HTMLTag' || node.name === 'HTMLBlock') {
    const attributes = readTag(state.sliceDoc(node.from, node.to));
    return attributes
      ? tagImage(
          node.from,
          node.to,
          attributes,
          inTableOf(node),
          state.facet(dialectFacet) === 'pandoc',
        )
      : null;
  }
  return null;
}

/** The node names an image can be. */
export const IMAGE_NODES = new Set(['Image', 'HTMLTag', 'HTMLBlock']);

/** The image whose text holds or touches `pos`, or null. */
export function imageAt(state: EditorState, pos: number): ImageElement | null {
  const ended = imageEndingAt(state, pos);
  if (ended !== null) return ended;
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

/** The image whose text, a pandoc attribute block included, ends at `pos`: a caret after its `}`. */
function imageEndingAt(state: EditorState, pos: number): ImageElement | null {
  if (state.facet(dialectFacet) !== 'pandoc' || state.sliceDoc(pos - 1, pos) !== '}') return null;
  const line = state.doc.lineAt(pos);
  const open = state.sliceDoc(line.from, pos).lastIndexOf('{');
  if (open === -1) return null;
  const image = imageAt(state, line.from + open - 1);
  return image !== null && image.to === pos ? image : null;
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
    source: value === null ? name : `${name}="${escapeAttribute(value, image.inTable)}"`,
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
    // The size of a pandoc image's attribute block goes into the tag.
    const size = image.width !== null ? String(image.width) : image.widthText;
    if (size !== null) known.set('width', named('width', size));
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
function asMarkdown(attributes: readonly Attribute[], inTable: boolean): string | null {
  if (!attributes.every((attribute) => MARKDOWN_ATTRIBUTES.has(attribute.name))) return null;
  const src = valueOf(attributes, 'src');
  const alt = valueOf(attributes, 'alt') ?? '';
  const title = valueOf(attributes, 'title');
  if (!src || /[\s<>\\&\p{Cc}]/u.test(src) || /[()]/.test(src)) return null;
  if (inTable && [src, alt, title ?? ''].some((value) => value.includes('|'))) return null;
  // Plain text only: whatever Markdown would read as more than text stays a tag.
  if (/[[\]\\*_`<>&!\r\n]/.test(alt)) return null;
  if (title !== null && /["\\\r\n&<]/.test(title)) return null;
  // An empty title is a title: `""` is written too.
  return `![${alt}](${src}${title === null ? '' : ` "${title}"`})`;
}

/**
 * The attribute block of a pandoc image with a new width (`{width=300px}`): its other tokens as
 * they are written, its height gone (the aspect follows the width), and no block at all when none
 * is left.
 */
function blockWith(image: ImageElement, width: number | null): string {
  const kept = readBlock(image.block ?? '{}').tokens.filter(
    (token) => !/^(?:width|height)=/i.test(token),
  );
  if (width !== null) kept.push(`width=${clampWidth(width)}px`);
  return kept.length === 0 ? '' : `{${kept.join(' ')}}`;
}

/** Whether a pandoc image's attribute block holds only a size, which a tag can write. */
function blockIsSize(image: ImageElement): boolean {
  return readBlock(image.block ?? '{}').tokens.every((token) => /^(?:width|height)=/i.test(token));
}

/** Whether a tag, which an alignment needs, can hold everything the image has. */
export function keepsAttributes(image: ImageElement): boolean {
  return image.base === null || image.block === null || blockIsSize(image);
}

/** An image's text with the look: a tag, or `![alt](src)` where nothing is left of the tag. */
export function imageText(image: ImageElement, look: ImageLook): string {
  // A Markdown image of a pandoc file is sized by its attribute block, and stays Markdown; only an
  // alignment, which pandoc has no word for, makes it a tag.
  if (image.base !== null && (image.block !== null || look.width !== undefined)) {
    const centered = (look.align ?? image.align) === 'center';
    if (centered) {
      if (look.width === undefined) return `${image.base}${image.block ?? ''}`;
      return `${image.base}${blockWith(image, look.width)}`;
    }
  }
  const attributes = attributesWith(image, look);
  // A tag of a pandoc file that is given a width, and has nothing a Markdown image can't hold,
  // is written as pandoc writes a size.
  if (image.pandoc && image.form === 'tag' && look.width !== undefined && look.width !== null) {
    const rest = attributes.filter((attribute) => attribute.name !== 'width');
    const own = rest.every((attribute) => MARKDOWN_ATTRIBUTES.has(attribute.name));
    const markdown = own ? asMarkdown(rest, image.inTable) : null;
    if (markdown !== null) return `${markdown}{width=${clampWidth(look.width)}px}`;
  }
  const plain = asMarkdown(attributes, image.inTable);
  if (plain !== null) return plain;
  return `<img ${attributes.map((attribute) => attribute.source).join(' ')}>`;
}

/**
 * Whether the tag that `change` writes would be an HTML block that takes in the lines under it
 * (a tag alone on its line, at the start of a block, is CommonMark's seventh kind, which runs to the
 * next blank line and reads what is in it as raw HTML), asked of the parse of the changed text.
 */
function swallows(state: EditorState, change: { from: number; insert: string }): boolean {
  const trial = state.update({ changes: change }).state;
  const tree = ensureSyntaxTree(trial, trial.doc.length, 500) ?? syntaxTree(trial);
  let block: SyntaxNode | null = tree.resolveInner(change.from + 1, 1);
  while (block && block.name !== 'HTMLBlock') block = block.parent;
  return block !== null && block.to > change.from + change.insert.length;
}

/** Whether the image is in the text of a setext heading, which a tag on its line would end. */
function inSetextHeading(state: EditorState, image: ImageElement): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(image.from, 1);
    node;
    node = node.parent
  ) {
    if (node.name.startsWith('SetextHeading')) return true;
  }
  return false;
}

/** What is said of an image that is the text of a setext heading, whose line can't be a tag. */
export const IMAGE_IN_HEADING =
  'This image is the text of a heading, which a tag on its line would end. Turn the heading into an ATX heading (#) first.';

/** What is said of an image of a pandoc file whose attributes a tag has no place for. */
export const IMAGE_ATTRIBUTES =
  "This image has attributes that an aligned image can't keep. Remove them first, or leave it unaligned.";

/** The edit that gives an image its look: its changes, whether it parts a paragraph, or why not. */
export interface LookEdit {
  changes: TextEdit[];
  /** The edit parts the paragraph below the image from it, which Track Changes may refuse. */
  parts?: boolean;
  /** Why the image can't have the look, said to the person; no change is made. */
  blocked?: string;
}

/** The edit that gives `image` the look, or null where it changes nothing. */
export function lookEdit(
  state: EditorState,
  image: ImageElement,
  look: ImageLook,
): LookEdit | null {
  const aligning = look.align !== undefined && look.align !== 'center';
  if (aligning && !keepsAttributes(image)) {
    return { changes: [], blocked: IMAGE_ATTRIBUTES };
  }
  const insert = imageText(image, look);
  if (insert === state.sliceDoc(image.from, image.to)) return null;
  const change: TextEdit = { from: image.from, to: image.to, insert };
  // A Markdown image alone at the start of a block, with lines under it that a tag there would
  // take as raw HTML, parts the paragraph after it instead: the line break is the one it had, and
  // the blank line after it the new one. Any marker on the image's line stays in front of it.
  if (image.form === 'markdown' && insert.startsWith('<img') && swallows(state, change)) {
    if (inSetextHeading(state, image)) return { changes: [], blocked: IMAGE_IN_HEADING };
    const line = state.doc.lineAt(image.to);
    const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
    if (next) {
      // The blank line has the quote markers of the line below it, and none of its indent.
      const prefix = /^[\s>]*/.exec(next.text)![0];
      const blank = prefix.includes('>') ? prefix.trimEnd() : '';
      return {
        changes: [change, { from: line.to, to: line.to, insert: `\n${blank}` }],
        parts: true,
      };
    }
  }
  return { changes: [change] };
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
  if (edit.blocked) {
    notice?.(edit.blocked);
    return false;
  }
  const before = view.state.doc;
  const { parts, changes } = edit;
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

/**
 * Alt text as the document writes it between `![` and `]`: one line, with what Markdown would read
 * as more than text escaped with a backslash (format §3.5.1), so that reading it back
 * (`readMarkdown`) gives the text that was typed.
 */
export function escapeAlt(text: string, inTable: boolean): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.replace(inTable ? /[\\[\]&`*_<>|]/g : /[\\[\]&`*_<>]/g, '\\$&');
}

/** The change that gives `image` the alt text, or null where it has that text already. */
export function altEdit(state: EditorState, image: ImageElement, alt: string): TextEdit | null {
  const wanted = alt.replace(/\s+/g, ' ').trim();
  // The alt it has is what is asked for: nothing to write, however the image happens to be written.
  if (image.alt === wanted) return null;
  let insert: string;
  if (image.form === 'tag') {
    const attributes = attributesWith(image, {});
    const kept = attributes.filter((attribute) => attribute.name !== 'alt');
    const at = attributes.findIndex((attribute) => attribute.name === 'alt');
    // An alt taken away from a tag stays as `alt=""`: no alt at all is a picture that has not been
    // described, and an empty one says it needs no description, as `![](src)` does.
    const written: Attribute[] =
      wanted === '' && at === -1
        ? []
        : [
            {
              name: 'alt',
              value: wanted,
              source: `alt="${escapeAttribute(wanted, image.inTable)}"`,
            },
          ];
    // Where the alt was stays its place; a new one goes after the src, as a tag is first written.
    const place = at === -1 ? Math.min(1, kept.length) : at;
    const all = [...kept.slice(0, place), ...written, ...kept.slice(place)];
    insert = `<img ${all.map((attribute) => attribute.source).join(' ')}>`;
  } else {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(image.from + 1, 1);
    while (node && node.name !== 'Image') node = node.parent;
    const [open, close] = node?.getChildren('LinkMark') ?? [];
    if (!node || !open || !close) return null;
    insert =
      state.sliceDoc(image.from, open.to) +
      escapeAlt(wanted, image.inTable) +
      state.sliceDoc(close.from, image.to);
  }
  return insert === state.sliceDoc(image.from, image.to)
    ? null
    : { from: image.from, to: image.to, insert };
}

/**
 * Gives the image at `at` (default: the one under the caret or in the selection) the alt text, as
 * one change: with Track Changes on, the editing rules write it as the substitution of the image
 * (an image is atomic content), and one Undo takes it back. False when there is no such image or
 * it has that alt text already.
 */
export function setImageAlt(view: EditorView, alt: string, at?: number): boolean {
  const image = at === undefined ? imageInSelection(view.state) : imageAt(view.state, at);
  if (!image) return false;
  const change = altEdit(view.state, image, alt);
  if (!change) return false;
  const before = view.state.doc;
  view.dispatch({
    changes: change,
    userEvent: 'input.image.alt',
    annotations: isolateHistory.of('full'),
  });
  return view.state.doc !== before;
}
