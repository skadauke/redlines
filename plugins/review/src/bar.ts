// Review Changes (design §5.6): a panel that starts at once on the first change and sits beside it,
// in the margin where there is room, else below or above it, never over it. It can be dragged by
// its title, and then stays where it was put. It names the change (who, when, what), and has Accept
// (A) and Reject (R), which decide the change and move on to the next; Comment (C), a field to ask
// about the change; and Previous (←) and Next (→). It takes the keyboard when it opens and after
// each change; a click into the document gives the keyboard back to the document. Esc or its close
// button closes it. Moving selects the change's mark and scrolls it into view.

import {
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  currentChange,
  parsedField,
  setCurrentChange,
  setViewModeEffect,
  viewModeField,
} from '@redlines/editor';
import { addComment, EditError, type MarkRange } from '@redlines/format';
import { authorLine, byline, colorClass } from './people.ts';
import { icon, type IconName } from './icons.ts';
import {
  applyEdit,
  attempt,
  button,
  changesOf,
  decideSuggestion,
  describeChanges,
  editContext,
  element,
  errorLine,
  flash,
  type ReviewContext,
  segmentSpan,
  spanOf,
  suggestionIn,
  suggestionsOf,
  visibleSpace,
} from './shared.ts';

/**
 * Gives the keyboard to the panel, and takes the page's own highlight of the selection that was in
 * the document: the review leaves nothing selected, and the browser keeps drawing the old selection
 * while the document is out of focus.
 */
/** Whether a key is part of an input method's composition (Safari ends it before the key). */
function composing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

function takeFocus(panel: HTMLElement): void {
  panel.focus({ preventScroll: true });
  panel.ownerDocument.getSelection()?.removeAllRanges();
}

/** The panel's width, and the room kept between it and the change, and the window's edges. */
const PANEL_WIDTH = 304;
/** The narrowest it is made to fit the margin; with less room it goes below or above the change. */
const PANEL_MIN_WIDTH = 240;
const PANEL_GAP = 16;
const PANEL_MARGIN = 12;

const setBarOpen = StateEffect.define<boolean>();

const barOpen = StateField.define<boolean>({
  create: () => false,
  update(open, tr) {
    for (const effect of tr.effects) if (effect.is(setBarOpen)) open = effect.value;
    // A person who chooses to read has stopped deciding: showing the simple look closes the bar, so
    // that it never steps through changes the page doesn't show. In the app a click on a change bar
    // or the View menu's Simple Look switch shows it; while the bar is open, that click opens a
    // card instead.
    const simple = (state: EditorState) => state.field(viewModeField) === 'simple';
    return open && simple(tr.state) && !simple(tr.startState) ? false : open;
  },
});

/** Whether the review bar is open in `state`. */
export function isBarOpen(state: EditorState): boolean {
  return state.field(barOpen, false) ?? false;
}

const moveTo = StateEffect.define<string>();

/** The change the bar last moved to, by id, until the selection moves elsewhere. */
const movedTo = StateField.define<string | null>({
  create: () => null,
  update(id, tr) {
    for (const effect of tr.effects) if (effect.is(moveTo)) return effect.value;
    return tr.selection ? null : id;
  },
});

/**
 * The index of the current change in `changes`: the one the bar last moved to, while the selection
 * stays on it; else the change that the selection covers exactly; else the innermost change around
 * the selection. Changes inside others, and interleaved ones (format §3.6), are told apart by
 * their segments. -1 when there is none.
 */
function currentIndex(state: EditorState, changes: readonly MarkRange[]): number {
  const id = state.field(movedTo, false);
  const moved = id ? changes.findIndex((change) => change.id === id) : -1;
  if (moved >= 0) return moved;
  const { main } = state.selection;
  const exact = changes.findIndex((change) => {
    const { from, to } = spanOf(change);
    return from === main.from && to === main.to;
  });
  if (exact >= 0) return exact;
  // A caret at an edge that two changes share (a deletion then an insertion) is on the one that
  // starts there, which is where the review put it, not on the one that ends there.
  if (main.empty) {
    const starting = changes.findIndex((change) =>
      change.segments.some((segment) => segmentSpan(segment).from === main.head),
    );
    if (starting >= 0) return starting;
  }
  let found = -1;
  let size = Infinity;
  changes.forEach((change, index) => {
    for (const segment of change.segments) {
      const { from, to } = segmentSpan(segment);
      if (from <= main.from && main.to <= to && to - from < size) {
        found = index;
        size = to - from;
      }
    }
  });
  return found;
}

