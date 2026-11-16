// The live preview (design §5.1): the document looks finished while you write it, and Markdown
// syntax appears only around the caret. Syntax characters stay in the text. Away from the caret
// they are hidden by replace decorations; inline marks show, in the syntax color, while the
// selection touches their element, and block prefixes while the selection is on their line.
// Code, URLs and front matter are drawn with spellcheck="false": the platform's spell check
// underlines nothing there, and WebKit, which reads the attribute on the text it checks, corrects
// and replaces nothing there either (tracked/smart-typing.ts).

import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  type Line,
  type Range,
  StateField,
  type Transaction,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { openBlock } from '../blocks/open.ts';
import { leafKind } from '../blocks/structure.ts';
import { parsedField, setViewModeEffect, viewModeField } from '../tracked/field.ts';
import { type Callout, CalloutTitleWidget, calloutOf, pendingCallout } from './callout.ts';
import { imageOfNode } from '../image-size.ts';
import { htmlBreak, htmlChip, htmlElement, htmlWbr } from './html-draw.ts';
import { imageDecoration, refreshImagesEffect, selectionInside } from './image.ts';
import { readTree, spacings } from './spacing.ts';
import {
  inWindow,
  replaceIn,
  selectionMoved,
  selectionPlaces,
  windowsOf,
  type Window,
} from '../restyle.ts';
import { emojiDecoration, emojiLookup } from './emoji.ts';
import { entityDecoration, pendingBox, roomDecoration, TaskBoxWidget } from './task.ts';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

const HIDDEN = Decoration.replace({});

/**
 * A hard line break's syntax (a backslash, or two or more spaces, in front of the line break),
 * hidden, and stepped over: the break is one character for the caret and for Backspace.
 */
const HARD_BREAK = Decoration.replace({ hardBreak: true });

/** Text the spell check leaves alone. */
const UNCHECKED = { spellcheck: 'false' };
const UNCHECKED_TEXT = Decoration.mark({ attributes: UNCHECKED });

/** Bullets by how deep their list is nested, as browsers draw them: a disc, a ring, a square. */
export const BULLETS = ['•', '◦', '▪'] as const;

/** Whether a node is in a table. */
function inTable(node: SyntaxNode): boolean {
  for (let up = node.parent; up; up = up.parent) if (up.name === 'Table') return true;
  return false;
}

/** How many lists hold a list item, its own included. */
function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let up = node.parent; up; up = up.parent) {
    if (up.name === 'BulletList' || up.name === 'OrderedList') depth++;
  }
  return depth;
}

/**
 * Inline elements: their class, the name of the marks that delimit them, and whether the spell
 * check leaves them alone.
 */
const INLINE: Record<string, { className: string; mark: string; unchecked?: true }> = {
  Emphasis: { className: 'rl-em', mark: 'EmphasisMark' },
  StrongEmphasis: { className: 'rl-strong', mark: 'EmphasisMark' },
  InlineCode: { className: 'rl-code', mark: 'CodeMark', unchecked: true },
  Strikethrough: { className: 'rl-strike', mark: 'StrikethroughMark' },
  // `<sub>` and `<sup>`, whose tags are the marks (script.ts).
  Subscript: { className: 'rl-sub', mark: 'SubscriptMark' },
  Superscript: { className: 'rl-sup', mark: 'SuperscriptMark' },
};

/** Nodes whose URL is part of their own syntax rather than a bare link. */
const URL_OWNERS = new Set(['Link', 'Image', 'Autolink', 'LinkReference']);

/** Whether any selection range touches `from`–`to`, ends included. */
function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

function onLine(state: EditorState, line: Line): boolean {
  return touches(state, line.from, line.to);
}

/** The end of the spaces and tabs at `pos`. */
function spaceAfter(line: Line, pos: number): number {
  let i = pos - line.from;
  while (line.text[i] === ' ' || line.text[i] === '\t') i++;
  return line.from + i;
}

/** The start of the spaces and tabs that end at `pos`. */
function spaceBefore(line: Line, pos: number): number {
  let i = pos - line.from;
  while (i > 0 && (line.text[i - 1] === ' ' || line.text[i - 1] === '\t')) i--;
  return line.from + i;
}

