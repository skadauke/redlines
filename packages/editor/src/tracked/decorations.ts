// Showing tracked changes (design §5.3, §5.5). Markers and the ledger are hidden, and the caret
// steps over them. In Redlines, inserted text is underlined and deleted text struck through, both
// in their author's color, text whose formatting changed has a dotted underline in it, and an
// inserted line break shows a small pilcrow when line break marks are shown; comments and
// highlights are tinted, and a bar left of the column marks each line with a pending change. Clean
// shows the newest text, as if every change were accepted, without markup or ordinary HTML
// comments. Plain shows the source as written, highlighted in grays.

import { syntaxTree } from '@codemirror/language';
import {
  type ChangeSet,
  EditorSelection,
  EditorState,
  type Extension,
  type Line,
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
import {
  type DeletedBlockKind,
  closerRange,
  deletedBlocks,
  isAlignMark,
  type MarkRange,
  type Parsed,
  type Segment,
  plainPayload,
} from '@redlines/format';
import {
  blankLines,
  blankLinesIn,
  TAIL_LENGTH,
  commentSpans,
  commentSpansIn,
  keptLine,
} from '../blocks/hidden.ts';
import {
  containersOf,
  foldField,
  headLine,
  hiddenContainerLines,
  isOpen,
} from '../blocks/containers.ts';
import { containerKeys } from '../blocks/container-keys.ts';
import { containerBracket, drawContainers, type ContainerDrawing } from './container-draw.ts';
import { openBlock } from '../blocks/open.ts';
import { resync } from '../restyle.ts';
import { BULLETS, LEVEL_COLS } from '../preview/decorations.ts';
import { alignedColumns, insertedColumnCells, tableAbove } from '../table/columns.ts';
import {
  GHOST_ROWS,
  ghostColors,
  ghostTableDOM,
  ghostTableHeight,
  ghostTableOf,
  type GhostTable,
} from '../table/ghost-table.ts';
import { textPx } from '../preview/theme.ts';
import { colorClass, colorsOf, colorTheme } from './colors.ts';
import {
  markEnd,
  marksOverlapping,
  marksReaching,
  windowEnd,
  windowStart,
  type Zone,
} from './windows.ts';
import {
  authorFacet,
  bodyEnd,
  boxChange,
  isDrawnChange,
  isColDeletion,
  isColInsertion,
  isTableDeletion,
  lineBreakMarksFacet,
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
  /**
   * Its classes, or none for a part that draws nothing and only takes a change bar: an inserted
   * line break, or deleted line breaks alone, while line break marks are hidden.
   */
  className: string;
  color: number;
  /** Deleted text, which is a change and takes a change bar. */
  change: boolean;
  /** An inserted line break's pilcrow. */
  split?: boolean;
  /**
   * The deleted text of a substitution of a whole block, which ends its own line: the new text
   * starts on the line below, in the same block (design: Part 3).
   */
  whole?: boolean;
  /** The id of the change this deleted text belongs to, on its element as `data-mark`. */
  mark?: string;
  /**
   * The id of the split a pilcrow draws, on its element as `data-rl-change`: drawn beside another
   * break's, with its marker on a hidden line (#198), its card is found by it.
   */
  id?: string;
}

/** The parts that draw something. */
const drawn = (parts: readonly Part[]) => parts.filter((part) => part.className);

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
  /** The change the layer draws, which a card is found by (`data-mark`). */
  mark?: string;
}

interface Span {
  from: number;
  to: number;
}

/** What the layer draws for a state, before it becomes decorations. */
interface Model {
  /** Hidden text within lines, in document order. */
  hidden: Hidden[];
  /**
   * Whole lines hidden, in document order: blank lines between blocks, lines that hold only
   * markers, and the ledger.
   */
  blocks: Span[];
  /**
   * Deleted text and pins moved from hidden lines to the start of the block below them (`side`
   * -1), and the pilcrows of line breaks to the end of the line above (1).
   */
  placed: { at: number; side: -1 | 1; parts: Part[] }[];
  layers: Layer[];
  /** The lines of inserted table rows, whose cells the author's tint and underline draw. */
  rows: { at: number; className: string }[];
  /** Ordinary HTML comments, drawn dimmed. */
  comments: Span[];
  /** Whole-block deletions drawn as blocks, in Redlines. */
  struck: Struck[];
  /**
   * Lines of markers alone that the join of a bullet's marker took along, by where each starts,
   * with where the bullet's line starts: what is drawn at such a line is drawn there.
   */
  carriedLines: Map<number, number>;
}

/** A stretch of a struck block's text and the color of whoever deleted it. */
interface StruckRun {
  text: string;
  color: number;
}

interface StruckBlock {
  kind: DeletedBlockKind;
  runs: StruckRun[];
  /** A deleted table, drawn as a ghost table (`table/ghost-table.ts`), not as runs of its source. */
  table?: GhostTable;
}

/**
 * A whole-block deletion (format §3.4) drawn as the blocks it deleted, struck where they were.
 * `lines` is its marker's own line, which the hidden lines around it hide (the widget replaces
 * them); `before` is the line of the next item of a list, whose bullet the deletion leaves in
 * front of its marker, and the blocks are drawn above it (so are the blocks of a deletion that is
 * all the text, above its marker's own line); `after` is the line above a block deleted at the end
 * of the text, and the blocks are drawn below it.
 */
interface Struck {
  id: string;
  where: 'lines' | 'before' | 'after';
  /** A position on the line the blocks belong to: the marker's. */
  at: number;
  colors: Set<number>;
  blocks: StruckBlock[];
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

const LINE_BREAK = /\r\n?|\n/g;
/** Line breaks one after the other, and the white space around them. */
const BREAKS = /[ \t]*(?:(?:\r\n?|\n)[ \t]*)+/g;

/**
 * Deleted text as drawn. With line break marks shown, a deleted line break is a pilcrow, struck
 * like the rest. Drawn as a line break, it would look like no change at all, as when someone's
 * inserted break is deleted. With them hidden, line breaks deleted alone, as in a join or a hard
 * break, draw nothing, and in deleted text they are a space, so that its words don't run together
 * or into the text beside it, as a whole paragraph deleted would into the next.
 */
const deletedText = (payload: string, marks: boolean) => {
  const text = plainPayload(payload);
  if (marks) return text.replace(LINE_BREAK, '¶');
  return text.replace(BREAKS, /\S/.test(text) ? ' ' : '');
};

/** A line of whitespace and block quote markers only: blank, also inside a quote. */
const BLANK = /^[ \t>]*$/;
/** What may come before a marker on its line without being text (format §3.2). */
const CONTAINER_PREFIX =
  /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])|\[[ xX]\](?=[ \t])))*[ \t]*$/;

/** How many segments the search for the deletions around whole-block deletions has visited, for tests. */
export const struckStats = { visited: 0 };

/** A marker, whose text holds no `-->`. */
const MARKER = /<!--(?:[^-]|-(?!->))*-->/g;

/** A line of the next item of a list, or a list item at all. */
const ITEM_LINE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/;

/** Whether a line starts a block, so the line above it ends one. */
const BLOCK_START = /^[ \t]*(?:[-*+>|]|\d{1,9}[.)]|#{1,6}(?:[ \t]|$)|`{3,}|~{3,})/;

/**
 * Whether a substitution is of the whole text of its block or its table cell (design: Part 3): it
 * starts where the block's text does, after its prefix, and ends where it ends. Its old text is
 * then drawn above the new, on a line of its own, in the same block.
 */
function replacesBlock(doc: Text, segment: Segment, bodyEnd: number): boolean {
  const { close } = segment;
  if (!close || segment.payload === undefined) return false;
  const line = doc.lineAt(segment.open.from);
  const before = doc.sliceString(line.from, segment.open.from).replace(MARKER, '');
  const last = doc.lineAt(close.to);
  const after = doc.sliceString(close.to, last.to).replace(MARKER, '');
  // A cell of a table: between its pipes, which a backslash before the first doesn't make one.
  const cell = /^[ \t]*\|/.test(before) && /(?:^|[^\\])(?:\\\\)*\|[ \t]*$/.test(before);
  if (cell) return /^[ \t]*(?:\||$)/.test(after);
  if (!/^[ \t]*$/.test(after)) return false;
  const heading = /^[ \t>]*#{1,6}[ \t]+$/.test(before);
  if (!heading) {
    // The first line of a block: an item or a quote line, or one under a blank line.
    const gap = line.number === 1 || BLANK.test(doc.line(line.number - 1).text.replace(MARKER, ''));
    if (!CONTAINER_PREFIX.test(before) || !(before.trim() !== '' || gap)) return false;
    // And the last: a blank line, the end of the text or another block follows.
    if (last.number < doc.lines && last.to < bodyEnd) {
      const next = doc.line(last.number + 1).text.replace(MARKER, '');
      if (!BLANK.test(next) && !BLOCK_START.test(next)) return false;
    }
  }
  return true;
}

/**
 * The block a substitution of code, display math or raw text replaced whole (format §3.5), drawn
 * as the code it was: its lines apart, in the code font, with no fence. Null for a payload that is
 * anything else, which is drawn as the text it is.
 */
