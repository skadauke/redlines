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
  Prec,
  type Range,
  type SelectionRange,
  StateField,
} from '@codemirror/state';
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  WidgetType,
} from '@codemirror/view';
import { openBlock } from '../blocks/open.ts';
import { leafKind } from '../blocks/structure.ts';
import { pastHidden } from '../tracked/decorations.ts';
import { parsedField, viewModeField } from '../tracked/field.ts';
import { imageDecoration, refreshImagesEffect } from './image.ts';
import { readTree, spacings } from './spacing.ts';
import { isTableWidget, tableDecoration } from './table.ts';
import { entityDecoration, pendingOver, TaskBoxWidget } from './task.ts';

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

const HIDDEN = Decoration.replace({});

/** Text the spell check leaves alone. */
const UNCHECKED = { spellcheck: 'false' };
const UNCHECKED_TEXT = Decoration.mark({ attributes: UNCHECKED });

/** Bullets by how deep their list is nested, as browsers draw them: a disc, a ring, a square. */
const BULLETS = ['•', '◦', '▪'] as const;

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

function atxHeading(b: Builder, node: SyntaxNode, level: string): void {
  const line = b.state.doc.lineAt(node.from);
  b.lineClass(line, `rl-h${level}`);
  const shown = onLine(b.state, line);
  let hiddenTo = node.from;
  for (const mark of node.getChildren('HeaderMark')) {
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

function quoteMark(b: Builder, node: SyntaxNode): void {
  const line = b.state.doc.lineAt(node.from);
  if (onLine(b.state, line)) b.syntax(node.from, node.to, true);
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
  // A box is drawn unless a pending change covers its marker: then it stays source.
  // An item with no text yet, as one being typed, stays source: there is nothing to check.
  const empty = marker !== null && state.sliceDoc(boxEnd, line.to).trim() === '';
  const box = marker && !empty && !pendingOver(state, marker.from, marker.to) ? marker : null;
  if (shown) {
    b.syntax(mark.from, mark.to, true);
    // The box's source is monospace too, so showing it doesn't move the item's text.
    b.mark(mark.from, boxEnd, 'rl-list-source');
  } else if (box) {
    const checked = /\[[xX]\]/.test(state.sliceDoc(box.from, box.to));
    const widget = new TaskBoxWidget(checked, columns(line, mark.from, boxEnd));
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
  if (touches(b.state, node.from, node.to)) {
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

/** Returns false for a table drawn as a widget, whose source needs no other decorations. */
function table(b: Builder, node: SyntaxNode): boolean {
  const { doc } = b.state;
  const first = doc.lineAt(node.from);
  const last = doc.lineAt(node.to);
  // A table inside a quote or list item stays source: its lines start with their prefix.
  if (first.from !== node.from || touches(b.state, first.from, last.to)) return true;
  b.push(tableDecoration(b.state, node, first.from, last.to));
  return false;
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
      if (name.startsWith('ATXHeading')) atxHeading(b, node, name.slice(-1));
      else if (name.startsWith('SetextHeading')) setextHeading(b, node, name.slice(-1));
      else if (name === 'Blockquote')
        b.eachLine(node.from, node.to, (line) => b.lineClass(line, 'rl-quote'));
      else if (name === 'QuoteMark') quoteMark(b, node);
      else if (name === 'OrderedList' && live) countedNumbers(state, node, numbers);
      else if (name === 'ListItem') listItem(b, node, numbers);
      else if (name === 'HorizontalRule') horizontalRule(b, node);
      else if (name === 'Link') link(b, node);
      else if (name === 'Autolink') autolink(b, node);
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
      } else if (name === 'TableDelimiter') b.syntax(node.from, node.to, true);
      else if (name === 'Table') return table(b, node);
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
    // Tables draw tracked changes, which look different in each view.
    const changed =
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((effect) => effect.is(refreshImagesEffect)) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      openBlock(tr.state) !== openBlock(tr.startState) ||
      tr.state.field(viewModeField, false) !== tr.startState.field(viewModeField, false);
    return changed ? previewDecorations(tr.state) : decorations;
  },
  // From a state field rather than a view plugin, because table widgets replace whole lines.
  provide: (field) => EditorView.decorations.from(field),
});

/** The rendered table whose first line starts at `pos` (`edge` 'from') or whose last ends there. */
function renderedTable(
  state: EditorState,
  pos: number,
  edge: 'from' | 'to',
): { from: number; to: number } | null {
  for (let it = state.field(previewField).iter(pos); it.value && it.from <= pos; it.next()) {
    // The table's widget, not any block decoration: hidden lines are block decorations too.
    const widget = (it.value.spec as { widget?: unknown }).widget;
    if (isTableWidget(widget) && (edge === 'from' ? it.from : it.to) === pos) {
      return { from: it.from, to: it.to };
    }
  }
  return null;
}

/** Whether the caret is on its line's last visual row (going down) or its first (going up). */
function onEdgeRow(view: EditorView, range: SelectionRange, line: Line, down: boolean): boolean {
  if (!line.length) return true;
  return view.moveToLineBoundary(range, down, true).head === (down ? line.to : line.from);
}

/**
 * An arrow key that would jump over a rendered table enters it instead: down or right from just
 * above puts the caret at the table's start, up or left from just below at its end. The table
 * then shows its source, as it does for a click.
 */
function enterTable(key: 'ArrowDown' | 'ArrowRight' | 'ArrowUp' | 'ArrowLeft'): Command {
  const forward = key === 'ArrowDown' || key === 'ArrowRight';
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (state.selection.ranges.length > 1 || !range.empty) return false;
    const line = state.doc.lineAt(range.head);
    // Past the blank lines between the line and the table, which are hidden.
    const after = pastHidden(state, line.to, true);
    const before = pastHidden(state, line.from, false);
    const table = forward
      ? after < state.doc.length &&
        renderedTable(state, after === line.to ? line.to + 1 : after, 'from')
      : before > 0 && renderedTable(state, before === line.from ? line.from - 1 : before, 'to');
    if (!table) return false;
    const beside =
      key === 'ArrowRight'
        ? range.head === line.to
        : key === 'ArrowLeft'
          ? range.head === line.from
          : onEdgeRow(view, range, line, forward);
    if (!beside) return false;
    view.dispatch({
      selection: { anchor: forward ? table.from : table.to },
      scrollIntoView: true,
      userEvent: 'select',
    });
    return true;
  };
}

const tableKeys = Prec.high(
  keymap.of(
    (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'] as const).map((key) => ({
      key,
      run: enterTable(key),
    })),
  ),
);

/** The live Markdown preview. Needs the Markdown language, with GFM for tables. */
export function markdownPreview(): Extension {
  return [previewField, tableKeys];
}