/** Columns from `from` to `to` on a line, with tab stops every 4 columns. */
function columns(line: Line, from: number, to: number): number {
  let cols = 0;
  for (let i = from - line.from; i < to - line.from; i++) {
    cols = line.text[i] === '\t' ? cols + 4 - (cols % 4) : cols + 1;
  }
  return cols;
}

/** A list marker drawn as a bullet, or as its number, in a box as wide as its source. */
class ListMarkWidget extends WidgetType {
  readonly text: string;
  readonly cols: number;

  constructor(text: string, cols: number) {
    super();
    this.text = text;
    this.cols = cols;
  }

  override eq(other: ListMarkWidget): boolean {
    return other.text === this.text && other.cols === this.cols;
  }

  override toDOM(): HTMLElement {
    const mark = document.createElement('span');
    mark.className = 'rl-list-mark';
    mark.style.setProperty('--rl-cols', String(this.cols));
    mark.textContent = this.text;
    return mark;
  }

  /** Clicking the marker puts the caret next to it, which shows its source. */
  override ignoreEvent(): boolean {
    return false;
  }
}

interface LineStyle {
  classes: Set<string>;
  /** Monospace columns at which wrapped lines hang. */
  hang?: number;
  /** The monospace columns the line's leading whitespace is drawn as wide as, if it is indented. */
  indent?: number;
}

/**
 * How far each level of a list is indented, in monospace columns, whatever its markers are in the
 * source: a bullet, a number and a task at the same level start at the same place, and so does
 * their text (a bullet's marker is two columns of source and a number's three).
 */
export const LEVEL_COLS = 3;

/** Collects decorations; line classes are merged so each line gets one line decoration. */
class Builder {
  readonly state: EditorState;
  private readonly ranges: Range<Decoration>[] = [];
  private readonly lines = new Map<number, LineStyle>();
  /** The first lines of the alerts, whose syntax their title stands for: their quote mark is none. */
  readonly titled = new Set<number>();

  constructor(state: EditorState) {
    this.state = state;
  }

  private style(line: Line): LineStyle {
    let style = this.lines.get(line.from);
    if (!style) this.lines.set(line.from, (style = { classes: new Set() }));
    return style;
  }

  push(range: Range<Decoration>): void {
    this.ranges.push(range);
  }

  lineClass(line: Line, className: string): void {
    this.style(line).classes.add(className);
  }

  /** Code keeps its own indentation, so its lines don't hang like a list item's text. */
  unhang(line: Line): void {
    this.style(line).hang = undefined;
  }

  /** Calls `fn` for each line from the one at `from` to the one at `to`. */
  eachLine(from: number, to: number, fn: (line: Line, first: boolean, last: boolean) => void) {
    const { doc } = this.state;
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let n = first; n <= last; n++) fn(doc.line(n), n === first, n === last);
  }

  /** Text drawn with `className`, which with `unchecked` the spell check leaves alone. */
  mark(from: number, to: number, className: string, unchecked = false): void {
    if (from >= to) return;
    const spec = unchecked ? { class: className, attributes: UNCHECKED } : { class: className };
    this.push(Decoration.mark(spec).range(from, to));
  }

  /** Text the spell check leaves alone, drawn as it is. */
  unchecked(from: number, to: number): void {
    if (from < to) this.push(UNCHECKED_TEXT.range(from, to));
  }

  /** Shows syntax in the syntax color, or hides it. */
  syntax(from: number, to: number, shown: boolean): void {
    if (from >= to) return;
    this.push(
      shown ? Decoration.mark({ class: 'rl-syntax' }).range(from, to) : HIDDEN.range(from, to),
    );
  }

  /**
   * A line inside a list item: its leading whitespace is set in the monospace font, so nesting
   * shows, and its wrapped lines hang at `hang` monospace columns, where its text starts.
   */
  indent(line: Line, hang: number, indent: number = hang): void {
    const style = this.style(line);
    style.hang = hang;
    style.indent = indent;
  }

  /**
   * The leading whitespace of a list line, in the monospace font, drawn `cols` columns wide: its
   * source's width is scaled to it (the font size of a space is its width).
   */
  private drawIndent(line: Line, cols: number): void {
    const to = spaceAfter(line, line.from);
    const source = columns(line, line.from, to);
    if (to <= line.from) return;
    const attributes: Record<string, string> =
      source === cols ? {} : { style: `font-size: ${cols / source}em` };
    this.push(Decoration.mark({ class: 'rl-indent', attributes }).range(line.from, to));
  }

  finish(): DecorationSet {
    for (const [from, { classes, hang, indent }] of this.lines) {
      if (hang) classes.add('rl-hang');
      if (indent !== undefined) this.drawIndent(this.state.doc.lineAt(from), indent);
      if (!classes.size) continue;
      const spec = { class: [...classes].join(' ') };
      const attributes: Record<string, string> = hang ? { style: `--rl-hang: ${hang}` } : {};
      // The lines of code and front matter are never spell checked.
      if (classes.has('rl-codeblock') || classes.has('rl-frontmatter')) {
        Object.assign(attributes, UNCHECKED);
      }
      const line = Object.keys(attributes).length ? { ...spec, attributes } : spec;
      this.ranges.push(Decoration.line(line).range(from));
    }
    return Decoration.set(this.ranges, true);
  }
}

