// The live preview (design §5.1): the document looks finished while you write it, and Markdown
// syntax appears only around the caret. Syntax characters stay in the text. Away from the caret
// they are hidden by replace decorations; inline marks show, in the syntax color, while the
// selection touches their element, and block prefixes while the selection is on their line.
// Code, URLs and front matter are drawn with spellcheck="false": the platform's spell check
// underlines nothing there, and WebKit, which reads the attribute on the text it checks, corrects
// and replaces nothing there either (tracked/smart-typing.ts).

import { syntaxTree } from '@codemirror/language';
import {
  type EditorState,
  type Extension,
  type Line,
  type Range,
  StateField,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { openBlock } from '../blocks/open.ts';
import { leafKind } from '../blocks/structure.ts';
import { parsedField, viewModeField } from '../tracked/field.ts';
import { type Callout, CalloutTitleWidget, calloutOf, pendingCallout } from './callout.ts';
import { freshlyAdded } from './fresh.ts';
import { imageDecoration, refreshImagesEffect } from './image.ts';
import { readTree, spacings } from './spacing.ts';
import { emojiDecoration, emojiLookup } from './emoji.ts';
import { entityDecoration, pendingBox, TaskBoxWidget } from './task.ts';

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
}

/** Collects decorations; line classes are merged so each line gets one line decoration. */
class Builder {
  readonly state: EditorState;
  private readonly ranges: Range<Decoration>[] = [];
  private readonly lines = new Map<number, LineStyle>();
  private readonly indented = new Set<number>();
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
  indent(line: Line, hang: number): void {
    this.style(line).hang = hang;
    if (this.indented.has(line.from)) return;
    this.indented.add(line.from);
    this.mark(line.from, spaceAfter(line, line.from), 'rl-indent');
  }

  finish(): DecorationSet {
    for (const [from, { classes, hang }] of this.lines) {
      if (hang) classes.add('rl-hang');
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
function loneMark(state: EditorState, node: SyntaxNode, mark: string): boolean {
  const first = node.getChild(mark);
  if (!first) return false;
  const line = state.doc.lineAt(first.from);
  const rest = state.sliceDoc(first.to, line.to).replace(/<!--[^]*?-->/g, '');
  return rest === '' && node.to <= line.to;
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
  const cols = columns(line, mark.from, content);
  const marker = node.getChild('Task')?.getChild('TaskMarker') ?? null;
  const boxEnd = marker ? spaceAfter(line, marker.to) : content;
  b.lineClass(line, 'rl-li');
  if (/^[ \t]*$/.test(line.text.slice(0, mark.from - line.from))) {
    // A task's text starts after its box, so its wrapped lines hang there.
    b.indent(line, columns(line, line.from, boxEnd));
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
    // The box's source is monospace too, so showing it doesn't move the item's text.
    b.mark(mark.from, boxEnd, 'rl-list-source');
  } else if (box) {
    const checked = /\[[xX]\]/.test(state.sliceDoc(box.from, box.to));
    const widget = new TaskBoxWidget(
      checked,
      columns(line, mark.from, boxEnd),
      pending === null || pending === 'source' ? null : pending,
    );
    b.push(Decoration.replace({ widget }).range(mark.from, boxEnd));
  } else {
    const text = state.sliceDoc(mark.from, mark.to);
    const bullet = BULLETS[Math.min(listDepth(node), BULLETS.length) - 1] ?? BULLETS[0];
    // A number as Markdown counts it; its source shows with the caret on it (above).
    const drawn = /^[-+*]$/.test(text) ? bullet : (numbers.get(mark.from) ?? text);
    const widget = new ListMarkWidget(drawn, cols);
    b.push(Decoration.replace({ widget }).range(mark.from, content));
  }
  // Continuation lines hang at their own indentation; nested items set their own below.
  b.eachLine(node.from, node.to, (next, first) => {
    if (!first) b.indent(next, columns(next, next.from, spaceAfter(next, next.from)));
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
  // A link a paste or a drop has just added is drawn with the caret at its end (`freshlyAdded`).
  if (touches(b.state, node.from, node.to) && !freshlyAdded(b.state, node.to)) {
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
export function previewDecorations(state: EditorState): DecorationSet {
  if (state.field(viewModeField, false) === 'raw') return Decoration.none;
  const b = new Builder(state);
  /** The leaf blocks, in document order, for the space between them. */
  const leaves: SyntaxNode[] = [];
  const numbers = new Map<number, string>();
  // The blocks for the space between them and the numbers, as the person sees them: with an empty
  // paragraph open, as if it held a character.
  const read = readTree(state);
  const live = read.tree === syntaxTree(state);
  if (!live) {
    read.tree.iterate({
      enter: (ref) => {
        if (leafKind(ref.name)) leaves.push(ref.node);
        else if (ref.name === 'OrderedList')
          countedNumbers(read.reading, ref.node, numbers, read.back);
      },
    });
  }
  syntaxTree(state).iterate({
    enter: (ref) => {
      const node = ref.node;
      const name = ref.name;
      if (live && leafKind(name)) leaves.push(node);
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
      else if (name === 'Image') {
        image(b, node);
        return false;
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
  for (const { line, spacing, below } of spacings(read.reading, leaves)) {
    b.lineClass(state.doc.line(line), `rl-space-${spacing}${below ? '-below' : ''}`);
  }
  return b.finish();
}

const previewField = StateField.define<DecorationSet>({
  create: previewDecorations,
  update(decorations, tr) {
    const changed =
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((effect) => effect.is(refreshImagesEffect)) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      openBlock(tr.state) !== openBlock(tr.startState) ||
      tr.state.field(viewModeField, false) !== tr.startState.field(viewModeField, false) ||
      // The names of emoji that a host gave, or took away, after the text was drawn.
      tr.state.facet(emojiLookup) !== tr.startState.facet(emojiLookup);
    return changed ? previewDecorations(tr.state) : decorations;
  },
  // From a state field rather than a view plugin, because it draws block decorations.
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => hardBreaksOf(view.state.field(field))),
  ],
});

/** The hard breaks' syntax among a set of decorations, as what the caret steps over. */
const stepped = new WeakMap<DecorationSet, DecorationSet>();
function hardBreaksOf(decorations: DecorationSet): DecorationSet {
  let found = stepped.get(decorations);
  if (!found) {
    found = decorations.update({
      filter: (_from, _to, value) => (value.spec as { hardBreak?: true }).hardBreak === true,
    });
    stepped.set(decorations, found);
  }
  return found;
}

/** The live Markdown preview. Needs the Markdown language, with GFM for tables. */
export function markdownPreview(): Extension {
  return [previewField];
}
