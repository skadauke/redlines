// HTML blocks drawn as GitHub draws them (#686, #689): a block of HTML that has no Markdown twin
// (a `<p align="center">`, a table with spans, a figure, a `<dl>`) is drawn rendered, sanitized to
// GitHub's list (`@redlines/format`), in a block that says it is HTML. Its source opens on demand:
// a double-click, Return on the selected block, or the label, and the source shows in a code box
// with a Done button until the caret leaves it (or Escape, or Done), when the block is drawn again.
//
// What is drawn is built from the parse, never inserted: the source is read by a template element
// (inert: no script runs, no image loads), and an element, an attribute and an address are copied
// to the page only when GitHub keeps them. Nothing is live: no script, no handler, no style, no
// frame, no request (an image shows as a small box with its alt text, and a link goes nowhere).
//
// What is not drawn rendered stays source, as written: a block with a mark of Redlines in it
// (a pending change is seen and decided in its text), a block that is in a quote or an item, the
// tags of `<details>` and `<div>` containers (containers.ts), a heading (html-draw.ts), an image
// (image.ts), one that has a Markdown twin (blocks/twin.ts), and one that opens with a tag GFM
// escapes.

import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
  type Transaction,
} from '@codemirror/state';
import { Decoration, EditorView, keymap, WidgetType } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import {
  htmlHandling,
  isAddressAttribute,
  isAllowedAddress,
  isAllowedAttribute,
  isAllowedElement,
  htmlTwin,
  isEscapedTag,
} from '@redlines/format';
import type { SyntaxNode } from '@lezer/common';
import { holdOpenAt } from '../blocks/containers.ts';
import { parsedField, setViewModeEffect, viewModeField } from '../tracked/field.ts';
import { imageOfNode } from '../image-size.ts';
import { imageResolver, sourceOf } from './image.ts';
import { readTag } from './html-inline.ts';

/** A source longer than this many lines opens in Plain, at the spot, rather than in the page. */
const LONG_SOURCE_LINES = 60;

/** The most a drawn block holds: past either, the rest is left out. */
const MAX_NODES = 5000;
const MAX_SOURCE = 20_000;
const MAX_DEPTH = 100;
const MAX_TEXT = 500;

/** A block of HTML that is drawn rendered, or would be: whole lines. */
interface HtmlBlock {
  from: number;
  to: number;
}

const OPENER =
  /^<(details|div)((?:\s[^<>\n]*)?)>[ \t]*(?:\r?\n[ \t]*<summary>([^\n]*?)<\/summary>[ \t]*)?$/i;
const CLOSER = /^<\/(details|div)>[ \t]*$/i;

/** The top-level HTML block that holds `pos`, as whole lines, or null. */
export function htmlBlockAt(state: EditorState, pos: number): HtmlBlock | null {
  if (pos < 0 || pos > state.doc.length) return null;
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === 'HTMLBlock' && node.parent?.name === 'Document')
        return linesOf(state, node);
    }
  }
  return null;
}

function linesOf(state: EditorState, node: SyntaxNode): HtmlBlock {
  return { from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.to).to };
}

/** Whether a node's block is one that is drawn rendered. Reads the state, never the view. */
function isRenderedBlock(state: EditorState, node: SyntaxNode): boolean {
  if (node.name !== 'HTMLBlock' || node.parent?.name !== 'Document') return false;
  if (state.field(viewModeField, false) === 'raw') return false;
  const { from, to } = linesOf(state, node);
  const source = state.sliceDoc(from, to);
  const tag = readTag(source.trimStart());
  if (!tag || tag.closing) return false;
  if (isEscapedTag(tag.name) || !isAllowedElement(tag.name)) return false;
  // What is not drawn as a block: containers' tags, headings, images and Markdown twins.
  const bare = source.replace(/<!--[^]*?-->/g, '');
  if (OPENER.test(bare) || CLOSER.test(bare)) return false;
  if (imageOfNode(state, node)) return false;
  // An exact Markdown twin is edited as Markdown (blocks/twin.ts); one with no exact twin, a table
  // with a span or a caption, is drawn here, whatever the reason the twin's commands give.
  const above = from > 0 ? state.doc.lineAt(from - 1).text : '';
  // A source this long is left as source: drawing it would cost more than it shows.
  if (to - from > MAX_SOURCE) return false;
  if ('twin' in htmlTwin(source, { afterText: above.trim() !== '' })) return false;
  // A pending change in the block is seen and decided in its text.
  const parsed = state.field(parsedField, false);
  const touched = parsed?.marks.some((mark) =>
    mark.segments.some((s) => s.open.from < to && (s.close ?? s.content).to > from),
  );
  return !touched;
}