/**
 * Whether a heading or a list item is only its mark, with nothing after it, not even the space:
 * a `#` or a `-` being typed in an empty paragraph, which becomes a block on the space, as in Docs
 * (design: block editing, "Typed syntax"). Until then the line is drawn as body text, so that it
 * does not change kind with each character.
 */
function loneMark(state: Source, node: SyntaxNode, mark: string): boolean {
  const first = node.getChild(mark);
  if (!first) return false;
  const line = state.doc.lineAt(first.from);
  const rest = state.sliceDoc(first.to, line.to).replace(/<!--[^]*?-->/g, '');
  return rest === '' && node.to <= line.to;
}

/** The text that a node is read from: a state, or the reading of one. */
type Source = Pick<EditorState, 'doc' | 'sliceDoc'>;

/** The marker of a list item with nothing after it, which has no block to take the space above. */
function emptyItemMark(state: Source, node: SyntaxNode): SyntaxNode | null {
  const mark = node.getChild('ListMark');
  if (!mark || loneMark(state, node, 'ListMark')) return null;
  const line = state.doc.lineAt(mark.from);
  if (node.to > line.to || node.getChild('Task')) return null;
  return /^[ \t]*$/.test(state.sliceDoc(mark.to, line.to).replace(/<!--[^]*?-->/g, ''))
    ? mark
    : null;
}

function atxHeading(b: Builder, node: SyntaxNode, level: string): void {
  const line = b.state.doc.lineAt(node.from);
  b.lineClass(line, `rl-h${level}`);
  // The `#`s show as source only while the caret is in them, as a list's marker does, not
  // whenever it is on the line: ← at the start of the text goes to the text above in one press,
  // and what Backspace takes is never drawn as text (design: block editing).
  const marks = node.getChildren('HeaderMark');
  const shown = marks.some((mark) => touches(b.state, mark.from, mark.to));
  let hiddenTo = node.from;
  for (const mark of marks) {
    if (shown) {
      b.syntax(mark.from, mark.to, true);
    } else if (mark.from === node.from) {
      hiddenTo = spaceAfter(line, mark.to);
      b.syntax(mark.from, hiddenTo, false);
    } else {
      b.syntax(Math.max(hiddenTo, spaceBefore(line, mark.from)), mark.to, false);
    }
  }
}

/** Whether an entity is the whole text of its paragraph and is `&nbsp;`: a line of room. */
function isRoom(state: EditorState, node: SyntaxNode): boolean {
  const paragraph = node.parent;
  return (
    state.sliceDoc(node.from, node.to) === '&nbsp;' &&
    paragraph?.name === 'Paragraph' &&
    paragraph.parent?.name === 'Document' &&
    state
      .sliceDoc(paragraph.from, paragraph.to)
      .replace(/<!--[^]*?-->/g, '')
      .trim() === '&nbsp;'
  );
}

/** A hard line break: its syntax is hidden (the line break itself is drawn as the break). */
function hardBreak(b: Builder, node: SyntaxNode): void {
  // The node ends with the line break; the syntax is what comes before it.
  const end = node.to - 1;
  if (end > node.from && b.state.sliceDoc(end, node.to) === '\n') {
    b.push(HARD_BREAK.range(node.from, end));
  }
}

