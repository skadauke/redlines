// Showing tracked changes (design §5.3, §5.5). Markers and the ledger are hidden, and the caret
// steps over them. In Redlines, inserted text is underlined and deleted text struck through, both
// in their author's color, text whose formatting changed has a dotted underline in it, and an
// inserted line break shows a small pilcrow; comments and highlights are tinted, and a bar left of
// the column marks each line with a pending change. Clean shows the newest text, as if every change
// were accepted, without markup or ordinary HTML comments. Raw shows the source as written,
// highlighted in grays.

import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  EditorState,
  type Extension,
  type Range,
  RangeSet,
  RangeSetBuilder,
  RangeValue,
  StateField,
  type Text,
  Transaction,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { colorClass, colorsOf, colorTheme } from './colors.ts';
import {
  authorFacet,
  bodyEnd,
  isDrawnChange,
  parsedField,
  peopleFacet,
  setViewModeEffect,
  trackedEditAnnotation,
  viewModeField,
} from './field.ts';

/**
 * Deleted text, a point comment's pin or an inserted line break's pilcrow, drawn in place of a
 * marker.
 */
interface Part {
  text: string;
  className: string;
  color: number;
  /** Deleted text, which is a change and takes a change bar. */
  change: boolean;
}

/** A marker, the ledger, or in Clean an ordinary HTML comment, hidden from view. */
interface Hidden {
  from: number;
  to: number;
  opener: boolean;
  parts: Part[];
  /** An ordinary HTML comment. */
  comment?: boolean;
  /** The marker of an inserted line break, which has no carrier: the line break shows. */
  split?: boolean;
}

/** Text drawn with a class: inserted text, or the range of a comment or a highlight. */
interface Layer {
  from: number;
  to: number;
  className: string;
  color: number;
  change: boolean;
}

interface Span {
  from: number;
  to: number;
}

/** What the layer draws for a state, before it becomes decorations. */
interface Model {
  /** Hidden text within lines, in document order. */
  hidden: Hidden[];
  /** Whole lines hidden, in document order: lines that hold only markers, and the ledger. */
  blocks: Span[];
  /** Deleted text and pins moved from hidden lines to the start of the block below them. */
  placed: { at: number; parts: Part[] }[];
  layers: Layer[];
  /** Ordinary HTML comments, drawn dimmed. */
  comments: Span[];
}

/** The span in `spans`, in document order and apart, that holds `pos`, ends included. */
function spanAt(spans: readonly Span[], pos: number): Span | undefined {
  let low = 0;
  let high = spans.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const span = spans[middle]!;
    if (pos < span.from) high = middle - 1;
    else if (pos > span.to) low = middle + 1;
    else return span;
  }
  return undefined;
}

/**
 * Deleted text as drawn: a deleted line break is a pilcrow, struck like the rest. Drawn as a line
 * break, it would look like no change at all, as when someone's inserted break is deleted.
 */
const deletedText = (text: string) => text.replace(/\r\n?|\n/g, '¶');

/** A line of whitespace and block quote markers only: blank, also inside a quote. */
const BLANK = /^[ \t>]*$/;
/** What may come before a marker on its line without being text (format §3.2). */
const CONTAINER_PREFIX =
  /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])|\[[ xX]\](?=[ \t])))*[ \t]*$/;

