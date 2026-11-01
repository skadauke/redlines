// The rail (design §5.7): notes in the page's right margin, one for each comment thread and one for
// each change that has its author's note, such as an agent's reason. A note is level with its
// anchor, pushed down past the note above it. At rest it shows who wrote what; the times and the
// actions appear on hover, or while the note is selected: clicked, or with the cursor in its
// anchor. A selected note's border takes its author's color, and its anchor's tint doubles. The
// rail shows only in Redlines, where it moves the text column left, so that column and rail stay
// centered together.

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
import { authorLine, byline, colorClass } from './people.ts';
import { applyEdit, button, editContext, element, isChange, type ReviewContext } from './shared.ts';
import { ACTIONS_HEIGHT, COLUMN_PADDING, NOTE_GAP, RAIL_WIDTH } from './styles.ts';

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

const noted = new WeakMap<Parsed, Note[]>();

/**
 * A document's notes, in the order of their anchors: one for each open comment thread, and one for
 * each change with a note. A resolved thread is settled and has none. A thread whose anchor is gone
 * is kept (format §4), at the end of the document.
 */
export function notesIn(parsed: Parsed): readonly Note[] {
  const known = noted.get(parsed);
  if (known) return known;
  const anchors = new Map<string, MarkRange>();
  for (const mark of parsed.marks) if (mark.kind === 'cmt') anchors.set(mark.id, mark);
  const end = parsed.ledgerRange?.from ?? parsed.text.length;
  const notes: Note[] = [];
  for (const thread of parsed.ledger.comments) {
    if (thread.resolved) continue;
    const ranges = anchors.get(thread.id)?.segments.map((segment) => segment.content) ?? [];
    notes.push({ id: thread.id, thread, pos: ranges[0]?.from ?? end, ranges, by: thread.by });
  }
  for (const change of parsed.marks) {
    if (!isChange(change) || !change.entry.note) continue;
    const ranges = change.segments.map(({ open, close }) => ({
      from: open.from,
      to: (close ?? open).to,
    }));
    notes.push({ id: change.id, change, pos: ranges[0]?.from ?? 0, ranges, by: change.entry.by });
  }
  // A stable sort: threads before changes at the same place.
  notes.sort((a, b) => a.pos - b.pos);
  noted.set(parsed, notes);
  return notes;
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

interface Layout {
  notes: readonly Note[];
  tops: number[];
  heights: number[];
  left: number;
}

/** How far a note is raised from the top of its anchor's text, so that their first lines align. */
const NOTE_LIFT = 5;

/**
 * The top of the text in the table cell that holds `pos`. The editor draws a table as one widget
 * and can only say where the table starts; the cells carry their source offsets in `data-end`, as
 * the table widget writes them for clicks. Null when `pos` isn't in a table on screen.
 */
function cellTop(view: EditorView, pos: number): number | null {
  for (const table of view.contentDOM.querySelectorAll<HTMLElement>('.rl-table')) {
    const start = view.posAtDOM(table);
    if (pos < start) continue;
    for (const cell of table.querySelectorAll<HTMLElement>('[data-end]')) {
      if (start + Number(cell.dataset['end']) < pos) continue;
      return (cell.querySelector('[data-from]') ?? cell).getBoundingClientRect().top;
    }
  }
  return null;
}

class Rail {
  readonly view: EditorView;
  readonly ctx: ReviewContext;
  readonly dom: HTMLElement;
  notes: readonly Note[] = [];
  decorations: DecorationSet = Decoration.none;
  private readonly views = new Map<string, NoteView>();

  constructor(view: EditorView, ctx: ReviewContext) {
    this.view = view;
    this.ctx = ctx;
    this.dom = element('div', 'rl-rail');
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
  }

  /** Draws the notes of `state`, and which is selected. */
  sync(state: EditorState): void {
    const parsed = state.field(parsedField);
    const notes = state.field(viewModeField) === 'redlines' ? notesIn(parsed) : [];
    const selected = selectedNote(state, notes);
    const ids = new Set(notes.map(({ id }) => id));
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      view.dom.remove();
      this.views.delete(id);
    }
    notes.forEach((note, i) => {
      let view = this.views.get(note.id);
      if (!view) this.views.set(note.id, (view = new NoteView(this, note)));
      view.render(note, parsed, note === selected);
      // Notes are in the document's order for the keyboard and screen readers too.
      const at = this.dom.children[i];
      if (at !== view.dom) this.dom.insertBefore(view.dom, at ?? null);
    });
    this.notes = notes;
    this.decorations = selected
      ? highlight(selected, colorClass(parsed, this.ctx.author.handle, selected.by))
      : Decoration.none;
    this.measure();
  }

  /** Places the notes once the editor has laid out the text. */
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
    const scroller = view.scrollDOM.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const originTop = scroller.top - view.scrollDOM.scrollTop;
    const { documentTop } = view;
    // Off screen, where the text isn't drawn, the editor's estimate of the line's height serves.
    const tops = notes.map(({ pos }) => {
      const block = view.lineBlockAt(pos);
      const top =
        (block.type === BlockType.WidgetRange ? cellTop(view, pos) : null) ??
        view.coordsAtPos(pos, 1)?.top ??
        block.top + documentTop;
      return top - originTop - NOTE_LIFT;
    });
    // Room is kept for a note's actions while they are hidden, so that hovering doesn't move the
    // notes below it.
    const heights = notes.map(({ id }) => {
      const note = this.views.get(id);
      if (!note) return 0;
      return note.dom.offsetHeight + (note.actions.offsetHeight ? 0 : ACTIONS_HEIGHT);
    });
    const left =
      content.right - scroller.left + view.scrollDOM.scrollLeft - COLUMN_PADDING - RAIL_WIDTH;
    return { notes, tops, heights, left };
  }

  private write(layout: Layout | null): void {
    // The notes changed since the read: another measure is coming.
    if (!layout || layout.notes !== this.notes) return;
    this.dom.style.left = `${layout.left}px`;
    const placed = stack(layout.tops, layout.heights, NOTE_GAP);
    layout.notes.forEach(({ id }, i) => {
      const note = this.views.get(id);
      if (note) note.dom.style.top = `${placed[i]}px`;
    });
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
    this.dom.remove();
  }
}

