// The rail (design §5.7): notes in the page's right margin, one for each comment thread and one for
// each change that has its author's note, such as an agent's reason. A note is level with its
// anchor; where notes crowd, one is (the selected note, else the one of the first anchor in view)
// and the others stack around it, so that the note at the top of the screen is the one the text
// there is about (#328). At rest a note shows who wrote what; the times and the actions appear on
// hover, or while the note is selected: clicked, or with the cursor in its anchor. A selected
// note's border takes its author's color, and its anchor's tint doubles. The rail shows in Simple
// and Redlines, where it moves the text column left, so that column and rail stay centered
// together. In a narrow editor the rail shrinks to a dot in the author's color level with each
// anchor, and the column takes its whole width back; hovering or clicking a dot shows its note over
// the page. A new comment is written in a note of its own, level with what it is on, and is
// private until it is posted: nothing of it is in the file before then.

import {
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  colorsOf,
  commentRangeOfRect,
  markupViewFacet,
  parsedField,
  pastHidden,
  refusedEditEffect,
  setViewModeEffect,
  viewModeField,
} from '@redlines/editor';
import {
  addComment,
  canReject,
  type Handle,
  type MarkRange,
  type Parsed,
  type Person,
  type Range,
  reopen,
  reply,
  resolve,
  suggestions,
  type Thread,
  type Time,
} from '@redlines/format';
import type { HostDocumentData } from '@redlines/plugin-api';
import { type Anchor, anchorAgain, followAnchor } from './anchors.ts';
import { type BoxOptions, CommentBox } from './comment-box.ts';
import { DraftKeeper, type DraftsNow, type KeptDrafts } from './drafts.ts';
import { icon, type IconName } from './icons.ts';
import { authorLine, byline, colorClass, formatTime } from './people.ts';
import {
  applyEdit,
  attempt,
  button,
  changesOf,
  changeTexts,
  decideSuggestion,
  describeChanges,
  editContext,
  element,
  errorLine,
  rowsDone,
  openerEnd,
  readable,
  type ReviewContext,
  segmentSpan,
  visibleSpace,
  visibleStart,
} from './shared.ts';
import { MARGIN, NOTE_GAP, RAIL_SPACE, RAIL_WIDTH } from './styles.ts';

export interface ThreadExtras {
  /** Turns a comment's text into what the note shows (More, citation links). Default: the text. */
  renderText?(
    entry: { id?: string; by: Handle; text: string; resized(): void },
    person: Person | undefined,
  ): Node;
  /** Shown at the foot of a thread's note, such as a run's live line. */
  footer?(thread: string): HTMLElement | null;
  /**
   * Whether a resolved thread's note stays in the rail though resolved comments are hidden, as one
   * whose run waits for an answer does. Asked each time the rail is drawn.
   */
  keepShown?(thread: string): boolean;
}

/** What a host adds to the rail. */
export interface RailOptions extends BoxOptions {
  extras?: ThreadExtras;
  /** Whether resolved comments show in the rail at the start. Default: they don't. */
  showResolved?: boolean;
  /**
   * Where the comments and replies being written are kept for their document, so that they
   * outlast the page (drafts.ts): the review's own store of document data, which the host binds
   * to the document. Without it, a draft lasts while its document is open.
   */
  documentData?: HostDocumentData;
  /**
   * Called when drafts start waiting to be written, a moment after a change, and when they no
   * longer are: a host that quits asks for them first (`saveDrafts`). It may come while the editor
   * is updating, so it must not change the editor itself.
   */
  onDraftsPending?: (pending: boolean) => void;
}

/** A note in the rail. */
export interface Note {
  /** The thread's id, or the change's. */
  id: string;
  thread?: Thread;
  /** The change, or a suggestion's first. */
  change?: MarkRange;
  /** All the changes of a suggestion of several marks, in document order; absent for one. */
  changes?: MarkRange[];
  /** Where the note is level with the text: the start of its anchor. */
  pos: number;
  /** The anchor's text, tinted more strongly while the note is selected. */
  ranges: Range[];
  by: Handle;
  /** A reply being written whose thread is gone: its note keeps it, at the end of the document. */
  orphan?: true;
  /** An element the host has the rail lay out (`Rail.pinElement`), which the rail doesn't draw. */
  host?: true;
}

/**
 * What the host holds for an element it has the rail lay out among its notes (`pinToRail`). The
 * rail never owns the element: the host makes it, fills it and takes it out of the page.
 */
export interface PinnedElement {
  /**
   * Its height changed: the rail measures it again and lays the notes out around it, and does
   * nothing more. It doesn't read the anchor again: the rail reads that when it syncs its notes,
   * which is when the document or the selection changes, among other things, so an anchor that
   * moved without either is seen at the next of those.
   */
  resized(): void;
  /** Scrolls it into view once the rail has placed it, which is a moment from now. */
  reveal(): void;
  /**
   * Takes it out of the layout, and the notes go back to their places. The element is left as it
   * is, in the page, where the host put it.
   */
  release(): void;
}

/** An element a host has the rail lay out (`Rail.pinElement`). */
interface Hosted {
  el: HTMLElement;
  /**
   * The position of the text it is level with, which the host keeps up with edits. Read when the
   * rail syncs its notes, and not at each layout. An anchor that throws is a pin the rail can't
   * hold: it lets the element go, as it does when it stops showing its notes in full.
   */
  anchor: () => number;
  /** Told once, after the update that did it, that the rail no longer lays the element out. */
  lost: () => void;
}

/**
 * A document's notes, in the order of their anchors: one for each open comment thread, and one for
 * each suggestion among `changes` (the editor's pending changes) that has a note: the marks of one
 * edit are one note, at the first, and its anchor is all of them. A resolved thread is settled and
 * has a note only with `showResolved`, or in `keep`. A thread whose anchor is gone is kept (format §4), at the
 * end of the document.
 */
export function notesIn(
  parsed: Parsed,
  changes: readonly MarkRange[],
  showResolved = false,
  /** Resolved threads that show though resolved comments don't: those with a reply being written. */
  keep: ReadonlySet<string> = new Set(),
): Note[] {
  const anchors = new Map<string, MarkRange>();
  for (const mark of parsed.marks) if (mark.kind === 'cmt') anchors.set(mark.id, mark);
  const end = parsed.ledgerRange?.from ?? parsed.text.length;
  const notes: Note[] = [];
  for (const thread of parsed.ledger.comments) {
    if (thread.resolved && !showResolved && !keep.has(thread.id)) continue;
    // The commented text, after any opener on a line of its own.
    const ranges =
      anchors.get(thread.id)?.segments.map((segment) => {
        const from = openerEnd(segment);
        return { from, to: Math.max(from, segment.content.to) };
      }) ?? [];
    notes.push({ id: thread.id, thread, pos: ranges[0]?.from ?? end, ranges, by: thread.by });
  }
  for (const marks of suggestions(changes)) {
    const [change] = marks;
    const first = change?.segments[0];
    if (!change || !first || !change.entry.note) continue;
    const ranges = marks.flatMap((mark) => mark.segments.map(segmentSpan));
    const note: Note = {
      id: change.id,
      change,
      pos: visibleStart(first),
      ranges,
      by: change.entry.by,
    };
    if (marks.length > 1) note.changes = marks;
    notes.push(note);
  }
  // A stable sort: threads before changes at the same place.
  return notes.sort((a, b) => a.pos - b.pos);
}

/**
 * Places notes level with their anchors, with `pinned` the one that keeps its anchor's height and
 * the others stacked around it, each clear of its neighbor by `gap`: the notes after it go down
 * past it, and the ones before it go up, past the top of the page if need be (#328). `tops` and
 * `heights` are in document order. A `settled` note (a resolved one) gives way: the others are
 * placed as if it were not there, and it takes the first place at or below its anchor that clears
 * them all. A `pinned` that is none of the notes is the first, which places every note from the
 * top, as `stack` does. Notes can't go above `floor`: when the ones before the pinned note would,
 * they stay at it and the notes after them give way, the pinned one last, as far as it takes.
 */
export function stackAround(
  tops: readonly number[],
  heights: readonly number[],
  gap: number,
  pinned: number,
  settled?: readonly boolean[],
  floor?: number,
): number[] {
  const placed: number[] = [];
  const height = (i: number) => heights[i] ?? 0;
  // The notes that take their place by the rule: those not settled, and the pinned one.
  const chain = tops.flatMap((_, i) => (!settled?.[i] || i === pinned ? [i] : []));
  const at = Math.max(chain.indexOf(pinned), 0);
  const first = chain[at];
  if (first !== undefined) {
    placed[first] = tops[first] ?? 0;
    for (let k = at + 1; k < chain.length; k++) {
      const [i, before] = [chain[k] ?? 0, chain[k - 1] ?? 0];
      placed[i] = Math.max(tops[i] ?? 0, (placed[before] ?? 0) + height(before) + gap);
    }
    for (let k = at - 1; k >= 0; k--) {
      const [i, after] = [chain[k] ?? 0, chain[k + 1] ?? 0];
      placed[i] = Math.min(tops[i] ?? 0, (placed[after] ?? 0) - gap - height(i));
    }
    if (floor !== undefined && chain.some((i) => (placed[i] ?? 0) < floor)) {
      // No room above: from the first note down, each keeps clear of the one before it.
      let bottom = -Infinity;
      for (const i of chain) {
        placed[i] = Math.max(placed[i] ?? 0, floor, bottom + gap);
        bottom = (placed[i] ?? 0) + height(i);
      }
    }
  }
  if (!settled) return placed;
  // Only settled notes look at the others: each takes the first place at or below its anchor that
  // clears every note placed so far. Those are kept in order of their tops, which no two share, so
  // the ones in the way are neighbors, found by a search and not by going through them all.
  const taken = chain
    .map((i) => ({ top: placed[i] ?? 0, bottom: (placed[i] ?? 0) + height(i) }))
    .sort((x, y) => x.top - y.top);
  /** The index of the first of `taken` for which `later` holds, which holds from there on. */
  const search = (later: (note: { top: number; bottom: number }) => boolean) => {
    let [low, high] = [0, taken.length];
    while (low < high) {
      const middle = (low + high) >> 1;
      const note = taken[middle];
      if (note && later(note)) high = middle;
      else low = middle + 1;
    }
    return low;
  };
  tops.forEach((top, i) => {
    if (!settled[i] || i === pinned) return;
    let place = top;
    // Moving down past one note can run into the next, so go on in order until none is in the way.
    // The notes that end clear above the place can't be in it, and none after one that starts
    // clear below it.
    for (let k = search((note) => note.bottom + gap > place); k < taken.length; k++) {
      const note = taken[k];
      if (!note || note.top >= place + height(i) + gap) break;
      place = Math.max(place, note.bottom + gap);
    }
    placed[i] = place;
    taken.splice(
      search((note) => note.top > place),
      0,
      { top: place, bottom: place + height(i) },
    );
  });
  return placed;
}

