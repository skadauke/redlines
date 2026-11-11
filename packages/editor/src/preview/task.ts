// Task boxes and HTML entities in the preview (design, Rendering). A task item's `- [ ]` is drawn
// as a gray box, with a check mark when checked; an entity such as `&amp;` or `&#169;` is drawn as
// its character. Both show their source while the selection touches them.
//
// The editor never writes formats. Clicking a box only says what it wants, in `checkBoxEffect`;
// the formatting plugin listens and makes the change, tracked or not. Without it the box is drawn
// and clicking it changes nothing.

import type { EditorState } from '@codemirror/state';
import { StateEffect } from '@codemirror/state';
import { Decoration, type EditorView, WidgetType } from '@codemirror/view';
import { colorClass, colorsOf } from '../tracked/colors.ts';
import { boxChange, parsedField, viewModeField } from '../tracked/field.ts';

/** A click on a task box: the start of the item (its list marker) and the state it wants. */
export interface CheckBoxRequest {
  pos: number;
  checked: boolean;
}

export const checkBoxEffect = StateEffect.define<CheckBoxRequest>();

/**
 * How a task box with a pending change is drawn: `source` where the change is one this can't
 * draw (the box stays Markdown), otherwise the box in its new state: `color` is the class of its
 * author's color in Redlines (empty in the other views, which draw the change's bar alone), and
 * `note` says what is pending, for a screen reader ("checked by Bo, pending").
 */
export type PendingBox = 'source' | { color: string; note: string };

/**
 * What the pending changes make of the box whose marker is `from`–`to`: null where none touches
 * it, a box in its new state for a box checked or unchecked (its point mark at the end of the
 * item's first line) or one inserted whole, otherwise the source.
 */
export function pendingBox(state: EditorState, from: number, to: number): PendingBox | null {
  const line = state.doc.lineAt(from);
  const parsed = state.field(parsedField);
  const colors = colorsOf(state);
  const redlines = state.field(viewModeField, false) === 'redlines';
  const look = (by: string, what: string): PendingBox => {
    const name = parsed.ledger.people.find(({ handle }) => handle === by)?.name ?? by;
    return {
      color: redlines ? colorClass(colors.get(by) ?? 0) : '',
      note: `${what} by ${name}, pending`,
    };
  };
  let found: PendingBox | null = null;
  for (const mark of parsed.marks) {
    if (mark.kind === 'hl' || mark.kind === 'cmt') continue;
    for (const { open, content, close, carrier } of mark.segments) {
      const sign =
        mark.kind === 'fmt' && !close && open.from >= line.from && open.to <= line.to
          ? boxChange(state.sliceDoc(open.from, open.to))
          : null;
      if (sign !== null) {
        found ??= look(mark.entry.by, sign === '+' ? 'checked' : 'unchecked');
        continue;
      }
      const end = Math.max(open.to, content.to, close?.to ?? 0, carrier?.to ?? 0);
      if (open.from >= to || end <= from) continue;
      // An insertion that holds the whole marker: the box is new, and drawn as it will be.
      if (mark.kind === 'ins' && close && content.from <= from && content.to >= to) {
        found ??= look(mark.entry.by, 'added');
      } else return 'source';
    }
  }
  return found;
}

const SVG = 'http://www.w3.org/2000/svg';

/** The box: a 16-unit square drawn 0.8 em wide, so its stroke is 1.25 px at 16 px text. */
function drawBox(checked: boolean, note: string | null): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', checked ? 'rl-box rl-box-checked' : 'rl-box');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('role', 'checkbox');
  svg.setAttribute('aria-checked', String(checked));
  // A name a screen reader says, with what is pending; the keyboard reaches the box, and Space
  // changes it (the ring is the theme's, on keyboard focus only).
  svg.setAttribute('aria-label', `${checked ? 'Done' : 'To do'}${note ? `, ${note}` : ''}`);
  svg.setAttribute('tabindex', '0');
  const rect = document.createElementNS(SVG, 'rect');
  rect.setAttribute('x', '0.78');
  rect.setAttribute('y', '0.78');
  rect.setAttribute('width', '14.44');
  rect.setAttribute('height', '14.44');
  rect.setAttribute('rx', '2.82');
  svg.append(rect);
  if (checked) {
    const tick = document.createElementNS(SVG, 'path');
    tick.setAttribute('d', 'M4.3 8.3 L7 11 L11.8 5.2');
    svg.append(tick);
  }
  return svg;
}