function setextHeading(b: Builder, node: SyntaxNode, level: string): void {
  const { doc } = b.state;
  const mark = node.getChild('HeaderMark');
  if (!mark) return;
  const underline = doc.lineAt(mark.from);
  b.eachLine(node.from, underline.from - 1, (line) => b.lineClass(line, `rl-h${level}`));
  if (touches(b.state, node.from, node.to)) b.syntax(mark.from, mark.to, true);
  // The line break before the underline goes too, so the underline takes no space.
  else b.syntax(underline.from - 1, underline.to, false);
}

/**
 * An alert (#311): the lines of its quote are a box, tinted, and its first line a title, with an
 * icon, the type's name and a menu, in the place of `> [!NOTE]`. The source shows while the
 * selection touches that syntax. A title that follows the type in the text stays text, set apart.
 */
function calloutBox(b: Builder, node: SyntaxNode, callout: Callout): void {
  const { state } = b;
  const active = touches(state, node.from, node.to);
  b.eachLine(node.from, node.to, (line, first, last) => {
    b.lineClass(line, 'rl-callout');
    b.lineClass(line, `rl-callout-${callout.type}`);
    if (first) {
      b.lineClass(line, 'rl-callout-first');
      b.lineClass(line, 'rl-callout-title');
      if (active) b.lineClass(line, 'rl-callout-active');
    }
    if (last) b.lineClass(line, 'rl-callout-last');
  });
  b.titled.add(callout.from);
  if (touches(state, callout.from, callout.to)) b.syntax(callout.from, callout.to, true);
  else {
    const widget = new CalloutTitleWidget(callout, pendingCallout(state, callout.from));
    b.push(Decoration.replace({ widget }).range(callout.from, callout.to));
  }
  // The title is the rest of the line, with the markers of changes inside it, which are no text.
  if (callout.title !== '') {
    b.mark(callout.to, b.state.doc.lineAt(callout.from).to, 'rl-callout-text');
  }
}

function quoteMark(b: Builder, node: SyntaxNode): void {
  if (b.titled.has(node.from)) return;
  const line = b.state.doc.lineAt(node.from);
  // Shown only while the caret is at the marker, as a heading's `#`s.
  if (touches(b.state, node.from, node.to)) b.syntax(node.from, node.to, true);
  else b.syntax(node.from, Math.min(spaceAfter(line, node.to), node.to + 1), false);
}

/**
 * The numbers of a numbered list's items as Markdown counts them, by the start of each item's
 * marker: the first item's number, then one more for each item, each with its own `.` or `)`.
 */
function countedNumbers(
  read: { sliceDoc(from: number, to?: number): string },
  list: SyntaxNode,
  numbers: Map<number, string>,
  back: (pos: number) => number = (pos) => pos,
): void {
  const items = list.getChildren('ListItem');
  const first = items[0]?.getChild('ListMark');
  const start = first ? Number.parseInt(read.sliceDoc(first.from, first.to), 10) : NaN;
  if (!Number.isFinite(start)) return;
  items.forEach((item, i) => {
    const mark = item.getChild('ListMark');
    if (!mark) return;
    const delimiter = read.sliceDoc(mark.to - 1, mark.to);
    numbers.set(back(mark.from), `${start + i}${delimiter}`);
  });
}