function replacedCode(
  payload: string,
): { kind: DeletedBlockKind; pieces: { text: string; at: number }[] } | null {
  const text = payload.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  // A payload of white space alone is no code to draw.
  if (text.trim() === '') return null;
  const lines = text.split('\n');
  const first = lines[0] ?? '';
  const fenced = /^[ \t>]*(`{3,}|~{3,})/.test(first) && lines.length > 1;
  let code: string[];
  let language = '';
  if (fenced) {
    const fence = /^[ \t>]*(`{3,}|~{3,})(.*)$/.exec(first);
    language = (fence?.[2] ?? '').trim();
    code = lines.slice(1, /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.test(lines.at(-1) ?? '') ? -1 : undefined);
  } else if (lines.every((line) => /^(?: {4}|\t)/.test(line) || /^[ \t]*$/.test(line))) {
    code = lines.map((line) => line.replace(/^(?: {4}|\t)/, ''));
  } else if (/^[ \t]{0,3}(?:\$\$|<(?:script|pre|style|textarea)[\s>])/i.test(first)) {
    code = lines;
  } else return null;
  const body = code.join('\n');
  return { kind: { kind: 'code', language }, pieces: [{ text: body, at: 0 }] };
}

/**
 * The table a substitution replaced whole (format §3.7): a payload that is one table and nothing
 * else, drawn as the ghost table of a table deleted. The new table follows its marker, so the old
 * is read as blocks alone, with no break at either end. Null for any other payload.
 */
function replacedTable(
  segment: Segment,
): { kind: DeletedBlockKind; pieces: { text: string; at: number }[] } | null {
  const blocks = deletedBlocks(segment, { atEnd: true, alone: true, tableRows: GHOST_ROWS });
  const [block] = blocks ?? [];
  return blocks?.length === 1 && block?.kind.kind === 'table' ? block : null;
}

/**
 * The whole-block deletions to draw as blocks (design: Part 3), by their marks, and the marks of
 * other people that they hold, whose deleted text is part of the blocks. A deletion is whole when
 * `deletedBlocks` reads its payload as whole blocks, and the file is in the form that goes with
 * it: its marker alone on its line before a block, the line of a bullet when the next item's
 * prefix stands in front of it, or the end of the text. Anything else live between its segments,
 * as text of another person's insertion, leaves it to be drawn inline.
 */