function analyze(state: EditorState): Model {
  const model: Model = { hidden: [], blocks: [], placed: [], layers: [], comments: [] };
  const mode = state.field(viewModeField);
  if (mode === 'raw') return model;
  const parsed = state.field(parsedField);
  const redlines = mode === 'redlines';
  const colors = colorsOf(state);
  const threads = new Map(parsed.ledger.comments.map((thread) => [thread.id, thread]));
  for (const mark of parsed.marks) {
    const color = colors.get(mark.entry.by) ?? 0;
    const author = colorClass(color);
    const change = isDrawnChange(mark);
    // A resolved comment is settled, and its text is no longer tinted.
    const tinted = mark.kind === 'hl' || (mark.kind === 'cmt' && !threads.get(mark.id)?.resolved);
    for (const segment of mark.segments) {
      const parts: Part[] = [];
      const { from, to } = segment.content;
      // A format change's payload is its operations, never deleted text.
      if (redlines && change && mark.kind !== 'ins' && mark.kind !== 'fmt' && segment.payload) {
        const text = deletedText(segment.payload);
        parts.push({ text, className: `rl-del ${author}`, color, change: true });
      }
      if (redlines && tinted && !segment.close) {
        parts.push({ text: '', className: `rl-cmt-point ${author}`, color, change: false });
      }
      if (redlines && mark.kind === 'split') {
        parts.push({ text: '', className: `rl-split ${author}`, color, change: true });
      }
      // The text of a format change, after the carrier of an opener alone on its line, as a block's
      // is. A box's mark is a point, and draws nothing of its own.
      const start = segment.carrier?.to ?? from;
      if (redlines && mark.kind === 'fmt' && segment.close && start < to) {
        model.layers.push({ from: start, to, className: `rl-fmt ${author}`, color, change: true });
      } else if (redlines && mark.kind !== 'fmt' && segment.close && from < to) {
        if (change && mark.kind !== 'del') {
          model.layers.push({ from, to, className: `rl-ins ${author}`, color, change: true });
        } else if (tinted) {
          model.layers.push({ from, to, className: `rl-cmt ${author}`, color, change: false });
        }
      }
      model.hidden.push({
        ...segment.open,
        opener: true,
        parts,
        ...(mark.kind === 'split' ? { split: true } : {}),
      });
      if (segment.close) model.hidden.push({ ...segment.close, opener: false, parts: [] });
    }
  }
  model.hidden.sort((a, b) => a.from - b.from);
  const comments = ordinaryComments(state, model.hidden, parsed.ledgerRange);
  // Small dimmed notes in Redlines (design §5.5); Clean is the document without them.
  if (redlines) model.comments = comments;
  else {
    const hidden = comments.map((span) => ({ ...span, opener: false, parts: [], comment: true }));
    model.hidden.push(...hidden);
    model.hidden.sort((a, b) => a.from - b.from);
  }
  hideLedger(state.doc, parsed.ledgerRange, model);
  hideMarkerLines(state.doc, model, parsed.ledgerRange?.from ?? state.doc.length);
  return model;
}

/**
 * Ordinary HTML comments, such as an author's `<!-- TODO -->`, which are content: each from its
 * `<!--` to its own `-->`. The Markdown parser's comment block runs on to the end of the line
 * with the `-->`, and that line may hold more text and comments. To the parser, markers and the
 * ledger are comments too. A `<!--` that is never closed stays text.
 */
function ordinaryComments(state: EditorState, markers: Span[], ledger: Span | null): Span[] {
  const taken = (ledger ? [...markers, ledger] : markers).toSorted((a, b) => a.from - b.from);
  const comments: Span[] = [];
  let next = 0;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Comment' && node.name !== 'CommentBlock') return;
      const text = state.sliceDoc(node.from, node.to);
      for (let open = text.indexOf('<!--'); open !== -1;) {
        const close = text.indexOf('-->', open + 2);
        if (close === -1) break;
        const span = { from: node.from + open, to: node.from + close + 3 };
        while (next < taken.length && taken[next]!.to <= span.from) next++;
        const overlap = taken[next];
        if (!overlap || overlap.from >= span.to) comments.push(span);
        open = text.indexOf('<!--', close + 3);
      }
      return false;
    },
  });
  return comments;
}

/**
 * The ledger never shows (design §5.5). When it ends its line, as it does, it is hidden as whole
 * lines together with the blank line before it, so the caret can't land beside it.
 */
function hideLedger(doc: Text, ledger: Span | null, model: Model): void {
  if (!ledger) return;
  if (doc.lineAt(ledger.to).to !== ledger.to) {
    model.hidden.push({ ...ledger, opener: false, parts: [] });
    model.hidden.sort((a, b) => a.from - b.from);
    return;
  }
  const atLineEnd = doc.lineAt(ledger.from).to === ledger.from;
  model.blocks.push({ from: atLineEnd ? ledger.from + 1 : ledger.from, to: ledger.to });
}

