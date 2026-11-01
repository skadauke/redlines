// Change cards (design §5.5). Hovering over a change shows its card after a short delay, above or
// below its lines, never over the changed text: who made the change and when, what it did in
// Word's words, and Accept and Reject, which decide it without moving on. Clicking a change pins
// its card until the selection or the text changes.

import { type Extension, Prec } from '@codemirror/state';
import {
  activateHover,
  closeHoverTooltip,
  EditorView,
  hoverTooltip,
  keymap,
  type Rect,
  type Tooltip,
  type TooltipView,
  tooltips,
} from '@codemirror/view';
import { parsedField, viewModeField } from '@redlines/editor';
import type { MarkRange, Parsed, Range } from '@redlines/format';
import { icon } from './icons.ts';
import { authorLine, byline, colorClass } from './people.ts';
import {
  attempt,
  button,
  changesOf,
  element,
  errorLine,
  openerEnd,
  type ReviewContext,
  segmentSpan,
  visibleSpace,
  visibleStart,
} from './shared.ts';

/** The most characters of changed text a card quotes. */
const QUOTE_LIMIT = 40;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Text as a card quotes it: on one line, and at most 40 characters, the last an ellipsis when it
 * was longer. Characters are what a reader sees as one, so an emoji is never cut in half.
 */
function quote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  // A change of white space alone.
  if (!flat) return text.includes('\n') ? '“¶”' : '“ ”';
  const chars = [...graphemes.segment(flat)].map(({ segment }) => segment);
  if (chars.length <= QUOTE_LIMIT) return `“${flat}”`;
  return `“${chars
    .slice(0, QUOTE_LIMIT - 1)
    .join('')
    .trimEnd()}…”`;
}

/**
 * The text of `ranges` as it reads, without the markers of any marks inside them, or what carries
 * an opener on a line of its own.
 */
function textOf(parsed: Parsed, ranges: readonly Range[]): string {
  const markers = parsed.marks
    .flatMap(({ segments }) =>
      segments.flatMap((segment) => {
        const opener = { from: segment.open.from, to: openerEnd(segment) };
        return segment.close ? [opener, segment.close] : [opener];
      }),
    )
    .sort((a, b) => a.from - b.from);
  return ranges
    .map(({ from, to }) => {
      let text = '';
      let pos = from;
      for (const marker of markers) {
        if (marker.to <= pos || marker.from >= to) continue;
        text += parsed.text.slice(pos, marker.from);
        pos = marker.to;
      }
      return text + parsed.text.slice(pos, to);
    })
    .join(' ');
}

/**
 * Whether deleted text is a break alone: a block break with the next block's prefix (`## `, `- `,
 * `> `), or a hard line break, which joins what it separated (format §3.4).
 */