function listItem(b: Builder, node: SyntaxNode, numbers: ReadonlyMap<number, string>): void {
  const { state } = b;
  const mark = node.getChild('ListMark');
  if (!mark) return;
  const line = state.doc.lineAt(mark.from);
  const content = spaceAfter(line, mark.to);
  const marker = node.getChild('Task')?.getChild('TaskMarker') ?? null;
  const boxEnd = marker ? spaceAfter(line, marker.to) : content;
  const text = state.sliceDoc(mark.from, mark.to);
  const bullet = BULLETS[Math.min(listDepth(node), BULLETS.length) - 1] ?? BULLETS[0];
  // A number as Markdown counts it; its source shows with the caret on it (below).
  const drawn = /^[-+*]$/.test(text) ? bullet : (numbers.get(mark.from) ?? text);
  // The marker's box is as wide for a bullet as for a number, and the item starts where its
  // level does, whatever its source says: a task's box is wider, a long number a column more.
  const cols = marker ? columns(line, mark.from, boxEnd) : Math.max(LEVEL_COLS, drawn.length + 1);
  const start = (listDepth(node) - 1) * LEVEL_COLS;
  const hang = start + cols;
  const textCol = columns(line, line.from, content);
  b.lineClass(line, 'rl-li');
  const plain = /^[ \t]*$/.test(line.text.slice(0, mark.from - line.from));
  if (plain) {
    // A task's text starts after its box, so its wrapped lines hang there.
    b.indent(line, hang, start);
  }
  // A task's source shows while the selection is on its marker, as a list marker's does.
  const shown = touches(state, mark.from, marker ? marker.to : mark.to);
  // A box is drawn, empty or not (an item with no text yet is an empty box at its indent), unless
  // a pending change we can't draw as a box covers its marker: then it stays source. A box with a
  // pending change of its own is drawn in its new state, in its author's color.
  const pending = marker ? pendingBox(state, marker.from, marker.to) : null;
  const box = marker && pending !== 'source' ? marker : null;
  if (shown) {
    b.syntax(mark.from, mark.to, true);
    // The box's source is monospace too, so showing it doesn't move the item's text: a marker's
    // source is as wide as its drawn box, which a bullet's two columns are not.
    if (marker) b.mark(mark.from, boxEnd, 'rl-list-source');
    else {
      const style = `display: inline-block; text-indent: 0; width: calc(${cols} * 0.6em)`;
      b.push(
        Decoration.mark({ class: 'rl-list-source', attributes: { style } }).range(
          mark.from,
          content,
        ),
      );
    }
  } else if (box) {
    const checked = /\[[xX]\]/.test(state.sliceDoc(box.from, box.to));
    const widget = new TaskBoxWidget(
      checked,
      columns(line, mark.from, boxEnd),
      pending === null || pending === 'source' ? null : pending,
    );
    b.push(Decoration.replace({ widget }).range(mark.from, boxEnd));
  } else {
    const widget = new ListMarkWidget(drawn, cols);
    b.push(Decoration.replace({ widget }).range(mark.from, content));
  }
  // Continuation lines hang at their own indentation; nested items set their own below.
  b.eachLine(node.from, node.to, (next, first) => {
    if (first) return;
    // A continuation line keeps its place relative to the item's text.
    const at = columns(next, next.from, spaceAfter(next, next.from));
    // A lazy one, at the margin, stays there.
    b.indent(next, plain && at > 0 ? Math.max(0, hang + at - textCol) : at);
  });
}

function codeBlock(b: Builder, node: SyntaxNode): void {
  // Runs after any list item around the block, so it can take back that item's hang.
  b.eachLine(node.from, node.to, (line, first, last) => {
    b.lineClass(line, 'rl-codeblock');
    if (first) b.lineClass(line, 'rl-codeblock-first');
    if (last) b.lineClass(line, 'rl-codeblock-last');
    b.unhang(line);
  });
  // Fences, with the language, show while the selection is in the block.
  const shown = touches(b.state, node.from, node.to);
  for (const mark of node.getChildren('CodeMark')) {
    b.syntax(mark.from, b.state.doc.lineAt(mark.from).to, shown);
  }
}

function horizontalRule(b: Builder, node: SyntaxNode): void {
  const line = b.state.doc.lineAt(node.from);
  b.lineClass(line, 'rl-hr');
  b.syntax(node.from, node.to, onLine(b.state, line));
}

function inline(
  b: Builder,
  node: SyntaxNode,
  className: string,
  markName: string,
  unchecked = false,
): void {
  b.mark(node.from, node.to, className, unchecked);
  const shown = touches(b.state, node.from, node.to);
  for (const mark of node.getChildren(markName)) b.syntax(mark.from, mark.to, shown);
}

function link(b: Builder, node: SyntaxNode): void {
  const [open, close] = node.getChildren('LinkMark');
  // A bracketed phrase with no destination or reference, such as "[sic]", stays text.
  if (!open || !close || !(node.getChild('URL') || node.getChild('LinkLabel'))) return;
  const shown = touches(b.state, node.from, node.to);
  b.mark(open.to, close.from, 'rl-link');
  b.syntax(open.from, open.to, shown);
  b.syntax(close.from, node.to, shown);
}

function autolink(b: Builder, node: SyntaxNode): void {
  const shown = touches(b.state, node.from, node.to);
  for (const mark of node.getChildren('LinkMark')) b.syntax(mark.from, mark.to, shown);
  const url = node.getChild('URL');
  if (url) b.mark(url.from, url.to, 'rl-link', true);
}