/**
 * Places notes at their anchors' heights, in order, each pushed down to clear the note above it by
 * `gap`: the layout of a page whose first note is the pinned one (`stackAround`).
 */
export function stack(
  tops: readonly number[],
  heights: readonly number[],
  gap: number,
  settled?: readonly boolean[],
): number[] {
  return stackAround(
    tops,
    heights,
    gap,
    Math.max(
      tops.findIndex((_, i) => !settled?.[i]),
      0,
    ),
    settled,
  );
}

/** The part of the page that can be seen, in the rail's coordinates. */
interface Span {
  top: number;
  bottom: number;
}

/**
 * The note that keeps its anchor's height while the others stack around it (#328): the selected
 * note when its anchor is in `view` (or always, with `always`: a comment being written stays where
 * it is), else the first note whose anchor is, and when none is, the first below the view, else the
 * last. `lines` are the anchors' first lines, in document order; `selected` is the index of the
 * selected note, or -1. -1 for no notes.
 */
export function pinnedNote(
  lines: readonly { top: number; bottom: number }[],
  view: Span,
  selected: number,
  always = false,
): number {
  const inView = (line: { top: number; bottom: number }) =>
    line.bottom >= view.top && line.top <= view.bottom;
  const chosen = lines[selected];
  if (chosen && (always || inView(chosen))) return selected;
  const first = lines.findIndex(inView);
  if (first >= 0) return first;
  const below = lines.findIndex((line) => line.top > view.bottom);
  return below >= 0 ? below : lines.length - 1;
}

/** The id of the note a new comment is written in. No mark's id has a space (format §2.3). */
const NEW_COMMENT = 'new comment';

/** The start of the id of the note of an element the host has the rail lay out, and a number. */
const HOSTED = 'hosted';

/** What a draft says when a reload changed the text it was on. */
const ANCHOR_CHANGED =
  'The text this pointed to changed. Post it here, or select other text and comment again.';

/** What a reply says when its thread is gone, and it can't be posted. */
const THREAD_GONE =
  'The comment this replied to is gone. Copy what you wrote, or Cancel to let it go.';

const REFUSED_IN_RAW = "A comment can't be added in Raw. Switch to Redlines to add one.";

/** What a new comment is on: the selection, or else the word under the caret, or else the caret. */
function newCommentRange(state: EditorState): Range {
  // Cells selected: the selected cells' text in one row, the whole rows across rows.
  const cells = commentRangeOfRect(state);
  if (cells) return cells;
  const { from, to, empty, head } = state.selection.main;
  if (!empty) return { from, to };
  // On screen, a caret beside a hidden marker is at the end of the word past it.
  const word =
    state.wordAt(head) ??
    state.wordAt(pastHidden(state, head, true)) ??
    state.wordAt(pastHidden(state, head, false));
  return word ? { from: word.from, to: word.to } : { from: head, to: head };
}

const setNewComment = StateEffect.define<Anchor | null>();

/** What the new comment being written is on, which follows the text through edits, or null. */
const newComment = StateField.define<Anchor | null>({
  create: () => null,
  update(range, tr) {
    for (const effect of tr.effects) if (effect.is(setNewComment)) return effect.value;
    return range && followAnchor(range, tr);
  },
});

/** A new comment that Escape closed, with what was written in it. */
interface SetAside {
  range: Anchor;
  text: string;
}

const setAside = StateEffect.define<SetAside | null>();

/**
 * The new comment last set aside, until it is started again on the same anchor. It shows nowhere,
 * and goes with its document.
 */
const setAsideComment = StateField.define<SetAside | null>({
  create: () => null,
  update(aside, tr) {
    for (const effect of tr.effects) if (effect.is(setAside)) return effect.value;
    return aside && tr.docChanged ? { ...aside, range: followAnchor(aside.range, tr) } : aside;
  },
});

/** Whether the selection is on an anchor: all of it, or a caret in it. */
function selectionOn(state: EditorState, { from, to }: Range): boolean {
  const { main } = state.selection;
  return main.empty ? from <= main.head && main.head <= to : main.from === from && main.to === to;
}

/** Whether a transaction starts a new comment, which puts a change's card away. */
export function startsNewComment(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(setNewComment) && effect.value !== null);
}

const selectNote = StateEffect.define<string>();

/** The note last clicked, until the selection moves. */
const clickedNote = StateField.define<string | null>({
  create: () => null,
  update(id, tr) {
    for (const effect of tr.effects) if (effect.is(selectNote)) return effect.value;
    return tr.selection ? null : id;
  },
});

/** The selected note: the one clicked, or else the one whose anchor holds the cursor. */
function selectedNote(state: EditorState, notes: readonly Note[]): Note | null {
  const clicked = state.field(clickedNote);
  if (clicked) return notes.find((note) => note.id === clicked) ?? null;
  const { head } = state.selection.main;
  let found: Note | null = null;
  for (const note of notes) {
    if (!note.ranges.some(({ from, to }) => from <= head && head <= to)) continue;
    // A resolved note gives way to an open one here too.
    if (found && !found.thread?.resolved && note.thread?.resolved) continue;
    found = note;
  }
  return found;
}

/** The selected note's anchor, tinted again in its author's color. */
function highlight(note: Note, color: string): DecorationSet {
  // A resolved thread's text isn't tinted at rest, and when selected it takes a lighter tint.
  const settled = note.thread?.resolved ? ' rl-anchor-resolved' : '';
  const mark = Decoration.mark({ class: `rl-anchor ${color}${settled}` });
  const ranges = note.ranges.filter(({ from, to }) => from < to);
  return Decoration.set(
    ranges.map(({ from, to }) => mark.range(from, to)),
    true,
  );
}

/**
 * How much wider than that the editor must be for the rail to come back. Notes can make the page
 * overflow, and its scroll bar, up to about 15px, takes that from the editor. Without the margin,
 * in that band, showing the notes would shrink the rail, which would hide them, which would give
 * the width back, and so on at every frame.
 */
const COMPACT_MARGIN = 24;

/**
 * Whether the editor, `width` px wide, shows the notes as dots (design §5.7). The column is
 * `column` px at the theme's size, times `textScale`; with notes beside it, it gives up width, down
 * to two-thirds of that, before the rail shrinks to dots. The rail, its gap and the least margins
 * grow with the text size above 100% (the note scale). `compact` is whether the rail is dots now:
 * from dots, the notes come back only with COMPACT_MARGIN to spare.
 */
export function railCompact(at: {
  width: number;
  column: number;
  textScale: number;
  compact: boolean;
}): boolean {
  const noteScale = Math.max(1, at.textScale);
  const keeps =
    (2 * (at.column * at.textScale)) / 3 +
    RAIL_SPACE * noteScale +
    2 * (MARGIN * noteScale) +
    (at.compact ? COMPACT_MARGIN : 0);
  return at.width < keeps;
}
/** How far a note is raised from the top of its anchor's text, so that their first lines align. */
const NOTE_LIFT = 5;
/** A dot's size, the least space between two dots, and how far right of the text they sit. */
const DOT_SIZE = 8;
const DOT_GAP = 4;
const DOT_OFFSET = 10;
/** How far a note shown from its dot is raised, so that its first line is level with the dot. */
const POPOVER_LIFT = 7;
/** How long a note shown on hover stays after the pointer leaves it. */
const POPOVER_CLOSE_MS = 200;
/** The room under the last note, where it reaches past the text. */
const NOTES_FOOT = 24;
/** How long the notes slide (`rl-rail-sliding`) after the one level with its anchor changes, ms. */
const SLIDE_MS = 250;

/** The top and bottom of a line of text. */
interface LineBox {
  top: number;
  bottom: number;
}

/** Where `pos` is on screen: its line of text, or off screen the editor's estimate. */
function lineBox(view: EditorView, pos: number, documentTop: number): LineBox {
  const block = view.lineBlockAt(pos);
  const found = view.coordsAtPos(pos, 1);
  if (found) return found;
  const top = block.top + documentTop;
  return { top, bottom: top + view.defaultLineHeight };
}

/** Whether a note is a resolved thread's, which gives way to the others. */
const isSettled = (note: Note): boolean => !!note.thread?.resolved;

/** Which notes are settled, or nothing when none is, which is every layout with them hidden. */
const settledOf = (notes: readonly Note[]): boolean[] | undefined =>
  notes.some(isSettled) ? notes.map(isSettled) : undefined;

