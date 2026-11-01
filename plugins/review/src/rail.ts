// The rail (design §5.7): notes in the page's right margin, one for each comment thread and one for
// each change that has its author's note, such as an agent's reason. A note is level with its
// anchor, pushed down past the note above it. At rest it shows who wrote what; the times and the
// actions appear on hover, or while the note is selected: clicked, or with the cursor in its
// anchor. A selected note's border takes its author's color, and its anchor's tint doubles. The
// rail shows only in Redlines, where it moves the text column left, so that column and rail stay
// centered together. In a narrow editor the rail shrinks to a dot in the author's color level with
// each anchor, and the column takes its whole width back; hovering or clicking a dot shows its
// note over the page.

import { type EditorState, type Extension, StateEffect, StateField } from '@codemirror/state';
import {
  BlockType,
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { parsedField, viewModeField } from '@redlines/editor';
import {
  EditError,
  type Handle,
  type MarkRange,
  type Parsed,
  type Range,
  reply,
  resolve,
  type Thread,
  type Time,
} from '@redlines/format';
import { icon, type IconName } from './icons.ts';
import { authorLine, byline, colorClass } from './people.ts';
import {
  applyEdit,
  attempt,
  button,
  changesOf,
  editContext,
  element,
  errorLine,
  insertedText,
  openerEnd,
  type ReviewContext,
  segmentSpan,
  shorten,
  visibleStart,
} from './shared.ts';
import { COLUMN_PADDING, NOTE_GAP, RAIL_WIDTH } from './styles.ts';

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

  constructor(view: EditorView, ctx: ReviewContext) {
    this.view = view;
    this.ctx = ctx;
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
      state.field(clickedNote) !== startState.field(clickedNote)
    ) {
      this.sync(state);
    } else if (update.geometryChanged || update.viewportChanged || update.heightChanged) {
      this.measure();
    }
    // A note pinned from its dot closes when the selection moves, unless a reply is being written.
    const { popover } = this;
    if (update.selectionSet && popover?.pinned && !this.views.get(popover.id)?.replying) {
      this.setPopover(null);
    }
  }

  /** Draws the notes of `state`, and which is selected. */
  sync(state: EditorState): void {
    const parsed = state.field(parsedField);
    const shown = state.field(viewModeField) === 'redlines';
    const notes = shown ? notesIn(parsed, changesOf(this.ctx)) : [];
    const selected = selectedNote(state, notes);
    const ids = new Set(notes.map(({ id }) => id));
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      view.remove();
      this.views.delete(id);
    }
    if (this.popover && !ids.has(this.popover.id)) this.popover = null;
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
    if (!notes.length) return null;
    // An editor that isn't laid out has no width, and keeps what it has.
    const width = view.scrollDOM.clientWidth;
    const compact = width > 0 ? width < COMPACT_BELOW : this.compact;
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
  }

  /** Shrinks the rail to dots, or brings it back; the editor then redraws the column's width. */
  private setCompact(compact: boolean): void {
    this.compact = compact;
    this.dom.classList.toggle('rl-rail-compact', compact);
    this.setPopover(null);
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
    this.view.dispatch({ effects: selectNote.of(id) });
  }

  /** Posts a reply to a thread as you (format §4). */
  reply(id: string, text: string): void {
    const doc = this.view.state.doc.toString();
    applyEdit(this.view, reply(doc, id, text, editContext(this.ctx.author)), 'review.reply');
  }

  resolve(id: string): void {
    const doc = this.view.state.doc.toString();
    applyEdit(this.view, resolve(doc, id, editContext(this.ctx.author)), 'review.resolve');
  }

  destroy(): void {
    clearTimeout(this.closing);
    this.dom.remove();
  }
}

