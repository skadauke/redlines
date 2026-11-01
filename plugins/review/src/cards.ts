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
import { button, element, isChange, type ReviewContext } from './shared.ts';

/** The most characters of changed text a card quotes. */
const QUOTE_LIMIT = 40;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Text as a card quotes it: on one line, and at most 40 characters, the last an ellipsis when it
 * was longer. Characters are what a reader sees as one, so an emoji is never cut in half.
 */
function quote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  // A change of white space alone, such as a paragraph break.
  if (!flat) return text.includes('\n') ? '“¶”' : '“ ”';
  const chars = [...graphemes.segment(flat)].map(({ segment }) => segment);
  if (chars.length <= QUOTE_LIMIT) return `“${flat}”`;
  return `“${chars
    .slice(0, QUOTE_LIMIT - 1)
    .join('')
    .trimEnd()}…”`;
}

/** The text of `ranges` as it reads, without the markers of any marks inside them. */
function textOf(parsed: Parsed, ranges: readonly Range[]): string {
  const markers = parsed.marks
    .flatMap(({ segments }) =>
      segments.flatMap(({ open, close }) => (close ? [open, close] : [open])),
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
 * What a change did, in Word's words: `Inserted “new”`, `Deleted “…”` or
 * `Replaced “March” with “April”`.
 */
export function describeChange(parsed: Parsed, change: MarkRange): string {
  const inserted = () =>
    quote(
      textOf(
        parsed,
        change.segments.map(({ content }) => content),
      ),
    );
  const deleted = () => quote(change.payload ?? '');
  if (change.kind === 'ins') return `Inserted ${inserted()}`;
  if (change.kind === 'del') return `Deleted ${deleted()}`;
  return `Replaced ${deleted()} with ${inserted()}`;
}

/** A change and the stretch of it under the pointer: one segment, markers included. */
interface Found {
  change: MarkRange;
  span: Range;
}

/**
 * The change at `pos`, on the side the pointer is (-1 before, 1 after), or null. Of changes inside
 * one another, the innermost.
 */
function changeAt(parsed: Parsed, pos: number, side: -1 | 1): Found | null {
  const from = side < 0 ? pos - 1 : pos;
  let found: Found | null = null;
  for (const change of parsed.marks) {
    if (!isChange(change)) continue;
    for (const { open, close } of change.segments) {
      const span = { from: open.from, to: (close ?? open).to };
      const inside = span.from <= from && from + 1 <= span.to;
      if (inside && (!found || span.to - span.from < found.span.to - found.span.from)) {
        found = { change, span };
      }
    }
  }
  return found;
}

/** Where a card goes when its change isn't on screen: nowhere to be seen. */
const OFF_SCREEN: Rect = { left: -1e4, right: -1e4, top: -1e4, bottom: -1e4 };

class Card implements TooltipView {
  readonly dom: HTMLElement;
  readonly offset = { x: -13, y: 6 };
  private readonly view: EditorView;
  private readonly span: Range;

  constructor(view: EditorView, ctx: ReviewContext, { change, span }: Found) {
    this.view = view;
    this.span = span;
    const parsed = view.state.field(parsedField);
    const { author, editor } = ctx;
    this.dom = element('div', `rl-card ${colorClass(parsed, author.handle, change.entry.by)}`);
    this.dom.setAttribute('role', 'dialog');
    const head = authorLine('rl-card', byline(parsed, change.entry.by, author), change.entry.at);
    const buttons = element('div', 'rl-card-buttons');
    buttons.append(
      button('rl-card-button', 'Accept', () => editor.accept(change.id), icon('accept')),
      button('rl-card-button', 'Reject', () => editor.reject(change.id), icon('reject')),
    );
    head.append(buttons);
    const what = describeChange(parsed, change);
    this.dom.setAttribute('aria-label', what);
    this.dom.append(head, element('div', 'rl-card-what', what));
  }

  /**
   * The card's anchor: from the top of the change's first line to the bottom of its last, so that
   * the card, above or below, never covers the changed text. A property, because hover cards are
   * placed through a host that calls it unbound.
   */
  readonly getCoords = (): Rect => {
    const start = this.view.coordsAtPos(this.span.from, 1);
    const end = this.view.coordsAtPos(this.span.to, -1);
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

/**
 * The room tooltips have: the window, less what scrolls the editor's ancestors out of sight, such
 * as a title bar above the scrolling page.
 */
function tooltipSpace(view: EditorView): Rect {
  const win = view.dom.ownerDocument.defaultView ?? window;
  const space = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
  for (let el = view.dom.parentElement; el; el = el.parentElement) {
    if (!/auto|scroll/.test(win.getComputedStyle(el).overflowY)) continue;
    const rect = el.getBoundingClientRect();
    space.top = Math.max(space.top, rect.top);
    space.bottom = Math.min(space.bottom, rect.bottom);
  }
  return space;
}

/** Change cards on hover, pinned by a click, in the Redlines view. */
export function cards(ctx: ReviewContext): Extension {
  const cardAt = (view: EditorView, pos: number, side: -1 | 1): Tooltip | null => {
    if (view.state.field(viewModeField) !== 'redlines') return null;
    const found = changeAt(view.state.field(parsedField), pos, side);
    if (!found) return null;
    const { from, to } = found.span;
    return { pos: from, end: to, above: true, create: (view) => new Card(view, ctx, found) };
  };
  const hover = hoverTooltip(cardAt, { hoverTime: 300, hideOnChange: true });
  return [
    hover,
    tooltips({ tooltipSpace }),
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
    EditorView.domEventHandlers({
      // Clicking a change pins its card; the click places the caret as usual.
      click(event, view) {
        const target = event.target instanceof Element ? event.target : null;
        const drawn = target?.closest('.rl-ins, .rl-del');
        if (!drawn || view.state.field(viewModeField) !== 'redlines') return false;
        const parsed = view.state.field(parsedField);
        const pos = view.posAtDOM(drawn);
        const found = changeAt(parsed, pos, 1) ?? changeAt(parsed, pos, -1);
        if (found) activateHover(view, found.span.from, 1, { tooltip: hover });
        return false;
      },
    }),
  ];
}