/**
 * The class of a note that is not drawn (display none) while the host holds the rail through a
 * pinch, because it is far off screen: each frame of a pinch changes the notes' lengths, and
 * working out the style of every note on a long page, seen or not, cost half of the frame. The
 * rail lays it out with the height it last measured; letting go draws every note again.
 */
const PARKED = 'rl-note-parked';
/** How far from the screen, in screens, a note must be to be parked. */
const PARK_DISTANCE = 1;
/** What the host has chosen to show in the rail. */
interface Choices {
  showResolved: boolean;
  /** The host is pinching: the rail keeps its state, whatever the width (`hold`). */
  held: boolean;
}

interface Layout {
  notes: readonly Note[];
  compact: boolean;
  /** Each anchor's first line. */
  lines: LineBox[];
  /** Each note's height. */
  heights: number[];
  /** The text size's note scale: 1, or the text size above 100%. */
  noteScale: number;
  /** Which notes are parked (see `PARKED`) for this layout. */
  parked: boolean[];
  /** A note was parked that is near the screen now: another measure with its real height. */
  again: boolean;
  /** The right end of the column's box, inside its padding: where the rail ends, or the text when
   * the rail is shrunk. */
  edge: number;
  /** The part of the page that can be seen, where the notes follow the view (#328). */
  view: Span;
  /** Which notes are resolved, which give way, or nothing when none is. */
  settled: boolean[] | undefined;
  /** The notes that aren't, by index: the ones that can be the pinned one, and their anchors' lines. */
  open: number[];
  openLines: LineBox[];
  /**
   * The index of the note to keep level with its anchor if that is in view, or -1: an element the
   * host has laid out, else the selected note.
   */
  selected: number;
  /** Whether that note keeps its anchor's height wherever the page is scrolled to. */
  stays: boolean;
  /** The note the places below were worked out around (-1: none yet), and each note's place. */
  placedFor: number;
  placed: number[];
}

/** The note shown over the page from its dot: on hover, or pinned by a click. */
interface Popover {
  id: string;
  pinned: boolean;
}

class Rail {
  readonly view: EditorView;
  readonly ctx: ReviewContext;
  readonly options: RailOptions;
  /** What the host chose to show, which outlasts a document and is read at each sync. */
  readonly choices: Choices;
  readonly dom: HTMLElement;
  notes: readonly Note[] = [];
  decorations: DecorationSet = Decoration.none;
  /** Whether the rail is shrunk to dots, in a narrow editor. */
  compact: boolean;
  private readonly noteLayer: HTMLElement;
  private readonly dotLayer: HTMLElement;
  private readonly views = new Map<string, NoteView>();
  private popover: Popover | null = null;
  private closing: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  /** Each note's height as last measured, for the notes parked in a pinch. */
  private readonly heightOf = new Map<string, number>();
  /** Keeps this document's drafts in the host's store, when it has one. */
  readonly keeper: DraftKeeper | null;
  /**
   * A scroll places the notes again by the layout last read, around the note that keeps its anchor's
   * height (#328); while the host holds the rail, the page is measured again (parked notes).
   */
  private readonly onScroll = (event: Event) => {
    if (!this.pageScroll(event.target)) return;
    if (this.choices.held) this.measure();
    else this.scrolled();
  };
  private readonly scrollKey = {};
  /** The layout last read, and each note's top as last written, which a scroll goes by. */
  private layout: Layout | null = null;
  private readonly written = new WeakMap<HTMLElement, number>();
  /** The id of the note that was level with its anchor at the last placement, and the slide's timer. */
  private pinnedId: string | null = null;
  private sliding: ReturnType<typeof setTimeout> | undefined;
  /** The id of the selected note: the one clicked, or whose anchor holds the caret, or being written. */
  private selectedId: string | null = null;
  /** The elements the host has the rail lay out among its notes, by the id of their notes. */
  private readonly hosted = new Map<string, Hosted>();
  private hostedCount = 0;
  /** Writes what is waiting to be written when the page goes away. */
  private readonly onPageHide = () => this.keeper?.flush();
  /** The host put the view at a place of its own, which drafts given back leave as it is. */
  placeKept = false;

  constructor(view: EditorView, ctx: ReviewContext, options: RailOptions, choices: Choices) {
    this.view = view;
    this.ctx = ctx;
    this.options = options;
    this.choices = choices;
    this.dom = element('div', 'rl-rail');
    this.noteLayer = element('div', 'rl-rail-notes');
    this.dotLayer = element('div', 'rl-rail-dots');
    this.dom.append(this.noteLayer, this.dotLayer);
    // A first guess from the window; the measure decides by the editor's width.
    const win = view.dom.ownerDocument.defaultView;
    const width = win?.innerWidth ?? 0;
    // At the saved text size, which the app has set on the root.
    const textScale =
      parseFloat(
        win
          ?.getComputedStyle(view.dom.ownerDocument.documentElement)
          .getPropertyValue('--rl-text-scale') ?? '',
      ) || 1;
    this.compact = width > 0 && railCompact({ width, column: 680, textScale, compact: false });
    this.dom.classList.toggle('rl-rail-compact', this.compact);
    view.scrollDOM.append(this.dom);
    this.keeper = options.documentData
      ? new DraftKeeper(options.documentData, () => this.draftsNow(), options.onDraftsPending)
      : null;
    view.dom.ownerDocument.defaultView?.addEventListener('pagehide', this.onPageHide);
    // Any element's scroll: the page scrolls in an element around the editor in the desktop app.
    view.dom.ownerDocument.defaultView?.addEventListener('scroll', this.onScroll, {
      capture: true,
      passive: true,
    });
    this.sync(view.state);
  }

  update(update: ViewUpdate): void {
    const { state, startState } = update;
    if (
      update.docChanged ||
      update.selectionSet ||
      state.field(viewModeField) !== startState.field(viewModeField) ||
      // A new record of people (or you) can change anyone's color.
      colorsOf(state) !== colorsOf(startState) ||
      state.field(clickedNote) !== startState.field(clickedNote) ||
      state.field(newComment) !== startState.field(newComment)
    ) {
      this.sync(state);
    } else if (update.geometryChanged || update.viewportChanged || update.heightChanged) {
      this.measure();
    }
    // A note pinned from its dot closes when the selection moves, unless it is being written in.
    const { popover } = this;
    if (update.selectionSet && popover?.pinned && !this.views.get(popover.id)?.writing) {
      this.setPopover(null);
    }
    // A new comment started, closed, set aside or moved with its text.
    if (
      state.field(newComment) !== startState.field(newComment) ||
      state.field(setAsideComment) !== startState.field(setAsideComment)
    ) {
      this.keeper?.changed();
    }
  }

  /** The drafts in the rail now, for the keeper. */
  private draftsNow(): DraftsNow {
    const { state } = this.view;
    const range = state.field(newComment);
    const box = this.views.get(NEW_COMMENT);
    const replies = new Map<string, string>();
    for (const [id, view] of this.views) {
      if (id !== NEW_COMMENT && view.written) replies.set(id, view.draft);
    }
    return {
      doc: state.doc,
      comment: range && box?.written ? { range, text: box.draft } : null,
      aside: state.field(setAsideComment),
      replies,
    };
  }

  /**
   * The person typed in the box of a note: the drafts are written in a moment, or at once when the
   * box was cleared, which forgets its draft.
   */
  edited(id: string): void {
    this.keeper?.typedIn(id === NEW_COMMENT ? 'comment' : { thread: id });
    if (this.views.get(id)?.written) this.keeper?.changed();
    else this.keeper?.save();
  }

  /**
   * The host says the document's data can be read: the first time, its kept drafts come back. A
   * document that had no file and was saved has none, and keeps its drafts from now on.
   */
  documentReady(why: 'opened' | 'saved'): void {
    const { keeper } = this;
    if (!keeper) return;
    if (!keeper.placed) keeper.took(this.giveBack(keeper.place()));
    else if (why === 'saved') keeper.saved();
  }

  /**
   * Gives kept drafts back, as they were left: a new comment open on its text, found again, or
   * saying that the text changed; a comment set aside, still aside; each reply in its thread's
   * note, or saying that its thread is gone. A box that has text already keeps it. The caret goes
   * to the box last typed in. Returns what it gave back.
   */
  private giveBack(kept: KeptDrafts): KeptDrafts {
    const { view } = this;
    const { state } = view;
    const given: KeptDrafts = {};
    const effects: StateEffect<unknown>[] = [];
    let range: Anchor | null = null;
    if (kept.comment && !this.views.get(NEW_COMMENT)?.written) {
      range = anchorAgain(kept.comment, state.doc);
      effects.push(setNewComment.of(range));
      given.comment = kept.comment;
    }
    if (kept.aside && !state.field(setAsideComment)) {
      const aside = { range: anchorAgain(kept.aside, state.doc), text: kept.aside.text };
      effects.push(setAside.of(aside));
      given.aside = kept.aside;
    }
    const threads = new Map(state.field(parsedField).ledger.comments.map((t) => [t.id, t]));
    for (const [id, reply] of Object.entries(kept.replies ?? {})) {
      let note = this.views.get(id);
      if (note?.written) continue;
      if (!note) {
        const thread = threads.get(id);
        const by = this.ctx.author.handle;
        const kind = thread ? { thread } : { orphan: true as const };
        note = new NoteView(this, { id, pos: 0, ranges: [], by, ...kind });
        this.views.set(id, note);
      }
      note.restoreReply(reply.text);
      (given.replies ??= {})[id] = reply;
    }
    if (kept.last !== undefined) given.last = kept.last;
    // The rail shows in the markup view, where a document shown Clean goes, as for a new comment.
    const shows = range !== null || given.replies !== undefined;
    if (shows && state.field(viewModeField) === 'clean') {
      effects.push(setViewModeEffect.of(state.facet(markupViewFacet)));
    }
    if (effects.length) view.dispatch({ effects });
    this.sync(view.state);
    if (range && kept.comment) {
      this.views.get(NEW_COMMENT)?.restoreNewComment(kept.comment.text);
      this.views.get(NEW_COMMENT)?.setNotice(range.changed ? ANCHOR_CHANGED : null);
    }
    const boxes = this.notes
      .map(({ id }) => id)
      .filter((id) => (id === NEW_COMMENT ? range !== null : given.replies?.[id] !== undefined));
    const last = kept.last === 'comment' ? NEW_COMMENT : kept.last;
    const target = last !== undefined && boxes.includes(last) ? last : boxes[0];
    const note = target === undefined ? undefined : this.views.get(target);
    // The view and the keyboard stay where the host put them, such as at a line asked for.
    if (target !== undefined && note && !this.placeKept) {
      if (this.compact) this.setPopover({ id: target, pinned: true });
      note.focusBox();
      this.reveal(note.dom);
    }
    return given;
  }