function struckBlocks(
  state: EditorState,
  parsed: Parsed,
  colors: ReadonlyMap<string, number>,
  marks: boolean,
): { struck: Map<MarkRange, Struck>; absorbed: Set<MarkRange> } {
  const struck = new Map<MarkRange, Struck>();
  const absorbed = new Set<MarkRange>();
  const { doc } = state;
  const end = parsed.ledgerRange?.from ?? doc.length;
  const colorOf = (mark: MarkRange) => colors.get(mark.entry.by) ?? 0;
  // The segments of the deletions in file order, made once and only when a deletion needs them.
  let sorted: { segment: Segment; mark: MarkRange }[] | null = null;
  const deletions = () =>
    (sorted ??= parsed.marks
      .filter((other) => other.kind === 'del')
      .flatMap((other) => other.segments.map((segment) => ({ segment, mark: other })))
      .sort((a, b) => a.segment.open.from - b.segment.open.from));
  /** The index of the first segment that opens at or after `from`. */
  const firstFrom = (list: readonly { segment: Segment }[], from: number) => {
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (list[middle]!.segment.open.from < from) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  for (const mark of parsed.marks) {
    // A deletion of whole blocks, or a substitution of one block of code (format §3.5).
    const replaced =
      mark.kind === 'sub' && mark.segments.length === 1 && !!mark.segments[0]?.carrier
        ? (replacedCode(plainPayload(mark.segments[0].payload ?? '')) ??
          replacedTable(mark.segments[0]))
        : null;
    if (
      (mark.kind !== 'del' && !replaced) ||
      !isDrawnChange(mark) ||
      isTableDeletion(mark) ||
      absorbed.has(mark)
    ) {
      continue;
    }
    const first = mark.segments[0];
    const last = mark.segments.at(-1);
    if (!first || !last || first.payload === undefined) continue;
    const line = doc.lineAt(first.open.from);
    const lead = doc.sliceString(line.from, first.open.from).replace(MARKER, '');
    let where: Struck['where'];
    // A deletion that is all the text of the file: no block above holds its marker, none follows it.
    let alone = false;
    let segments: { segment: Segment; mark: MarkRange }[] = mark.segments.map((segment) => ({
      segment,
      mark,
    }));
    const hold = new Set<MarkRange>();
    // A table deleted alone, with text typed after it (#470): its payload has no break of its own, and
    // the break after the marker is the opener's carrier, so the marker is the first line's, and
    // the text below is paragraphs of their own.
    const lone =
      !replaced &&
      !!first.carrier &&
      mark.segments.length === 1 &&
      line.number === 1 &&
      BLANK.test(lead) &&
      first.open.to === line.to &&
      !/\n[ \t>]*$/.test(plainPayload(first.payload)) &&
      /^\s*\|/.test(plainPayload(first.payload));
    if (first.carrier && !lone) {
      if (!CONTAINER_PREFIX.test(lead)) continue;
      where = BLANK.test(lead) ? 'lines' : 'before';
      const lastLine = doc.lineAt(last.open.to);
      // Nothing live between the segments: every line holds markers and blank lines alone.
      let bare = true;
      for (let n = line.number; n <= lastLine.number && bare; n++) {
        const text = doc.line(n).text.replace(MARKER, '');
        bare = where === 'before' ? n !== line.number || text === lead : BLANK.test(text);
      }
      if (!bare || (where === 'before' && mark.segments.length > 1)) continue;
      if (where === 'lines' && !replaced) {
        // Other people's deletions in the same lines belong to the blocks: found among the
        // segments of all deletions, in file order, by search (not by a scan of every mark).
        const inside = (segment: Segment) =>
          segment.open.from >= line.from && segment.open.to <= lastLine.to;
        const held = new Set<MarkRange>();
        for (
          let i = firstFrom(deletions(), line.from);
          i < deletions().length && deletions()[i]!.segment.open.from <= lastLine.to;
          i++
        ) {
          const found = deletions()[i]!;
          struckStats.visited++;
          if (inside(found.segment)) held.add(found.mark);
        }
        segments = [...held]
          .flatMap((other) => other.segments.map((segment) => ({ segment, mark: other })))
          .sort((a, b) => a.segment.open.from - b.segment.open.from);
        const outside = segments.some(
          ({ segment, mark: other }) => !inside(segment) || !isDrawnChange(other),
        );
        if (outside || segments[0]?.segment !== first) continue;
        for (const { mark: other } of segments) hold.add(other);
      }
    } else {
      where = 'after';
      if (
        mark.segments.length !== 1 ||
        (!lone && !/^\s*$/.test(doc.sliceString(first.open.to, end)))
      )
        continue;
      // The first line of the file, with no text above it, has no block above to hold the marker:
      // the blocks are drawn above its line, which is hidden like the ledger and leaves the caret
      // a place, as in Clean.
      alone = BLANK.test(lead) && line.number === 1;
      if (alone) where = 'before';
    }
    const blocks = replaced
      ? [replaced]
      : deletedBlocks(
          segments.map(({ segment }) => segment),
          { lead, atEnd: where === 'after' || alone, alone, tableRows: GHOST_ROWS },
        );
    if (!blocks) continue;
    // Of the text that is all the text, only a table is drawn as a block: any other stays as the text
    // on its line that it is, which the caret rests on (`hideMarkerLines`).
    if (alone && !blocks.every((block) => block.kind.kind === 'table')) continue;
    // Each stretch of the blocks' text in the color of the person who deleted it.
    const owners: { to: number; color: number }[] = [];
    let total = 0;
    for (const { segment, mark: owner } of segments) {
      total += plainPayload(segment.payload ?? '').length;
      owners.push({ to: total, color: colorOf(owner) });
    }
    const drawn = new Set<number>();
    const struckBlock = blocks.map((block): StruckBlock => {
      // A table is drawn as a table, with its cells' text in the colors of whose it is.
      if (block.kind.kind === 'table') {
        const table = ghostTableOf(block.kind, owners, colorOf(mark), marks);
        for (const color of ghostColors(table)) drawn.add(color);
        return { kind: { ...block.kind, rows: [] }, runs: [], table };
      }
      const runs: StruckRun[] = [];
      const add = (text: string, color: number) => {
        const previous = runs.at(-1);
        if (previous?.color === color) previous.text += text;
        else runs.push({ text, color });
      };
      block.pieces.forEach((piece, index) => {
        if (index > 0)
          add(block.kind.kind === 'code' ? '\n' : ' ', runs.at(-1)?.color ?? colorOf(mark));
        let at = piece.at;
        while (at < piece.at + piece.text.length) {
          const owner = owners.find((candidate) => at < candidate.to) ?? owners.at(-1)!;
          const to = Math.min(piece.at + piece.text.length, owner.to);
          add(piece.text.slice(at - piece.at, to - piece.at), owner.color);
          at = Math.max(to, at + 1);
        }
      });
      if (marks) add('¶', runs.at(-1)?.color ?? colorOf(mark));
      for (const run of runs) drawn.add(run.color);
      return { kind: block.kind, runs };
    });
    drawn.add(colorOf(mark));
    const item: Struck = {
      id: mark.id,
      where,
      at: where === 'before' ? line.from : where === 'after' ? line.to : first.open.from,
      colors: drawn,
      blocks: struckBlock,
    };
    struck.set(mark, item);
    for (const other of hold) if (other !== mark) absorbed.add(other);
  }
  return { struck, absorbed };
}

function analyze(state: EditorState, kept: number | null, zone?: Zone): Model {
  const model: Model = {
    hidden: [],
    blocks: [],
    carriedLines: new Map(),
    placed: [],
    layers: [],
    rows: [],
    comments: [],
    struck: [],
  };
  const mode = state.field(viewModeField);
  if (mode === 'raw') return model;
  const whole = state.field(parsedField);
  // In a window, the marks that open in it, and those of a block of its own that reach into it
  // from above, whose pieces that start in the window it draws (`windows.ts`).
  const marksHere = zone ? marksReaching(whole, zone.from, zone.to) : whole.marks;
  const parsed = zone ? { ...whole, marks: marksHere } : whole;
  // Simple is Redlines with the changes' looks mostly off (design: The views and the looks): the same
  // parts and layers, so that the bars land on the same lines, with no deleted text, no underline
  // (an insertion is only in its author's color), no tint and no marks of line breaks.
  // Comments, highlights and pins are drawn as in Redlines.
  const markup = mode === 'redlines' || mode === 'simple';
  const redlines = mode === 'redlines';
  const marks = redlines && state.facet(lineBreakMarksFacet);
  const colors = colorsOf(state);
  const threads = new Map(parsed.ledger.comments.map((thread) => [thread.id, thread]));
  // Blocks deleted whole are drawn as blocks, only in Redlines: Simple and Clean draw none.
  const blocks = redlines
    ? struckBlocks(state, parsed, colors, state.facet(lineBreakMarksFacet))
    : null;
  if (blocks) model.struck = [...blocks.struck.values()];
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
      // A deleted row is drawn as a ghost row of its table (`table/ghosts.ts`), never as text.
      if (
        markup &&
        change &&
        mark.kind !== 'ins' &&
        mark.kind !== 'fmt' &&
        segment.payload &&
        !isTableDeletion(mark)
      ) {
        // A block drawn as a block takes its own bar, and leaves the lines around it alone.
        const asBlock = blocks?.struck.has(mark) || blocks?.absorbed.has(mark);
        if (!asBlock) {
          const text = redlines ? deletedText(segment.payload, marks) : '';
          const whole =
            redlines &&
            text !== '' &&
            mark.kind === 'sub' &&
            replacesBlock(state.doc, segment, parsed.ledgerRange?.from ?? state.doc.length);
          parts.push({
            text,
            className: text ? `rl-del ${author}` : '',
            color,
            change: true,
            mark: mark.id,
            ...(whole ? { whole } : {}),
          });
        }
      }
      if (markup && tinted && !segment.close) {
        parts.push({ text: '', className: `rl-cmt-point ${author}`, color, change: false });
      }
      // An inserted table row: a change bar, in Simple too, and in Redlines its line has the author's
      // tint and underline.
      if (markup && mark.kind === 'ins' && mark.payload === 'row') {
        parts.push({ text: '', className: '', color, change: true });
        // Simple draws the text of the row in the author's color, with no tint and no underline.
        if (redlines) {
          const moved = mark.entry.move === undefined ? '' : ' rl-moved-row';
          model.rows.push({ at: segment.open.from, className: `rl-ins-row${moved} ${author}` });
        } else {
          model.rows.push({ at: segment.open.from, className: `rl-ins-row-plain ${author}` });
        }
      }
      // A deleted table column: a change bar on each row of its table, in Simple too; the ghost cells
      // are drawn by the layout.
      if (markup && isColDeletion(mark)) {
        const table = tableAbove(state, segment.open.from);
        for (const row of table?.rows ?? []) {
          model.layers.push({ from: row.from, to: row.from, className: '', color, change: true });
        }
      }
      // An inserted table column: a change bar on each row, and in Redlines its cells have the
      // author's tint and underline.
      if (markup && isColInsertion(mark)) {
        // (The cells are tinted and underlined by the layout, which has the cell: `rl-ins-col`.)
        for (const cell of insertedColumnCells(state, mark)) {
          model.layers.push({ from: cell.from, to: cell.from, className: '', color, change: true });
        }
      }
      // A box checked or unchecked: its point mark has no text, and its line has a change bar.
      if (
        markup &&
        change &&
        mark.kind === 'fmt' &&
        !segment.close &&
        boxChange(state.sliceDoc(segment.open.from, segment.open.to)) !== null
      ) {
        parts.push({ text: '', className: '', color, change: true });
      }
      if (markup && mark.kind === 'split') {
        const className = marks ? `rl-split ${author}` : '';
        parts.push({ text: '', className, color, change: true, split: true, id: mark.id });
      }
      // An alignment change of a table (format §3.7): the table is not the text it changed. A bar on the
      // header row, and in Redlines a dotted underline under the header text of each column changed;
      // the new alignment is what the delimiter row says.
      const aligned = markup && mark.kind === 'fmt' && isAlignMark(mark);
      if (aligned) {
        const found = alignedColumns(state, mark);
        const header = found?.table.rows[0];
        if (found && header) {
          model.layers.push({
            from: header.from,
            to: header.from,
            className: '',
            color,
            change: true,
          });
          if (redlines) {
            for (const col of found.cols) {
              const cell = header.cells[col];
              if (!cell || cell.textTo <= cell.textFrom) continue;
              model.layers.push({
                from: cell.textFrom,
                to: cell.textTo,
                className: `rl-fmt ${author}`,
                color,
                change: true,
              });
            }
          }
        }
      }
      // The text of a format change, after the carrier of an opener alone on its line, as a block's
      // is. A box's mark is a point, and draws nothing of its own.
      const start = segment.carrier?.to ?? from;
      if (aligned) {
        // (drawn above)
      } else if (markup && mark.kind === 'fmt' && segment.close && start < to) {
        const className = redlines ? `rl-fmt ${author}` : '';
        model.layers.push({ from: start, to, className, color, change: true });
      } else if (markup && mark.kind !== 'fmt' && segment.close && from < to) {
        if (change && mark.kind !== 'del') {
          // Simple: the author's color, without the underline.
          const className = redlines ? `rl-ins ${author}` : `rl-ins-plain ${author}`;
          // A substitution's text starts after the carrier of an opener alone on its line, which
          // its old text is drawn after: struck text is no inserted text.
          const start =
            mark.kind === 'sub' && segment.carrier && segment.carrier.to < to
              ? segment.carrier.to
              : from;
          model.layers.push({ from: start, to, className, color, change: true });
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
      if (segment.close)
        model.hidden.push({ ...closerRange(parsed.text, segment.close), opener: false, parts: [] });
    }
  }
  model.hidden.sort((a, b) => a.from - b.from);
  const here = zone ? commentSpansIn(state, zone.from, zone.to) : commentSpans(state);
  const comments = ordinaryComments(here, model.hidden, parsed.ledgerRange);
  // Small dimmed notes in Redlines (design §5.5); Clean is the document without them.
  if (redlines) model.comments = comments;
  else {
    const hidden = comments.map((span) => ({ ...span, opener: false, parts: [], comment: true }));
    model.hidden.push(...hidden);
    model.hidden.sort((a, b) => a.from - b.from);
  }
  const ledger = parsed.ledgerRange;
  if (!zone || (ledger && ledger.from >= zone.from && ledger.from < zone.to)) {
    hideLedger(state.doc, ledger, model);
  }
  // Blank lines between blocks are structure, never lines (design: block editing).
  // The empty paragraph Return opened is drawn, wherever the caret is, while it is open.
  const blank = openBlock(state)?.empty ?? null;
  model.blocks.push(
    ...(zone
      ? blankLinesIn(state, zone.from, zone.to, kept, blank)
      : blankLines(state, kept, blank)),
  );
  // The tag lines of containers, and what a closed section folds away (blocks/containers.ts).
  model.blocks.push(...hiddenContainerLines(state));
  // The empty paragraph that is open is no blank line that a marker's line takes along.
  const open = openBlock(state)?.empty ?? null;
  const drawn = (line: Line) => open !== null && line.from <= open.to && line.to >= open.from;
  hideMarkerLines(state.doc, model, parsed.ledgerRange?.from ?? state.doc.length, drawn, kept);
  return zone ? within(model, zone) : sorted(model);
}

/** The model in the order its pieces start, as a window's pieces are put among the others'. */
function sorted(model: Model): Model {
  model.placed.sort((a, b) => a.at - b.at);
  model.layers.sort((a, b) => a.from - b.from);
  model.rows.sort((a, b) => a.at - b.at);
  model.struck.sort((a, b) => a.at - b.at);
  return model;
}

const startsIn = (zone: Zone, pos: number) => pos >= zone.from && pos < zone.to;

/** What a window's model holds of the pieces that start in it. */
function within(model: Model, zone: Zone): Model {
  const keep = <T>(items: T[], at: (item: T) => number) =>
    items.filter((item) => startsIn(zone, at(item)));
  return sorted({
    hidden: keep(model.hidden, (item) => item.from),
    blocks: keep(model.blocks, (item) => item.from),
    placed: keep(model.placed, (item) => item.at),
    layers: keep(model.layers, (item) => item.from),
    rows: keep(model.rows, (item) => item.at),
    comments: keep(model.comments, (item) => item.from),
    struck: keep(model.struck, (item) => item.at),
    carriedLines: new Map([...model.carriedLines].filter(([line]) => startsIn(zone, line))),
  });
}

/**
 * Ordinary HTML comments, such as an author's `<!-- TODO -->`, which are content: each from its
 * `<!--` to its own `-->`. The Markdown parser's comment block runs on to the end of the line
 * with the `-->`, and that line may hold more text and comments. To the parser, markers and the
 * ledger are comments too. A `<!--` that is never closed stays text.
 */
function ordinaryComments(spans: readonly Span[], markers: Span[], ledger: Span | null): Span[] {
  const taken = (ledger ? [...markers, ledger] : markers).toSorted((a, b) => a.from - b.from);
  const comments: Span[] = [];
  let next = 0;
  for (const span of spans) {
    while (next < taken.length && taken[next]!.to <= span.from) next++;
    const overlap = taken[next];
    if (!overlap || overlap.from >= span.to) comments.push(span);
  }
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
function linesBlock(
  doc: Text,
  first: number,
  last: number,
  side: 'after' | 'before' | 'either',
  drawn: (line: Line) => boolean = () => false,
) {
  const blank = (n: number) =>
    n >= 1 && n <= doc.lines && BLANK.test(doc.line(n).text) && !drawn(doc.line(n));
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
 * line, and deleted text on it is drawn at the start of the block below, if there is one. An
 * inserted line break's marker on such a line, as the second of Enter three times in a paragraph
 * leaves it, has its pilcrow drawn at the end of the text above instead, where the break shows,
 * beside the pilcrow of a break there ("¶¶"): at the start of the block below, it would stand on
 * the first letter. A marker after a list item's bullet is hidden together with the line break
 * after it, which brings the item's text up to its bullet. In Clean, a line that holds only
 * ordinary comments hides too (see `linesBlock`); a comment is never an opener, so it joins no
 * lines.
 */
function hideMarkerLines(
  doc: Text,
  model: Model,
  bodyEnd: number,
  drawn: (line: Line) => boolean,
  kept: number | null = null,
): void {
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
    model.blocks.push(linesBlock(doc, line.number, last.number, 'either', drawn));
  }
  const joined = new Map<Hidden, Hidden | null>();
  /** Lines of markers alone that the join of a bullet's marker took along. */
  const absorbed = new Set<number>();
  /** What a line has besides the markers on it. */
  const markersOutside = (line: Line, markers: Hidden[]) => {
    let rest = '';
    let at = line.from;
    for (const marker of markers) {
      rest += doc.sliceString(at, marker.from);
      at = marker.to;
    }
    return rest + doc.sliceString(at, line.to);
  };
  for (const [n, markers] of byLine) {
    if (absorbed.has(n)) continue;
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
    // A `>` right against a marker is text, typed in front of it, not the marker of a quote: a
    // quote's own are followed by a space (format §3.2).
    if (!before.endsWith('>') && BLANK.test(before + between + after)) {
      // The caret is on it (an empty paragraph the caret just opened inside an insertion): it
      // shows as the empty line the caret is on, its markers hidden where they stand (#670).
      if (kept === line.from) continue;
      // Deleted text with no block below it, as when all the text is deleted, stays on its line.
      if (parts.some((part) => part.text) && !textBelow(n)) continue;
      const comments = markers.every((marker) => marker.comment);
      model.blocks.push(
        linesBlock(doc, n, n, opener ? 'after' : comments ? 'either' : 'before', drawn),
      );
      if (parts.length) moved.push({ line: n, parts });
    } else if (opener && CONTAINER_PREFIX.test(before) && /^[ \t]*$/.test(between + after)) {
      const all = [...markers];
      const carried = [...parts];
      let next = n + 1;
      for (;;) {
        while (next <= doc.lines && BLANK.test(doc.line(next).text)) next++;
        if (next > doc.lines) break;
        // Another marker alone on the next line, as a change typed at the start of the item's text
        // writes it (`- <!--fmt …-->`, `<!--ins …-->`, the text): the item's text comes up past it
        // too, or the line it is on would stand between the bullet and the text.
        const more = byLine.get(next);
        if (!more || more.some((marker) => marker.split)) break;
        const rest = markersOutside(doc.line(next), more);
        if (!BLANK.test(rest)) break;
        all.push(...more);
        carried.push(...more.flatMap((marker) => marker.parts));
        absorbed.add(next);
        model.carriedLines.set(doc.line(next).from, line.from);
        next++;
      }
      if (next > doc.lines) continue;
      const text = doc.line(next);
      const to = text.from + /^[ \t>]*/.exec(text.text)![0].length;
      for (const marker of all) joined.set(marker, null);
      joined.set(first, { from: first.from, to, opener: true, parts: carried });
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
  /** The nearest line above `pos`, where a hidden block starts, that shows text; null at the top. */
  const lineAbove = (pos: number) => {
    for (let n = doc.lineAt(pos).number - 1; n >= 1; n--) {
      const line = doc.line(n);
      if (!BLANK.test(line.text) && !spanAt(blocks, line.from)) return line;
    }
    return null;
  };
  const placed = new Map<string, Model['placed'][number]>();
  const place = (at: number, side: -1 | 1, parts: Part[]) => {
    const key = `${at} ${side}`;
    const same = placed.get(key);
    if (same) same.parts.push(...parts);
    else placed.set(key, { at, side, parts: [...parts] });
  };
  for (const { line, parts } of moved) {
    const block = spanAt(blocks, doc.line(line).from)!;
    const above = parts.some((part) => part.split) ? lineAbove(block.from) : null;
    if (above) {
      const breaks = parts.filter((part) => part.split);
      // Drawn with the pilcrow of a line break at the end of that line, so that they stand side by
      // side.
      const beside = model.hidden.findLast(
        (hidden) =>
          hidden.from >= above.from &&
          hidden.to <= above.to &&
          hidden.parts.some((part) => part.split),
      );
      if (beside) beside.parts = [...beside.parts, ...breaks];
      else place(above.to, 1, breaks);
    }
    const rest = above ? parts.filter((part) => !part.split) : parts;
    if (!rest.length) continue;
    const below = doc.lineAt(block.to).number + 1;
    let at = Math.max(0, block.from - 1);
    if (below <= doc.lines) {
      const text = doc.line(below);
      at = text.from + /^[ \t>]*/.exec(text.text)![0].length;
    }
    place(at, -1, rest);
  }
  model.placed = [...placed.values()];
}

/** The classes of a change bar for changes by these colors: one author's, or gray for several. */
function barClass(colors: Set<number>): string {
  if (!colors.size) return '';
  const [only] = colors;
  // An unknown author's bar is gray too.
  return colors.size === 1 && only ? `rl-bar ${colorClass(only)}` : 'rl-bar rl-bar-mixed';
}

/**
 * Where a change is, for the change bars: the text it is drawn on, from `from` to `to`, or a point
 * (`from` is `to`) where it stands: deleted text, which a view may hide, an inserted line break, a
 * box checked, a table's row. In its author's color.
 */
export interface ChangeSpan {
  from: number;
  to: number;
  color: number;
}

/** The changes of a model, in the order of the parts that hold them. */
function changeSpans(model: Model): ChangeSpan[] {
  const spans: ChangeSpan[] = [];
  for (const { from, to, color, change } of model.layers)
    if (change) spans.push({ from, to, color });
  for (const { from, parts } of model.hidden) {
    for (const part of parts) if (part.change) spans.push({ from, to: from, color: part.color });
  }
  for (const { at, parts } of model.placed) {
    for (const part of parts) if (part.change) spans.push({ from: at, to: at, color: part.color });
  }
  return spans;
}

/** The change bar classes of each line, by line number: which lines hold a change, and whose. */
function bars(
  doc: Text,
  spans: readonly ChangeSpan[],
  hidden: readonly { from: number; to: number }[] = [],
): Map<number, string> {
  const colors = new Map<number, Set<number>>();
  // A line that starts inside a hidden range that began on an earlier line is drawn as one with it
  // (a bullet and its text over hidden marker lines): the one line the view renders is the first,
  // which takes the class (#654).
  const multi = hidden.filter(({ from, to }) => doc.lineAt(from).number !== doc.lineAt(to).number);
  const firsts = new Map<number, number>();
  const first = (n: number): number => {
    const known = firsts.get(n);
    if (known !== undefined) return known;
    // A range that ends where the line starts has taken the break before it too.
    const start = doc.line(n).from;
    const range = multi.find((r) => r.from < start && start <= r.to);
    const found = range ? first(doc.lineAt(range.from).number) : n;
    firsts.set(n, found);
    return found;
  };
  for (const { from, to, color } of spans) {
    for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++) {
      const key = multi.length ? first(n) : n;
      const onLine = colors.get(key);
      if (onLine) onLine.add(color);
      else colors.set(key, new Set([color]));
    }
  }
  return new Map([...colors].map(([n, onLine]) => [n, barClass(onLine)]));
}

/** Deleted text, pins and pilcrows, drawn in place of hidden markers. */
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
          part.text === this.parts[i]?.text &&
          part.className === this.parts[i]?.className &&
          part.whole === this.parts[i]?.whole &&
          part.mark === this.parts[i]?.mark &&
          part.id === this.parts[i]?.id,
      )
    );
  }

  override toDOM(): HTMLElement {
    const spans: HTMLElement[] = [];
    for (const part of this.parts) {
      const span = document.createElement('span');
      span.className = part.className;
      span.textContent = part.text;
      if (part.split && part.id) span.dataset['rlChange'] = part.id;
      // Deleted text carries its change, which a card finds by it.
      if (part.mark && part.text) span.dataset['mark'] = part.mark;
      // The old text of a block replaced whole ends its own line: the new text starts below it.
      if (part.whole) span.append(document.createElement('br'));
      // The pilcrows of line breaks stand in a box, side by side when there are several ("¶¶").
      const last = spans.at(-1);
      if (!part.split) spans.push(span);
      else if (last?.className === 'rl-splits') last.append(span);
      else {
        const box = document.createElement('span');
        box.className = 'rl-splits';
        box.append(span);
        spans.push(box);
      }
    }
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

/** The blocks of one or more whole-block deletions drawn as blocks, struck where they were. */
class StruckWidget extends WidgetType {
  readonly deleted: readonly Struck[];
  /** Whether a list item stands right above, so that a struck item is the next of its list. */
  readonly afterItem: boolean;
  /** Whether it stands after the last line of the text, below the line it belongs to. */
  readonly after: boolean;

  constructor(deleted: readonly Struck[], afterItem: boolean, after = false) {
    super();
    this.deleted = deleted;
    this.afterItem = afterItem;
    this.after = after;
  }

  override eq(other: StruckWidget): boolean {
    return (
      other.afterItem === this.afterItem &&
      other.after === this.after &&
      other.deleted.length === this.deleted.length &&
      other.deleted.every(
        (item, i) =>
          item.id === this.deleted[i]!.id &&
          JSON.stringify(item.blocks) === JSON.stringify(this.deleted[i]!.blocks) &&
          [...item.colors].join() === [...this.deleted[i]!.colors].join(),
      )
    );
  }

  override get estimatedHeight(): number {
    return this.deleted.reduce(
      (sum, item) =>
        item.blocks.reduce(
          (height, block) => height + (block.table ? ghostTableHeight(block.table) : 28),
          sum,
        ),
      0,
    );
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'rl-struck-blocks';
    if (this.after) wrap.dataset['after'] = 'true';
    let item = this.afterItem;
    const indents: number[] = [];
    for (const deleted of this.deleted) {
      const bar = barClass(deleted.colors);
      for (const block of deleted.blocks) {
        // A table is its own element, laid out as a table (`table/ghost-table.ts`), and no item.
        if (block.table) {
          wrap.append(ghostTableDOM(block.table, deleted.id, bar));
          item = false;
          continue;
        }
        const { kind } = block;
        if (kind.kind !== 'item') indents.length = 0;
        const div = document.createElement('div');
        div.dataset['mark'] = deleted.id;
        const classes = ['rl-struck', bar];
        if (kind.kind === 'heading') classes.push(`rl-h${kind.level}`);
        else if (kind.kind === 'quote') classes.push('rl-quote');
        // Code: its lines apart, in the code font, as the preview draws it, with no fence.
        else if (kind.kind === 'code') {
          classes.push('rl-codeblock', 'rl-codeblock-first', 'rl-codeblock-last');
          div.style.whiteSpace = 'pre-wrap';
        } else if (kind.kind === 'item') classes.push('rl-hang', 'rl-li');
        classes.push(kind.kind === 'item' && item ? 'rl-space-item' : 'rl-space-block');
        item = kind.kind === 'item';
        div.className = classes.join(' ');
        if (kind.kind === 'item') {
          // The item's level, from the indents of the items before it in this run (the parse's
          // nesting isn't there): one deeper than the nearest item it is indented past.
          while (indents.length && indents[indents.length - 1]! >= kind.indent) indents.pop();
          indents.push(kind.indent);
          const level = indents.length + (indents.length === 1 && kind.indent > 0 ? 1 : 0);
          const depth = Math.min(level, BULLETS.length);
          const mark = document.createElement('span');
          mark.className = 'rl-list-mark';
          const drawn = /^[-*+]$/.test(kind.marker) ? BULLETS[depth - 1]! : kind.marker;
          // As the preview draws an item: a level is as deep for a bullet as for a number.
          const cols = Math.max(LEVEL_COLS, drawn.length + 1);
          const start = (level - 1) * LEVEL_COLS;
          mark.style.setProperty('--rl-cols', String(cols));
          mark.textContent = drawn;
          div.style.setProperty('--rl-hang', String(start + cols));
          if (kind.indent > 0) {
            const indent = document.createElement('span');
            indent.className = 'rl-indent';
            indent.textContent = ' '.repeat(kind.indent);
            if (kind.indent !== start) indent.style.fontSize = `${start / kind.indent}em`;
            div.append(indent);
          }
          div.append(mark);
        }
        // A block with no text, an empty pair of fences, still stands a line high.
        if (block.runs.every((run) => run.text === '' || run.text === '¶')) {
          div.append(document.createTextNode('\u200b'));
        }
        for (const run of block.runs) {
          const span = document.createElement('span');
          span.className = `rl-del ${colorClass(run.color)}`;
          span.textContent = run.text;
          div.append(span);
        }
        wrap.append(div);
      }
    }
    return wrap;
  }

  /** A click on a struck block puts the caret beside it: it is atomic. */
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
  /** What `trackedText` reads: the hidden text and the layers; the rest of the model is not kept. */
  model: Model;
  /** The changes, where the bars are drawn (`bar-layer.ts`). */
  spans: ChangeSpan[];
  /** The blank line the caret is on, which is drawn (`keptLine`). */
  kept: number | null;
  decorations: DecorationSet;
  /** What the caret steps over: hidden text, and hidden lines with the line breaks around them. */
  atomic: RangeSet<Atom>;
  /** The runs of hidden lines, by where each starts. */
  runs: RangeSet<HiddenRun>;
  /** How many lines they hold. */
  lines: number;
}

/** The ranges the caret steps over: hidden text, and hidden lines with their line breaks. */
function atomRanges(doc: Text, model: Model, extra: readonly Span[] = []): Range<Atom>[] {
  // Whether the caret looks different at either end: across deleted text, or onto another line.
  const spans = [
    ...model.hidden.map(({ from, to, parts }) => ({
      from,
      to,
      visible: parts.some((part) => part.text),
    })),
    ...extra.map(({ from, to }) => ({ from, to, visible: false })),
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
  return merged.map(({ from, to, visible }) => (visible ? SHOWN : BLANK_ATOM).range(from, to));
}

/** What a model draws: its decorations, where the bars are, what the caret steps over. */
interface Drawing {
  ranges: Range<Decoration>[];
  spans: ChangeSpan[];
  atoms: Range<Atom>[];
  runs: Range<HiddenRun>[];
}

function draw(
  doc: Text,
  model: Model,
  zone?: Zone,
  containers?: (spans: ChangeSpan[]) => ContainerDrawing,
): Drawing {
  const ranges: Range<Decoration>[] = [];
  for (const { from, to, parts } of model.hidden) {
    const shown = drawn(parts);
    const widget = shown.length ? new MarkupWidget(shown) : null;
    ranges.push((widget ? Decoration.replace({ widget }) : HIDDEN).range(from, to));
  }
  // Whole blocks deleted, drawn as blocks: in the place of the hidden lines of their markers, above
  // the line of the next item of a list, or below the line above the end of the text.
  const slots = new Map<string, { at: number; to: number; side: -1 | 1 | 0; items: Struck[] }>();
  for (const item of model.struck) {
    const span = item.where === 'lines' ? spanAt(model.blocks, item.at) : undefined;
    const slot = span
      ? { at: span.from, to: span.to, side: 0 as const }
      : item.where === 'after'
        ? { at: item.at, to: item.at, side: 1 as const }
        : (() => {
            // A line the join of a bullet took along has no place of its own: its struck blocks
            // are drawn at the bullet's line, above the join.
            const at = doc.lineAt(item.at).from;
            const place = model.carriedLines.get(at) ?? at;
            return { at: place, to: place, side: -1 as const };
          })();
    const key = `${slot.at} ${slot.side}`;
    const same = slots.get(key);
    if (same) same.items.push(item);
    else slots.set(key, { ...slot, items: [item] });
  }
  const itemAbove = (slot: { at: number; side: -1 | 1 | 0 }) => {
    // The line the blocks follow: the nearest above them that shows text.
    let n = doc.lineAt(slot.at).number - (slot.side === 1 ? 0 : 1);
    while (n >= 1 && BLANK.test(doc.line(n).text)) n--;
    return n >= 1 && ITEM_LINE.test(doc.line(n).text);
  };
  for (const { from, to } of model.blocks) {
    const slot = slots.get(`${from} 0`);
    if (!slot) ranges.push(HIDDEN_LINES.range(from, to));
    else {
      const widget = new StruckWidget(slot.items, itemAbove(slot));
      ranges.push(Decoration.replace({ block: true, widget }).range(from, to));
      slots.delete(`${from} 0`);
    }
  }
  for (const slot of slots.values()) {
    const widget = new StruckWidget(slot.items, itemAbove(slot), slot.side === 1);
    ranges.push(Decoration.widget({ block: true, widget, side: slot.side || -1 }).range(slot.at));
  }
  for (const { at, side, parts } of model.placed) {
    const shown = drawn(parts);
    if (!shown.length) continue;
    ranges.push(Decoration.widget({ widget: new MarkupWidget(shown), side }).range(at));
  }
  for (const { from, to, className, mark } of model.layers) {
    // A layer with no class, a change in Simple, only takes a bar.
    if (!className) continue;
    const attributes = mark === undefined ? undefined : { 'data-mark': mark };
    ranges.push(Decoration.mark({ class: className, attributes }).range(from, to));
  }
  for (const { from, to } of model.comments) ranges.push(COMMENT.range(from, to));
  for (const { at, className } of model.rows) {
    ranges.push(Decoration.line({ class: className }).range(doc.lineAt(at).from));
  }
  const spans = changeSpans(model).sort((a, b) => a.from - b.from);
  const containerDrawn = containers?.(spans);
  if (containerDrawn) ranges.push(...containerDrawn.ranges);
  for (const [n, className] of bars(doc, spans, model.hidden)) {
    const line = doc.line(n);
    const block = spanAt(model.blocks, line.from);
    if (block && line.to <= block.to) continue;
    ranges.push(Decoration.line({ class: className }).range(line.from));
  }
  const runs = model.blocks.map(({ from, to }) =>
    new HiddenRun(doc.lineAt(to).number - doc.lineAt(from).number + 1).range(from, to),
  );
  const atoms = atomRanges(doc, model, containerDrawn?.atoms);
  if (!zone) return { ranges, spans, atoms, runs };
  return {
    ranges: ranges.filter((range) => startsIn(zone, range.from)),
    spans,
    atoms: atoms.filter((range) => startsIn(zone, range.from)),
    runs,
  };
}

/** What the display keeps of a model. */
function keptOf(model: Model): Model {
  return {
    hidden: model.hidden,
    blocks: [],
    placed: [],
    layers: model.layers,
    rows: [],
    comments: [],
    struck: [],
    carriedLines: new Map(),
  };
}

function display(state: EditorState): Display {
  const kept = keptLine(state);
  const model = analyze(state, kept);
  const drawing = draw(
    state.doc,
    model,
    undefined,
    state.field(viewModeField) === 'raw' ? undefined : (spans) => containerDrawing(state, spans),
  );
  return {
    model: keptOf(model),
    spans: drawing.spans,
    kept,
    decorations: Decoration.set(drawing.ranges, true),
    atomic: RangeSet.of(drawing.atoms),
    runs: RangeSet.of(drawing.runs),
    lines: drawing.runs.reduce((sum, run) => sum + run.value.lines, 0),
  };
}

/**
 * Where the changes are, for the change bars: the one list, which the layer that draws them and the
 * click on a bar both go by. It is the same array until the display is drawn again.
 */
export function trackedChangeSpans(state: EditorState): readonly ChangeSpan[] {
  return state.field(trackedField).spans;
}

/** The tracked layer's decorations for a state. Exported for tests; the editor caches them. */
export function trackedDecorations(state: EditorState): DecorationSet {
  return display(state).decorations;
}

/** How many times the display was drawn in windows and how many whole, for tests. */
export const trackedStats = { windowed: 0, whole: 0 };

/** More windows than this, or windows this much of the text, and the display is drawn whole. */
const MAX_ZONES = 16;
const MAX_PLACES = 32;
const MAX_SHARE = 0.5;

/**
 * Where the ledger changed what a mark is drawn as: marks whose author or move differ, and the
 * comments whose thread was resolved or reopened (`tinted`), by where they are in the new text.
 */
function ledgerRegions(before: Parsed, parsed: Parsed, map: (pos: number) => number) {
  const regions: [number, number][] = [];
  const entries = new Map(before.marks.map((mark) => [mark.id, mark]));
  const resolved = (of: Parsed) =>
    new Set(of.ledger.comments.filter((thread) => thread.resolved).map((thread) => thread.id));
  const was = resolved(before);
  const now = resolved(parsed);
  const unlike = (mark: MarkRange, other: MarkRange | undefined) =>
    !other ||
    other.kind !== mark.kind ||
    other.entry.by !== mark.entry.by ||
    other.entry.move !== mark.entry.move ||
    (mark.kind === 'cmt' && was.has(mark.id) !== now.has(mark.id));
  const seen = new Set<string>();
  for (const mark of parsed.marks) {
    seen.add(mark.id);
    const was = entries.get(mark.id);
    const [from, to] = [mark.segments[0]!.open.from, markEnd(mark)];
    if (unlike(mark, was)) regions.push([from, to]);
    else if (was) {
      // Not where the edit leaves it: the pairing of its markers changed.
      const [a, b] = [map(was.segments[0]!.open.from), map(markEnd(was))];
      if (a !== from || b !== to) {
        regions.push([from, to], [Math.min(a, b), Math.max(a, b)]);
      }
    }
  }
  for (const mark of before.marks) {
    if (seen.has(mark.id)) continue;
    const [a, b] = [map(mark.segments[0]!.open.from), map(markEnd(mark))];
    regions.push([Math.min(a, b), Math.max(a, b)]);
  }
  return regions;
}

/** The map `items` have after the changes, and those before `from` as they were. */
function mapped<T>(
  items: readonly T[],
  changes: ChangeSet | null,
  move: (item: T, map: (pos: number) => number) => T,
): readonly T[] {
  if (!changes) return items;
  const map = (pos: number) => changes.mapPos(pos, 1);
  return items.map((item) => move(item, map));
}

/**
 * The items with the windows' replaced by the new ones. Both are in the order they start in, and
 * the windows are in order and apart.
 */
function spliced<T>(
  items: readonly T[],
  start: (item: T) => number,
  zones: readonly Zone[],
  fresh: readonly (readonly T[])[],
): T[] {
  const result: T[] = [];
  let at = 0;
  const firstFrom = (from: number, low: number) => {
    let high = items.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (start(items[middle]!) < from) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  zones.forEach((zone, i) => {
    const from = firstFrom(zone.from, at);
    for (let k = at; k < from; k++) result.push(items[k]!);
    at = firstFrom(zone.to, from);
    for (const item of fresh[i]!) result.push(item);
  });
  for (let k = at; k < items.length; k++) result.push(items[k]!);
  return result;
}

/**
 * The display after a transaction, drawn again only in the windows that it can have changed (#744):
 * where the text was edited, the marks the edit touched, what the parse added, the lines the caret
 * left and came to. Everything else is kept and mapped. Null where the whole is drawn again.
 */
function advance(value: Display, tr: Transaction): Display | null {
  const { state, startState } = tr;
  const mode = state.field(viewModeField);
  if (
    mode === 'raw' ||
    mode !== startState.field(viewModeField) ||
    startState.facet(peopleFacet) !== state.facet(peopleFacet) ||
    startState.facet(authorFacet) !== state.facet(authorFacet) ||
    startState.facet(lineBreakMarksFacet) !== state.facet(lineBreakMarksFacet)
  ) {
    return null;
  }
  // Containers draw whole: their folds and brackets reach across the text.
  if (containersOf(state).length || containersOf(startState).length) return null;
  const { doc } = state;
  const parsed = state.field(parsedField);
  const before = startState.field(parsedField);
  const tree = syntaxTree(state);
  const oldTree = syntaxTree(startState);
  const changes = tr.docChanged ? tr.changes : null;
  const regions: [number, number][] = [];
  if (changes) {
    // An edit in very many places (a deletion that marks each of many marks inside it) is drawn whole.
    let places = 0;
    changes.iterChangedRanges(() => places++);
    if (places > MAX_PLACES) return null;
    // What a ledger says of the marks far from the edit: an author, a move, a resolved thread.
    // The marks themselves, too: the scan is textual, so an unclosed `<!--` can swallow a marker far
    // below it, and a mark that stood far from the edit goes, or changes its place.
    regions.push(...ledgerRegions(before, parsed, (pos) => changes.mapPos(pos, 1)));
    const colors = colorsOf(state);
    const old = colorsOf(startState);
    if (
      colors.size !== old.size ||
      [...colors].some(([handle, color]) => old.get(handle) !== color)
    ) {
      return null;
    }
    changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      regions.push([fromB - 1, Math.max(resync(changes, oldTree, tree, toB), toB) + 1]);
      for (const mark of marksOverlapping(before, fromA - 1, toA + 1)) {
        const [a, b] = [
          changes.mapPos(mark.segments[0]!.open.from, 1),
          changes.mapPos(markEnd(mark), -1),
        ];
        regions.push([Math.min(a, b), Math.max(a, b)]);
      }
      for (const mark of marksOverlapping(parsed, fromB - 1, toB + 1)) {
        regions.push([mark.segments[0]!.open.from, markEnd(mark)]);
      }
    });
    if (regions.length > 200) return null;
    const was = before.ledgerRange;
    const now = parsed.ledgerRange;
    if (
      (was === null) !== (now === null) ||
      (was &&
        now &&
        (changes.mapPos(was.from, 1) !== now.from || changes.mapPos(was.to, -1) !== now.to))
    ) {
      const from = Math.min(
        now?.from ?? doc.length,
        was ? changes.mapPos(was.from, 1) : doc.length,
      );
      regions.push([from - 2, doc.length]);
    }
  }
  // What the parse added, and the stretch below it that is read as it stands (`blankLines`).
  const reach = changes ? changes.mapPos(oldTree.length, -1) : oldTree.length;
  if (tree.length !== reach) {
    const lo = Math.min(tree.length, reach);
    const block = tree.topNode.childBefore(lo);
    regions.push([
      block?.prevSibling?.from ?? block?.from ?? 0,
      Math.max(tree.length, reach) + TAIL_LENGTH,
    ]);
  }
  // The lines the caret left and came to, and the empty paragraph that opened and closed.
  const kept = keptLine(state);
  const line = (pos: number) => {
    const at = doc.lineAt(Math.min(Math.max(pos, 0), doc.length));
    regions.push([at.from - 1, at.to + 1]);
  };
  if (kept !== value.kept) {
    if (kept !== null) line(kept);
    if (value.kept !== null) line(changes ? changes.mapPos(value.kept, -1) : value.kept);
  }
  const open = openBlock(state);
  const wasOpen = openBlock(startState);
  if (open !== wasOpen) {
    for (const [block, map] of [
      [open, false],
      [wasOpen, true],
    ] as const) {
      if (!block) continue;
      const [a, b] = [block.empty.from, block.empty.to];
      regions.push(map && changes ? [changes.mapPos(a, 1), changes.mapPos(b, -1)] : [a, b]);
      if (block.pressedIn) regions.push([block.pressedIn.from, block.pressedIn.to]);
    }
  }
  if (!regions.length) return value;
  regions.sort((x, y) => x[0] - y[0]);
  const zones: Zone[] = [];
  let share = 0;
  for (const [a, b] of regions) {
    const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
    const from = windowStart(state, parsed, Math.max(0, Math.min(lo, doc.length)));
    const to = windowEnd(state, parsed, Math.max(0, Math.min(hi, doc.length)));
    const previous = zones.at(-1);
    if (previous && from <= previous.to) {
      previous.from = Math.min(previous.from, from);
      previous.to = Math.max(previous.to, to);
    } else zones.push({ from, to });
  }
  if (zones.length > MAX_ZONES) return null;
  for (const zone of zones) share += Math.min(zone.to, doc.length) - zone.from;
  if (share > Math.max(20_000, doc.length * MAX_SHARE)) return null;
  let decorations = changes ? value.decorations.map(changes) : value.decorations;
  let atomic = changes ? value.atomic.map(changes) : value.atomic;
  let runs = changes ? value.runs.map(changes) : value.runs;
  let lines = value.lines;
  const hidden: Hidden[][] = [];
  const layers: Layer[][] = [];
  const spans: ChangeSpan[][] = [];
  for (const zone of zones) {
    const model = analyze(state, kept, zone);
    const drawing = draw(doc, model, zone);
    // The runs it held, as they were before the changes (a run deleted whole is gone from the
    // mapped set).
    const back = changes?.invertedDesc;
    const old = {
      from: back ? back.mapPos(zone.from, -1) : zone.from,
      to: !back
        ? zone.to
        : zone.to > doc.length
          ? startState.doc.length + 1
          : back.mapPos(zone.to, 1),
    };
    value.runs.between(old.from, old.to, (from, _to, run) => {
      if (startsIn(old, from)) lines -= run.lines;
    });
    for (const run of drawing.runs) lines += run.value.lines;
    const filter = (from: number) => !startsIn(zone, from);
    const bounds = { filter, filterFrom: zone.from, filterTo: zone.to };
    decorations = decorations.update({ ...bounds, add: drawing.ranges, sort: true });
    atomic = atomic.update({ ...bounds, add: drawing.atoms, sort: true });
    runs = runs.update({ ...bounds, add: drawing.runs, sort: true });
    hidden.push(model.hidden);
    layers.push(model.layers);
    spans.push(drawing.spans);
  }
  const model = value.model;
  return {
    model: {
      ...model,
      hidden: spliced(
        mapped(model.hidden, changes, (item, map) => ({
          ...item,
          from: map(item.from),
          to: map(item.to),
        })),
        (item) => item.from,
        zones,
        hidden,
      ),
      layers: spliced(
        mapped(model.layers, changes, (item, map) => ({
          ...item,
          from: map(item.from),
          to: map(item.to),
        })),
        (item) => item.from,
        zones,
        layers,
      ),
    },
    spans: spliced(
      mapped(value.spans, changes, (item, map) => ({
        ...item,
        from: map(item.from),
        to: map(item.to),
      })),
      (item) => item.from,
      zones,
      spans,
    ),
    kept,
    decorations,
    atomic,
    runs,
    lines,
  };
}

/**
 * The containers' drawing, with the changes that a closed section holds put on its summary line:
 * a bar there (a span for each change, added to `spans`), and a count after the summary.
 */
function containerDrawing(state: EditorState, spans: ChangeSpan[]) {
  const parsed = state.field(parsedField);
  const colors = colorsOf(state);
  const drawing = drawContainers(state, (from, to) => {
    let count = 0;
    for (const mark of parsed.marks) {
      if (!isDrawnChange(mark)) continue;
      const at = mark.segments[0]?.open.from ?? -1;
      if (at >= from && at <= to) count++;
    }
    return count;
  });
  for (const container of containersOf(state)) {
    if (isOpen(state, container)) continue;
    const row = headLine(state, container).from;
    for (const mark of parsed.marks) {
      if (!isDrawnChange(mark)) continue;
      const at = mark.segments[0]?.open.from ?? -1;
      if (at >= container.bodyFrom && at <= container.end) {
        spans.push({ from: row, to: row, color: colors.get(mark.entry.by) ?? 0 });
      }
    }
  }
  return drawing;
}

const trackedField = StateField.define<Display>({
  create: display,
  update(value, tr) {
    const changed =
      tr.docChanged ||
      tr.startState.facet(peopleFacet) !== tr.state.facet(peopleFacet) ||
      // Your color is the first: a change of author recolors the text, as it does the rail.
      tr.startState.facet(authorFacet) !== tr.state.facet(authorFacet) ||
      tr.startState.facet(lineBreakMarksFacet) !== tr.state.facet(lineBreakMarksFacet) ||
      tr.startState.field(viewModeField) !== tr.state.field(viewModeField) ||
      tr.startState.field(foldField, false) !== tr.state.field(foldField, false) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      // The caret onto a blank line, or off it, which is hidden again.
      (tr.selection !== undefined && keptLine(tr.state) !== value.kept) ||
      openBlock(tr.state) !== openBlock(tr.startState);
    if (!changed) return value;
    const kept = advance(value, tr);
    if (kept) trackedStats.windowed++;
    else trackedStats.whole++;
    return kept ?? display(tr.state);
  },
  // From a state field rather than a view plugin, because hidden lines and the ledger replace
  // line breaks.
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
});

/** A run of whole lines hidden from view: blank lines, lines of markers alone, the ledger. */
export class HiddenRun extends RangeValue {
  /** How many lines it holds. */
  readonly lines: number;

  constructor(lines: number) {
    super();
    this.lines = lines;
  }

  override eq(other: RangeValue): boolean {
    return other instanceof HiddenRun && other.lines === this.lines;
  }
}

/**
 * The lines Clean and Redlines hide, each run from the start of its first line to the end of its
 * last (the caret steps over it with the line breaks around it); none in Plain.
 */
export function hiddenLines(state: EditorState): RangeSet<HiddenRun> {
  const shown = state.field(trackedField, false);
  if (shown) return shown.runs;
  const { doc } = state;
  const model = analyze(state, keptLine(state));
  return RangeSet.of(
    model.blocks.map(({ from, to }) =>
      new HiddenRun(doc.lineAt(to).number - doc.lineAt(from).number + 1).range(from, to),
    ),
  );
}

/** A stretch of text as the tracked layer draws it. */
export interface TrackedPiece {
  /** Where the text is in the document. Deleted text isn't: it is drawn at this position. */
  from: number;
  text: string;
  deleted: boolean;
  /** The classes of the marks around the text, outermost first. */
  layers: string[];
}
/**
 * A selection whose ends aren't hidden: moved out of hidden text and hidden lines, a caret off the
 * start of a document whose first lines are hidden or off the end of one whose last lines are, and
 * nothing past the body's end, onto the line after the hidden ledger. A caret in hidden text goes
 * to the nearer end; in hidden lines, with `forward`, to the one after them, as after typing, which
 * only moves on.
 */
export function visibleSelection(
  state: EditorState,
  selection: EditorSelection = state.selection,
  forward = false,
): EditorSelection {
  const { atomic: atoms, runs } = state.field(trackedField);
  if (!atoms.size) return selection;
  const end = bodyEnd(state.field(parsedField)) ?? state.doc.length;
  const length = state.doc.length;
  // Whether the document's last line is hidden, with nothing after it to rest on.
  let lastHidden = false;
  runs.between(length, length, () => {
    lastHidden = true;
    return false;
  });
  const open = openBlock(state);
  const inHiddenLines = (pos: number) => {
    let inside = false;
    runs.between(pos, pos, (from, to) => {
      if (from <= pos && pos <= to) inside = true;
    });
    return inside;
  };
  const outside = (pos: number, side: -1 | 0 | 1) => {
    // The empty paragraph that is open is a place for the caret, wherever it is.
    if (open && pos >= open.empty.from && pos <= open.empty.to) return Math.min(pos, end);
    let moved = pos;
    atoms.between(pos, pos, (from, to) => {
      if (side === 0 && pos === 0 && from === 0) moved = to;
      else if (side === 0 && pos === length && lastHidden && to === length) moved = from;
      else if (from < pos && pos < to) {
        const onward = forward && inHiddenLines(pos);
        moved = side < 0 || (side === 0 && !onward && pos - from <= to - pos) ? from : to;
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

/** What the caret steps over in a state: hidden text and hidden lines, none in Plain. */
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
 * Leaving Plain, a new version of the file from outside, or an edit the tracked layer dealt with
 * (tracked or plain) or a decision can leave the caret in text that is hidden now: inside markers
 * that an edit brought together, on a blank line under a new own-line marker, or past the hidden
 * ledger. It moves out.
 */
const caretOutOfHiding = EditorState.transactionFilter.of((tr) => {
  const switched = tr.effects.some((effect) => effect.is(setViewModeEffect));
  const moved = tr.annotation(Transaction.remote) || tr.annotation(trackedEditAnnotation);
  if (!switched && !moved) return tr;
  // Text typed or pasted that is hidden where it stands, as a space on a line of markers alone is
  // (#811), leaves the caret after the hidden lines, not back where the edit began.
  const typed = tr.docChanged && tr.isUserEvent('input');
  const selection = visibleSelection(tr.state, tr.state.selection, typed);
  return selection === tr.state.selection ? tr : [tr, { selection, sequential: true }];
});

/**
 * How many lines Clean and Redlines hide, on the content element as `data-rl-hidden-lines`, so
 * that the page can be asked (a check in WebKit by hand, as no runner draws it here).
 */
const hiddenCount = EditorView.contentAttributes.compute([trackedField], (state) => {
  return { 'data-rl-hidden-lines': String(state.field(trackedField).lines) };
});

/** The view's class on the editor: `rl-view-clean`, `-simple`, `-redlines` or `-raw`. */
const viewClass = EditorView.editorAttributes.compute([viewModeField], (state) => ({
  class: `rl-view-${state.field(viewModeField)}`,
}));

/** Markdown's syntax in Plain, drawn in grays: color means a person. */
const rawHighlighter = tagHighlighter([
  { tag: tags.heading, class: 'rl-tok-heading' },
  { tag: tags.strong, class: 'rl-tok-strong' },
  { tag: tags.emphasis, class: 'rl-tok-emphasis' },
  { tag: tags.strikethrough, class: 'rl-tok-strike' },
  { tag: tags.processingInstruction, class: 'rl-tok-mark' },
  { tag: [tags.link, tags.url], class: 'rl-tok-link' },
  { tag: tags.comment, class: 'rl-tok-comment' },
]);

/** The highlighting of the visible text, in Plain only: the other views draw the document. */
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

export const trackedThemeSpec: Parameters<typeof EditorView.baseTheme>[0] = {
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
  // Inserted text in Simple: the author's color alone, with no underline.
  '.rl-ins-plain': { color: 'var(--rl-color)' },
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
  // An inserted line break, while line break marks are shown: a small pilcrow on the baseline at the
  // end of the line before it, in the author's color, in a box that takes no room in the line, with
  // the pilcrows of the breaks beside it ("¶¶"). The box would take the negative text indent of a
  // list item's hanging line, and draw them that far left of the break: over the word before it,
  // or over the bullet.
  '.rl-splits': {
    display: 'inline-block',
    width: '0',
    position: 'relative',
    left: '1px',
    textIndent: '0',
    whiteSpace: 'nowrap',
  },
  '.rl-split::before': { content: '"¶"', fontSize: '0.8em', color: 'var(--rl-color)' },
  // A change bar: 2px, 24px left of the column. The bars of the text are drawn in a layer, beside
  // the screen lines that hold a change (bar-layer.ts), and the line says only that it holds one
  // (`rl-bar`). A struck block draws its own bar, as tall as the block.
  '.rl-bar': { position: 'relative' },
  '.rl-bar:not(.cm-line)::before': {
    content: '""',
    position: 'absolute',
    top: '0',
    bottom: '0',
    left: '-24px',
    width: '2px',
    backgroundColor: 'var(--rl-color)',
  },
  '.rl-bar-mixed::before': { backgroundColor: 'var(--rl-mixed)' },
  // Under the pointer, in Simple and Redlines, a bar is wider (3 px instead of 2): a click on it
  // switches the looks (bar-switch.ts). The pointer is a hand over its target.
  '.rl-bar.rl-bar-hot::before': { width: '3px' },
  // A quote's own border would move its bar right.
  '.rl-quote.rl-bar::before': { left: '-26px' },
  // A table row's bar is drawn by its first cell: nothing but a cell may be a child of a row.
  '.rl-trow.rl-bar::before': { display: 'none' },
  '.rl-trow.rl-bar > .rl-tc:first-child': { position: 'relative' },
  '.rl-trow.rl-bar > .rl-tc:first-child::before': {
    content: '""',
    position: 'absolute',
    top: '0',
    bottom: '0',
    left: '-24px',
    width: '2px',
    backgroundColor: 'var(--rl-color)',
  },
  '.rl-trow.rl-bar-mixed > .rl-tc:first-child::before': { backgroundColor: 'var(--rl-mixed)' },
  // The hovered bar of a row is the row's class; the first cell draws the bar.
  '.rl-trow.rl-bar.rl-bar-hot > .rl-tc:first-child::before': { width: '3px' },
  // An inserted table row: the author's tint behind its cells, and the text underlined and in the
  // author's color as inserted text is.
  '.rl-trow.rl-ins-row > .rl-tc': {
    backgroundColor: 'var(--rl-color-tint)',
    color: 'var(--rl-color)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--rl-color)',
    textDecorationThickness: '1.5px',
    textUnderlineOffset: '3px',
    textDecorationSkipInk: 'none',
  },
  // An inserted table row in Simple: the text in the author's color, with no tint and no underline.
  '.rl-trow.rl-ins-row-plain > .rl-tc': { color: 'var(--rl-color)' },
  // The new place of a moved row: a double underline.
  '.rl-trow.rl-moved-row > .rl-tc': { textDecorationStyle: 'double' },
  // An inserted table column: the author's tint behind its cells, the text underlined and in the
  // author's color, as an inserted row's.
  '.rl-tc.rl-ins-col': {
    backgroundColor: 'var(--rl-color-tint)',
    color: 'var(--rl-color)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--rl-color)',
    textDecorationThickness: '1.5px',
    textUnderlineOffset: '3px',
    textDecorationSkipInk: 'none',
  },
  // An inserted table column in Simple: the text in the author's color alone.
  '.rl-tc.rl-ins-col-plain': { color: 'var(--rl-color)' },
  // The new place of a moved column: a double underline.
  '.rl-tc.rl-ins-col.rl-moved-col': { textDecorationStyle: 'double' },
  // A deleted row, a ghost at its place (`table/ghosts.ts`): struck text in the author's color on
  // the author's tint; a moved row's old place has a double strikethrough. Not editable.
  '.rl-trow.rl-ghost': { display: 'table-row', cursor: 'default', userSelect: 'none' },
  '.rl-trow.rl-ghost > .rl-tc': { backgroundColor: 'var(--rl-color-tint)' },
  '.rl-trow.rl-ghost-moved .rl-del': { textDecorationStyle: 'double' },
  // A deleted column, a ghost cell in each row (`table/colghosts.ts`): the same, a cell among cells.
  '.rl-tc.rl-ghost-col': {
    backgroundColor: 'var(--rl-color-tint)',
    cursor: 'default',
    userSelect: 'none',
  },
  '.rl-tc.rl-ghost-col.rl-ghost-moved .rl-del': { textDecorationStyle: 'double' },
  // Ordinary HTML comments in Redlines: small dimmed notes.
  '.rl-comment': { color: 'var(--rl-ink-2)', fontSize: '0.85em' },

  // Plain: the source in the code font, a little wider and more open than the document's column,
  // markers and the ledger in the second ink.
  '&.rl-view-raw .cm-scroller': { fontFamily: 'var(--rl-font-mono)' },
  '&.rl-view-raw .cm-content': {
    maxWidth: 'calc(760px * var(--rl-text-scale, 1) + 2 * var(--rl-margin, 24px))',
    paddingTop: textPx(40),
    fontSize: 'calc(13.5px * var(--rl-text-scale, 1))',
    lineHeight: '1.75',
  },
  '&.rl-view-raw .rl-tok-heading, &.rl-view-raw .rl-tok-strong': { fontWeight: '700' },
  '&.rl-view-raw .rl-tok-emphasis': { fontStyle: 'italic' },
  '&.rl-view-raw .rl-tok-strike': { textDecoration: 'line-through' },
  '&.rl-view-raw .rl-tok-mark': { color: 'var(--rl-ink-2)' },
  '&.rl-view-raw .rl-tok-link': { color: 'var(--rl-ink-2)' },
  '&.rl-view-raw .rl-tok-comment': { color: 'var(--rl-ink-2)' },
};

const theme = EditorView.baseTheme(trackedThemeSpec);

/** Tracked changes, comments and the three views. Needs the Markdown language. */
export function trackedChanges(): Extension {
  return [
    parsedField,
    viewModeField,
    trackedField,
    caretOutOfHiding,
    hiddenCount,
    viewClass,
    rawHighlighting,
    colorTheme,
    theme,
    foldField,
    containerBracket,
    containerKeys,
  ];
}

/** What a display holds, as text, for tests: the display kept by the field, and one drawn whole. */
function describeDisplay(display: Display): string[] {
  const lines: string[] = [];
  const replacer = (_key: string, value: unknown) =>
    value instanceof Set ? [...value] : value instanceof Map ? [...value] : value;
  for (const cursor = display.decorations.iter(); cursor.value; cursor.next()) {
    const { value } = cursor;
    const spec = value.spec as { class?: string; attributes?: object; widget?: WidgetType };
    const widget = spec.widget;
    const made =
      widget instanceof MarkupWidget
        ? JSON.stringify(widget.parts)
        : widget instanceof StruckWidget
          ? JSON.stringify([widget.deleted, widget.afterItem, widget.after], replacer)
          : '';
    lines.push(
      `deco ${cursor.from} ${cursor.to} ${value.startSide} ${value.endSide} ${spec.class ?? ''} ${JSON.stringify(spec.attributes ?? null)} ${made}`,
    );
  }
  for (const cursor = display.atomic.iter(); cursor.value; cursor.next()) {
    lines.push(`atom ${cursor.from} ${cursor.to} ${cursor.value.visible}`);
  }
  for (const cursor = display.runs.iter(); cursor.value; cursor.next()) {
    lines.push(`run ${cursor.from} ${cursor.to} ${cursor.value.lines}`);
  }
  for (const span of display.spans) lines.push(`span ${JSON.stringify(span)}`);
  for (const item of display.model.hidden) lines.push(`hidden ${JSON.stringify(item)}`);
  for (const item of display.model.layers) lines.push(`layer ${JSON.stringify(item)}`);
  lines.push(`lines ${display.lines} kept ${display.kept}`);
  return lines;
}

/** For tests: the display the field keeps. */
export const keptDisplay = (state: EditorState): string[] =>
  describeDisplay(state.field(trackedField));

/** For tests: the display that drawing the whole text again gives. */
export const freshDisplay = (state: EditorState): string[] => describeDisplay(display(state));