/**
 * Lines `first` to `last` as a hidden block, with the blank line beside them, if there is one:
 * after them for an opener, before them for a closer (format §3.3). A comment takes the blank line
 * after it, or the one before it when it ends the file, so no blank line is left at the end; one
 * with text right below it takes neither, because that blank line keeps the blocks apart.
 */
function linesBlock(doc: Text, first: number, last: number, side: 'after' | 'before' | 'either') {
  const blank = (n: number) => n >= 1 && n <= doc.lines && BLANK.test(doc.line(n).text);
  if (side !== 'before' && blank(last + 1)) {
    return { from: doc.line(first).from, to: doc.line(last + 1).to };
  }
  const before = side === 'before' || (side === 'either' && last === doc.lines);
  if (before && blank(first - 1)) {
    return { from: doc.line(first - 1).from, to: doc.line(last).to };
  }
  return { from: doc.line(first).from, to: doc.line(last).to };
}

/**
 * A mark that starts or ends a block has its marker on a line of its own (format §3.3). Such a
 * line is hidden, with the blank line after an opener or before a closer, so it leaves no empty
 * line, and deleted text on it is drawn at the start of the block below, if there is one. A
 * marker after a list item's bullet is hidden together with the line break after it, which brings
 * the item's text up to its bullet. In Clean, a line that holds only ordinary comments hides too
 * (see `linesBlock`); a comment is never an opener, so it joins no lines.
 */
function hideMarkerLines(doc: Text, model: Model, bodyEnd: number): void {
  /** Whether a line with text follows line `n`, before the ledger, to draw deleted text on. */
  const textBelow = (n: number) => {
    for (let k = n + 1; k <= doc.lines && doc.line(k).from < bodyEnd; k++) {
      if (!BLANK.test(doc.line(k).text)) return true;
    }
    return false;
  };
  const byLine = new Map<number, Hidden[]>();
  const moved: { line: number; parts: Part[] }[] = [];
  for (const hidden of model.hidden) {
    const line = doc.lineAt(hidden.from);
    if (hidden.to <= line.to) {
      const onLine = byLine.get(line.number);
      if (onLine) onLine.push(hidden);
      else byLine.set(line.number, [hidden]);
      continue;
    }
    // Hidden text over several lines is a comment, or a ledger that doesn't end its line. A
    // comment alone on its lines hides with them.
    const last = doc.lineAt(hidden.to);
    const before = doc.sliceString(line.from, hidden.from);
    if (!hidden.comment || !BLANK.test(before + doc.sliceString(hidden.to, last.to))) continue;
    model.blocks.push(linesBlock(doc, line.number, last.number, 'either'));
  }
  const joined = new Map<Hidden, Hidden | null>();
  for (const [n, markers] of byLine) {
    const line = doc.line(n);
    const first = markers[0]!;
    const last = markers.at(-1)!;
    let between = '';
    for (let i = 1; i < markers.length; i++) {
      between += doc.sliceString(markers[i - 1]!.to, markers[i]!.from);
    }
    const before = doc.sliceString(line.from, first.from);
    const after = doc.sliceString(last.to, line.to);
    const opener = markers.some((marker) => marker.opener);
    const parts = markers.flatMap((marker) => marker.parts);
    // The line of an inserted line break that a bullet, quote markers or indentation come before
    // is a line of the text, as Enter in front of the first word of an item or a quote's line
    // leaves it (`- ` and the split): the line break after the marker is no carrier, and shows.
    if (before !== '' && markers.some((marker) => marker.split)) continue;
    if (BLANK.test(before + between + after)) {
      // Deleted text with no block below it, as when all the text is deleted, stays on its line.
      if (parts.some((part) => part.text) && !textBelow(n)) continue;
      const comments = markers.every((marker) => marker.comment);
      model.blocks.push(linesBlock(doc, n, n, opener ? 'after' : comments ? 'either' : 'before'));
      if (parts.length) moved.push({ line: n, parts });
    } else if (opener && CONTAINER_PREFIX.test(before) && /^[ \t]*$/.test(between + after)) {
      let next = n + 1;
      while (next <= doc.lines && BLANK.test(doc.line(next).text)) next++;
      if (next > doc.lines) continue;
      const text = doc.line(next);
      const to = text.from + /^[ \t>]*/.exec(text.text)![0].length;
      for (const marker of markers) joined.set(marker, null);
      joined.set(first, { from: first.from, to, opener: true, parts });
    }
  }

  model.blocks.sort((a, b) => a.from - b.from);
  const blocks: Span[] = [];
  for (const block of model.blocks) {
    const previous = blocks.at(-1);
    // Blocks one line break apart hide as one.
    if (previous && block.from <= previous.to + 1) previous.to = Math.max(previous.to, block.to);
    else blocks.push({ ...block });
  }
  model.blocks = blocks;
  model.hidden = model.hidden.flatMap((hidden) => {
    const replaced = joined.get(hidden);
    if (replaced !== undefined) return replaced ? [replaced] : [];
    return spanAt(blocks, hidden.from) ? [] : [hidden];
  });
  const placed = new Map<number, Part[]>();
  for (const { line, parts } of moved) {
    const block = spanAt(blocks, doc.line(line).from)!;
    const below = doc.lineAt(block.to).number + 1;
    let at = Math.max(0, block.from - 1);
    if (below <= doc.lines) {
      const text = doc.line(below);
      at = text.from + /^[ \t>]*/.exec(text.text)![0].length;
    }
    placed.set(at, [...(placed.get(at) ?? []), ...parts]);
  }
  model.placed = [...placed].map(([at, parts]) => ({ at, parts }));
}