/**
 * The index of the current suggestion in `groups`, which are `changes` split into suggestions: the
 * one that holds the current change (see `currentIndex`). -1 when there is none.
 */
function currentGroup(
  state: EditorState,
  changes: readonly MarkRange[],
  groups: readonly (readonly MarkRange[])[],
): number {
  const change = changes[currentIndex(state, changes)];
  return change ? groups.findIndex((marks) => marks.includes(change)) : -1;
}

/**
 * What opens the bar. The changes are shown while you review them: a document shown Clean or Raw
 * switches to Redlines.
 */
function opening(view: EditorView, ctx: ReviewContext): StateEffect<unknown>[] {
  const effects: StateEffect<unknown>[] = [setBarOpen.of(true)];
  if (view.state.field(viewModeField) !== 'redlines' && ctx.editor.getUiState().hasRedlines) {
    effects.push(setViewModeEffect.of('redlines'));
  }
  return effects;
}

export function openBar(view: EditorView, ctx: ReviewContext): void {
  view.dispatch({ effects: opening(view, ctx) });
}

export function closeBar(view: EditorView): void {
  if (isBarOpen(view.state)) view.dispatch({ effects: setBarOpen.of(false) });
}

/**
 * Moves to a change: puts the caret at its start, scrolled into view, marks the change as the
 * current one (its text and its bars, which the theme draws apart from a selection), and opens the
 * bar. A suggestion of several marks is marked whole. Nothing stays selected: the person's own
 * selection, if there was one, goes.
 */
function select(view: EditorView, ctx: ReviewContext, change: MarkRange): void {
  const marks = suggestionIn(ctx, change.id);
  const first = marks[0] ?? change;
  const ranges = marks.flatMap((mark) => mark.segments.map(segmentSpan));
  const caret = EditorSelection.cursor(spanOf(first).from);
  view.dispatch({
    selection: caret,
    effects: [
      ...opening(view, ctx),
      moveTo.of(change.id),
      setCurrentChange.of({ ids: marks.map((mark) => mark.id), ranges }),
      EditorView.scrollIntoView(caret, { y: 'center' }),
    ],
    userEvent: 'select.review',
  });
  // The panel takes the keyboard after each change, so that A, R, C and the arrows reach it.
  const panel = view.dom.querySelector<HTMLElement>('.rl-review-panel');
  if (panel) takeFocus(panel);
  else view.focus();
}

/** The current change's text, drawn as the review's own mark (`rl-review-current`). */
const currentMark = Decoration.mark({ class: 'rl-review-current' });
const currentDecorations = EditorView.decorations.compute([currentChange, barOpen], (state) => {
  const current = state.field(currentChange);
  if (!current || !isBarOpen(state)) return Decoration.none;
  return Decoration.set(
    current.ranges
      .filter(({ from, to }) => from < to)
      .map(({ from, to }) => currentMark.range(from, to)),
    true,
  );
});

/** The current change goes when the bar closes, however it closes. */
const clearOnClose = EditorState.transactionExtender.of((tr) =>
  isBarOpen(tr.startState) && !isBarOpen(tr.state) && tr.startState.field(currentChange, false)
    ? { effects: setCurrentChange.of(null) }
    : null,
);

/**
 * What Review Changes starts with: the document's first change, wherever the caret is. With a
 * selection, the first change the selection touches, and when it touches none, the first change
 * after it, round to the top. Either way the selection goes, and the change is marked. With no
 * changes the bar just opens (the command is disabled then).
 */
export function start(view: EditorView, ctx: ReviewContext): void {
  const groups = suggestionsOf(ctx);
  const { from, to, empty } = view.state.selection.main;
  const spans = (marks: readonly MarkRange[]) =>
    marks.flatMap((mark) => mark.segments.map(segmentSpan));
  let target = groups[0];
  if (!empty) {
    target =
      groups.find((marks) => spans(marks).some((at) => at.from < to && at.to > from)) ??
      groups.find((marks) => marks.some((mark) => spanOf(mark).from >= to)) ??
      groups[0];
  }
  const change = target?.[0];
  if (change) select(view, ctx, change);
  else openBar(view, ctx);
}