/** One entry of a note: a comment, a reply, or a change's note. */
interface Entry {
  by: Handle;
  at: Time;
  text: string;
}

class NoteView {
  readonly dom: HTMLElement;
  readonly actions: HTMLElement;
  private readonly rail: Rail;
  private readonly id: string;
  private readonly items: HTMLElement;
  private replyBox: ReplyBox | null = null;
  private drawn = '';

  constructor(rail: Rail, note: Note) {
    this.rail = rail;
    this.id = note.id;
    this.dom = element('div', 'rl-note');
    this.items = element('div', 'rl-note-items');
    this.actions = element('div', 'rl-note-actions');
    const { editor } = rail.ctx;
    if (note.thread) {
      this.actions.append(
        button('rl-note-button', 'Reply', () => this.openReply()),
        button('rl-note-button', 'Resolve', () => rail.resolve(note.id)),
      );
    } else {
      this.actions.append(
        button('rl-note-button', 'Accept', () => editor.accept(note.id)),
        button('rl-note-button', 'Reject', () => editor.reject(note.id)),
      );
    }
    this.dom.append(this.items, this.actions);
    // Clicking a note selects it and leaves the keyboard in the document.
    this.dom.addEventListener('mousedown', (event) => {
      if (event.target instanceof Element && event.target.closest('textarea')) return;
      event.preventDefault();
      rail.select(note.id);
    });
  }

  render(note: Note, parsed: Parsed, selected: boolean): void {
    const me = this.rail.ctx.author;
    const color = (handle: Handle) => colorClass(parsed, me.handle, handle);
    this.dom.className = `rl-note ${color(note.by)}`;
    this.dom.classList.toggle('rl-note-selected', selected);
    this.dom.classList.toggle('rl-note-replying', !!this.replyBox && !this.replyBox.dom.hidden);
    const entries: Entry[] = note.thread
      ? [note.thread, ...note.thread.replies]
      : [{ by: note.by, at: note.change?.entry.at ?? '', text: note.change?.entry.note ?? '' }];
    const items = entries.map(({ by, at, text }) => ({
      who: byline(parsed, by, me),
      color: color(by),
      at,
      text,
    }));
    const drawn = JSON.stringify(items);
    if (drawn === this.drawn) return;
    this.drawn = drawn;
    this.items.replaceChildren(
      ...items.map(({ who, color, at, text }) => {
        const item = element('div', `rl-note-item ${color}`);
        item.append(authorLine('rl-note', who, at), element('div', 'rl-note-text', text));
        return item;
      }),
    );
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
    if (!this.replyBox.dom.isConnected) this.dom.insertBefore(this.replyBox.dom, this.actions);
    this.dom.classList.add('rl-note-replying');
    this.replyBox.open();
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
    this.error = element('div', 'rl-note-error');
    this.error.hidden = true;
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
    EditorView.editorAttributes.of((view) =>
      view.plugin(plugin)?.notes.length ? { class: 'rl-has-rail' } : null,
    ),
  ];
}