/** The classes of a change bar for changes by these colors: one author's, or gray for several. */
function barClass(colors: Set<number>): string {
  if (!colors.size) return '';
  const [only] = colors;
  // An unknown author's bar is gray too.
  return colors.size === 1 && only ? `rl-bar ${colorClass(only)}` : 'rl-bar rl-bar-mixed';
}

/** The change bar classes of each line, by line number. */
function bars(doc: Text, model: Model): Map<number, string> {
  const colors = new Map<number, Set<number>>();
  const add = (from: number, to: number, color: number) => {
    for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++) {
      const onLine = colors.get(n);
      if (onLine) onLine.add(color);
      else colors.set(n, new Set([color]));
    }
  };
  for (const layer of model.layers) if (layer.change) add(layer.from, layer.to, layer.color);
  for (const { from, parts } of model.hidden) {
    for (const part of parts) if (part.change) add(from, from, part.color);
  }
  for (const { at, parts } of model.placed) {
    for (const part of parts) if (part.change) add(at, at, part.color);
  }
  return new Map([...colors].map(([n, onLine]) => [n, barClass(onLine)]));
}

/** Deleted text and pins, drawn in place of hidden markers. */
class MarkupWidget extends WidgetType {
  readonly parts: readonly Part[];

  constructor(parts: readonly Part[]) {
    super();
    this.parts = parts;
  }

  override eq(other: MarkupWidget): boolean {
    return (
      other.parts.length === this.parts.length &&
      other.parts.every(
        (part, i) =>
          part.text === this.parts[i]?.text && part.className === this.parts[i]?.className,
      )
    );
  }

  override toDOM(): HTMLElement {
    const spans = this.parts.map((part) => {
      const span = document.createElement('span');
      span.className = part.className;
      span.textContent = part.text;
      return span;
    });
    if (spans.length === 1) return spans[0]!;
    const wrap = document.createElement('span');
    wrap.append(...spans);
    return wrap;
  }

  /** A click on deleted text puts the caret beside it. */
  override ignoreEvent(): boolean {
    return false;
  }
}

const HIDDEN = Decoration.replace({});
const HIDDEN_LINES = Decoration.replace({ block: true });
const COMMENT = Decoration.mark({ class: 'rl-comment' });

