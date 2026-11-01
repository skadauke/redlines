// The review bar (design §5.6). It is hidden until you ask for it, with Review Changes or the
// next- and previous-change shortcuts, and floats 22px above the bottom of the window, centered on
// the page: previous, "Change 3 of 17" through the changes in document order, next; Accept and
// Reject, which decide the selected change and move on to the next; and close. Moving selects the
// change and scrolls it into view. Esc closes the bar.

import {
  EditorSelection,
  type EditorState,
  type Extension,
  Prec,
  type SelectionRange,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { parsedField, setViewModeEffect, viewModeField } from '@redlines/editor';
import type { MarkRange } from '@redlines/format';
import { icon, type IconName } from './icons.ts';
import { button, element, isChange, type ReviewContext, spanOf, visibleSpace } from './shared.ts';

/** How far the bar floats above the bottom of the window. */
const BAR_LIFT = 22;
/** Room kept under the text the editor scrolls into view while the bar is open. */
const BAR_ROOM = 84;

const setBarOpen = StateEffect.define<boolean>();

const barOpen = StateField.define<boolean>({
  create: () => false,
  update(open, tr) {
    for (const effect of tr.effects) if (effect.is(setBarOpen)) open = effect.value;
    return open;
  },
});

/** Whether the review bar is open in `state`. */
export function isBarOpen(state: EditorState): boolean {
  return state.field(barOpen, false) ?? false;
}

/** The pending changes, in document order: what `EditorUiState.changes` lists. */
function changesIn(state: EditorState): MarkRange[] {
  return state.field(parsedField).marks.filter(isChange);
}

/** The index of the change the selection is on: the cursor is in it, or the selection overlaps it. */
function currentIndex(changes: readonly MarkRange[], selection: SelectionRange): number {
  return changes.findIndex((change) => {
    const { from, to } = spanOf(change);
    if (selection.empty) return from <= selection.head && selection.head <= to;
    return selection.from < to && from < selection.to;
  });
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

/** Selects a change, scrolled into view, with the bar open. */
function select(view: EditorView, ctx: ReviewContext, change: MarkRange): void {
  const { from, to } = spanOf(change);
  const range = EditorSelection.range(from, to);
  view.dispatch({
    selection: range,
    effects: [...opening(view, ctx), EditorView.scrollIntoView(range, { y: 'center' })],
    userEvent: 'select.review',
  });
  view.focus();
}

/**
 * Moves to the next change (`dir` 1) or the previous one (-1) and opens the bar. From a change, the
 * one after or before it, round to the other end; from elsewhere, the first after the cursor or
 * the last before it.
 */
export function move(view: EditorView, ctx: ReviewContext, dir: 1 | -1): void {
  const changes = changesIn(view.state);
  const { main } = view.state.selection;
  const current = currentIndex(changes, main);
  const n = changes.length;
  let index: number;
  if (current >= 0) index = (current + dir + n) % n;
  else if (dir > 0) index = changes.findIndex((change) => spanOf(change).from >= main.head);
  else index = changes.findLastIndex((change) => spanOf(change).to <= main.head);
  if (index < 0) index = dir > 0 ? 0 : n - 1;
  const change = changes[index];
  if (change) select(view, ctx, change);
  else openBar(view, ctx);
}

/** Decides the selected change and moves on to the change after it, if any remains. */
function decide(view: EditorView, ctx: ReviewContext, how: 'accept' | 'reject'): void {
  const changes = changesIn(view.state);
  const current = currentIndex(changes, view.state.selection.main);
  const change = changes[current];
  if (!change) return;
  const following = changes[current + 1] ?? changes[0];
  if (how === 'accept') ctx.editor.accept(change.id);
  else ctx.editor.reject(change.id);
  const next = following && changesIn(view.state).find(({ id }) => id === following.id);
  if (next && next.id !== change.id) select(view, ctx, next);
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

/** A button with a label and an icon. */
function textButton(name: IconName, label: string, run: () => void) {
  const el = button('rl-bar-text', label, run);
  el.prepend(icon(name, 15));
  return el;
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
  private dock: HTMLElement | null = null;
  private controls: Controls | null = null;

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
      else this.hide();
    } else if (this.dock) {
      if (update.docChanged || update.selectionSet) this.refresh(update.state);
      if (update.geometryChanged) this.place();
    }
  }

  private show(): void {
    const { view, ctx } = this;
    const close = () => {
      closeBar(view);
      this.changed();
    };
    const controls: Controls = {
      count: element('span', 'rl-bar-count'),
      previous: iconButton('previous', 'Previous change', '⌥⌘[', () => move(view, ctx, -1)),
      next: iconButton('next', 'Next change', '⌥⌘]', () => move(view, ctx, 1)),
      accept: textButton('accept', 'Accept', () => decide(view, ctx, 'accept')),
      reject: textButton('reject', 'Reject', () => decide(view, ctx, 'reject')),
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
    );
    bar.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
      view.focus();
    });
    this.dock = element('div', 'rl-review-dock');
    this.dock.append(bar);
    view.dom.append(this.dock);
    this.controls = controls;
    this.refresh(view.state);
    this.place();
  }

  private hide(): void {
    this.dock?.remove();
    this.dock = this.controls = null;
  }

  /** Brings the count and the buttons up to date. */
  private refresh(state: EditorState): void {
    if (!this.controls) return;
    const { count, previous, next, accept, reject } = this.controls;
    const changes = changesIn(state);
    const current = currentIndex(changes, state.selection.main);
    const n = changes.length;
    count.textContent = !n
      ? 'No changes'
      : current >= 0
        ? `Change ${current + 1} of ${n}`
        : `${n} ${n === 1 ? 'change' : 'changes'}`;
    previous.disabled = next.disabled = !n;
    accept.disabled = reject.disabled = current < 0;
  }

  /** Centers the bar on the page where it can be seen, above the bottom of the window. */
  private place(): void {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const space = visibleSpace(view);
        const rect = view.dom.getBoundingClientRect();
        const win = view.dom.ownerDocument.defaultView ?? window;
        const left = Math.max(rect.left, space.left);
        const right = Math.min(rect.right, space.right);
        return { left, width: right - left, bottom: win.innerHeight - space.bottom };
      },
      write: ({ left, width, bottom }) => {
        if (!this.dock) return;
        this.dock.style.left = `${left}px`;
        this.dock.style.width = `${width}px`;
        this.dock.style.bottom = `${bottom + BAR_LIFT}px`;
      },
    });
  }

  destroy(): void {
    this.hide();
  }
}

/** The review bar. `changed` is called after the bar opens or closes from the bar itself. */
export function reviewBar(ctx: ReviewContext, changed: () => void): Extension {
  return [
    barOpen,
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