  /** The threads whose note has a reply being written. */
  private draftedThreads(): Set<string> {
    const ids = new Set<string>();
    for (const [id, view] of this.views) if (id !== NEW_COMMENT && view.written) ids.add(id);
    return ids;
  }

  /** The resolved threads whose notes show though resolved comments are hidden. */
  private keptThreads(parsed: Parsed): Set<string> {
    const ids = this.draftedThreads();
    const extras = this.options.extras;
    if (extras?.keepShown) {
      for (const { id, resolved } of parsed.ledger.comments)
        if (resolved && extras.keepShown(id)) ids.add(id);
    }
    return ids;
  }

  /**
   * Notes for the replies being written whose thread is gone, at the end of the document, after
   * the threads whose anchor is gone.
   */
  private orphans(parsed: Parsed): Note[] {
    const threads = new Set(parsed.ledger.comments.map(({ id }) => id));
    const end = parsed.ledgerRange?.from ?? parsed.text.length;
    const notes: Note[] = [];
    for (const [id, view] of this.views) {
      if (id === NEW_COMMENT || threads.has(id) || !view.written) continue;
      notes.push({ id, pos: end, ranges: [], by: this.ctx.author.handle, orphan: true });
    }
    return notes;
  }

  /**
   * Draws the notes again when a note kept only for its draft may no longer need keeping: the text
   * in its box was cleared or posted. A resolved note is kept so only while resolved comments are
   * hidden, and the note of a reply whose thread is gone always.
   */
  releaseDraft(orphan = false): void {
    if (orphan || !this.choices.showResolved) this.sync(this.view.state);
  }