/**
 * A stretch the caret steps over: hidden text, or hidden lines with the line breaks around them.
 */
export class Atom extends RangeValue {
  /**
   * Whether it draws something, deleted text or a move to another line, so that the caret looks
   * different at its two ends. Markers draw nothing.
   */
  readonly visible: boolean;

  constructor(visible: boolean) {
    super();
    this.visible = visible;
  }

  override eq(other: RangeValue): boolean {
    return other instanceof Atom && other.visible === this.visible;
  }
}

const SHOWN = new Atom(true);
const BLANK_ATOM = new Atom(false);

interface Display {
  model: Model;
  decorations: DecorationSet;
  /** What the caret steps over: hidden text, and hidden lines with the line breaks around them. */
  atomic: RangeSet<Atom>;
}

function atomicRanges(doc: Text, model: Model): RangeSet<Atom> {
  // Whether the caret looks different at either end: across deleted text, or onto another line.
  const spans = [
    ...model.hidden.map(({ from, to, parts }) => ({
      from,
      to,
      visible: parts.some((part) => part.text),
    })),
    ...model.blocks.map(({ from, to }) => ({
      from: Math.max(0, from - 1),
      to: Math.min(doc.length, to + 1),
      visible: true,
    })),
  ].sort((a, b) => a.from - b.from);
  const merged: typeof spans = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    // Hidden text that touches is stepped over at once, without a stop between, unless both
    // sides show something: then the caret stops where they meet, as after deleted text that
    // ends a line before the hidden ledger.
    const touching = previous && span.from === previous.to;
    if (
      previous &&
      (span.from < previous.to || (touching && !(previous.visible && span.visible)))
    ) {
      previous.to = Math.max(previous.to, span.to);
      previous.visible ||= span.visible;
    } else merged.push(span);
  }
  return RangeSet.of(
    merged.map(({ from, to, visible }) => (visible ? SHOWN : BLANK_ATOM).range(from, to)),
  );
}

function display(state: EditorState): Display {
  const model = analyze(state);
  const { doc } = state;
  const ranges: Range<Decoration>[] = [];
  for (const { from, to, parts } of model.hidden) {
    const widget = parts.length ? new MarkupWidget(parts) : null;
    ranges.push((widget ? Decoration.replace({ widget }) : HIDDEN).range(from, to));
  }
  for (const { from, to } of model.blocks) ranges.push(HIDDEN_LINES.range(from, to));
  for (const { at, parts } of model.placed) {
    ranges.push(Decoration.widget({ widget: new MarkupWidget(parts), side: -1 }).range(at));
  }
  for (const { from, to, className } of model.layers) {
    ranges.push(Decoration.mark({ class: className }).range(from, to));
  }
  for (const { from, to } of model.comments) ranges.push(COMMENT.range(from, to));
  for (const [n, className] of bars(doc, model)) {
    const line = doc.line(n);
    const block = spanAt(model.blocks, line.from);
    if (block && line.to <= block.to) continue;
    ranges.push(Decoration.line({ class: className }).range(line.from));
  }
  return { model, decorations: Decoration.set(ranges, true), atomic: atomicRanges(doc, model) };
}

/** The tracked layer's decorations for a state. Exported for tests; the editor caches them. */
export function trackedDecorations(state: EditorState): DecorationSet {
  return display(state).decorations;
}

const trackedField = StateField.define<Display>({
  create: display,
  update(value, tr) {
    const changed =
      tr.docChanged ||
      tr.startState.facet(peopleFacet) !== tr.state.facet(peopleFacet) ||
      // Your color is the first: a change of author recolors the text, as it does the rail.
      tr.startState.facet(authorFacet) !== tr.state.facet(authorFacet) ||
      tr.startState.field(viewModeField) !== tr.state.field(viewModeField) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState);
    return changed ? display(tr.state) : value;
  },
  // From a state field rather than a view plugin, because hidden lines and the ledger replace
  // line breaks.
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
});