// ---------------------------------------------------------------- sanitizing

/** What a drawn attribute may hold: a number, a keyword, or any text. */
const NUMBER = /^\d{1,5}%?$/;
const WORD = /^[A-Za-z-]{1,20}$/;
const VALUES: Record<string, RegExp | undefined> = {
  align: WORD,
  valign: WORD,
  dir: /^(?:ltr|rtl|auto)$/i,
  width: NUMBER,
  height: NUMBER,
  colspan: NUMBER,
  rowspan: NUMBER,
  span: NUMBER,
  start: /^-?\d{1,6}$/,
  scope: WORD,
  border: /^\d{1,2}$/,
};

/** The attributes drawn, of those GitHub keeps: the ones that change how the block looks. */
const DRAWN = new Set([
  ...['abbr', 'align', 'alt', 'border', 'colspan', 'datetime', 'dir', 'height', 'href', 'lang'],
  ...['open', 'rowspan', 'scope', 'span', 'start', 'title', 'valign', 'width'],
]);

const VOID = new Set(['br', 'hr', 'img', 'wbr', 'source']);

/**
 * The source of an HTML block, as what GitHub draws of it, built from nodes of the page's own: a
 * fragment that holds only elements on GitHub's list and the attributes drawn, and text. An
 * element GitHub drops is unwrapped (its text stays), or, with nothing to show, a muted chip with
 * its name; one of the nine GFM escapes is its source as text; a comment is nothing.
 */
export function renderHtml(
  source: string,
  doc: Document = document,
  image?: (written: string) => string | null,
  dark = false,
): DocumentFragment {
  const template = doc.createElement('template');
  template.innerHTML = source;
  const out = doc.createDocumentFragment();
  const budget = { nodes: 0 };
  imageUrl = image ?? null;
  darkPicture = dark;
  try {
    copyChildren(template.content, out, doc, 0, budget);
  } finally {
    imageUrl = null;
    darkPicture = false;
  }
  return out;
}

/** Where a page that draws images finds the one an HTML block names: a printed page, and the editor
 * for a local image through the host's resolver. With none, an image is a box with its alt text. */
let imageUrl: ((written: string) => string | null) | null = null;
/** Whether a `<picture>` picks the source made for a dark appearance (#818). */
let darkPicture = false;

const localOnly = new WeakMap<object, (written: string) => string | null>();
/** The host's resolver as one that finds local images only; one function per resolver, so that a
 * rebuilt block's widget equals the last (`eq`). */
function localImages(resolve: (path: string) => string | null): (written: string) => string | null {
  let found = localOnly.get(resolve);
  if (!found) {
    found = (written) => {
      const source = sourceOf(written);
      return source.kind === 'local' ? resolve(source.path) : null;
    };
    localOnly.set(resolve, found);
  }
  return found;
}