  /** Draws the notes of `state`, and which is selected. */
  sync(state: EditorState): void {
    const parsed = state.field(parsedField);
    // The rail shows in the markup views (design: the rail, cards and review bar in Simple).
    const mode = state.field(viewModeField);
    const shown = mode === 'redlines' || mode === 'simple';
    const range = state.field(newComment);
    this.views.get(NEW_COMMENT)?.setNotice(range?.changed ? ANCHOR_CHANGED : null);
    const writing: Note | null = range && {
      id: NEW_COMMENT,
      pos: range.from,
      ranges: [range],
      by: this.ctx.author.handle,
    };
    const notes = shown
      ? [
          ...notesIn(
            parsed,
            changesOf(this.ctx),
            this.choices.showResolved,
            this.keptThreads(parsed),
          ),
          ...this.orphans(parsed),
        ]
      : [];
    if (shown && writing) notes.push(writing);
    // A stable sort, as in `notesIn`.
    notes.sort((a, b) => a.pos - b.pos);
    // The host's elements stay while the rail shows its notes in full: not as dots, and not with
    // no note of its own, which is also what Clean and Raw leave it.
    if (this.hosted.size && (this.compact || !notes.length)) this.dropHosted();
    // While a new comment is written, its anchor is the one to see.
    const selected = (shown && writing) || selectedNote(state, notes);
    this.selectedId = selected?.id ?? null;
    const ids = new Set(notes.map(({ id }) => id));
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      // A new comment, or a reply being written, waits as it is while the rail doesn't show.
      if (id === NEW_COMMENT ? writing : view.written) {
        view.hide();
        continue;
      }
      view.remove();
      this.views.delete(id);
    }
    if (this.popover && !ids.has(this.popover.id)) this.popover = null;
    // A new comment comes back as it was left, which in a narrow editor is over the page.
    const waiting = this.views.get(NEW_COMMENT);
    if (shown && this.compact && waiting && !waiting.dom.isConnected) {
      this.popover = { id: NEW_COMMENT, pinned: true };
    }
    notes.forEach((note, i) => {
      let view = this.views.get(note.id);
      if (!view) this.views.set(note.id, (view = new NoteView(this, note)));
      view.render(note, parsed, note === selected, this.popover?.id === note.id);
      // Notes are in the document's order for the keyboard and screen readers too.
      for (const [layer, el] of [
        [this.noteLayer, view.dom],
        [this.dotLayer, view.dot],
      ] as const) {
        const at = layer.children[i];
        if (at !== el) layer.insertBefore(el, at ?? null);
      }
    });
    this.notes = this.hosted.size ? this.withHosted(notes, state) : notes;
    // A note that is gone leaves no height behind.
    const here = new Set(notes.map(({ id }) => id));
    for (const id of this.heightOf.keys()) if (!here.has(id)) this.heightOf.delete(id);
    this.decorations = selected
      ? highlight(selected, colorClass(state, selected.by))
      : Decoration.none;
    this.measure();
  }

  /**
   * Whether a note must stay drawn though it is far off screen: one with a box open, with the
   * focus (display none would take it), shown from its dot, or whose run asks a question (the
   * agent's Allow panel, which waits for an answer).
   */
  private keeps(id: string, note: NoteView): boolean {
    return (
      note.writing ||
      this.popover?.id === id ||
      note.dom.contains(note.dom.ownerDocument.activeElement) ||
      !!this.options.extras?.keepShown?.(id)
    );
  }

  /**
   * Holds the rail in the state it has, or lets it go: the rule (`railCompact`) then applies once,
   * to the width at that moment.
   */
  hold(held: boolean): void {
    if (this.choices.held === held) return;
    this.choices.held = held;
    // A held rail parks the notes far from the screen, and the screen moves when the person
    // scrolls, with no change of size to measure again: it measures on every scroll (`onScroll`).
    if (!held) this.measure();
  }

  /** Places the notes, or the dots, once the editor has laid out the text. */
  measure(): void {
    this.view.requestMeasure<Layout | null>({
      key: this,
      read: (view) => this.read(view),
      write: (layout) => this.write(layout),
    });
  }

  private read(view: EditorView): Layout | null {
    const { notes } = this;
    // A measure asked for before the rail left: the document may be another, and shorter, by now.
    if (this.destroyed || !notes.length) return null;
    // An editor that isn't laid out has no width, and keeps what it has. Its width with any scroll
    // bar of its own, which comes and goes with what the notes reach.
    const width = view.scrollDOM.offsetWidth;
    // One look at the content's style: the theme's tokens reach it, and it has the margin.
    const style = view.dom.ownerDocument.defaultView?.getComputedStyle(view.contentDOM);
    const column = parseFloat(style?.getPropertyValue('--rl-column') ?? '') || 680;
    const textScale = parseFloat(style?.getPropertyValue('--rl-text-scale') ?? '') || 1;
    const noteScale = Math.max(1, textScale);
    // While the host holds the rail, the measure places it in the state it has.
    const compact =
      width > 0 && !this.choices.held
        ? railCompact({ width, column, textScale, compact: this.compact })
        : this.compact;
    const scroller = view.scrollDOM.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const originTop = scroller.top - view.scrollDOM.scrollTop;
    const seen = this.seen(view, originTop);
    const { documentTop } = view;
    const lines = notes.map(({ pos }) => {
      const { top, bottom } = lineBox(view, pos, documentTop);
      return { top: top - originTop, bottom: bottom - originTop };
    });
    // A note's actions sit in its head, so neither hovering nor selecting changes its height.
    const held = this.choices.held && !compact;
    // The window's height: the page scrolls in an element of its own (or here), so what is on
    // screen is told from the line's place in the window.
    const screen = view.dom.ownerDocument.defaultView?.innerHeight ?? 0;
    const parked: boolean[] = [];
    let again = false;
    const heights = notes.map(({ id }, i) => {
      // An element of the host's is never parked, and has the height it has.
      const hosted = this.hosted.get(id);
      if (hosted) return hosted.el.offsetHeight;
      const note = this.views.get(id);
      if (!note) return 0;
      const line = lines[i];
      const far =
        held &&
        !!line &&
        this.heightOf.has(id) &&
        screen > 0 &&
        (line.bottom + originTop < -PARK_DISTANCE * screen ||
          line.top + originTop > (1 + PARK_DISTANCE) * screen) &&
        !this.keeps(id, note);
      parked[i] = far;
      if (far) return this.heightOf.get(id) ?? 0;
      // Drawn again after being parked: its height is not known until it is drawn.
      if (note.dom.classList.contains(PARKED)) {
        again = true;
        return this.heightOf.get(id) ?? 0;
      }
      const height = note.height();
      this.heightOf.set(id, height);
      return height;
    });
    // The column's own margin, which the rail stays inside.
    const margin = parseFloat(style?.getPropertyValue('padding-left') ?? '') || MARGIN * noteScale;
    const edge = content.right - scroller.left + view.scrollDOM.scrollLeft - margin;
    const settled = settledOf(notes);
    // A resolved note gives way, and is never the one that keeps its anchor's height.
    const open = notes.flatMap((_, i) => (settled?.[i] ? [] : [i]));
    // An element of the host's keeps its anchor's height, as a new comment being written does.
    const level = notes.findIndex(({ host }) => host);
    return {
      notes,
      compact,
      lines,
      heights,
      edge,
      noteScale,
      parked,
      again,
      view: seen,
      settled,
      open,
      openLines: open.map((i) => lines[i] ?? { top: 0, bottom: 0 }),
      selected: level >= 0 ? level : notes.findIndex(({ id }) => id === this.selectedId),
      stays: level >= 0 || this.selectedId === NEW_COMMENT,
      placedFor: -1,
      placed: [],
    };
  }

  /**
   * Whether a scroll, which is heard from any element, is the page's: the document's, the editor's
   * own, or that of an element around the editor, in which the desktop app scrolls its page. A
   * note's own text that scrolls, or a list beside the editor, is not.
   */
  private pageScroll(target: EventTarget | null): boolean {
    const { view } = this;
    return (
      target === view.dom.ownerDocument ||
      target === view.scrollDOM ||
      (target instanceof Node && target.contains(view.dom))
    );
  }

  /** The part of the page that can be seen, in the rail's coordinates: from the top of the page. */
  private seen(view: EditorView, originTop: number): Span {
    const space = visibleSpace(view);
    return { top: space.top - originTop, bottom: space.bottom - originTop };
  }

  /**
   * The page scrolled: the notes are placed again around the first anchor in view, by the layout
   * last read, so that no note is read or measured again, and only those that move are written.
   */
  private scrolled(): void {
    if (this.destroyed || !this.layout || this.layout.notes !== this.notes) return;
    this.view.requestMeasure<Span>({
      key: this.scrollKey,
      read: (view) =>
        this.seen(view, view.scrollDOM.getBoundingClientRect().top - view.scrollDOM.scrollTop),
      write: (seen) => {
        const { layout } = this;
        if (this.destroyed || !layout || layout.notes !== this.notes) return;
        this.place(layout, seen, false);
      },
    });
  }

  private write(layout: Layout | null): void {
    if (this.destroyed) return;
    if (!layout) this.view.scrollDOM.style.minHeight = '';
    // The notes changed since the read: another measure is coming.
    if (!layout || layout.notes !== this.notes) return;
    if (layout.compact !== this.compact) {
      this.setCompact(layout.compact);
      return;
    }
    layout.notes.forEach(({ id }, i) => {
      this.views.get(id)?.dom.classList.toggle(PARKED, !!layout.parked[i]);
    });
    if (layout.again) this.measure();
    const { noteScale: k } = layout;
    this.dom.style.left = this.compact
      ? `${layout.edge + DOT_OFFSET * k}px`
      : `${layout.edge - RAIL_WIDTH * k}px`;
    // The host's elements are laid out with the notes: the same left, and a top of their own.
    for (const { el } of this.hosted.values()) el.style.left = this.dom.style.left;
    this.layout = layout;
    this.place(layout, layout.view, true);
  }

  /**
   * Places the notes, or the dots, around the one that is level with its anchor (#328): the
   * selected note when its anchor is in `seen`, else the first note whose anchor is. The places are
   * worked out again only when that note changes, and written as they come near the screen: the
   * notes within a screen of it, and with `full`, every note that moved.
   */
  private place(layout: Layout, seen: Span, full: boolean): void {
    const { open, openLines, selected, stays } = layout;
    const pinned =
      open[
        pinnedNote(
          openLines,
          seen,
          open.indexOf(selected),
          // A new comment being written, or an element of the host's, stays where it is, wherever
          // the page is scrolled to.
          stays,
        )
      ] ?? 0;
    const arranged = pinned !== layout.placedFor;
    if (arranged) {
      layout.placed = this.arrange(layout, pinned);
      layout.placedFor = pinned;
      const id = layout.notes[pinned]?.id ?? null;
      // Another note is level with its anchor now: the others slide to their places.
      if (this.pinnedId !== null && id !== this.pinnedId) this.slide();
      this.pinnedId = id;
    }
    this.flush(layout, seen, full);
    if (full || arranged) this.holdNotes(layout, full);
  }

  /** Where each note, or each dot, goes with the note at index `pinned` level with its anchor. */
  private arrange(layout: Layout, pinned: number): number[] {
    const { noteScale: k, settled } = layout;
    if (layout.compact) {
      const centers = layout.lines.map(({ top, bottom }) => (top + bottom - DOT_SIZE * k) / 2);
      return stackAround(
        centers,
        layout.notes.map(() => DOT_SIZE * k),
        DOT_GAP * k,
        pinned,
        settled,
        0,
      );
    }
    return stackAround(
      layout.lines.map(({ top }) => top - NOTE_LIFT * k),
      layout.heights,
      NOTE_GAP * k,
      pinned,
      settled,
      0,
    );
  }

  /**
   * Writes the places of `layout`: what moved, and of that, with a scroll, what is or was within a
   * screen of the part of the page that can be seen. The tops of a few hundred notes are a few
   * hundred styles to work out, and those far from the screen can wait until the page comes near
   * them, which is another scroll's write; a note never written is written, wherever it is.
   */
  private flush(layout: Layout, seen: Span, full: boolean): void {
    const { placed, compact, noteScale: k } = layout;
    const reach = Math.max(seen.bottom - seen.top, 1);
    const near = (top: number, height: number) =>
      top + height >= seen.top - reach && top <= seen.bottom + reach;
    const set = (el: HTMLElement, top: number, height: number) => {
      const was = this.written.get(el);
      if (was === top) return;
      if (!full && was !== undefined && !near(was, height) && !near(top, height)) return;
      this.written.set(el, top);
      el.style.top = `${top}px`;
    };
    layout.notes.forEach(({ id }, i) => {
      const view = this.views.get(id);
      const top = placed[i];
      if (top === undefined) return;
      const height = layout.heights[i] ?? 0;
      if (!view) {
        // The host's element, which the rail lays out in the full rail only.
        const hosted = this.hosted.get(id);
        if (hosted && !compact) set(hosted.el, top, height);
        return;
      }
      if (compact) {
        set(view.dot, top, DOT_SIZE * k);
        set(view.dom, top - POPOVER_LIFT * k, height);
      } else {
        set(view.dom, top, height);
      }
    });
  }

  /** The note that slides is the one that moves because another is now level with its anchor. */
  private slide(): void {
    this.dom.classList.add('rl-rail-sliding');
    clearTimeout(this.sliding);
    this.sliding = setTimeout(() => this.dom.classList.remove('rl-rail-sliding'), SLIDE_MS);
  }

  /**
   * Makes the editor as long as its notes, so that the page scrolls to the foot of the last. A note
   * that reaches past the text, such as a long comment on its last line, would otherwise hang out
   * of the editor's own scroller, which would show a scroll bar of its own for it. The notes reach
   * their lowest with the first level with its anchor (a resolved note can go lower in another
   * layout), so a measure holds the page as long as that needs, and as the layout shown needs if it
   * is longer; a scroll only makes it longer, since a page that changed its length with the note
   * level with its anchor would move under the person at its end.
   */
  private holdNotes(layout: Layout, full: boolean): void {
    const bottomOf = (placed: readonly number[]) => {
      const lift = layout.compact ? POPOVER_LIFT * layout.noteScale : 0;
      return Math.max(...placed.map((top, i) => top - lift + (layout.heights[i] ?? 0)));
    };
    const first = layout.open[0] ?? 0;
    const lowest = first === layout.placedFor ? layout.placed : this.arrange(layout, first);
    const bottom = full
      ? Math.max(bottomOf(lowest), bottomOf(layout.placed))
      : bottomOf(layout.placed);
    const room = bottom + NOTES_FOOT * layout.noteScale;
    const { style } = this.view.scrollDOM;
    if (full ? style.minHeight !== `${room}px` : room > (parseFloat(style.minHeight) || 0)) {
      style.minHeight = `${room}px`;
    }
  }

  /** Shrinks the rail to dots, or brings it back; the editor then redraws the column's width. */
  private setCompact(compact: boolean): void {
    this.compact = compact;
    // What was read is for the other layout: a scroll before the next measure leaves it be.
    this.layout = null;
    // The dots hold no element of the host's: they are let go, and the layout is of the notes.
    if (compact && this.hosted.size) this.sync(this.view.state);
    this.dom.classList.toggle('rl-rail-compact', compact);
    // A new comment being written stays in sight, with the keyboard in its box.
    const writing = compact && this.views.has(NEW_COMMENT);
    this.setPopover(writing ? { id: NEW_COMMENT, pinned: true } : null);
    queueMicrotask(() => {
      if (this.dom.isConnected) this.view.dispatch({});
    });
  }

  private setPopover(popover: Popover | null): void {
    clearTimeout(this.closing);
    this.popover = popover;
    for (const [id, view] of this.views) view.setOpen(popover?.id === id);
    this.measure();
  }

  /**
   * Puts the note shown from its dot away, as a zoom change does: its place was measured for the
   * old layout. A note being written stays, with its draft and the keyboard.
   */
  closePopover(): void {
    const { popover } = this;
    if (!popover || this.views.get(popover.id)?.writing) return;
    this.setPopover(null);
  }

  /** Shows a note from its dot while the pointer is over the dot or the note. */
  peek(id: string): void {
    if (!this.compact) return;
    clearTimeout(this.closing);
    if (this.popover?.id === id || this.popover?.pinned) return;
    this.setPopover({ id, pinned: false });
  }

  /** Puts a note shown on hover away soon after the pointer leaves it. */
  leave(id: string): void {
    const { popover } = this;
    if (!this.compact || popover?.id !== id || popover.pinned) return;
    this.closing = setTimeout(() => this.setPopover(null), POPOVER_CLOSE_MS);
  }

  /** Keeps a note shown from its dot, and selects it; a second click on the dot puts it away. */
  pin(id: string, toggle = true): void {
    if (!this.compact) return;
    if (toggle && this.popover?.id === id && this.popover.pinned) this.setPopover(null);
    else this.setPopover({ id, pinned: true });
    this.select(id);
  }

  select(id: string): void {
    // A new comment is selected while it is written, and there is nothing to select after it.
    if (id !== NEW_COMMENT) this.view.dispatch({ effects: selectNote.of(id) });
  }

  /**
   * Opens a box for a new comment. Raw takes none, and says so, and a document shown Clean switches
   * to Redlines. A comment already being written keeps its place and its draft, but an empty box
   * moves to the selection, and so does a draft that was refused where it was, since the message
   * asks for another selection. On the anchor of what Escape set aside, that comes back. With
   * `initialText`, an empty box opens with it, the caret after it; a draft that comes back, or a box
   * being written in, keeps its own words. Returns whether there is a box to write in.
   */
  startComment(initialText?: string): boolean {
    const { view } = this;
    const { state } = view;
    const mode = state.field(viewModeField);
    if (mode === 'raw') {
      view.dispatch({ effects: refusedEditEffect.of(REFUSED_IN_RAW) });
      return false;
    }
    const open = this.views.get(NEW_COMMENT);
    const aside = state.field(setAsideComment);
    const restored = !open?.written && aside && selectionOn(state, aside.range) ? aside : null;
    const effects: StateEffect<unknown>[] = [];
    // Simple shows the rail and the notes already: only Clean goes to the markup view.
    if (mode === 'clean') effects.push(setViewModeEffect.of(state.facet(markupViewFacet)));
    if (restored) effects.push(setAside.of(null), setNewComment.of(restored.range));
    else if (!open?.written || open.refused || state.field(newComment)?.changed) {
      effects.push(setNewComment.of(newCommentRange(state)));
    }
    view.dispatch({ effects });
    const note = this.views.get(NEW_COMMENT);
    if (!note) return false;
    if (this.compact) this.setPopover({ id: NEW_COMMENT, pinned: true });
    // Focusing would scroll to the note before the rail has placed it, so the scroll waits.
    note.openNewComment(restored?.text ?? (open?.written ? undefined : initialText));
    // A box opened now, such as one set aside and restored, missed the sync that set it.
    note.setNotice(view.state.field(newComment)?.changed ? ANCHOR_CHANGED : null);
    this.reveal(note.dom);
    return true;
  }

  /**
   * Scrolls `el`, in a note, into view. This comes after the rail's next measure, which places the
   * note and makes room for it.
   */
  reveal(el: HTMLElement): void {
    this.measure();
    this.view.requestMeasure({
      read: () => null,
      write: () => el.scrollIntoView({ block: 'nearest' }),
    });
  }

  /**
   * Lays out `el`, an element of the host's, among the notes, level with `anchor`: a position in
   * the text, which the host keeps up with edits. As a new comment's box is, it stays level with
   * its anchor wherever the page is scrolled to, and the notes around it go up or down to clear
   * it, so that none is covered. The rail sets its `left` and `top`, as for a note, and neither
   * draws it nor moves it in the page: the host makes it as wide as a note, fills it and tells the
   * rail when its height changes (`resized`).
   *
   * The rail reads `anchor` when it syncs its notes, which is when the document or the selection
   * changes, among other things, and not at each layout: `resized` measures the element's height
   * again and nothing more.
   *
   * The rail lays out only what it shows in full. In a narrow editor, where the notes are dots, and
   * while it has no note of its own, as in Clean and Raw, or in a document with no comment (the
   * column makes room for notes only), it takes nothing, and returns null: the host places the
   * element as it would without a rail. One it holds is let go when it stops showing them, and
   * `lost` is called once, after the update that did it (a host that places the element reads the
   * layout, which an update doesn't allow), for the host to place the element then. An `anchor`
   * that throws is a pin the rail can't hold either: null where it throws as the element is
   * pinned, and a loss, like any other, where it throws later.
   */
  pinElement(el: HTMLElement, anchor: () => number, lost: () => void): PinnedElement | null {
    if (this.destroyed || this.compact || !this.notes.some((note) => !note.host)) return null;
    // Refused here, and not taken and then lost in the sync below: a host that pins again as soon as
    // it is told of a loss (Ask does) would be told of another, and so on.
    try {
      anchor();
    } catch {
      return null;
    }
    const id = `${HOSTED} ${++this.hostedCount}`;
    const hosted: Hosted = { el, anchor, lost };
    this.hosted.set(id, hosted);
    // Wherever it was placed before, by the host or by this rail, was not for this layout.
    this.written.delete(el);
    this.sync(this.view.state);
    const mine = () => this.hosted.get(id) === hosted;
    return {
      resized: () => {
        if (mine()) this.measure();
      },
      reveal: () => {
        if (mine()) this.reveal(el);
      },
      release: () => {
        if (!mine()) return;
        this.hosted.delete(id);
        this.sync(this.view.state);
      },
    };
  }

  /**
   * The rail stops laying out the host's elements: its notes are dots, or not shown, or it has none
   * of its own. Each is told, once this update is over, and places itself.
   */
  private dropHosted(): void {
    for (const { lost } of this.hosted.values()) queueMicrotask(lost);
    this.hosted.clear();
  }

  /**
   * `notes` and the host's elements among them, in the order of their anchors. The anchors are
   * read here, and an anchor is the host's code, run in an update: one that threw would have the
   * editor switch the whole rail off. The element it belongs to is let go instead.
   */
  private withHosted(notes: readonly Note[], state: EditorState): Note[] {
    const by = this.ctx.author.handle;
    const hosted: Note[] = [];
    for (const [id, held] of [...this.hosted]) {
      let at: number;
      try {
        at = held.anchor();
      } catch {
        this.hosted.delete(id);
        queueMicrotask(held.lost);
        continue;
      }
      const pos = Math.min(Math.max(Math.trunc(at) || 0, 0), state.doc.length);
      hosted.push({ id, pos, ranges: [], by, host: true });
    }
    // A stable sort, as in `notesIn`: at one place, the notes come first.
    return [...notes, ...hosted].sort((a, b) => a.pos - b.pos);
  }

  /**
   * Posts the new comment as you (format §4): its anchor and its entry. Returns its thread, which is
   * what was posted.
   */
  postComment(text: string): { thread: string; id: string } {
    const { state } = this.view;
    const range = state.field(newComment);
    if (!range) throw new Error('No new comment is being written');
    const doc = state.doc.toString();
    const { changes, id } = addComment(doc, range, text, editContext(this.ctx.author));
    applyEdit(this.view, changes, 'review.comment');
    this.select(id);
    return { thread: id, id };
  }

  /** Takes the new comment's note away. `kept` is set aside for its anchor, if it says anything. */
  closeNewComment(kept: string): void {
    const { view } = this;
    const range = view.state.field(newComment);
    const effects: StateEffect<unknown>[] = [setNewComment.of(null)];
    if (range && kept.trim()) effects.push(setAside.of({ range, text: kept }));
    view.dispatch({ effects });
    view.focus();
  }

  /**
   * Whether a comment or a reply that isn't posted has text: in a box that shows, in a reply's
   * that was closed, or in a comment set aside with Escape.
   */
  hasDraft(): boolean {
    return (
      [...this.views.values()].some((view) => view.written) ||
      !!this.view.state.field(setAsideComment)
    );
  }

  /** Draws a thread's note again, with its text and footer, and lays the rail out. */
  refreshThread(thread: string): void {
    const note = this.views.get(thread);
    if (!note) {
      // A resolved thread's note that is to be kept now has none yet.
      if (this.options.extras?.keepShown?.(thread)) this.sync(this.view.state);
      return;
    }
    note.invalidate();
    this.sync(this.view.state);
  }

  /**
   * Shows a thread's note: Clean or Raw switch to the markup view, the note is selected and scrolled into
   * view, and in a narrow editor pinned over the page from its dot. Returns false, changing
   * nothing, when no note would be drawn for it.
   */
  showThread(id: string): boolean {
    const { state } = this.view;
    const parsed = state.field(parsedField);
    const notes = notesIn(
      parsed,
      changesOf(this.ctx),
      this.choices.showResolved,
      this.keptThreads(parsed),
    );
    if (!notes.some((note) => note.id === id && note.thread)) return false;
    if (state.field(viewModeField) === 'clean' || state.field(viewModeField) === 'raw') {
      this.view.dispatch({ effects: setViewModeEffect.of(state.facet(markupViewFacet)) });
    }
    // `notesIn` said a note is drawn, so after the switch it has its view.
    if (this.compact) this.pin(id, false);
    else this.select(id);
    const note = this.views.get(id);
    if (note) this.reveal(note.dom);
    return true;
  }

  /**
   * Posts a reply to a thread as you (format §4). Returns the thread and the reply's id: the reply
   * of the thread that wasn't there before.
   */
  reply(id: string, text: string): { thread: string; id: string } {
    const repliesOf = () =>
      this.view.state.field(parsedField).ledger.comments.find((thread) => thread.id === id)
        ?.replies ?? [];
    const before = new Set(repliesOf().map((posted) => posted.id));
    const doc = this.view.state.doc.toString();
    applyEdit(this.view, reply(doc, id, text, editContext(this.ctx.author)), 'review.reply');
    const posted = repliesOf().find((added) => !before.has(added.id));
    // A reply always gains the thread one; without it, a run would take the reply for a comment.
    if (!posted) throw new Error(`The reply to ${id} is not in the document`);
    return { thread: id, id: posted.id };
  }

  resolve(id: string): void {
    const doc = this.view.state.doc.toString();
    applyEdit(this.view, resolve(doc, id, editContext(this.ctx.author)), 'review.resolve');
  }

  /** Reopens a resolved thread. */
  reopen(id: string): void {
    const doc = this.view.state.doc.toString();
    applyEdit(this.view, reopen(doc, id), 'review.reopen');
  }

  destroy(): void {
    this.destroyed = true;
    // What was typed a moment ago, about to be written.
    this.keeper?.flush();
    this.view.dom.ownerDocument.defaultView?.removeEventListener('pagehide', this.onPageHide);
    this.view.dom.ownerDocument.defaultView?.removeEventListener('scroll', this.onScroll, {
      capture: true,
    });
    clearTimeout(this.closing);
    clearTimeout(this.sliding);
    this.dropHosted();
    for (const view of this.views.values()) view.remove();
    this.dom.remove();
    this.view.scrollDOM.style.minHeight = '';
  }
}