/** A stretch of text as the tracked layer draws it. */
export interface TrackedPiece {
  /** Where the text is in the document. Deleted text isn't: it is drawn at this position. */
  from: number;
  text: string;
  deleted: boolean;
  /** The classes of the marks around the text, outermost first. */
  layers: string[];
}

/** The tracked layer's view of part of a document, for widgets that draw its text themselves. */
export interface TrackedText {
  /** The visible pieces of `from`–`to`, deleted text included, in order. */
  pieces(from: number, to: number): TrackedPiece[];
  /** The classes of the change bar for `from`–`to`, or '' when nothing there changed. */
  bar(from: number, to: number): string;
}

/** How the layer draws `from`–`to`, such as a table's text, or null when it isn't installed. */
export function trackedText(state: EditorState, from: number, to: number): TrackedText | null {
  const model = state.field(trackedField, false)?.model;
  if (!model) return null;
  const hidden = model.hidden.filter((span) => span.from < to && from < span.to);
  const layers = model.layers
    .filter((span) => span.from < to && from < span.to)
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const around = (start: number, end: number) =>
    layers.filter((layer) => layer.from <= start && end <= layer.to).map((l) => l.className);
  const visible = (start: number, end: number, pieces: TrackedPiece[]) => {
    const cuts = new Set([start, end]);
    for (const layer of layers) {
      for (const pos of [layer.from, layer.to]) if (start < pos && pos < end) cuts.add(pos);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1]!, points[i]!];
      pieces.push({ from: a, text: state.sliceDoc(a, b), deleted: false, layers: around(a, b) });
    }
  };
  return {
    pieces(start, end) {
      const pieces: TrackedPiece[] = [];
      let pos = start;
      for (const span of hidden) {
        if (span.to <= start || end <= span.from) continue;
        if (pos < span.from) visible(pos, span.from, pieces);
        if (start <= span.from) {
          for (const part of span.parts) {
            if (!part.text) continue;
            const outer = around(span.from, span.to);
            pieces.push({
              from: span.to,
              text: part.text,
              deleted: true,
              layers: [...outer, part.className],
            });
          }
        }
        pos = Math.max(pos, span.to);
      }
      if (pos < end) visible(pos, end, pieces);
      return pieces;
    },
    bar(start, end) {
      const colors = new Set<number>();
      for (const layer of layers) {
        if (layer.change && layer.from <= end && start <= layer.to) colors.add(layer.color);
      }
      for (const span of hidden) {
        if (span.from < start || end < span.from) continue;
        for (const part of span.parts) if (part.change) colors.add(part.color);
      }
      return barClass(colors);
    },
  };
}

/**
 * A selection whose ends aren't hidden: moved out of hidden text and hidden lines, a caret off the
 * start of a document whose first lines are hidden, and nothing past the body's end, onto the line
 * after the hidden ledger.
 */
export function visibleSelection(
  state: EditorState,
  selection: EditorSelection = state.selection,
): EditorSelection {
  const atoms = state.field(trackedField).atomic;
  if (!atoms.size) return selection;
  const end = bodyEnd(state.field(parsedField)) ?? state.doc.length;
  const outside = (pos: number, side: -1 | 0 | 1) => {
    let moved = pos;
    atoms.between(pos, pos, (from, to) => {
      if (side === 0 && pos === 0 && from === 0) moved = to;
      else if (from < pos && pos < to) {
        moved = side < 0 || (side === 0 && pos - from <= to - pos) ? from : to;
      }
    });
    return Math.min(moved, end);
  };
  const next = EditorSelection.create(
    selection.ranges.map((range) =>
      range.empty
        ? EditorSelection.cursor(outside(range.head, 0))
        : EditorSelection.range(
            outside(range.anchor, range.anchor < range.head ? -1 : 1),
            outside(range.head, range.head < range.anchor ? -1 : 1),
          ),
    ),
    selection.mainIndex,
  );
  return next.eq(selection) ? selection : next;
}