/** Whether the window shows a dark appearance: the app's (`data-rl-appearance`), else the system's. */
function isDark(): boolean {
  if (typeof document === 'undefined') return false;
  const told = document.documentElement.dataset['rlAppearance'];
  if (told === 'dark' || told === 'light') return told === 'dark';
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The first address of a `srcset` (its candidates are `url 2x, url 480w`), or ''. */
function firstCandidate(srcset: string): string {
  return srcset.split(',')[0]?.trim().split(/\s+/)[0] ?? '';
}

/** The address a `<picture>` draws: its `<source>` for the appearance, else its `<img>`'s. */
function pictureSource(picture: Element, img: Element): string {
  const want = darkPicture ? 'dark' : 'light';
  for (const source of Array.from(picture.children)) {
    if (source.localName.toLowerCase() !== 'source') continue;
    const media = (source.getAttribute('media') ?? '').toLowerCase();
    if (!new RegExp(`\\(\\s*prefers-color-scheme\\s*:\\s*${want}\\s*\\)`).test(media)) continue;
    const found = firstCandidate(source.getAttribute('srcset') ?? '');
    if (found) return found;
  }
  return img.getAttribute('src') ?? '';
}

function copyChildren(
  from: Node,
  to: Node,
  doc: Document,
  depth: number,
  budget: { nodes: number },
): void {
  for (const child of Array.from(from.childNodes)) {
    if (budget.nodes++ > MAX_NODES) return;
    if (child.nodeType === 3) {
      to.appendChild(doc.createTextNode(child.textContent ?? ''));
    } else if (child.nodeType === 1) {
      copyElement(child as Element, to, doc, depth, budget);
    }
  }
}

function copyElement(
  element: Element,
  to: Node,
  doc: Document,
  depth: number,
  budget: { nodes: number },
): void {
  const name = element.localName.toLowerCase();
  if (isEscapedTag(name)) {
    to.appendChild(doc.createTextNode(element.outerHTML.slice(0, MAX_TEXT)));
    return;
  }
  if (depth > MAX_DEPTH) return;
  if (name === 'picture') {
    // The image that matches the appearance; its sources are never loaded themselves.
    const img = Array.from(element.children).find((c) => c.localName.toLowerCase() === 'img');
    if (img) {
      copyImage(img, pictureSource(element, img), to, doc);
      return;
    }
  }
  if (!isAllowedElement(name)) {
    if (htmlHandling(name) === 'chip') {
      const chip = doc.createElement('span');
      chip.className = 'rl-html-chip';
      chip.textContent = name;
      to.appendChild(chip);
    } else copyChildren(element, to, doc, depth + 1, budget);
    return;
  }
  if (name === 'img') {
    copyImage(element, element.getAttribute('src') ?? '', to, doc);
    return;
  }
  // `<source>` only picks an image; nothing is drawn of it.
  if (name === 'source') return;
  const copy = doc.createElement(name);
  for (const attribute of Array.from(element.attributes)) {
    const key = attribute.name.toLowerCase();
    if (!DRAWN.has(key) || !isAllowedAttribute(name, key)) continue;
    const value = attribute.value;
    if (isAddressAttribute(name, key)) {
      if (isAllowedAddress(name, key, value)) copy.setAttribute(key, value);
      continue;
    }
    if (key === 'title') {
      // For an app hint, never the system's tooltip.
      copy.setAttribute('data-rl-title', value.slice(0, MAX_TEXT));
      continue;
    }
    const allowed = VALUES[key];
    if (allowed && !allowed.test(value)) continue;
    copy.setAttribute(key, value.slice(0, MAX_TEXT));
  }
  if (name === 'a') copy.classList.add('rl-link');
  to.appendChild(copy);
  if (!VOID.has(name)) copyChildren(element, copy, doc, depth + 1, budget);
}

/**
 * An `<img>` of an HTML block: the image itself when the page can find it (a local one through the
 * host's resolver, at its numeric width and height), else a box with its alt text. Nothing remote
 * is loaded.
 */
function copyImage(element: Element, written: string, to: Node, doc: Document): void {
  const shown = imageUrl?.(written) ?? null;
  const alt = (element.getAttribute('alt') ?? '').slice(0, MAX_TEXT);
  if (shown !== null) {
    const picture = doc.createElement('img');
    picture.setAttribute('src', shown);
    picture.setAttribute('alt', alt);
    for (const key of ['width', 'height']) {
      const value = element.getAttribute(key) ?? '';
      if (VALUES[key]?.test(value)) picture.setAttribute(key, value);
    }
    to.appendChild(picture);
    return;
  }
  // Nothing is loaded: an image is a box with its alt text.
  const box = doc.createElement('span');
  box.className = 'rl-html-img';
  box.textContent = alt || 'image';
  to.appendChild(box);
}

// ------------------------------------------------------------------- opening

interface Opened {
  /** The start of the blocks (their first line) whose source is open. */
  keys: ReadonlySet<number>;
  /** The block that the current match of Find is in, or null. */
  found: number | null;
}

const NOTHING: Opened = { keys: new Set(), found: null };

/** Opens the source of the HTML block that starts at `from`. The caret goes in with it. */
const openHtmlSource = StateEffect.define<number>();

interface Sel {
  from: number;
  to: number;
  empty: boolean;
  head: number;
}

/** Whether a selection range has an end strictly inside the block: its source shows. */
function insideBlock(range: Sel, b: HtmlBlock): boolean {
  return range.empty
    ? range.head > b.from && range.head < b.to
    : (range.from > b.from && range.from < b.to) || (range.to > b.from && range.to < b.to);
}

/** Whether a range is the whole block: it is selected, and drawn. */
function isWhole(range: { from: number; to: number }, b: HtmlBlock): boolean {
  return range.from === b.from && range.to === b.to;
}

/** A range that keeps the source open: the caret anywhere in the block, even at its ends. */
function keeps(range: Sel, b: HtmlBlock): boolean {
  if (range.empty) return range.head >= b.from && range.head <= b.to;
  return !isWhole(range, b) && range.from < b.to && range.to > b.from;
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

export const openedField = StateField.define<Opened>({
  create: () => NOTHING,
  update(value, tr: Transaction) {
    const hold = tr.effects.findLast((e) => e.is(holdOpenAt));
    const opens = tr.effects.filter((e) => e.is(openHtmlSource));
    if (!tr.docChanged && !tr.selection && !hold && !opens.length) return value;
    let { keys, found } = value;
    if (tr.docChanged) {
      keys = new Set([...keys].map((key) => tr.changes.mapPos(key, 1)));
      if (found !== null) found = tr.changes.mapPos(found, 1);
    }
    const { state } = tr;
    // A tree that has not reached the end can not name the blocks: what is open stays open.
    if (syntaxTree(state).length < state.doc.length && !opens.length && !hold) {
      return keys === value.keys && found === value.found ? value : { keys, found };
    }
    const place = (pos: number) => htmlBlockAt(state, pos);
    const next = new Set<number>();
    for (const key of keys) {
      const block = place(key);
      if (block && state.selection.ranges.some((r) => keeps(r, block))) {
        next.add(block.from);
      }
    }
    for (const effect of opens) {
      const block = place(effect.value);
      if (block) next.add(block.from);
    }
    // A caret or an end of a selection that lands inside a block shows its source.
    for (const range of state.selection.ranges) {
      for (const pos of range.empty ? [range.head] : [range.from, range.to]) {
        const block = place(pos);
        if (block && insideBlock(range, block)) next.add(block.from);
      }
    }
    let nextFound: number | null = null;
    if (hold) nextFound = place(hold.value)?.from ?? null;
    else if (found !== null) {
      const block = place(found);
      if (block && state.selection.ranges.some((r) => keeps(r, block))) {
        nextFound = block.from;
      }
    }
    if (nextFound !== null && next.has(nextFound)) nextFound = null;
    if (sameSet(next, value.keys) && nextFound === value.found) return value;
    return { keys: next, found: nextFound };
  },
});

/** Whether the source of the block shows: it was opened, Find holds it, or the selection is in it. */
function isSourceOpen(state: EditorState, block: HtmlBlock): boolean {
  const opened = state.field(openedField, false);
  if (opened && (opened.keys.has(block.from) || opened.found === block.from)) return true;
  return state.selection.ranges.some((range) => insideBlock(range, block));
}

// ------------------------------------------------------------------- drawing

/** What the drawing needs of the preview's builder. */
interface BlockSink {
  readonly state: EditorState;
  push(range: Range<Decoration>): void;
}

/** The rendered block: a label that opens its source, and the sanitized HTML. */
class HtmlBlockWidget extends WidgetType {
  readonly source: string;
  readonly selected: boolean;
  readonly image: ((written: string) => string | null) | null;
  readonly dark: boolean;
  constructor(
    source: string,
    selected: boolean,
    image: ((written: string) => string | null) | null,
    dark: boolean,
  ) {
    super();
    this.source = source;
    this.selected = selected;
    this.image = image;
    this.dark = dark;
  }
  override eq(other: HtmlBlockWidget): boolean {
    return (
      other.source === this.source &&
      other.selected === this.selected &&
      other.image === this.image &&
      other.dark === this.dark
    );
  }
  override toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = this.selected ? 'rl-html-block rl-html-block-selected' : 'rl-html-block';
    wrap.dataset['rlHtmlLength'] = String(this.source.length);
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'rl-html-label';
    label.textContent = 'HTML';
    label.setAttribute('aria-label', 'Show the HTML source');
    label.setAttribute('data-rl-title', 'Show the HTML source');
    const body = document.createElement('div');
    body.className = 'rl-html-body';
    body.append(renderHtml(this.source, document, this.image ?? undefined, this.dark));
    wrap.append(label, body);
    return wrap;
  }
  // The editor hears the block's presses (`presses` below); what they do is the whole of a click.
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The line above the source that is open: says what it is, and closes it. */
class SourceHeadWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const head = document.createElement('div');
    head.className = 'rl-html-source-head';
    const name = document.createElement('span');
    name.textContent = 'HTML source';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'rl-html-done';
    done.textContent = 'Done';
    head.append(name, done);
    return head;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Draws an HTML block of the document, if it is one that is drawn rendered: its lines replaced by
 * the drawing, or, while its source is open, a code box with a head. True when it is drawn as a
 * widget (nothing in it is drawn by anything else).
 */
export function htmlBlock(b: BlockSink, node: SyntaxNode): boolean {
  const { state } = b;
  if (!isRenderedBlock(state, node)) return false;
  const block = linesOf(state, node);
  if (isSourceOpen(state, block)) {
    const head = Decoration.widget({ widget: new SourceHeadWidget(), block: true, side: -1 });
    b.push(head.range(block.from));
    for (let n = state.doc.lineAt(block.from).number; n <= state.doc.lineAt(block.to).number; n++) {
      const line = state.doc.line(n);
      const classes = ['rl-html-source'];
      if (line.from === block.from) classes.push('rl-html-source-first');
      if (line.to === block.to) classes.push('rl-html-source-last');
      b.push(Decoration.line({ class: classes.join(' ') }).range(line.from));
    }
    return true;
  }
  const selected = state.selection.ranges.some((range) => isWhole(range, block));
  const resolve = state.facet(imageResolver);
  // Only a local image is drawn, through the host's resolver; a remote or data address stays a box.
  const image = resolve ? localImages(resolve) : null;
  const widget = new HtmlBlockWidget(
    state.sliceDoc(block.from, block.to),
    selected,
    image,
    isDark(),
  );
  // `imageAtom`: the caret steps over the block as one object.
  b.push(Decoration.replace({ widget, block: true, imageAtom: true }).range(block.from, block.to));
  return true;
}

/** The block at `pos` when it is drawn rendered (its source is not open). */
function renderedAt(state: EditorState, pos: number): HtmlBlock | null {
  const block = htmlBlockAt(state, pos);
  if (!block || isSourceOpen(state, block)) return null;
  const node = syntaxTree(state).resolveInner(block.from, 1);
  for (let up: SyntaxNode | null = node; up; up = up.parent) {
    if (up.name === 'HTMLBlock') return isRenderedBlock(state, up) ? block : null;
  }
  return null;
}

// ---------------------------------------------------------------- the view's side

/** Selects the block whole: drawn, with its outline. */
function select(view: EditorView, block: HtmlBlock): void {
  view.dispatch({
    selection: EditorSelection.range(block.from, block.to),
    scrollIntoView: true,
    userEvent: 'select',
  });
}

/** Opens the block's source, with the caret at the end of its first line. */
export function openSource(view: EditorView, block: HtmlBlock): void {
  const { state } = view;
  const first = state.doc.lineAt(block.from);
  const lines = state.doc.lineAt(block.to).number - first.number + 1;
  if (lines > LONG_SOURCE_LINES) {
    // Too long for the page: Plain, at the spot.
    view.dispatch({
      effects: setViewModeEffect.of('raw'),
      selection: { anchor: first.to },
      scrollIntoView: true,
    });
    return;
  }
  const anchor = first.to > block.from ? first.to : Math.min(block.from + 1, block.to);
  view.dispatch({
    effects: openHtmlSource.of(block.from),
    selection: { anchor },
    scrollIntoView: true,
    userEvent: 'select',
  });
}

/** The block a press landed on, from the drawn block's length (its position is the editor's). */
function blockOfDom(view: EditorView, wrap: Element): HtmlBlock | null {
  try {
    const from = view.posAtDOM(wrap);
    const length = Number((wrap as HTMLElement).dataset['rlHtmlLength']);
    return Number.isFinite(length) ? { from, to: from + length } : null;
  } catch {
    return null;
  }
}

const presses = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target;
    if (!(target instanceof Element) || event.button !== 0) return false;
    if (event.shiftKey || event.metaKey || event.ctrlKey) return false;
    const done = target.closest('.rl-html-done');
    if (done) {
      const head = done.closest('.rl-html-source-head');
      if (!head || !view.contentDOM.contains(head)) return false;
      // The head is a widget before the block's first line: its position is that line's start.
      const block = htmlBlockAt(view.state, view.posAtDOM(head, 0) + 1);
      event.preventDefault();
      if (block) select(view, block);
      return true;
    }
    const wrap = target.closest('.rl-html-block');
    if (!wrap || !view.contentDOM.contains(wrap)) return false;
    const block = blockOfDom(view, wrap);
    if (!block) return false;
    event.preventDefault();
    view.focus();
    if (target.closest('.rl-html-label') || event.detail >= 2) openSource(view, block);
    else select(view, block);
    return true;
  },
  // A link in a drawn block goes nowhere: nothing in it is live.
  click(event, view) {
    const target = event.target;
    if (!(target instanceof Element) || !view.contentDOM.contains(target)) return false;
    if (!target.closest('.rl-html-block')) return false;
    event.preventDefault();
    // The label with the keyboard (Tab, then Return or Space) is a click with no pointer.
    const wrap = target.closest('.rl-html-block');
    if (event.detail === 0 && target.closest('.rl-html-label') && wrap) {
      const block = blockOfDom(view, wrap);
      if (block) openSource(view, block);
    }
    return true;
  },
});