/**
 * Moves to the next change (`dir` 1) or the previous one (-1), in the document order of the
 * changes' first segments, a suggestion of several marks counting as one, and opens the bar. From
 * the current change, the one after or before it, round to the other end; from elsewhere, the
 * first that starts after the cursor or the last that starts before it.
 */
export function move(view: EditorView, ctx: ReviewContext, dir: 1 | -1): void {
  const groups = suggestionsOf(ctx);
  const current = currentGroup(view.state, changesOf(ctx), groups);
  const { head } = view.state.selection.main;
  const n = groups.length;
  const starts = (marks: readonly MarkRange[]) => (marks[0] ? spanOf(marks[0]).from : 0);
  let index: number;
  if (current >= 0) index = (current + dir + n) % n;
  else if (dir > 0) index = groups.findIndex((marks) => starts(marks) >= head);
  else index = groups.findLastIndex((marks) => starts(marks) < head);
  if (index < 0) index = dir > 0 ? 0 : n - 1;
  const change = groups[index]?.[0];
  if (change) select(view, ctx, change);
  else openBar(view, ctx);
}

/**
 * Decides the current change, all the marks of its suggestion, then moves on to the first change
 * after it that is still there, round to the first. A refused decision changes nothing, and its
 * message shows in `line`.
 */
function decide(
  view: EditorView,
  ctx: ReviewContext,
  how: 'accept' | 'reject',
  line: HTMLElement,
): boolean {
  const groups = suggestionsOf(ctx);
  const current = currentGroup(view.state, changesOf(ctx), groups);
  const change = groups[current]?.[0];
  if (!change) return false;
  const ran = attempt(line, () => decideSuggestion(ctx, how, change.id));
  if (!ran) return false;
  const remaining = new Map(changesOf(ctx).map((left) => [left.id, left]));
  const after = [...groups.slice(current + 1), ...groups.slice(0, current)];
  const next = after
    .map((marks) => marks.map(({ id }) => remaining.get(id)).find((left) => left !== undefined))
    .find((left) => left !== undefined);
  if (next) select(view, ctx, next);
  return true;
}

/** A button with an icon alone, explained by a hint on hover: its name and shortcut. */
function iconButton(name: IconName, label: string, keys: string, run: () => void) {
  const el = button('rl-bar-icon', label, run, icon(name));
  const hint = element('span', 'rl-hint', label);
  hint.setAttribute('aria-hidden', 'true');
  hint.append(element('span', 'rl-hint-keys', keys));
  el.append(hint);
  return el;
}

/** A button with an icon, a label and the letter that presses it, which the panel's keys use. */
function keyButton(name: IconName, label: string, key: string, run: () => void, named = label) {
  const el = button('rl-bar-text', named, run, icon(name, 15));
  el.append(element('span', 'rl-bar-label', label), element('span', 'rl-bar-key', key));
  el.setAttribute('aria-keyshortcuts', key);
  return el;
}

/** What the panel shows that changes with the document and the selection. */
interface Controls {
  count: HTMLElement;
  body: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  accept: HTMLButtonElement;
  reject: HTMLButtonElement;
  comment: HTMLButtonElement;
  form: HTMLElement;
  field: HTMLTextAreaElement;
  actions: HTMLElement;
  nav: HTMLElement;
}

/** Where the panel goes: the box of the change, the box of the text column, the window. */
export interface PanelSpace {
  change: { left: number; right: number; top: number; bottom: number };
  column: { left: number; right: number };
  visible: { left: number; top: number; right: number; bottom: number };
  /** The margin notes the panel must not cover, where they are drawn. */
  notes?: readonly { top: number; bottom: number }[];
}

/**
 * Where the panel's top left goes, in the window's own coordinates: beside the change, in the margin
 * to the right of the text column, level with the change's top; where the margin has no room for
 * it, below the change, or above it when it doesn't fit below. It is never over the change, and
 * never outside `visible`.
 */