/** What the caret steps over in a state: hidden text and hidden lines, none in Raw. */
export function atomsOf(state: EditorState): RangeSet<Atom> {
  return state.field(trackedField, false)?.atomic ?? RangeSet.of<Atom>([]);
}

/**
 * Whether all of `from`–`to` is text the caret steps over, and with `blank`, text that draws
 * nothing, so that the caret looks the same at either end.
 */
export function onlyHidden(state: EditorState, from: number, to: number, blank = false): boolean {
  const spans: { from: number; to: number }[] = [];
  atomsOf(state).between(from, to, (start, end, atom) => {
    if (!blank || !atom.visible) spans.push({ from: start, to: end });
  });
  let pos = from;
  for (const span of spans.sort((a, b) => a.from - b.from)) {
    if (span.from > pos) break;
    pos = Math.max(pos, span.to);
  }
  return pos >= to;
}

/** The position past the hidden text that starts at `pos` (`forward`) or ends there. */
export function pastHidden(state: EditorState, pos: number, forward: boolean): number {
  const atoms = atomsOf(state);
  for (let moved = true; moved;) {
    moved = false;
    atoms.between(pos, pos, (from, to) => {
      if (forward ? from === pos && to > pos : to === pos && from < pos) {
        pos = forward ? to : from;
        moved = true;
        return false;
      }
    });
  }
  return pos;
}

/**
 * Leaving Raw, a new version of the file from outside, or an edit the tracked layer dealt with
 * (tracked or plain) or a decision can leave the caret in text that is hidden now: inside markers
 * that an edit brought together, on a blank line under a new own-line marker, or past the hidden
 * ledger. It moves out.
 */
const caretOutOfHiding = EditorState.transactionFilter.of((tr) => {
  const switched = tr.effects.some((effect) => effect.is(setViewModeEffect));
  const moved = tr.annotation(Transaction.remote) || tr.annotation(trackedEditAnnotation);
  if (!switched && !moved) return tr;
  const selection = visibleSelection(tr.state);
  return selection === tr.state.selection ? tr : [tr, { selection, sequential: true }];
});

/** The view's class on the editor: `rl-view-clean`, `rl-view-redlines` or `rl-view-raw`. */
const viewClass = EditorView.editorAttributes.compute([viewModeField], (state) => ({
  class: `rl-view-${state.field(viewModeField)}`,
}));

/** Markdown's syntax in Raw, drawn in grays: color means a person. */
const rawHighlighter = tagHighlighter([
  { tag: tags.heading, class: 'rl-tok-heading' },
  { tag: tags.strong, class: 'rl-tok-strong' },
  { tag: tags.emphasis, class: 'rl-tok-emphasis' },
  { tag: tags.strikethrough, class: 'rl-tok-strike' },
  { tag: tags.processingInstruction, class: 'rl-tok-mark' },
  { tag: [tags.link, tags.url], class: 'rl-tok-link' },
  { tag: tags.comment, class: 'rl-tok-comment' },
]);

/** The highlighting of the visible text, in Raw only: the other views draw the document. */
function rawDecorations(view: EditorView): DecorationSet {
  if (view.state.field(viewModeField) !== 'raw') return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const marks = new Map<string, Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    highlightTree(
      tree,
      rawHighlighter,
      (start, end, classes) => {
        let mark = marks.get(classes);
        if (!mark) marks.set(classes, (mark = Decoration.mark({ class: classes })));
        builder.add(start, end, mark);
      },
      from,
      to,
    );
  }
  return builder.finish();
}