/** An image drawn in place of its syntax, while the selection is elsewhere. */
function image(b: Builder, node: SyntaxNode): void {
  // A tag that is no image, or a block that holds more than one, stays source.
  if (!imageOfNode(b.state, node)) return;
  // The image stays drawn while it is selected or the caret is beside it (a click selects it, #675);
  // only a selection with an end inside its syntax shows the source.
  if (selectionInside(b.state, node.from, node.to)) {
    // Its source shows, and the spell check leaves the path alone.
    const url = node.getChild('URL');
    if (url) b.unchecked(url.from, url.to);
    return;
  }
  // The ledger is hidden, and what it holds is never fetched.
  const ledger = b.state.field(parsedField).ledgerRange;
  if (ledger && node.from < ledger.to && node.to > ledger.from) return;
  const decoration = imageDecoration(b.state, node);
  if (decoration) b.push(decoration.range(node.from, node.to));
}

/**
 * YAML front matter (`FrontMatter`, a node of the parse, #154), a `---` line that opens the
 * document through a closing `---` or `...` line: a dimmed monospace block, its delimiters hidden
 * away from the selection like a code block's fences.
 */
function frontMatter(b: Builder, node: SyntaxNode): void {
  b.eachLine(node.from, node.to, (line, first, last) => {
    b.lineClass(line, 'rl-frontmatter');
    if (first) b.lineClass(line, 'rl-frontmatter-first');
    if (last) b.lineClass(line, 'rl-frontmatter-last');
  });
  const shown = touches(b.state, node.from, node.to);
  for (const mark of node.getChildren('FrontMatterMark')) {
    b.syntax(mark.from, b.state.doc.lineAt(mark.from).to, shown);
  }
}

/**
 * The preview's decorations for a state. Exported for tests; the editor caches them. The Raw view
 * shows the source as written, without them.
 */