/** From the edge of a drawn block, an arrow toward it selects it (the next one steps over). */
function reach(view: EditorView, edge: 'start' | 'end'): boolean {
  const range = view.state.selection.main;
  if (!range.empty || view.state.selection.ranges.length > 1) return false;
  const block = renderedAt(view.state, range.head);
  if (!block || (edge === 'start' ? block.from : block.to) !== range.head) return false;
  view.dispatch({
    selection: EditorSelection.range(block.from, block.to),
    scrollIntoView: true,
    userEvent: 'select',
  });
  return true;
}

/** Return on the selected block opens its source; Escape in a source ends it; arrows reach it. */
export const htmlBlockKeys = Prec.highest(
  keymap.of([
    {
      key: 'Enter',
      run(view) {
        const range = view.state.selection.main;
        if (range.empty || view.state.selection.ranges.length > 1) return false;
        const block = renderedAt(view.state, range.from);
        if (!block || !isWhole(range, block)) return false;
        openSource(view, block);
        return true;
      },
    },
    {
      key: 'Escape',
      run(view) {
        const { state } = view;
        const range = state.selection.main;
        if (state.selection.ranges.length > 1 || !range.empty) return false;
        const block = htmlBlockAt(state, range.head);
        if (!block || !isSourceOpen(state, block)) return false;
        for (
          let up: SyntaxNode | null = syntaxTree(state).resolveInner(block.from, 1);
          up;
          up = up.parent
        ) {
          if (up.name !== 'HTMLBlock') continue;
          if (!isRenderedBlock(state, up)) return false;
          view.dispatch({ selection: EditorSelection.range(block.from, block.to) });
          return true;
        }
        return false;
      },
    },
    { key: 'ArrowRight', run: (view) => reach(view, 'start') },
    { key: 'ArrowLeft', run: (view) => reach(view, 'end') },
  ]),
);

/** The state and the presses and keys of the HTML blocks. */
export function htmlBlocks(): Extension {
  return [openedField, presses];
}
