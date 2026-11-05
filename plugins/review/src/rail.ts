// The rail (design §5.7): notes in the page's right margin, one for each comment thread and one for
// each change that has its author's note, such as an agent's reason. A note is level with its
// anchor, pushed down past the note above it. At rest it shows who wrote what; the times and the
// actions appear on hover, or while the note is selected: clicked, or with the cursor in its
// anchor. A selected note's border takes its author's color, and its anchor's tint doubles. The
// rail shows only in Redlines, where it moves the text column left, so that column and rail stay
// centered together. In a narrow editor the rail shrinks to a dot in the author's color level with
// each anchor, and the column takes its whole width back; hovering or clicking a dot shows its
// note over the page. A new comment is written in a note of its own, level with what it is on, and
// is private until it is posted: nothing of it is in the file before then.

import {
  type ChangeDesc,
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type Transaction,
} from '@codemirror/state';
import {
  BlockType,
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  parsedField,
  pastHidden,
  refusedEditEffect,
  setViewModeEffect,
  viewModeField,
} from '@redlines/editor';
import {
  addComment,
  type Handle,
  type MarkRange,
  type Parsed,
  type Person,
  type Range,
  reply,
  resolve,
  type Thread,
  type Time,
} from '@redlines/format';
import { type BoxOptions, CommentBox } from './comment-box.ts';
import { icon, type IconName } from './icons.ts';
import { authorLine, byline, colorClass } from './people.ts';
import {
  applyEdit,
  attempt,
  button,
  changesOf,
  changeTexts,
  editContext,
  element,
  errorLine,
  openerEnd,
  readable,
  type ReviewContext,
  segmentSpan,
  visibleStart,
} from './shared.ts';
import { COLUMN_PADDING, NOTE_GAP, RAIL_WIDTH } from './styles.ts';

export interface ThreadExtras {
  /** Turns a comment's text into what the note shows (More, citation links). Default: the text. */
  renderText?(
    entry: { id?: string; by: Handle; text: string; resized(): void },
    person: Person | undefined,
  ): Node;
  /** Shown at the foot of a thread's note, such as a run's live line. */
  footer?(thread: string): HTMLElement | null;
}

/** What a host adds to the rail. */
export interface RailOptions extends BoxOptions {
  extras?: ThreadExtras;
}

/** A note in the rail. */
export interface Note {
  /** The thread's id, or the change's. */
  id: string;
  thread?: Thread;
  change?: MarkRange;
  /** Where the note is level with the text: the start of its anchor. */
  pos: number;
  /** The anchor's text, tinted more strongly while the note is selected. */
  ranges: Range[];
  by: Handle;
}

/**
 * A document's notes, in the order of their anchors: one for each open comment thread, and one for
 * each of `changes` (the editor's pending changes) with a note. A resolved thread is settled and
 * has none. A thread whose anchor is gone is kept (format §4), at the end of the document.
 */
export function notesIn(parsed: Parsed, changes: readonly MarkRange[]): Note[] {
  const anchors = new Map<string, MarkRange>();
  for (const mark of parsed.marks) if (mark.kind === 'cmt') anchors.set(mark.id, mark);
  const end = parsed.ledgerRange?.from ?? parsed.text.length;
  const notes: Note[] = [];
  for (const thread of parsed.ledger.comments) {
    if (thread.resolved) continue;
    // The commented text, after any opener on a line of its own.
    const ranges =
      anchors.get(thread.id)?.segments.map((segment) => {
        const from = openerEnd(segment);
        return { from, to: Math.max(from, segment.content.to) };
      }) ?? [];
    notes.push({ id: thread.id, thread, pos: ranges[0]?.from ?? end, ranges, by: thread.by });
  }
  for (const change of changes) {
    const first = change.segments[0];
    if (!first || !change.entry.note) continue;
    const ranges = change.segments.map(segmentSpan);
    notes.push({ id: change.id, change, pos: visibleStart(first), ranges, by: change.entry.by });
  }
  // A stable sort: threads before changes at the same place.
  return notes.sort((a, b) => a.pos - b.pos);
}