/** One entry of a note: a comment, a reply, or a change's note. */
interface Entry {
  /** The comment's or reply's id. A change's note has none. */
  id?: string;
  by: Handle;
  at: Time;
  text: string;
}

/** An action of a note: an icon, explained by a hint on hover. */
function noteIcon(name: IconName, label: string, run: () => void): HTMLButtonElement {
  const el = button('rl-note-icon', label, run, icon(name, 14));
  const hint = element('span', 'rl-hint', label);
  hint.setAttribute('aria-hidden', 'true');
  el.append(hint);
  return el;
}

/** What a change did, as its note shows it above the reason: the old text and the new. */
interface ChangeShown {
  old: string;
  added: string;
}

function changeShown(parsed: Parsed, change: MarkRange): ChangeShown {
  const row = rowsDone([change]);
  if (row !== null) return { old: '', added: row };
  const { old, added, label } = changeTexts(parsed, change);
  // A format change names what it did: `Bold`.
  if (label !== undefined) return { old: '', added: label };
  return { old: readable(old), added: readable(added) };
}

/** What each change of a suggestion did, in order. */
function changesShown(parsed: Parsed, changes: readonly MarkRange[]): ChangeShown[] {
  const rows = changes.length > 1 ? rowsDone(changes) : null;
  if (rows !== null) return [{ old: '', added: rows }];
  return changes.map((change) => changeShown(parsed, change));
}