/** The box of a task item, in the width of the list marker and space it replaces. */
export class TaskBoxWidget extends WidgetType {
  readonly checked: boolean;
  readonly cols: number;
  /** A pending change to the box: its author's color class ('' in views without colors), and what a
   * screen reader is told of it. Null with none. */
  readonly pending: { color: string; note: string } | null;

  constructor(
    checked: boolean,
    cols: number,
    pending: { color: string; note: string } | null = null,
  ) {
    super();
    this.checked = checked;
    this.cols = cols;
    this.pending = pending;
  }

  override eq(other: TaskBoxWidget): boolean {
    return (
      other.checked === this.checked &&
      other.cols === this.cols &&
      other.pending?.color === this.pending?.color &&
      other.pending?.note === this.pending?.note
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'rl-list-mark rl-task';
    if (this.pending) wrap.classList.add('rl-box-pending');
    if (this.pending?.color) wrap.classList.add(this.pending.color);
    wrap.style.setProperty('--rl-cols', String(this.cols));
    const box = drawBox(this.checked, this.pending?.note ?? null);
    wrap.append(box);
    const toggle = () => {
      const pos = view.posAtDOM(wrap);
      view.dispatch({ effects: checkBoxEffect.of({ pos, checked: !this.checked }) });
      return pos;
    };
    wrap.addEventListener('mousedown', (event) => {
      // The caret stays where it was: the click is on the box, not in the line's source.
      event.preventDefault();
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      toggle();
    });
    box.addEventListener('keydown', (event) => {
      if (event.key !== ' ' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const pos = toggle();
      // The change draws the box again: the focus goes to the new one, at the same item.
      queueMicrotask(() => {
        for (const other of view.contentDOM.querySelectorAll<HTMLElement>('.rl-task')) {
          if (view.posAtDOM(other) === pos) other.querySelector<SVGElement>('.rl-box')?.focus();
        }
      });
    });
    return wrap;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  minus: '−',
  ne: '≠',
  le: '≤',
  ge: '≥',
  asymp: '≈',
  infin: '∞',
  micro: 'µ',
  sect: '§',
  para: '¶',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  prime: '′',
  Prime: '″',
  cent: '¢',
  pound: '£',
  yen: '¥',
  euro: '€',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  hearts: '♥',
  check: '✓',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  iexcl: '¡',
  iquest: '¿',
};

/**
 * Characters an entity must not hide: they would make text read differently from how it looks.
 * Direction controls, zero-width characters and noncharacters stay source.
 */
const INVISIBLE =
  /^[\u00ad\u061c\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufdd0-\ufdef\ufeff]$/;

/** The character an entity stands for, or null for a name not known or a number not a character. */
export function decodeEntity(source: string): string | null {
  const body = source.slice(1, -1);
  const numeric = /^#(?:[xX]([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(body);
  if (numeric) {
    const code = numeric[1] ? Number.parseInt(numeric[1], 16) : Number(numeric[2]);
    // CommonMark turns 0 and what isn't a character into the replacement character; we leave
    // those as source, as controls are, rather than draw something the file doesn't say.
    if (code < 0x20 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
    if (code >= 0x7f && code < 0xa0) return null;
    // U+FFFE and U+FFFF, and the same two at the end of each plane.
    if ((code & 0xfffe) === 0xfffe || INVISIBLE.test(String.fromCodePoint(code))) return null;
    return String.fromCodePoint(code);
  }
  return Object.hasOwn(NAMED, body) ? (NAMED[body] ?? null) : null;
}

/** An entity drawn as its character. */
class EntityWidget extends WidgetType {
  readonly char: string;
  readonly source: string;

  constructor(char: string, source: string) {
    super();
    this.char = char;
    this.source = source;
  }

  override eq(other: EntityWidget): boolean {
    return other.char === this.char && other.source === this.source;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'rl-entity';
    span.textContent = this.char;
    return span;
  }

  /** Clicking the character puts the caret on it, which shows its source. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The decoration that draws an `Entity` node as its character, or null for one left as source. */
export function entityDecoration(state: EditorState, from: number, to: number): Decoration | null {
  const source = state.sliceDoc(from, to);
  const char = decodeEntity(source);
  return char === null ? null : Decoration.replace({ widget: new EntityWidget(char, source) });
}