export function previewDecorations(state: EditorState, window?: Window): DecorationSet {
  if (state.field(viewModeField, false) === 'raw') return Decoration.none;
  const b = new Builder(state);
  /** The leaf blocks, in document order, for the space between them. */
  const leaves: SyntaxNode[] = [];
  const numbers = new Map<number, string>();
  // The blocks for the space between them and the numbers, as the person sees them: with an empty
  // paragraph open, as if it held a character.
  const read = readTree(state);
  const live = read.tree === syntaxTree(state);
  // A window is read only from a live tree (the field draws all of it again while a block is open).
  const bounds = window && live ? { from: window.context, to: window.reach } : {};
  if (!live) {
    read.tree.iterate({
      enter: (ref) => {
        if (leafKind(ref.name)) leaves.push(ref.node);
        else if (ref.name === 'ListItem') {
          // An empty item keeps the space above it while an empty paragraph is open too.
          const mark = emptyItemMark(read.reading, ref.node);
          if (mark) leaves.push(mark);
        } else if (ref.name === 'OrderedList')
          countedNumbers(read.reading, ref.node, numbers, read.back);
      },
    });
  }
  syntaxTree(state).iterate({
    ...bounds,
    enter: (ref) => {
      const node = ref.node;
      const name = ref.name;
      if (live && leafKind(name)) leaves.push(node);
      // An empty item has no block of its own: its marker stands for it, so that the space above
      // it is the item's from the first, not from the first letter typed in it (#509).
      else if (live && name === 'ListItem') {
        const mark = emptyItemMark(state, node);
        if (mark) leaves.push(mark);
      }
      const inlineSpec = INLINE[name];
      if (inlineSpec) {
        inline(b, node, inlineSpec.className, inlineSpec.mark, inlineSpec.unchecked);
        return name !== 'InlineCode';
      }
      if (name.startsWith('ATXHeading')) {
        if (!loneMark(state, node, 'HeaderMark')) atxHeading(b, node, name.slice(-1));
      } else if (name.startsWith('SetextHeading')) setextHeading(b, node, name.slice(-1));
      else if (name === 'Blockquote') {
        const callout = calloutOf(state, node);
        if (callout) calloutBox(b, node, callout);
        else b.eachLine(node.from, node.to, (line) => b.lineClass(line, 'rl-quote'));
      } else if (name === 'QuoteMark') quoteMark(b, node);
      else if (name === 'OrderedList' && live) countedNumbers(state, node, numbers);
      else if (name === 'ListItem') {
        if (!loneMark(state, node, 'ListMark')) listItem(b, node, numbers);
      } else if (name === 'HorizontalRule') horizontalRule(b, node);
      else if (name === 'Link') link(b, node);
      else if (name === 'Autolink') autolink(b, node);
      else if (name === 'HardBreak') hardBreak(b, node);
      else if (name === 'HtmlElement') htmlElement(b, node);
      // A `<br>` in a table cell is drawn by the table (table/layout.ts).
      else if (name === 'HtmlBreak' || name === 'HtmlWbr') {
        if (!inTable(node)) {
          const decoration = name === 'HtmlBreak' ? htmlBreak() : htmlWbr();
          b.push(decoration.range(node.from, node.to));
        }
      } else if (name === 'HtmlDropped')
        b.syntax(node.from, node.to, touches(state, node.from, node.to));
      else if (name === 'HtmlChip') htmlChip(b, node);
      else if (name === 'Image' || name === 'HTMLTag' || name === 'HTMLBlock') {
        // An `<img>` tag is an image too (#526: it is what an image with a size is written as).
        if (imageOfNode(state, node.node)) {
          image(b, node.node);
          return false;
        }
        return true;
      } else if (name === 'URL') {
        // A URL is never spell checked: a bare one is drawn as a link, the one of an autolink is
        // drawn by `autolink`, and the others show only as syntax around the caret.
        const owner = node.parent?.name ?? '';
        if (!URL_OWNERS.has(owner)) b.mark(node.from, node.to, 'rl-link', true);
        else if (owner !== 'Autolink') b.unchecked(node.from, node.to);
      } else if (name === 'Escape')
        b.syntax(node.from, node.from + 1, touches(state, node.from, node.to));
      // Entities in table cells are drawn by the table widget, not here (out of scope for now).
      else if (name === 'Entity') {
        // A paragraph of `&nbsp;` alone is a line of room: an empty line, with the caret in it too.
        if (isRoom(state, node)) {
          b.push(roomDecoration().range(node.from, node.to));
          return true;
        }
        const decoration = touches(state, node.from, node.to)
          ? null
          : entityDecoration(state, node.from, node.to);
        if (decoration) b.push(decoration.range(node.from, node.to));
      } else if (name === 'Emoji') {
        const decoration = touches(state, node.from, node.to)
          ? null
          : emojiDecoration(state, node.from, node.to);
        if (decoration) b.push(decoration.range(node.from, node.to));
      } else if (name === 'TableDelimiter') b.syntax(node.from, node.to, true);
      else if (name === 'FencedCode' || name === 'CodeBlock') {
        codeBlock(b, node);
        return false;
      } else if (name === 'FrontMatter') {
        frontMatter(b, node);
        return false;
      }
      return true;
    },
  });
  for (const { line, spacing, below, apart, clip } of spacings(read.reading, leaves)) {
    const kind = below ? '-below' : apart ? '-apart' : clip ? '-clip' : '';
    b.lineClass(state.doc.line(line), `rl-space-${spacing}${kind}`);
  }
  return b.finish();
}

/** What the preview field holds: the decorations, and the hard breaks and images among them. */
interface Preview {
  decorations: DecorationSet;
  /** The hard breaks' syntax and the images, as what the caret steps over. */
  breaks: DecorationSet;
}

const isBreak = (value: Decoration) => {
  const spec = value.spec as { hardBreak?: true; imageAtom?: true };
  return spec.hardBreak === true || spec.imageAtom === true;
};

function previewOf(decorations: DecorationSet, breaks?: DecorationSet): Preview {
  return {
    decorations,
    breaks: breaks ?? decorations.update({ filter: (_from, _to, value) => isBreak(value) }),
  };
}

/**
 * The preview's decorations after a transaction. A change of the text, the selection or the parse
 * redraws only the blocks it can touch (`windowsOf`), and keeps and maps the rest; what no window
 * can hold (a switch of view, an open block, the images drawn again) redraws all of it.
 */