/**
 * The old text struck through, an arrow, and the new text: `March → April`. A suggestion of
 * several marks shows its changes in order, separated by ` · `, and the line is clipped to the
 * note's lines with an ellipsis (styles.ts).
 */
function changeLine(shown: readonly ChangeShown[]): HTMLElement {
  const line = element(
    'div',
    shown.length > 1 ? 'rl-note-change rl-note-changes' : 'rl-note-change',
  );
  shown.forEach(({ old, added }, i) => {
    if (i > 0) line.append(' · ');
    if (old) line.append(element('del', 'rl-note-old', old));
    if (old && added) line.append(' → ');
    if (added) line.append(element('span', 'rl-note-new', added));
  });
  return line;
}

/**
 * What the changes of a suggestion did, in the card's words (`Replaced “March” with “April”`), as
 * the note's line in the simple look, where the page shows no old text: so that Accept and Reject
 * are not decided blind. It is the only place that says what they decide, so it isn't clipped to
 * the note's lines as the arrows' line is (styles.ts): every change of the suggestion shows.
 */
function changeSentence(text: string): HTMLElement {
  return element('div', 'rl-note-change rl-note-sentence', text);
}

class NoteView {
  readonly dom: HTMLElement;
  /** The note's dot, shown in place of the note in a narrow editor. */
  readonly dot: HTMLButtonElement;
  private readonly actions: HTMLElement;
  private readonly rail: Rail;
  private readonly id: string;
  private readonly items: HTMLElement;
  private readonly error: HTMLElement;
  private box: CommentBox | null = null;
  private footer: HTMLElement | null = null;
  /** A change's Reject, which a change that can only be accepted goes without. */
  private reject: HTMLElement | null = null;
  /** A thread's Resolve and Reopen: a resolved thread has the second in place of the first. */
  private resolveAction: HTMLElement | null = null;
  private reopenAction: HTMLElement | null = null;
  private drawn = '';
  /** Whether the thread was resolved when the note was last drawn. */
  private settled = false;
  /** Whether the note was last drawn for a reply whose thread is gone. */
  private orphan = false;

  constructor(rail: Rail, note: Note) {
    this.rail = rail;
    this.id = note.id;
    this.dom = element('div', 'rl-note');
    this.items = element('div', 'rl-note-items');
    this.error = errorLine('rl-note-error');
    // The actions, icons at the end of the note's first line; each render puts them back there.
    this.actions = element('span', 'rl-note-actions');
    // A refused action changes nothing and says why.
    const act = (run: () => void) => () => attempt(this.error, run);
    if (note.thread || note.orphan) {
      this.resolveAction = noteIcon(
        'resolve',
        'Resolve',
        act(() => rail.resolve(note.id)),
      );
      this.reopenAction = noteIcon(
        'reopen',
        'Reopen',
        act(() => rail.reopen(note.id)),
      );
      this.actions.append(
        noteIcon('reply', 'Reply', () => this.openReply()),
        this.resolveAction,
      );
    } else if (note.change) {
      this.reject = noteIcon(
        'reject',
        'Reject',
        act(() => decideSuggestion(rail.ctx, 'reject', note.id)),
      );
      this.actions.append(
        noteIcon(
          'accept',
          'Accept',
          act(() => decideSuggestion(rail.ctx, 'accept', note.id)),
        ),
        this.reject,
      );
    }
    this.dom.append(this.items, this.error);
    // Clicking a note selects it. Its text can be selected and copied; its controls keep the
    // keyboard in the document.
    this.dom.addEventListener('mousedown', (event) => {
      if (event.target instanceof Element && event.target.closest('button, textarea')) return;
      rail.select(note.id);
    });
    this.dom.addEventListener('mouseenter', () => rail.peek(note.id));
    this.dom.addEventListener('mouseleave', () => rail.leave(note.id));

    this.dot = element('button', 'rl-note-dot');
    this.dot.type = 'button';
    this.dot.addEventListener('mousedown', (event) => event.preventDefault());
    this.dot.addEventListener('mouseenter', () => rail.peek(note.id));
    this.dot.addEventListener('mouseleave', () => rail.leave(note.id));
    this.dot.addEventListener('click', () => rail.pin(note.id));
  }

  /** Whether a box in the note is open. */
  get writing(): boolean {
    return !!this.box && !this.box.dom.hidden;
  }

  /** Shows `text` under the draft in the note's box, or nothing. */
  setNotice(text: string | null): void {
    this.box?.setNotice(text);
  }

  /** Whether the note's box has a draft in it. */
  get written(): boolean {
    return !!this.box?.written;
  }

  /** What is written in the note's box. */
  get draft(): string {
    return this.box?.text ?? '';
  }

  /** Puts the keyboard in the note's box. */
  focusBox(): void {
    this.box?.focus();
  }

  /** Whether the last post from the note's box was refused. */
  get refused(): boolean {
    return !!this.box?.refused;
  }

  /** The height the rail lays the note out with. Its actions, in its head, add none. */
  height(): number {
    return this.dom.offsetHeight;
  }

