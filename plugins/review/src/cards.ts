// Change cards (design §5.5). Hovering over a change shows its card after a short delay, above or
// below its lines, never over the changed text: who made the change and when, what it did in
// Word's words, and Accept and Reject, which decide it without moving on. Clicking a change pins
// its card until the selection or the text changes.

import { EditorState, type Extension, Prec } from '@codemirror/state';
import {
  activateHover,
  closeHoverTooltip,
  EditorView,
  hoverTooltip,
  keymap,
  type Rect,
  type Tooltip,
  type TooltipView,
  type ViewUpdate,
  tooltips,
} from '@codemirror/view';
import { parsedField, viewModeField } from '@redlines/editor';
import { canReject } from '@redlines/format';
import type { MarkRange, Parsed, Range } from '@redlines/format';
import { icon } from './icons.ts';
import { authorLine, byline, colorClass } from './people.ts';
import { startsNewComment } from './rail.ts';
import {
  attempt,
  button,
  changesOf,
  changeTexts,
  decideSuggestion,
  element,
  errorLine,
  isRowInsertion,
  rowsDone,
  readable,
  type ReviewContext,
  segmentSpan,
  suggestionIn,
  visibleSpace,
  visibleStart,
} from './shared.ts';

/** Text as a card quotes it, in quotation marks (see `readable`). */
const quote = (text: string) => `“${readable(text)}”`;

/**
 * Whether deleted text is a break alone: a block break with the next block's prefix (`## `, `- `,
 * `> `), or a hard line break, which joins what it separated (format §3.4).
 */