function isBreak(text: string): boolean {
  return text.includes('\n') && /^(?:[\s>\\]|#{1,6} |[-*+] |\d{1,9}[.)] )*$/.test(text);
}

/**
 * What a change did, in Word's words: `Inserted “new”`, `Deleted “…”`,
 * `Replaced “March” with “April”`, `Inserted paragraph break` or `Joined paragraphs`.
 */
export function describeChange(parsed: Parsed, change: MarkRange): string {
  const inserted = () =>
    quote(
      textOf(
        parsed,
        change.segments.map(({ content }) => content),
      ),
    );
  const deleted = change.payload ?? '';
  if (change.kind === 'split') return 'Inserted paragraph break';
  if (change.kind === 'ins') return `Inserted ${inserted()}`;
  if (change.kind === 'del')
    return isBreak(deleted) ? 'Joined paragraphs' : `Deleted ${quote(deleted)}`;
  return `Replaced ${quote(deleted)} with ${inserted()}`;
}

/** A change and the stretch of it under the pointer: one segment, markers included. */
interface Found {
  change: MarkRange;
  span: Range;
  /** Where the segment's text starts on screen. */
  start: number;
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
  const pos = view.posAtDOM(el);
  const struck = el.classList.contains('rl-del') ? struckChange(changes, pos, el) : null;
  return struck ?? changeAt(changes, pos, 1) ?? changeAt(changes, pos, -1);
}

/** Where a card goes when its change isn't on screen: nowhere to be seen. */
const OFF_SCREEN: Rect = { left: -1e4, right: -1e4, top: -1e4, bottom: -1e4 };

class Card implements TooltipView {
  readonly dom: HTMLElement;
  readonly offset = { x: -13, y: 6 };
  private readonly view: EditorView;
  private readonly found: Found;

  constructor(view: EditorView, ctx: ReviewContext, found: Found) {
    this.view = view;
    this.found = found;
    const { change } = found;
    const parsed = view.state.field(parsedField);
    const { author, editor } = ctx;
    this.dom = element('div', `rl-card ${colorClass(parsed, author.handle, change.entry.by)}`);
    this.dom.setAttribute('role', 'dialog');
    const head = authorLine('rl-card', byline(parsed, change.entry.by, author), change.entry.at);
    // A refused decision changes nothing and says why.
    const error = errorLine('rl-card-error');
    const buttons = element('div', 'rl-card-buttons');
    buttons.append(
      button(
        'rl-card-button',
        'Accept',
        () => attempt(error, () => editor.accept(change.id)),
        icon('accept'),
      ),
      button(
        'rl-card-button',
        'Reject',
        () => attempt(error, () => editor.reject(change.id)),
        icon('reject'),
      ),
    );
    head.append(buttons);
    const what = describeChange(parsed, change);
    this.dom.setAttribute('aria-label', what);
    this.dom.append(head, element('div', 'rl-card-what', what), error);
  }

  /**
   * The card's anchor: from the top of the change's first line to the bottom of its last, so that
   * the card, above or below, never covers the changed text. A property, because hover cards are
   * placed through a host that calls it unbound.
   */
  readonly getCoords = (): Rect => {
    const start = this.view.coordsAtPos(this.found.start, 1);
    const end = this.view.coordsAtPos(this.found.span.to, -1);
    const first = start ?? end;
    const last = end ?? start;
    if (!first || !last) return OFF_SCREEN;
    return {
      left: first.left,
      right: first.right,
      top: Math.min(first.top, last.top),
      bottom: Math.max(first.bottom, last.bottom),
    };
  };
}

/** The farthest the pointer may move between pressing and releasing for the press to be a click. */
const CLICK_SLOP = 4;

/** Change cards on hover, pinned by a click, in the Redlines view. */
export function cards(ctx: ReviewContext): Extension {
  /** The element under the pointer at its last move. */
  let hovered: Element | null = null;
  /** The change whose card is being pinned. */
  let pinning: Found | null = null;
  const redlines = (view: EditorView) => view.state.field(viewModeField) === 'redlines';
  /** The change under the pointer: the deleted text it is over, else the text at `pos`. */
  const pointedAt = (view: EditorView, pos: number, side: -1 | 1): Found | null => {
    const changes = changesOf(ctx);
    const struck = hovered?.closest('.rl-del');
    if (struck && view.contentDOM.contains(struck)) return changeOf(view, changes, struck);
    return changeAt(changes, pos, side);
  };
  const cardAt = (view: EditorView, pos: number, side: -1 | 1): Tooltip | null => {
    const found = pinning ?? (redlines(view) ? pointedAt(view, pos, side) : null);
    if (!found) return null;
    const { from, to } = found.span;
    return { pos: from, end: to, above: true, create: (view) => new Card(view, ctx, found) };
  };
  const hover = hoverTooltip(cardAt, { hoverTime: 300, hideOnChange: true });
  /** Opens a change's card until the selection or the text changes. */
  const pin = (view: EditorView, found: Found) => {
    pinning = found;
    try {
      activateHover(view, found.span.from, 1, { tooltip: hover });
    } finally {
      pinning = null;
    }
  };
  return [
    hover,
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
        const drawn = target?.closest('.rl-ins, .rl-del');
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
}