  render(note: Note, parsed: Parsed, selected: boolean, open: boolean): void {
    const me = this.rail.ctx.author;
    const color = (handle: Handle) => colorClass(this.rail.ctx.editor.view.state, handle);
    this.dom.className = `rl-note ${color(note.by)}`;
    this.dom.classList.toggle('rl-note-selected', selected);
    this.dom.classList.toggle('rl-note-writing', this.writing);
    this.dot.className = `rl-note-dot ${color(note.by)}`;
    this.dot.classList.toggle('rl-note-dot-selected', selected);
    this.setOpen(open);
    const settled = isSettled(note);
    this.settled = settled;
    this.orphan = !!note.orphan;
    this.dom.classList.toggle('rl-note-resolved', settled);
    this.dot.classList.toggle('rl-note-dot-resolved', settled);
    if (this.resolveAction && this.reopenAction) {
      const [wanted, other] = settled
        ? [this.reopenAction, this.resolveAction]
        : [this.resolveAction, this.reopenAction];
      other.remove();
      // A reply whose thread is gone has only Reply, which opens its box again.
      if (note.orphan) wanted.remove();
      else if (wanted.parentNode !== this.actions) this.actions.append(wanted);
    }
    // A reply's box says when its thread is gone, and can't post then. A new comment's notice is
    // the rail's (`sync`).
    if (note.id !== NEW_COMMENT) {
      this.box?.setNotice(note.orphan ? THREAD_GONE : null);
      this.box?.setPostable(!note.orphan);
    }
    const resolver = note.thread?.resolved;
    const resolvedBy = resolver ? byline(parsed, resolver.by, me).name : '';
    if (this.reject && note.change) {
      const marks = note.changes ?? [note.change];
      if (!marks.every((mark) => canReject(parsed, mark))) this.reject.remove();
      else if (this.reject.parentNode !== this.actions) this.actions.append(this.reject);
    }
    const entries: Entry[] = note.thread
      ? [note.thread, ...note.thread.replies]
      : [{ by: note.by, at: note.change?.entry.at ?? '', text: note.change?.entry.note ?? '' }];
    const items = entries.map(({ id, by, at, text }) => ({
      id,
      by,
      who: byline(parsed, by, me),
      color: color(by),
      at,
      text,
    }));
    const marks = note.change ? (note.changes ?? [note.change]) : null;
    // The simple look hides the old text, so the note says in words what a click decides; the full
    // markup shows the old text struck, and the note the arrow.
    const simple = this.rail.view.state.field(viewModeField) === 'simple';
    const sentence = marks && simple ? describeChanges(parsed, marks) : null;
    const change = marks && !simple ? changesShown(parsed, marks) : null;
    const first = items[0];
    const label = settled ? 'Resolved note' : 'Note';
    this.dot.setAttribute('aria-label', first ? `${label} by ${first.who.name}` : label);
    const drawn = JSON.stringify([items, change, sentence, resolver, resolvedBy]);
    if (drawn === this.drawn) return;
    this.drawn = drawn;
    this.items.replaceChildren(
      ...items.map(({ id, by, who, color, at, text }) => {
        const item = element('div', `rl-note-item ${color}`);
        item.append(authorLine('rl-note', who, at, true));
        if (change) item.append(changeLine(change));
        else if (sentence !== null) item.append(changeSentence(sentence));
        // A new comment has no text yet, and an orphaned reply no comment: only who is writing,
        // over the box.
        if (note.id !== NEW_COMMENT && !note.orphan) {
          const body = element('div', 'rl-note-text');
          body.append(note.thread ? this.commentText(parsed, id, by, text) : text);
          item.append(body);
        }
        return item;
      }),
    );
    if (resolver) {
      const line = element('div', 'rl-note-resolved-line');
      line.append(icon('resolve', 12), `Resolved by ${resolvedBy}`);
      const shown = formatTime(resolver.at, new Date(), true);
      if (shown) {
        const time = element('time', 'rl-note-resolved-time', shown);
        time.dateTime = resolver.at;
        time.title = formatTime(resolver.at);
        line.append(time);
      }
      this.items.append(line);
    }
    this.items.querySelector('.rl-note-head')?.append(this.actions);
    if (note.thread) this.setFooter(this.rail.options.extras?.footer?.(note.id) ?? null);
    else this.setFooter(null);
  }

  /** What the note shows of a comment or a reply. */
  private commentText(
    parsed: Parsed,
    id: string | undefined,
    by: Handle,
    text: string,
  ): Node | string {
    const { extras } = this.rail.options;
    if (!extras?.renderText) return text;
    const person = parsed.ledger.people.find(({ handle }) => handle === by);
    // `resized`: what it drew changed the note's size, so the rail must place its notes again.
    return extras.renderText(
      { ...(id === undefined ? {} : { id }), by, text, resized: () => this.rail.measure() },
      person,
    );
  }

  /** Puts the footer under the thread, over any box being written in. */
  private setFooter(footer: HTMLElement | null): void {
    if (footer === this.footer) return;
    this.footer?.remove();
    if (footer) this.items.after(footer);
    this.footer = footer;
  }

  /** Makes the next render draw the note, though what it shows from the file is the same. */
  invalidate(): void {
    this.drawn = '';
  }

  /** Shows the note over the page from its dot, or puts it away. */
  setOpen(open: boolean): void {
    this.dom.classList.toggle('rl-note-open', open);
    this.dot.setAttribute('aria-expanded', String(open));
  }

  /** Takes the note out of the page, as it is. */
  hide(): void {
    this.dom.remove();
    this.dot.remove();
  }

  /** Takes the note out for good. */
  remove(): void {
    this.hide();
    this.box?.detach();
  }

  /**
   * Opens the note's box for a new comment, with `draft` in it if given. The note goes when the box
   * closes. A refusal is over: this is on a new anchor, or an attempt on the same one.
   */
  openNewComment(draft?: string, focus: FocusOptions | false = { preventScroll: true }): void {
    const { rail } = this;
    this.openBox(
      'Comment',
      (text) => rail.postComment(text),
      (kept) => rail.closeNewComment(kept),
      // The rail scrolls to the note once it has placed it.
      focus,
    );
    this.box?.clearRefusal();
    if (draft !== undefined) this.box?.setDraft(draft);
  }

  /** Opens the box of a new comment kept from before, with its text, leaving the keyboard be. */
  restoreNewComment(text: string): void {
    this.openNewComment(text, false);
  }

  /** Opens the reply's box with text kept from before, leaving the keyboard be. */
  restoreReply(text: string): void {
    this.openReplyBox(false);
    this.box?.setDraft(text);
  }

  private openReply(): void {
    const { rail } = this;
    this.openReplyBox();
    // A note shown from its dot stays while the reply is written.
    rail.pin(this.id, false);
    rail.select(this.id);
  }

  private openReplyBox(focus?: FocusOptions | false): void {
    const { rail } = this;
    this.openBox(
      'Reply',
      (text) => rail.reply(this.id, text),
      (kept) => {
        // A reply keeps its text when closed, but one whose thread is gone has nothing to go back
        // to: Cancel lets it go.
        if (this.orphan && !kept) this.box?.setDraft('');
        rail.view.focus();
      },
      focus,
    );
  }

  private openBox(
    label: string,
    post: (text: string) => { thread: string; id: string },
    closed: (kept: string) => void,
    focus?: FocusOptions | false,
  ): void {
    const { rail } = this;
    this.box ??= new CommentBox(label, rail.options, {
      post,
      edited: () => rail.edited(this.id),
      close: (kept) => {
        this.dom.classList.remove('rl-note-writing');
        rail.measure();
        closed(kept);
        // Posted or Cancelled: forgotten at once, for the app may quit right after, and a posted
        // comment must not come back as a draft. Set aside with Escape: kept in a moment.
        if (kept) rail.keeper?.changed();
        else rail.keeper?.save();
        if ((this.settled || this.orphan) && !this.written) rail.releaseDraft(this.orphan);
      },
      resize: () => {
        rail.measure();
        // A resolved note shown only for its draft goes when the draft is cleared, and so does an
        // orphaned reply's.
        if ((this.settled || this.orphan) && !this.written) rail.releaseDraft(this.orphan);
      },
      reveal: (el) => rail.reveal(el),
    });
    if (this.box.dom.parentNode !== this.dom) this.error.before(this.box.dom);
    this.dom.classList.add('rl-note-writing');
    this.box.open(focus);
  }
}

/** The rail, and what can be asked of it from outside the editor. */
export interface RailControl {
  extension: Extension;
  startComment(initialText?: string): boolean;
  hasDraft(): boolean;
  saveDrafts(): void;
  discardDrafts(): void;
  keepPlace(): void;
  /** Stops hearing from the host's store. */
  destroy(): void;
  refreshThread(thread: string): void;
  showThread(thread: string): boolean;
  showsResolved(): boolean;
  setShowResolved(show: boolean): void;
  /** Puts away the note shown from its dot, but not one being written. */
  closePopover(): void;
  /**
   * Holds the rail in the state it has while the host pinches the text, however the width changes,
   * and lets it go, applying the rule once, when the fingers lift.
   */
  hold(held: boolean): void;
  /** Lays out an element of the host's among the notes (`Rail.pinElement`), or returns null. */
  pinToRail(el: HTMLElement, anchor: () => number, lost: () => void): PinnedElement | null;
}

/** The rail and its notes, for an editor showing tracked changes. */
export function rail(ctx: ReviewContext, options: RailOptions): RailControl {
  const choices: Choices = { showResolved: options.showResolved ?? false, held: false };
  const plugin = ViewPlugin.define((view) => new Rail(view, ctx, options, choices), {
    decorations: (value) => value.decorations,
  });
  const current = () => ctx.editor.view.plugin(plugin);
  const stopReady = options.documentData?.onReady((why) => current()?.documentReady(why));
  return {
    extension: [
      clickedNote,
      newComment,
      setAsideComment,
      plugin,
      // The column makes room for the full rail; the dots of a shrunk rail need none.
      EditorView.editorAttributes.of((view) => {
        const value = view.plugin(plugin);
        return value?.notes.length && !value.compact ? { class: 'rl-has-rail' } : null;
      }),
    ],
    startComment: (initialText) => current()?.startComment(initialText) ?? false,
    hasDraft: () => current()?.hasDraft() ?? false,
    saveDrafts: () => current()?.keeper?.save(),
    discardDrafts: () => current()?.keeper?.discard(),
    keepPlace: () => {
      const rail = current();
      if (rail) rail.placeKept = true;
    },
    destroy: () => stopReady?.(),
    refreshThread: (thread) => current()?.refreshThread(thread),
    showThread: (thread) => current()?.showThread(thread) ?? false,
    showsResolved: () => choices.showResolved,
    closePopover: () => current()?.closePopover(),
    hold(held) {
      const rail = current();
      if (rail) rail.hold(held);
      else choices.held = held;
    },
    pinToRail: (el, anchor, lost) => current()?.pinElement(el, anchor, lost) ?? null,
    setShowResolved(show) {
      if (choices.showResolved === show) return;
      choices.showResolved = show;
      const rail = current();
      if (!rail) return;
      rail.sync(rail.view.state);
      // The column makes room for the rail from the editor's attributes, which change only in an
      // update, as `setCompact` makes one.
      rail.view.dispatch({});
    },
  };
}