function updatePreview(value: Preview, tr: Transaction): Preview {
  const state = tr.state;
  const everything =
    tr.effects.some((effect) => effect.is(refreshImagesEffect)) ||
    openBlock(state) !== null ||
    openBlock(tr.startState) !== null ||
    state.field(viewModeField, false) !== tr.startState.field(viewModeField, false) ||
    // The names of emoji that a host gave, or took away, after the text was drawn.
    state.facet(emojiLookup) !== tr.startState.facet(emojiLookup);
  const tree = syntaxTree(state);
  // A selection set, even to where it was, ends what a paste has just added (`freshlyAdded`).
  const moved = selectionMoved(tr) || tr.selection !== undefined;
  if (!everything && !tr.docChanged && !moved && tree === syntaxTree(tr.startState)) return value;
  // Another tree of the same length (a language set again) has no window to name.
  const replaced =
    !tr.docChanged &&
    tree !== syntaxTree(tr.startState) &&
    tree.length === syntaxTree(tr.startState).length;
  const extra = moved ? selectionPlaces(tr) : [];
  // The ledger is never drawn: where it is, and where it was, may change what is.
  const ledger = state.field(parsedField).ledgerRange;
  const was = tr.startState.field(parsedField).ledgerRange;
  const sameLedger = ledger
    ? !!was &&
      tr.changes.mapPos(was.from, 1) === ledger.from &&
      tr.changes.mapPos(was.to, -1) === ledger.to
    : !was;
  if (!sameLedger) {
    for (const range of [ledger, was]) if (range) extra.push([range.from, range.to]);
  }
  const windows = everything || replaced ? null : windowsOf(tr, extra);
  if (!windows) return previewOf(previewDecorations(state));
  let decorations = tr.docChanged ? value.decorations.map(tr.changes) : value.decorations;
  let breaks = tr.docChanged ? value.breaks.map(tr.changes) : value.breaks;
  for (const window of windows) {
    const fresh = previewDecorations(state, window);
    decorations = replaceIn(decorations, window, inWindow(fresh, window));
    breaks = replaceIn(
      breaks,
      window,
      inWindow(fresh, window).filter((range) => isBreak(range.value)),
    );
  }
  return { decorations, breaks };
}

/** The decorations the preview field holds, for tests: the editor keeps them as edits go. */
export function keptPreviewDecorations(state: EditorState): DecorationSet {
  return state.field(previewField).decorations;
}

const previewField = StateField.define<Preview>({
  create: (state) => previewOf(previewDecorations(state)),
  update: updatePreview,
  // From a state field rather than a view plugin, because it draws block decorations.
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).breaks),
  ],
});

/**
 * The caret never rests between the spaces of a hard break (#608): they are one unit that it steps
 * over, hidden. A space typed in front of them makes the run longer, and the caret mapped through
 * the typing lands inside it; it goes to the nearer edge (in front of them when typing at their
 * start), where it can be seen, and a selection's ends go outward.
 */
const hardBreakCaret = Prec.highest(
  EditorState.transactionFilter.of((tr) => {
    // A change, a selection, or a switch of the view (Raw has no atoms: a caret between the spaces
    // that Raw allowed goes out when the spaces hide).
    if (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(setViewModeEffect))) {
      return tr;
    }
    if (tr.state.field(viewModeField, false) === 'raw') return tr;
    const decorations = tr.state.field(previewField).decorations;
    const outside = (pos: number, side: -1 | 0 | 1) => {
      let moved = pos;
      decorations.between(pos, pos, (from, to, value) => {
        if ((value.spec as { hardBreak?: true }).hardBreak === true && from < pos && pos < to) {
          moved = side < 0 || (side === 0 && pos - from <= to - pos) ? from : to;
        }
      });
      return moved;
    };
    const { newSelection } = tr;
    let changed = false;
    const ranges = newSelection.ranges.map((range) => {
      const anchor = outside(range.anchor, range.empty ? 0 : range.anchor < range.head ? -1 : 1);
      const head = outside(range.head, range.empty ? 0 : range.head < range.anchor ? -1 : 1);
      if (anchor === range.anchor && head === range.head) return range;
      changed = true;
      return range.empty ? EditorSelection.cursor(head) : EditorSelection.range(anchor, head);
    });
    if (!changed) return tr;
    return [
      tr,
      { selection: EditorSelection.create(ranges, newSelection.mainIndex), sequential: true },
    ];
  }),
);

/** The live Markdown preview. Needs the Markdown language, with GFM for tables. */
export function markdownPreview(): Extension {
  return [previewField, hardBreakCaret];
}