/** One entry of a note: a comment, a reply, or a change's note. */
interface Entry {
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
  const old = change.kind === 'ins' || change.kind === 'split' ? '' : (change.payload ?? '');
  const added =
    change.kind === 'del' ? '' : change.kind === 'split' ? '¶' : insertedText(parsed, change);
  return { old: shorten(old) || (old ? '¶' : ''), added: shorten(added) || added };
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
  private replyBox: ReplyBox | null = null;
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
    } else {
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

  get replying(): boolean {
    return !!this.replyBox && !this.replyBox.dom.hidden;
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
    this.dom.classList.toggle('rl-note-replying', this.replying);
    this.dot.className = `rl-note-dot ${color(note.by)}`;
    this.dot.classList.toggle('rl-note-dot-selected', selected);
    this.setOpen(open);
    const entries: Entry[] = note.thread
      ? [note.thread, ...note.thread.replies]
      : [{ by: note.by, at: note.change?.entry.at ?? '', text: note.change?.entry.note ?? '' }];
    const items = entries.map(({ by, at, text }) => ({
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
      ...items.map(({ who, color, at, text }) => {
        const item = element('div', `rl-note-item ${color}`);
        item.append(authorLine('rl-note', who, at, true));
        if (change) item.append(changeLine(change));
        item.append(element('div', 'rl-note-text', text));
        return item;
      }),
    );
    this.items.querySelector('.rl-note-head')?.append(this.actions);
  }

  /** Shows the note over the page from its dot, or puts it away. */
  setOpen(open: boolean): void {
    this.dom.classList.toggle('rl-note-open', open);
    this.dot.setAttribute('aria-expanded', String(open));
  }

  remove(): void {
    this.dom.remove();
    this.dot.remove();
  }

  private openReply(): void {
    this.replyBox ??= new ReplyBox({
      post: (text) => this.rail.reply(this.id, text),
      close: () => {
        this.dom.classList.remove('rl-note-replying');
        this.rail.measure();
        this.rail.view.focus();
      },
      resize: () => this.rail.measure(),
    });
    if (!this.replyBox.dom.isConnected) this.items.after(this.replyBox.dom);
    this.dom.classList.add('rl-note-replying');
    this.replyBox.open();
    // A note shown from its dot stays while the reply is written.
    this.rail.pin(this.id, false);
    this.rail.select(this.id);
  }
}

interface ReplyActions {
  /** Posts the reply. Throws an `EditError` when it can't. */
  post(text: string): void;
  /** Called after the box closes. */
  close(): void;
  /** Called when the box changes size. */
  resize(): void;
}

/** The box a reply is written in. It keeps its text when closed, until the reply is posted. */
class ReplyBox {
  readonly dom: HTMLElement;
  private readonly field: HTMLTextAreaElement;
  private readonly postButton: HTMLButtonElement;
  private readonly error: HTMLElement;
  private readonly actions: ReplyActions;

  constructor(actions: ReplyActions) {
    this.actions = actions;
    this.dom = element('div', 'rl-note-reply');
    this.field = element('textarea', '');
    this.field.rows = 2;
    this.field.placeholder = 'Reply';
    this.field.setAttribute('aria-label', 'Reply');
    this.error = errorLine('rl-note-error');
    this.postButton = button('rl-note-button', 'Post', () => this.post());
    this.postButton.title = 'Post (⌘↩)';
    this.postButton.disabled = true;
    const row = element('div', 'rl-note-reply-row');
    row.append(
      button('rl-note-button', 'Cancel', () => this.close()),
      this.postButton,
    );
    this.dom.append(this.field, this.error, row);

    this.field.addEventListener('input', () => {
      this.postButton.disabled = !this.field.value.trim();
      this.error.hidden = true;
      this.field.style.height = 'auto';
      this.field.style.height = `${this.field.scrollHeight}px`;
      actions.resize();
    });
    this.field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.post();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    });
  }

  open(): void {
    this.dom.hidden = false;
    this.field.focus();
    this.actions.resize();
  }

  private close(): void {
    this.dom.hidden = true;
    this.actions.close();
  }

  private post(): void {
    const text = this.field.value.trim();
    if (!text) return;
    try {
      this.actions.post(text);
    } catch (error) {
      // Such as a ledger that can't be read: the draft stays.
      if (!(error instanceof EditError)) throw error;
      this.error.textContent = error.message;
      this.error.hidden = false;
      this.actions.resize();
      return;
    }
    this.field.value = '';
    this.field.style.height = '';
    this.postButton.disabled = true;
    this.close();
  }
}

/** The rail and its notes, for an editor showing tracked changes. */
export function rail(ctx: ReviewContext): Extension {
  const plugin = ViewPlugin.define((view) => new Rail(view, ctx), {
    decorations: (value) => value.decorations,
  });
  return [
    clickedNote,
    plugin,
    // The column makes room for the full rail; the dots of a shrunk rail need none.
    EditorView.editorAttributes.of((view) => {
      const value = view.plugin(plugin);
      return value?.notes.length && !value.compact ? { class: 'rl-has-rail' } : null;
    }),
  ];
}