/**
 * Places notes at their anchors' heights, in order, each pushed down to clear the note above it by
 * `gap`.
 */
export function stack(tops: readonly number[], heights: readonly number[], gap: number): number[] {
  const placed: number[] = [];
  let bottom = -Infinity;
  tops.forEach((top, i) => {
    const at = Math.max(top, bottom + gap);
    placed.push(at);
    bottom = at + (heights[i] ?? 0);
  });
  return placed;
}

/** The id of the note a new comment is written in. No mark's id has a space (format §2.3). */
const NEW_COMMENT = 'new comment';

const REFUSED_IN_RAW = "A comment can't be added in Raw. Switch to Redlines to add one.";

/** What a new comment is on: the selection, or else the word under the caret, or else the caret. */
function newCommentRange(state: EditorState): Range {
  const { from, to, empty, head } = state.selection.main;
  if (!empty) return { from, to };
  // On screen, a caret beside a hidden marker is at the end of the word past it.
  const word =
    state.wordAt(head) ??
    state.wordAt(pastHidden(state, head, true)) ??
    state.wordAt(pastHidden(state, head, false));
  return word ? { from: word.from, to: word.to } : { from: head, to: head };
}

/**
 * An anchor through edits. What is put in right at its ends stays outside it. With its text
 * deleted, it is on the point where the text was.
 */
function mapAnchor(range: Range, changes: ChangeDesc): Range {
  const from = changes.mapPos(range.from, 1);
  return { from, to: Math.max(from, changes.mapPos(range.to, -1)) };
}

const setNewComment = StateEffect.define<Range | null>();

/** What the new comment being written is on, which follows the text through edits, or null. */
const newComment = StateField.define<Range | null>({
  create: () => null,
  update(range, tr) {
    for (const effect of tr.effects) if (effect.is(setNewComment)) return effect.value;
    return range && tr.docChanged ? mapAnchor(range, tr.changes) : range;
  },
});

/** A new comment that Escape closed, with what was written in it. */
interface SetAside {
  range: Range;
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
    return aside && tr.docChanged ? { ...aside, range: mapAnchor(aside.range, tr.changes) } : aside;
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
    if (note.ranges.some(({ from, to }) => from <= head && head <= to)) found = note;
  }
  return found;
}

/** The selected note's anchor, tinted again in its author's color. */
function highlight(note: Note, color: string): DecorationSet {
  const mark = Decoration.mark({ class: `rl-anchor ${color}` });
  const ranges = note.ranges.filter(({ from, to }) => from < to);
  return Decoration.set(
    ranges.map(({ from, to }) => mark.range(from, to)),
    true,
  );
}

/** Below this width of the editor, about a window of 1,000px, the rail shrinks to dots. */
export const COMPACT_BELOW = 1000;
/**
 * How much wider than that the editor must be for the rail to come back. Notes can make the page
 * overflow, and its scroll bar, up to about 15px, takes that from the editor. Without the margin,
 * in that band, showing the notes would shrink the rail, which would hide them, which would give
 * the width back, and so on at every frame.
 */
const COMPACT_MARGIN = 24;
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

/** The top and bottom of a line of text. */
interface LineBox {
  top: number;
  bottom: number;
}

/**
 * The text in the table cell that holds `pos`. The editor draws a table as one widget and can only
 * say where the table starts; the cells carry their source offsets in `data-end`, as the table
 * widget writes them for clicks. Null when `pos` isn't in a table on screen.
 */
function cellBox(view: EditorView, pos: number): LineBox | null {
  for (const table of view.contentDOM.querySelectorAll<HTMLElement>('.rl-table')) {
    const start = view.posAtDOM(table);
    if (pos < start) continue;
    for (const cell of table.querySelectorAll<HTMLElement>('[data-end]')) {
      if (start + Number(cell.dataset['end']) < pos) continue;
      return (cell.querySelector('[data-from]') ?? cell).getBoundingClientRect();
    }
  }
  return null;
}