function isBreak(text: string): boolean {
  return text.includes('\n') && /^(?:[\s>\\]|#{1,6} |[-*+] |\d{1,9}[.)] )*$/.test(text);
}

/**
 * What a change did, in Word's words: `Inserted “new”`, `Deleted “…”`,
 * `Replaced “March” with “April”`, `Inserted paragraph break`, `Joined paragraphs` or
 * `Formatted: Bold`. A
 * substitution with no old text, such as the second part of one that untracked typing split
 * (format §3.10), inserted its text.
 */
export function describeChange(parsed: Parsed, change: MarkRange): string {
  const row = rowsDone([change]);
  if (row !== null) return row;
  const { old, added, label } = changeTexts(parsed, change);
  if (label !== undefined) return `Formatted: ${label}`;
  if (change.kind === 'split') return 'Inserted paragraph break';
  if (change.kind === 'ins' || (change.kind === 'sub' && old === '')) {
    return `Inserted ${quote(added)}`;
  }
  if (change.kind === 'del') return isBreak(old) ? 'Joined paragraphs' : `Deleted ${quote(old)}`;
  return `Replaced ${quote(old)} with ${quote(added)}`;
}

/** What the changes of one suggestion did: `Inserted 2 rows` for rows inserted together, else each
 * change's words. */
export function describeChanges(parsed: Parsed, changes: readonly MarkRange[]): string {
  const rows = changes.length > 1 ? rowsDone(changes) : null;
  if (rows !== null) return rows;
  return changes.map((change) => describeChange(parsed, change)).join(' · ');
}

/** A change and the stretch of it under the pointer: one segment, markers included. */
interface Found {
  change: MarkRange;
  span: Range;
  /** Where the segment's text starts on screen. */
  start: number;
  /**
   * The block or the struck text the pointer is over, when the tracked layer drew it as a widget
   * (a deleted block, or the old text of a block rewritten whole): the card stands against its
   * box, above or below, and not against the markers, which are hidden lines.
   */
  box?: Element;
}

/**
 * The change of `changes` at `pos`, on the side the pointer is (-1 before, 1 after), or null. Of
 * changes inside one another, the innermost.
 */
function changeAt(changes: readonly MarkRange[], pos: number, side: -1 | 1): Found | null {
  const from = side < 0 ? pos - 1 : pos;
  let found: Found | null = null;
  for (const change of changes) {
    for (const segment of change.segments) {
      const span = segmentSpan(segment);
      const inside = span.from <= from && from + 1 <= span.to;
      if (inside && (!found || span.to - span.from < found.span.to - found.span.from)) {
        found = { change, span, start: visibleStart(segment) };
      }
    }
  }
  return found;
}

/** The inserted row on the line of `pos`, as a change whose stretch is the row: its cells are text
 * the tracked layer draws no mark around. */
function rowAt(state: EditorState, changes: readonly MarkRange[], pos: number): Found | null {
  const line = state.doc.lineAt(Math.min(pos, state.doc.length));
  for (const change of changes) {
    const segment = change.segments[0];
    if (!isRowInsertion(change) || !segment) continue;
    if (line.from <= segment.open.from && segment.open.from <= line.to) {
      return { change, span: { from: line.from, to: line.to }, start: line.from };
    }
  }
  return null;
}

/** Text as it reads, whatever draws its line breaks: pilcrows and white space count as a space. */
const reading = (text: string) => text.replace(/[\s¶]+/g, ' ').trim();

/**
 * The change whose deleted text `el` draws, struck through. Deleted text is a widget at one end of
 * its markers, or for a deleted paragraph at the start of the block below, where another change
 * can start too, such as a paragraph inserted in its place. So the struck text decides: the
 * deletion or substitution with a segment that deleted this text, nearest to where it is drawn.
 */
function struckChange(changes: readonly MarkRange[], pos: number, el: Element): Found | null {
  const struck = reading(el.textContent ?? '');
  let found: Found | null = null;
  let distance = Infinity;
  for (const change of changes) {
    for (const segment of change.segments) {
      // Only a deletion's and a substitution's payload is deleted text: a format change's is its
      // operations, such as `+bold`.
      if (change.kind !== 'del' && change.kind !== 'sub') continue;
      if (segment.payload === undefined || reading(segment.payload) !== struck) continue;
      const span = segmentSpan(segment);
      const away = Math.max(span.from - pos, pos - span.to, 0);
      if (away < distance) {
        found = { change, span, start: visibleStart(segment) };
        distance = away;
      }
    }
  }
  return found;
}

/**
 * The change that the tracked layer drew as `el`: the deletion its struck text belongs to, or the
 * change at its position, on either side.
 */
function changeOf(view: EditorView, changes: readonly MarkRange[], el: Element): Found | null {
  // A struck block or struck text carries its change's id: found by it, not by matching its text,
  // which two blocks may share.
  const marked = el.closest<HTMLElement>('[data-mark]');
  const change = marked?.dataset['mark']
    ? changes.find((mark) => mark.id === marked.dataset['mark'])
    : null;
  if (marked && change) {
    // Of its segments, the one drawn nearest where this is: a later segment of a change keeps its
    // card, as a card found by the text does.
    const at = view.posAtDOM(marked);
    let segment = change.segments[0];
    let distance = Infinity;
    for (const candidate of change.segments) {
      const span = segmentSpan(candidate);
      const away = Math.max(span.from - at, at - span.to, 0);
      if (away < distance) {
        segment = candidate;
        distance = away;
      }
    }
    if (segment) {
      return { change, span: segmentSpan(segment), start: visibleStart(segment), box: marked };
    }
  }
  const pos = view.posAtDOM(el);
  const struck = el.classList.contains('rl-del') ? struckChange(changes, pos, el) : null;
  return (
    struck ??
    changeAt(changes, pos, 1) ??
    changeAt(changes, pos, -1) ??
    rowAt(view.state, changes, pos)
  );
}

/** Where a card goes when its change isn't on screen: nowhere to be seen. */
const OFF_SCREEN: Rect = { left: -1e4, right: -1e4, top: -1e4, bottom: -1e4 };

class Card implements TooltipView {
  readonly dom: HTMLElement;
  readonly offset = { x: -13, y: 6 };
  private readonly view: EditorView;
  private readonly found: Found;
  private readonly by: string;
  private color: string;
  /** Where the struck block or text was last seen, for the moment it is redrawn. */
  private boxRect: Rect | null = null;

  constructor(view: EditorView, ctx: ReviewContext, found: Found) {
    this.view = view;
    this.found = found;
    const { change } = found;
    const parsed = view.state.field(parsedField);
    const { author } = ctx;
    // A suggestion of several marks is decided as one, from the card of any of them.
    const marks = suggestionIn(ctx, change.id);
    this.by = change.entry.by;
    this.color = colorClass(view.state, this.by);
    this.dom = element('div', `rl-card ${this.color}`);
    this.dom.setAttribute('role', 'dialog');
    const head = authorLine('rl-card', byline(parsed, change.entry.by, author), change.entry.at);
    // A refused decision changes nothing and says why.
    const error = errorLine('rl-card-error');
    const buttons = element('div', 'rl-card-buttons');
    buttons.append(
      button(
        'rl-card-button',
        'Accept',
        () => attempt(error, () => decideSuggestion(ctx, 'accept', change.id)),
        icon('accept'),
      ),
    );
    // A format change whose text has lost the formatting can only be accepted.
    if (marks.every((mark) => canReject(parsed, mark))) {
      buttons.append(
        button(
          'rl-card-button',
          'Reject',
          () => attempt(error, () => decideSuggestion(ctx, 'reject', change.id)),
          icon('reject'),
        ),
      );
    }
    head.append(buttons);
    const what = describeChanges(parsed, marks.length > 1 ? marks : [change]);
    this.dom.setAttribute('aria-label', what);
    this.dom.append(head, element('div', 'rl-card-what', what), error);
  }

  /** Follows the author's color when the record of people changes while the card is open. */
  update(update: ViewUpdate): void {
    const color = colorClass(update.state, this.by);
    if (color === this.color) return;
    this.dom.classList.replace(this.color, color);
    this.color = color;
  }

  /**
   * The card's anchor: from the top of the change's first line to the bottom of its last, so that
   * the card, above or below, never covers the changed text. A property, because hover cards are
   * placed through a host that calls it unbound.
   */
  readonly getCoords = (): Rect => {
    const { box } = this.found;
    if (box?.isConnected) {
      const rect = box.getBoundingClientRect();
      this.boxRect = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }
    // A block deleted whole is a widget: its own box, whatever is under its hidden markers.
    if (this.boxRect && box?.classList.contains('rl-struck')) return this.boxRect;
    const start = this.view.coordsAtPos(this.found.start, 1);
    const end = this.view.coordsAtPos(this.found.span.to, -1);
    const first = start ?? end;
    const last = end ?? start;
    if (!first || !last) return this.boxRect ?? OFF_SCREEN;
    const rect = {
      left: first.left,
      right: first.right,
      top: Math.min(first.top, last.top),
      bottom: Math.max(first.bottom, last.bottom),
    };
    // Struck old text drawn above its new text, as a block rewritten whole is: from the top of the
    // old text to the bottom of the new, so that the card, above or below, covers neither.
    if (this.boxRect) {
      rect.top = Math.min(rect.top, this.boxRect.top);
      rect.bottom = Math.max(rect.bottom, this.boxRect.bottom);
    }
    return rect;
  };
}

/** The farthest the pointer may move between pressing and releasing for the press to be a click. */
const CLICK_SLOP = 4;

/**
 * Change cards on hover, pinned by a click, in the Redlines view only: in Simple the text reads as
 * accepted, and a card over plain-looking words would surprise. And `close`, which puts away the
 * card that shows, as a zoom change does: it was placed for the old layout.
 */
export function cards(ctx: ReviewContext): {
  extension: Extension;
  close(view: EditorView): void;
  /** Pins the card of change `id` over its first segment, as a click on it would. */
  pinChange(view: EditorView, id: string): void;
} {
  /** The element under the pointer at its last move. */
  let hovered: Element | null = null;
  /** The change whose card is being pinned. */
  let pinning: Found | null = null;
  const redlines = (view: EditorView) => view.state.field(viewModeField) === 'redlines';
  /** The change under the pointer: the deleted text it is over, else the text at `pos`. */
  const pointedAt = (view: EditorView, pos: number, side: -1 | 1): Found | null => {
    const changes = changesOf(ctx);
    const struck = hovered?.closest('.rl-del, .rl-struck, .rl-ghost');
    if (struck && view.contentDOM.contains(struck)) return changeOf(view, changes, struck);
    // A line break's mark, drawn where the break shows, also when its marker is on a hidden line
    // beside another break's (#198).
    const mark = hovered?.closest<HTMLElement>('.rl-split[data-rl-change]');
    if (mark && view.contentDOM.contains(mark)) {
      const split = changes.find((change) => change.id === mark.dataset['rlChange']);
      const segment = split?.segments[0];
      if (split && segment) {
        return { change: split, span: segmentSpan(segment), start: visibleStart(segment) };
      }
    }
    return changeAt(changes, pos, side) ?? rowAt(view.state, changes, pos);
  };
  const cardAt = (view: EditorView, pos: number, side: -1 | 1): Tooltip | null => {
    const found = pinning ?? (redlines(view) ? pointedAt(view, pos, side) : null);
    if (!found) return null;
    const { from, to } = found.span;
    return { pos: from, end: to, above: true, create: (view) => new Card(view, ctx, found) };
  };
  const hover = hoverTooltip(cardAt, {
    hoverTime: 300,
    hideOnChange: true,
    hideOn: startsNewComment,
  });
  /** Opens a change's card until the selection or the text changes. */
  const pin = (view: EditorView, found: Found) => {
    pinning = found;
    try {
      activateHover(view, found.span.from, 1, { tooltip: hover });
    } finally {
      pinning = null;
    }
  };
  const extension: Extension = [
    hover,
    // A card over text that now reads as accepted would surprise, and its buttons could only switch
    // back: choosing Simple puts it away.
    EditorState.transactionExtender.of((tr) =>
      tr.state.field(viewModeField) === 'simple' &&
      tr.startState.field(viewModeField) !== 'simple' &&
      tr.startState.field(hover.active).length
        ? { effects: closeHoverTooltip(hover) }
        : null,
    ),
    tooltips({ tooltipSpace: visibleSpace }),
    // Esc puts a card away.
    Prec.high(
      keymap.of([
        {
          key: 'Escape',
          run: (view) => {
            if (!view.state.field(hover.active).length) return false;
            view.dispatch({ effects: closeHoverTooltip(hover) });
            return true;
          },
        },
      ]),
    ),
    EditorView.domEventObservers({
      mousemove(event) {
        hovered = event.target instanceof Element ? event.target : null;
      },
      // A click on a change pins its card. The press can select the change's note, which redraws
      // the text under the pointer, and then the browser sends no click; so the press is followed
      // to its release instead, and the card opens once the selection that the press made is in.
      mousedown(event, view) {
        const target = event.target instanceof Element ? event.target : null;
        const drawn = target?.closest(
          '.rl-ins, .rl-del, .rl-fmt, .rl-ins-row, .rl-struck, .rl-ghost',
        );
        if (event.button !== 0 || !drawn || !redlines(view)) return;
        const found = changeOf(view, changesOf(ctx), drawn);
        if (!found) return;
        const { doc } = view.state;
        const win = view.dom.ownerDocument.defaultView ?? window;
        const release = (up: MouseEvent) => {
          const moved = Math.hypot(up.clientX - event.clientX, up.clientY - event.clientY);
          if (moved > CLICK_SLOP) return;
          setTimeout(() => {
            if (view.dom.isConnected && view.state.doc === doc && redlines(view)) pin(view, found);
          });
        };
        win.addEventListener('mouseup', release, { once: true });
      },
    }),
  ];
  return {
    extension,
    pinChange(view, id) {
      const change = changesOf(ctx).find((mark) => mark.id === id);
      const segment = change?.segments[0];
      if (!change || !segment) return;
      pin(view, { change, span: segmentSpan(segment), start: visibleStart(segment) });
    },
    close(view) {
      if (view.state.field(hover.active).length) {
        view.dispatch({ effects: closeHoverTooltip(hover) });
      }
    },
  };
}