export function panelPlace(
  space: PanelSpace,
  size: { width: number; height: number },
): { left: number; top: number; width: number } {
  const { change, column, visible } = space;
  const clamp = (value: number, low: number, high: number) =>
    Math.max(low, Math.min(value, Math.max(low, high)));
  const topLimit = visible.top + PANEL_MARGIN;
  const bottomLimit = visible.bottom - PANEL_MARGIN;
  // In the margin right of the text, as wide as the margin lets it be, level with the change; or, where
  // a note is there, in the nearest place along the margin that no note is in.
  const room = visible.right - PANEL_MARGIN - (column.right + PANEL_GAP);
  if (room >= PANEL_MIN_WIDTH) {
    const width = Math.min(size.width, room);
    const notes = space.notes ?? [];
    const wanted = clamp(change.top - 6, topLimit, bottomLimit - size.height);
    const free = (top: number) =>
      top >= topLimit &&
      top + size.height <= bottomLimit &&
      notes.every((note) => top + size.height + 6 <= note.top || top >= note.bottom + 6);
    const candidates = [
      wanted,
      ...notes.flatMap((note) => [note.bottom + 8, note.top - size.height - 8]),
    ].toSorted((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted));
    const top = candidates.find(free);
    if (top !== undefined) return { left: column.right + PANEL_GAP, top, width };
  }
  const width = Math.min(size.width, visible.right - visible.left - 2 * PANEL_MARGIN);
  const left = clamp(
    change.left,
    visible.left + PANEL_MARGIN,
    visible.right - PANEL_MARGIN - width,
  );
  const below = change.bottom + 10;
  if (below + size.height <= bottomLimit) return { left, top: below, width };
  const above = change.top - size.height - 10;
  if (above >= topLimit) return { left, top: above, width };
  // No room above or below: below, as far up as the window lets it, whatever it covers.
  return { left, top: clamp(below, topLimit, bottomLimit - size.height), width };
}

class Panel {
  private readonly view: EditorView;
  private readonly ctx: ReviewContext;
  private readonly changed: () => void;
  private panel: HTMLElement | null = null;
  private controls: Controls | null = null;
  private error: HTMLElement | null = null;
  /** Where a drag put the panel; null while it goes by the change. */
  private dragged: { left: number; top: number } | null = null;
  /** What the body shows, so that it is drawn again only when it changes. */
  private shown = '';
  private onScroll: (() => void) | null = null;

  constructor(view: EditorView, ctx: ReviewContext, changed: () => void) {
    this.view = view;
    this.ctx = ctx;
    this.changed = changed;
    if (isBarOpen(view.state)) this.show();
  }

  update(update: ViewUpdate): void {
    const open = isBarOpen(update.state);
    if (open !== isBarOpen(update.startState)) {
      if (open) this.show();
      else {
        this.hide();
        // Closed from outside the panel, as when the simple look is shown: the host hears of it too.
        this.changed();
      }
    } else if (this.panel) {
      if (update.transactions.length) this.refresh(update.state);
      if (update.geometryChanged || update.transactions.length) this.place();
    }
  }

  private close(): void {
    closeBar(this.view);
    this.changed();
    this.view.focus();
  }

  private show(): void {
    const { view, ctx } = this;
    const error = errorLine('rl-bar-error');
    const field = element('textarea', 'rl-rp-field');
    field.rows = 2;
    field.placeholder = 'Ask about this change';
    field.setAttribute('aria-label', 'Comment');
    const form = element('div', 'rl-rp-form');
    form.hidden = true;
    form.append(field);
    const count = element('span', 'rl-bar-count');
    count.setAttribute('aria-live', 'polite');
    const top = element('div', 'rl-rp-top');
    top.title = 'Drag to move';
    top.append(
      element('b', 'rl-rp-title', 'Review Changes'),
      count,
      iconButton('close', 'Close', 'Esc', () => this.close()),
    );
    const body = element('div', 'rl-rp-body');
    // What the next change is, who made it and what it did, is read out when it comes up.
    body.setAttribute('aria-live', 'polite');
    const controls: Controls = {
      count,
      body,
      form,
      field,
      previous: keyButton(
        'previous',
        'Previous',
        '←',
        () => move(view, ctx, -1),
        'Previous change',
      ),
      next: keyButton('next', 'Next', '→', () => move(view, ctx, 1), 'Next change'),
      accept: keyButton('accept', 'Accept', 'A', () => this.decide('accept')),
      reject: keyButton('reject', 'Reject', 'R', () => this.decide('reject')),
      comment: keyButton('reply', 'Comment', 'C', () => this.comment()),
      actions: element('div', 'rl-rp-actions'),
      nav: element('div', 'rl-rp-nav'),
    };
    controls.actions.append(controls.accept, controls.reject, controls.comment);
    controls.nav.append(controls.previous, controls.next);
    const panel = element('div', 'rl-review-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Review changes');
    panel.tabIndex = -1;
    panel.append(top, body, form, controls.actions, controls.nav, error);
    panel.addEventListener('keydown', (event) => this.keydown(event));
    this.drag(top);
    view.dom.append(panel);
    this.panel = panel;
    this.controls = controls;
    this.error = error;
    this.shown = '';
    this.refresh(view.state);
    this.place();
    // Scrolling the page moves the change from under the panel's place.
    this.onScroll = () => this.place();
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
    takeFocus(panel);
  }