/** Where `pos` is on screen: its line of text, or off screen the editor's estimate. */
function lineBox(view: EditorView, pos: number, documentTop: number): LineBox {
  const block = view.lineBlockAt(pos);
  const found =
    (block.type === BlockType.WidgetRange ? cellBox(view, pos) : null) ?? view.coordsAtPos(pos, 1);
  if (found) return found;
  const top = block.top + documentTop;
  return { top, bottom: top + view.defaultLineHeight };
}

interface Layout {
  notes: readonly Note[];
  compact: boolean;
  /** Each anchor's first line. */
  lines: LineBox[];
  /** Each note's height. */
  heights: number[];
  /** The right end of the column's box, inside its padding: where the rail ends, or the text when
   * the rail is shrunk. */
  edge: number;
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

  constructor(view: EditorView, ctx: ReviewContext, options: RailOptions) {
    this.view = view;
    this.ctx = ctx;
    this.options = options;
    this.dom = element('div', 'rl-rail');
    this.noteLayer = element('div', 'rl-rail-notes');
    this.dotLayer = element('div', 'rl-rail-dots');
    this.dom.append(this.noteLayer, this.dotLayer);
    // A first guess from the window; the measure decides by the editor's width.
    const width = view.dom.ownerDocument.defaultView?.innerWidth ?? 0;
    this.compact = width > 0 && width < COMPACT_BELOW;
    this.dom.classList.toggle('rl-rail-compact', this.compact);
    view.scrollDOM.append(this.dom);
    this.sync(view.state);
  }

