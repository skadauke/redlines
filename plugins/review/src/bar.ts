// The review bar (design §5.6). It is hidden until you ask for it, with Review Changes or the
// next- and previous-change shortcuts, and floats 22px above the bottom of the window, centered
// under the text column and its notes: previous, "Change 3 of 17" through the changes in document
// order, next; Accept and Reject, which decide the current change and move on to the next; and
// close. Moving selects the change and scrolls it into view. Esc closes the bar.

import {
  EditorSelection,
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { setViewModeEffect, viewModeField } from '@redlines/editor';
import type { MarkRange } from '@redlines/format';
import { icon, type IconName } from './icons.ts';
import {
  attempt,
  button,
  changesOf,
  decideSuggestion,
  element,
  errorLine,
  type ReviewContext,
  segmentSpan,
  spanOf,
  suggestionIn,
  suggestionsOf,
  visibleSpace,
} from './shared.ts';

/** How far the bar floats above the bottom of the window. */
const BAR_LIFT = 22;
/** The least room between the bar and the sides of the window. */
const BAR_MARGIN = 16;
/** Room kept under the text the editor scrolls into view while the bar is open. */
const BAR_ROOM = 84;

const setBarOpen = StateEffect.define<boolean>();

const barOpen = StateField.define<boolean>({
  create: () => false,
  update(open, tr) {
    for (const effect of tr.effects) if (effect.is(setBarOpen)) open = effect.value;
    // A person who chooses to read has stopped deciding: showing the simple look closes the bar, so
    // that it never steps through changes the page doesn't show. In the app nothing but a click on
    // a change bar shows it, and while the bar is open that click opens a card instead.
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
 * Moves to a change: selects it, scrolled into view, and opens the bar. A suggestion of several
 * marks is selected whole, from the start of its first mark to the end of its last.
 */
function select(view: EditorView, ctx: ReviewContext, change: MarkRange): void {
  const marks = suggestionIn(ctx, change.id);
  const range = EditorSelection.range(
    spanOf(marks[0] ?? change).from,
    spanOf(marks.at(-1) ?? change).to,
  );
  view.dispatch({
    selection: range,
    effects: [
      ...opening(view, ctx),
      moveTo.of(change.id),
      EditorView.scrollIntoView(range, { y: 'center' }),
    ],
    userEvent: 'select.review',
  });
  view.focus();
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
): void {
  const groups = suggestionsOf(ctx);
  const current = currentGroup(view.state, changesOf(ctx), groups);
  const change = groups[current]?.[0];
  if (!change) return;
  let decided = false;
  const ran = attempt(line, () => {
    decided = decideSuggestion(ctx, how, change.id);
  });
  // Nothing was decided where the view hides the old text; it shows the change instead.
  if (!ran || !decided) return;
  const remaining = new Map(changesOf(ctx).map((left) => [left.id, left]));
  const after = [...groups.slice(current + 1), ...groups.slice(0, current)];
  const next = after
    .map((marks) => marks.map(({ id }) => remaining.get(id)).find((left) => left !== undefined))
    .find((left) => left !== undefined);
  if (next) select(view, ctx, next);
}

/** A button with an icon, explained by a hint on hover: its name and shortcut. */
function iconButton(name: IconName, label: string, keys: string, run: () => void) {
  const el = button('rl-bar-icon', label, run, icon(name));
  const hint = element('span', 'rl-hint', label);
  hint.setAttribute('aria-hidden', 'true');
  hint.append(element('span', 'rl-hint-keys', keys));
  el.append(hint);
  return el;
}

/**
 * A button with a label and an icon. The label is in a span, so that a bar too wide for its
 * window can show the icon alone (`rl-review-bar-narrow`), and the button is named for assistive
 * technology and by its hint either way.
 */
function textButton(name: IconName, label: string, run: () => void) {
  const el = button('rl-bar-text', label, run, icon(name, 15));
  el.append(element('span', 'rl-bar-label', label));
  const hint = element('span', 'rl-hint', label);
  hint.setAttribute('aria-hidden', 'true');
  el.append(hint);
  return el;
}

/**
 * Whether the bar, which is `fullWidth` wide with its labels, doesn't fit a window `windowWidth`
 * wide with 16 px to spare on each side: it then shows Accept and Reject as icons.
 */
export function barNarrow(fullWidth: number, windowWidth: number): boolean {
  return fullWidth > windowWidth - 2 * BAR_MARGIN;
}

/** What the bar shows that changes with the document and the selection. */
interface Controls {
  count: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  accept: HTMLButtonElement;
  reject: HTMLButtonElement;
}

class Bar {
  private readonly view: EditorView;
  private readonly ctx: ReviewContext;
  private readonly changed: () => void;
  private bar: HTMLElement | null = null;
  private controls: Controls | null = null;
  /** Whether the bar shows icons alone, and how wide it is while it doesn't. */
  private narrow = false;
  private fullWidth = 0;

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
        // Closed from outside the bar, as when the simple look is shown: the host hears of it too.
        this.changed();
      }
    } else if (this.bar) {
      if (update.transactions.length) this.refresh(update.state);
      if (update.geometryChanged) this.place();
    }
  }

  private show(): void {
    const { view, ctx } = this;
    const close = () => {
      closeBar(view);
      this.changed();
    };
    const error = errorLine('rl-bar-error');
    const controls: Controls = {
      count: element('span', 'rl-bar-count'),
      previous: iconButton('previous', 'Previous change', '⌥⌘[', () => move(view, ctx, -1)),
      next: iconButton('next', 'Next change', '⌥⌘]', () => move(view, ctx, 1)),
      accept: textButton('accept', 'Accept', () => decide(view, ctx, 'accept', error)),
      reject: textButton('reject', 'Reject', () => decide(view, ctx, 'reject', error)),
    };
    controls.count.setAttribute('aria-live', 'polite');
    const bar = element('div', 'rl-review-bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Review changes');
    bar.append(
      controls.previous,
      controls.count,
      controls.next,
      element('span', 'rl-bar-divider'),
      controls.accept,
      controls.reject,
      element('span', 'rl-bar-divider'),
      iconButton('close', 'Close', 'Esc', close),
      error,
    );
    bar.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
      view.focus();
    });
    view.dom.append(bar);
    this.bar = bar;
    this.controls = controls;
    this.refresh(view.state);
    this.place();
  }

  private hide(): void {
    this.bar?.remove();
    this.bar = this.controls = null;
    this.narrow = false;
  }

  /** Brings the count and the buttons up to date. */
  private refresh(state: EditorState): void {
    if (!this.controls) return;
    const { count, previous, next, accept, reject } = this.controls;
    const groups = suggestionsOf(this.ctx);
    const current = currentGroup(state, changesOf(this.ctx), groups);
    const n = groups.length;
    count.textContent = !n
      ? 'No changes'
      : current >= 0
        ? `Change ${current + 1} of ${n}`
        : `${n} ${n === 1 ? 'change' : 'changes'}`;
    previous.disabled = next.disabled = !n;
    accept.disabled = reject.disabled = current < 0;
  }

  /**
   * Centers the bar under the text column, with the margin notes beside it when they show (the
   * column's box holds both, centered together on the page), and keeps it inside the window, 22px
   * above the bottom of the part of the window where the editor can be seen: in the desktop app,
   * the window's bottom, however short the document.
   */
  private place(): void {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const win = view.dom.ownerDocument.defaultView ?? window;
        const content = view.contentDOM.getBoundingClientRect();
        // Its width with its labels is what it is while it shows them: the window zoom makes
        // the page narrower, and the bar must still fit.
        if (!this.narrow) this.fullWidth = this.bar?.offsetWidth ?? 0;
        const narrow = barNarrow(this.fullWidth, win.innerWidth);
        const half = (this.bar?.offsetWidth ?? 0) / 2;
        const widest = win.innerWidth - BAR_MARGIN - half;
        const middle = (content.left + content.right) / 2;
        const center = Math.max(BAR_MARGIN + half, Math.min(middle, widest));
        return { center, narrow, bottom: win.innerHeight - visibleSpace(view).bottom + BAR_LIFT };
      },
      write: ({ center, narrow, bottom }) => {
        if (!this.bar) return;
        this.bar.style.left = `${center}px`;
        this.bar.style.bottom = `${bottom}px`;
        if (narrow === this.narrow) return;
        // The icons make the bar narrower: place it again at that width.
        this.narrow = narrow;
        this.bar.classList.toggle('rl-review-bar-narrow', narrow);
        this.place();
      },
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

/** The review bar. `changed` is called after the bar opens or closes from the bar itself. */
export function reviewBar(ctx: ReviewContext, changed: () => void): Extension {
  return [
    barOpen,
    movedTo,
    ViewPlugin.define((view) => new Bar(view, ctx, changed)),
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
    EditorView.scrollMargins.of((view) => (isBarOpen(view.state) ? { bottom: BAR_ROOM } : null)),
  ];
}