const rawHighlighting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = rawDecorations(view);
    }

    update(update: ViewUpdate): void {
      const { state, startState } = update;
      const changed =
        update.docChanged ||
        update.viewportChanged ||
        state.field(viewModeField) !== startState.field(viewModeField) ||
        syntaxTree(state) !== syntaxTree(startState);
      if (changed) this.decorations = rawDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const theme = EditorView.baseTheme({
  // CodeMirror pads hidden markers and deleted text with zero-width buffers, where a line may
  // break. With its `break-spaces`, a space after a hidden marker that didn't fit at the end of a
  // line started the next one. With `pre-wrap`, a space at the end of a line hangs in the margin,
  // and the line breaks after it.
  '.cm-content.cm-lineWrapping': { whiteSpace: 'pre-wrap' },
  // Inserted text: underlined, and the text too in its author's color, as in Word.
  '.rl-ins': {
    color: 'var(--rl-color)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--rl-color)',
    textDecorationThickness: '1.5px',
    textUnderlineOffset: '3px',
    textDecorationSkipInk: 'none',
  },
  // Deleted text: struck through, in its author's color.
  '.rl-del': {
    color: 'var(--rl-color)',
    textDecoration: 'line-through',
    textDecorationColor: 'var(--rl-color)',
    textDecorationThickness: '1px',
  },
  // Text whose formatting changed: a quiet dotted underline in its author's color.
  '.rl-fmt': {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: 'var(--rl-color)',
    textDecorationThickness: '1px',
    textUnderlineOffset: '3px',
    textDecorationSkipInk: 'none',
  },
  // The range of a comment or a highlight: the author's tint behind the text.
  '.rl-cmt': { backgroundColor: 'var(--rl-color-tint)' },
  // A comment on a point: a dot in the author's color above the text, taking no room in the line.
  '.rl-cmt-point': { position: 'relative' },
  '.rl-cmt-point::before': {
    content: '""',
    position: 'absolute',
    left: '-2px',
    bottom: '1.12em',
    width: '4px',
    height: '4px',
    borderRadius: '50%',
    backgroundColor: 'var(--rl-color)',
  },
  // An inserted line break: a small pilcrow on the baseline at the end of the line before it, in
  // the author's color, taking no room in the line.
  '.rl-split::before': {
    content: '"¶"',
    display: 'inline-block',
    width: '0',
    position: 'relative',
    left: '1px',
    fontSize: '0.8em',
    color: 'var(--rl-color)',
  },
  // A change bar: 2px, 24px left of the column, as tall as the line.
  '.rl-bar': { position: 'relative' },
  '.rl-bar::before': {
    content: '""',
    position: 'absolute',
    top: '0',
    bottom: '0',
    left: '-24px',
    width: '2px',
    backgroundColor: 'var(--rl-color)',
  },
  '.rl-bar-mixed::before': { backgroundColor: 'var(--rl-mixed)' },
  // A quote's own border would move its bar right.
  '.rl-quote.rl-bar::before': { left: '-26px' },
  // Ordinary HTML comments in Redlines: small dimmed notes.
  '.rl-comment': { color: 'var(--rl-ink-3)', fontSize: '0.85em' },

  // Raw: the source in the code font, a little wider and more open than the document's column,
  // markers and the ledger in the second ink.
  '&.rl-view-raw .cm-scroller': { fontFamily: 'var(--rl-font-mono)' },
  '&.rl-view-raw .cm-content': {
    maxWidth: 'calc(760px + 48px)',
    paddingTop: '40px',
    fontSize: 'calc(13.5px * var(--rl-text-scale, 1))',
    lineHeight: '1.75',
  },
  '&.rl-view-raw .rl-tok-heading, &.rl-view-raw .rl-tok-strong': { fontWeight: '700' },
  '&.rl-view-raw .rl-tok-emphasis': { fontStyle: 'italic' },
  '&.rl-view-raw .rl-tok-strike': { textDecoration: 'line-through' },
  '&.rl-view-raw .rl-tok-mark': { color: 'var(--rl-ink-3)' },
  '&.rl-view-raw .rl-tok-link': { color: 'var(--rl-ink-2)' },
  '&.rl-view-raw .rl-tok-comment': { color: 'var(--rl-ink-2)' },
});

/** Tracked changes, comments and the three views. Needs the Markdown language. */
export function trackedChanges(): Extension {
  return [
    parsedField,
    viewModeField,
    trackedField,
    caretOutOfHiding,
    viewClass,
    rawHighlighting,
    colorTheme,
    theme,
  ];
}