  update(update: ViewUpdate): void {
    const { state, startState } = update;
    if (
      update.docChanged ||
      update.selectionSet ||
      state.field(viewModeField) !== startState.field(viewModeField) ||
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
  }

  /** Draws the notes of `state`, and which is selected. */
  sync(state: EditorState): void {
    const parsed = state.field(parsedField);
    const shown = state.field(viewModeField) === 'redlines';
    const range = state.field(newComment);
    const writing: Note | null = range && {
      id: NEW_COMMENT,
      pos: range.from,
      ranges: [range],
      by: this.ctx.author.handle,
    };
    const notes = shown ? notesIn(parsed, changesOf(this.ctx)) : [];
    if (shown && writing) {
      // A stable sort, as in `notesIn`.
      notes.push(writing);
      notes.sort((a, b) => a.pos - b.pos);
    }
    // While a new comment is written, its anchor is the one to see.
    const selected = (shown && writing) || selectedNote(state, notes);
    const ids = new Set(notes.map(({ id }) => id));
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      // A new comment waits, as it is, while the rail doesn't show.
      if (id === NEW_COMMENT && writing) {
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
    this.notes = notes;
    this.decorations = selected
      ? highlight(selected, colorClass(parsed, this.ctx.author.handle, selected.by))
      : Decoration.none;
    this.measure();
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
    const below = COMPACT_BELOW + (this.compact ? COMPACT_MARGIN : 0);
    const compact = width > 0 ? width < below : this.compact;
    const scroller = view.scrollDOM.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const originTop = scroller.top - view.scrollDOM.scrollTop;
    const { documentTop } = view;
    const lines = notes.map(({ pos }) => {
      const { top, bottom } = lineBox(view, pos, documentTop);
      return { top: top - originTop, bottom: bottom - originTop };
    });
    // A note's actions sit in its head, so neither hovering nor selecting changes its height.
    const heights = notes.map(({ id }) => this.views.get(id)?.height() ?? 0);
    const edge = content.right - scroller.left + view.scrollDOM.scrollLeft - COLUMN_PADDING;
    return { notes, compact, lines, heights, edge };
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
    if (this.compact) {
      this.dom.style.left = `${layout.edge + DOT_OFFSET}px`;
      const centers = layout.lines.map(({ top, bottom }) => (top + bottom - DOT_SIZE) / 2);
      const placed = stack(
        centers,
        layout.notes.map(() => DOT_SIZE),
        DOT_GAP,
      );
      layout.notes.forEach(({ id }, i) => {
        const view = this.views.get(id);
        if (!view) return;
        view.dot.style.top = `${placed[i]}px`;
        view.dom.style.top = `${(placed[i] ?? 0) - POPOVER_LIFT}px`;
      });
      this.holdNotes(
        placed.map((top) => top - POPOVER_LIFT),
        layout.heights,
      );
      return;
    }
    this.dom.style.left = `${layout.edge - RAIL_WIDTH}px`;
    const placed = stack(
      layout.lines.map(({ top }) => top - NOTE_LIFT),
      layout.heights,
      NOTE_GAP,
    );
    layout.notes.forEach(({ id }, i) => {
      const view = this.views.get(id);
      if (view) view.dom.style.top = `${placed[i]}px`;
    });
    this.holdNotes(placed, layout.heights);
  }

  /**
   * Makes the editor as long as its notes, so that the page scrolls to the foot of the last. A note
   * that reaches past the text, such as a long comment on its last line, would otherwise hang out
   * of the editor's own scroller, which would show a scroll bar of its own for it.
   */
  private holdNotes(tops: readonly number[], heights: readonly number[]): void {
    const bottom = Math.max(...tops.map((top, i) => top + (heights[i] ?? 0)));
    this.view.scrollDOM.style.minHeight = `${bottom + NOTES_FOOT}px`;
  }

  /** Shrinks the rail to dots, or brings it back; the editor then redraws the column's width. */
  private setCompact(compact: boolean): void {
    this.compact = compact;
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
   * asks for another selection. On the anchor of what Escape set aside, that comes back. Returns
   * whether there is a box to write in.
   */
  startComment(): boolean {
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
    if (mode !== 'redlines') effects.push(setViewModeEffect.of('redlines'));
    if (restored) effects.push(setAside.of(null), setNewComment.of(restored.range));
    else if (!open?.written || open.refused) {
      effects.push(setNewComment.of(newCommentRange(state)));
    }
    view.dispatch({ effects });
    const note = this.views.get(NEW_COMMENT);
    if (!note) return false;
    if (this.compact) this.setPopover({ id: NEW_COMMENT, pinned: true });
    // Focusing would scroll to the note before the rail has placed it, so the scroll waits.
    note.openNewComment(restored?.text);
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

  /** Posts the new comment as you (format §4): its anchor and its entry. Returns its thread. */
  postComment(text: string): string {
    const { state } = this.view;
    const range = state.field(newComment);
    if (!range) throw new Error('No new comment is being written');
    const doc = state.doc.toString();
    const { changes, id } = addComment(doc, range, text, editContext(this.ctx.author));
    applyEdit(this.view, changes, 'review.comment');
    this.select(id);
    return id;
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

  /** Draws a thread's note again, with its text and footer, and lays the rail out. */
  refreshThread(thread: string): void {
    const note = this.views.get(thread);
    if (!note) return;
    note.invalidate();
    this.sync(this.view.state);
  }

  /** Posts a reply to a thread as you (format §4). Returns the thread. */
  reply(id: string, text: string): string {
    const doc = this.view.state.doc.toString();
    applyEdit(this.view, reply(doc, id, text, editContext(this.ctx.author)), 'review.reply');
    return id;
  }

  resolve(id: string): void {
    const doc = this.view.state.doc.toString();
    applyEdit(this.view, resolve(doc, id, editContext(this.ctx.author)), 'review.resolve');
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.closing);
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
  const { old, added, label } = changeTexts(parsed, change);
  // A format change names what it did: `Bold`.
  if (label !== undefined) return { old: '', added: label };
  return { old: readable(old), added: readable(added) };
}

/** The old text struck through, an arrow, and the new text: `March → April`. */
function changeLine({ old, added }: ChangeShown): HTMLElement {
  const line = element('div', 'rl-note-change');
  if (old) line.append(element('del', 'rl-note-old', old));
  if (old && added) line.append(' → ');
  if (added) line.append(element('span', 'rl-note-new', added));
  return line;
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
  private drawn = '';

  constructor(rail: Rail, note: Note) {
    this.rail = rail;
    this.id = note.id;
    this.dom = element('div', 'rl-note');
    this.items = element('div', 'rl-note-items');
    this.error = errorLine('rl-note-error');
    // The actions, icons at the end of the note's first line; each render puts them back there.
    this.actions = element('span', 'rl-note-actions');
    const { editor } = rail.ctx;
    // A refused action changes nothing and says why.
    const act = (run: () => void) => () => attempt(this.error, run);
    if (note.thread) {
      this.actions.append(
        noteIcon('reply', 'Reply', () => this.openReply()),
        noteIcon(
          'resolve',
          'Resolve',
          act(() => rail.resolve(note.id)),
        ),
      );
    } else if (note.change) {
      this.actions.append(
        noteIcon(
          'accept',
          'Accept',
          act(() => editor.accept(note.id)),
        ),
        noteIcon(
          'reject',
          'Reject',
          act(() => editor.reject(note.id)),
        ),
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

  /** Whether the note's box has a draft in it. */
  get written(): boolean {
    return !!this.box?.written;
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
    const color = (handle: Handle) => colorClass(parsed, me.handle, handle);
    this.dom.className = `rl-note ${color(note.by)}`;
    this.dom.classList.toggle('rl-note-selected', selected);
    this.dom.classList.toggle('rl-note-writing', this.writing);
    this.dot.className = `rl-note-dot ${color(note.by)}`;
    this.dot.classList.toggle('rl-note-dot-selected', selected);
    this.setOpen(open);
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
    const change = note.change ? changeShown(parsed, note.change) : null;
    const first = items[0];
    this.dot.setAttribute('aria-label', first ? `Note by ${first.who.name}` : 'Note');
    const drawn = JSON.stringify([items, change]);
    if (drawn === this.drawn) return;
    this.drawn = drawn;
    this.items.replaceChildren(
      ...items.map(({ id, by, who, color, at, text }) => {
        const item = element('div', `rl-note-item ${color}`);
        item.append(authorLine('rl-note', who, at, true));
        if (change) item.append(changeLine(change));
        // A new comment has no text yet: only who is writing it, over its box.
        if (note.id !== NEW_COMMENT) {
          const body = element('div', 'rl-note-text');
          body.append(note.thread ? this.commentText(parsed, id, by, text) : text);
          item.append(body);
        }
        return item;
      }),
    );
    this.items.querySelector('.rl-note-head')?.append(this.actions);
    if (note.thread) this.setFooter(this.rail.options.extras?.footer?.(note.id) ?? null);
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
  openNewComment(draft?: string): void {
    const { rail } = this;
    this.openBox(
      'Comment',
      (text) => rail.postComment(text),
      (kept) => rail.closeNewComment(kept),
      // The rail scrolls to the note once it has placed it.
      { preventScroll: true },
    );
    this.box?.clearRefusal();
    if (draft !== undefined) this.box?.setDraft(draft);
  }

  private openReply(): void {
    const { rail } = this;
    this.openBox(
      'Reply',
      (text) => rail.reply(this.id, text),
      () => rail.view.focus(),
    );
    // A note shown from its dot stays while the reply is written.
    rail.pin(this.id, false);
    rail.select(this.id);
  }

  private openBox(
    label: string,
    post: (text: string) => string,
    closed: (kept: string) => void,
    focus?: FocusOptions,
  ): void {
    const { rail } = this;
    this.box ??= new CommentBox(label, rail.options, {
      post,
      close: (kept) => {
        this.dom.classList.remove('rl-note-writing');
        rail.measure();
        closed(kept);
      },
      resize: () => rail.measure(),
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
  startComment(): boolean;
  refreshThread(thread: string): void;
}

/** The rail and its notes, for an editor showing tracked changes. */
export function rail(ctx: ReviewContext, options: RailOptions): RailControl {
  const plugin = ViewPlugin.define((view) => new Rail(view, ctx, options), {
    decorations: (value) => value.decorations,
  });
  const current = () => ctx.editor.view.plugin(plugin);
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
    startComment: () => current()?.startComment() ?? false,
    refreshThread: (thread) => current()?.refreshThread(thread),
  };
}