  private hide(): void {
    if (this.onScroll) {
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
      window.removeEventListener('scroll', this.onScroll, { capture: true });
    }
    this.onScroll = null;
    this.panel?.remove();
    this.panel = this.controls = this.error = null;
    this.dragged = null;
    this.shown = '';
  }

  /** The panel's keys: A, R and C, and the arrows. In the comment field, Return posts and Esc leaves. */
  private keydown(event: KeyboardEvent): void {
    const { controls, panel } = this;
    if (!controls || !panel) return;
    if (event.target === controls.field) {
      if (event.key === 'Escape' && !composing(event)) {
        event.preventDefault();
        event.stopPropagation();
        this.closeForm();
        takeFocus(panel);
      } else if (event.key === 'Enter' && !event.shiftKey && !composing(event)) {
        event.preventDefault();
        this.comment();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || composing(event)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const target =
      { a: controls.accept, r: controls.reject, c: controls.comment }[key] ??
      (key === 'ArrowRight' ? controls.next : key === 'ArrowLeft' ? controls.previous : null);
    if (!target || target.disabled) return;
    // A key held down decides one change, not the rest of the document.
    if (
      event.repeat &&
      (target === controls.accept || target === controls.reject || target === controls.comment)
    ) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    target.click();
  }

  private decide(how: 'accept' | 'reject'): void {
    // The comment being written goes only when the decision is made and the panel moves on (a
    // refused decision leaves the change, and the words, where they are).
    if (this.error) decide(this.view, this.ctx, how, this.error);
    if (this.panel) takeFocus(this.panel);
  }

  private closeForm(): void {
    if (!this.controls) return;
    this.controls.form.hidden = true;
    this.controls.field.value = '';
  }

  /** Comment: opens the field; with words in it, posts them as a comment on the change. */
  private comment(): void {
    const { controls, view, ctx, error } = this;
    if (!controls || !error) return;
    const groups = suggestionsOf(ctx);
    const current = currentGroup(view.state, changesOf(ctx), groups);
    const change = groups[current]?.[0];
    if (!change) return;
    if (controls.form.hidden) {
      controls.form.hidden = false;
      controls.field.focus();
      this.place();
      return;
    }
    const text = controls.field.value.trim();
    if (!text) {
      controls.field.focus();
      return;
    }
    try {
      const range = spanOf(change);
      const { changes } = addComment(
        view.state.doc.toString(),
        range,
        text,
        editContext(ctx.author),
      );
      applyEdit(view, changes, 'review.comment');
    } catch (failure) {
      if (!(failure instanceof EditError || failure instanceof RangeError)) throw failure;
      flash(error, failure.message);
      return;
    }
    this.closeForm();
    if (this.panel) takeFocus(this.panel);
  }

  /** Brings the count, the change's description and the buttons up to date. */
  private refresh(state: EditorState): void {
    if (!this.controls) return;
    const { count, body, previous, next, accept, reject, comment, actions, nav } = this.controls;
    const groups = suggestionsOf(this.ctx);
    const changes = changesOf(this.ctx);
    const current = currentGroup(state, changes, groups);
    const n = groups.length;
    count.textContent = !n
      ? 'No changes'
      : current >= 0
        ? `Change ${current + 1} of ${n}`
        : `${n} ${n === 1 ? 'change' : 'changes'}`;
    previous.disabled = next.disabled = !n;
    accept.disabled = reject.disabled = comment.disabled = current < 0;
    actions.hidden = nav.hidden = !n;
    const marks = groups[current];
    const first = marks?.[0];
    const key = !n
      ? 'none'
      : first
        ? `${marks.map((mark) => mark.id).join(',')}|${current}|${n}`
        : `unplaced|${n}`;
    if (key === this.shown) return;
    // A different change: the comment being written was about the last one.
    if (this.shown !== '') this.closeForm();
    this.shown = key;
    body.replaceChildren();
    if (!n) {
      body.append(element('div', 'rl-rp-what', 'No more changes to review.'));
      body.append(button('rl-bar-text rl-rp-done', 'Done', () => this.close()));
      return;
    }
    if (!first || !marks) {
      body.append(element('div', 'rl-rp-what', `${n} ${n === 1 ? 'change' : 'changes'} to review`));
      return;
    }
    const parsed = state.field(parsedField);
    const head = authorLine(
      'rl-rp',
      byline(parsed, first.entry.by, this.ctx.author),
      first.entry.at,
    );
    head.classList.add(colorClass(state, first.entry.by));
    const what = describeChanges(parsed, marks);
    body.append(head, element('div', 'rl-rp-what', what));
  }

  /** Puts the panel beside the current change (or where a drag left it). */
  private place(): void {
    const panel = this.panel;
    if (!panel) return;
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const win = view.dom.ownerDocument.defaultView ?? window;
        // The part of the window where the editor can be seen, and inside the editor's own box: an
        // editor that is a sheet in a page keeps its panel on the sheet.
        const seen = visibleSpace(view);
        const box = view.dom.getBoundingClientRect();
        const visible = {
          left: Math.max(seen.left, box.left),
          top: Math.max(seen.top, box.top),
          right: Math.min(seen.right, box.right),
          bottom: Math.min(seen.bottom, box.bottom),
        };
        const content = view.contentDOM.getBoundingClientRect();
        // The text's own edges, inside the padding that holds the margin notes.
        const style = win.getComputedStyle(view.contentDOM);
        const text = {
          left: content.left + (Number.parseFloat(style.paddingLeft) || 0),
          right: content.right - (Number.parseFloat(style.paddingRight) || 0),
        };
        const current = view.state.field(currentChange, false);
        const ranges = (current?.ranges ?? []).filter(({ from, to }) => from <= to);
        const first = ranges[0];
        const last = ranges.at(-1);
        const start = first ? view.coordsAtPos(first.from, 1) : null;
        const end = last ? view.coordsAtPos(last.to, -1) : null;
        const a = start ?? end;
        const z = end ?? start;
        const change =
          a && z
            ? {
                left: Math.min(a.left, z.left),
                right: Math.max(a.right, z.right),
                top: Math.min(a.top, z.top),
                bottom: Math.max(a.bottom, z.bottom),
              }
            : null;
        const notes = [...view.dom.querySelectorAll('.rl-rail .rl-note')].map((note) => {
          const r = note.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        });
        return {
          visible,
          notes,
          column: text,
          change,
          width: panel.offsetWidth || PANEL_WIDTH,
          height: panel.offsetHeight,
          win: { width: win.innerWidth, height: win.innerHeight },
        };
      },
      write: ({ visible, notes, column, change, width, height, win }) => {
        if (!this.panel) return;
        // An editor scrolled out of the page takes its panel with it.
        const gone = visible.right <= visible.left || visible.bottom <= visible.top;
        this.panel.style.visibility = gone ? 'hidden' : '';
        if (gone) return;
        let at: { left: number; top: number; width?: number } | null = this.dragged;
        if (!at) {
          // A change off the screen leaves the panel where it is, kept on the screen.
          const off = !change || change.bottom < visible.top || change.top > visible.bottom;
          const space: PanelSpace = {
            change: change ?? {
              left: column.left,
              right: column.right,
              top: visible.top + 80,
              bottom: visible.top + 100,
            },
            column,
            visible,
            notes,
          };
          at = panelPlace(space, { width: PANEL_WIDTH, height });
          if (off && change) {
            at = {
              left: at.left,
              top: Math.max(
                visible.top + PANEL_MARGIN,
                Math.min(at.top, visible.bottom - height - PANEL_MARGIN),
              ),
            };
          }
        }
        const left = Math.max(0, Math.min(at.left, win.width - width));
        const top = Math.max(0, Math.min(at.top, win.height - height));
        this.panel.style.left = `${Math.round(left)}px`;
        this.panel.style.top = `${Math.round(top)}px`;
        if (at.width !== undefined) this.panel.style.width = `${Math.round(at.width)}px`;
      },
    });
  }

  /** The title is the handle: dragging it moves the panel, and it stays where it was put. */
  private drag(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (event) => {
      const panel = this.panel;
      if (!panel || event.button !== 0 || (event.target as Element).closest('button')) return;
      event.preventDefault();
      const box = panel.getBoundingClientRect();
      const grab = { x: event.clientX - box.left, y: event.clientY - box.top };
      const win = this.view.dom.ownerDocument.defaultView ?? window;
      panel.classList.add('rl-review-panel-dragging');
      const move = (e: PointerEvent) => {
        const left = Math.max(0, Math.min(e.clientX - grab.x, win.innerWidth - panel.offsetWidth));
        const top = Math.max(0, Math.min(e.clientY - grab.y, win.innerHeight - panel.offsetHeight));
        this.dragged = { left, top };
        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
      };
      const end = () => {
        panel.classList.remove('rl-review-panel-dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
      };
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // (no capture, as in a test: the moves still reach the handle)
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  }

  destroy(): void {
    this.hide();
  }
}
/**
 * What a click on a change bar does while the review bar is open (the core's `barClickHandlers`):
 * the card of the change on that line opens, in place of the switch between Redlines' two looks,
 * which the review bar would leave to the person who has stopped deciding. Nothing otherwise.
 * `pos` is where the bar's line starts, and `piece` the part of a line that wraps which the piece
 * of the bar that was clicked stands beside: the change there is the one.
 */
export function barClickHandler(
  ctx: ReviewContext,
  pin: (view: EditorView, id: string) => void,
): (view: EditorView, pos: number, mark?: string, span?: { from: number; to: number }) => boolean {
  return (view, pos, mark, piece) => {
    if (!isBarOpen(view.state)) return false;
    // The bar of a struck block is its change's own: found by its id, not by its place.
    if (mark !== undefined) {
      if (changesOf(ctx).some((change) => change.id === mark)) pin(view, mark);
      return true;
    }
    const line = view.state.doc.lineAt(pos);
    const changes = changesOf(ctx);
    const onLine = (change: MarkRange) =>
      change.segments.some((segment) => {
        const at = segmentSpan(segment);
        return at.from <= line.to && at.to >= line.from;
      });
    // The line's own change first. Only when it has none, a change on a hidden line just above it:
    // a deleted block's marker is, and the bar is on the line below.
    const above = (change: MarkRange) =>
      change.segments.some((segment) => {
        const at = segmentSpan(segment);
        return at.to < line.from && !view.state.sliceDoc(at.to, line.from).trim();
      });
    // The piece of the bar beside some screen lines of a paragraph that wraps: the change there.
    const beside = (change: MarkRange) =>
      !!piece &&
      change.segments.some((segment) => {
        const at = segmentSpan(segment);
        return at.from < piece.to && at.to > piece.from;
      });
    // Or, when the piece is beside plain text (a deletion's struck words wrap onto screen lines
    // after the one it stands at), the last change before it on the line.
    const before = (change: MarkRange) =>
      !!piece &&
      change.segments.some((segment) => {
        const at = segmentSpan(segment);
        return at.to <= piece.from && at.to >= line.from;
      });
    const found =
      changes.find(beside) ??
      changes.findLast(before) ??
      changes.find(onLine) ??
      changes.findLast(above);
    if (found) pin(view, found.id);
    // The bar is open: a click never switches the view.
    return true;
  };
}

/** The review panel. `changed` is called after it opens or closes from the panel itself. */
export function reviewBar(ctx: ReviewContext, changed: () => void): Extension {
  return [
    barOpen,
    movedTo,
    currentChange,
    currentDecorations,
    clearOnClose,
    ViewPlugin.define((view) => new Panel(view, ctx, changed)),
    Prec.high(
      keymap.of([
        {
          key: 'Escape',
          run: (view) => {
            if (!isBarOpen(view.state)) return false;
            closeBar(view);
            changed();
            return true;
          },
        },
      ]),
    ),
  ];
}
