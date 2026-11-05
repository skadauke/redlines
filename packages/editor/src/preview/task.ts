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
import { parsedField } from '../tracked/field.ts';

/** A click on a task box: the start of the item (its list marker) and the state it wants. */
export interface CheckBoxRequest {
  pos: number;
  checked: boolean;
}

export const checkBoxEffect = StateEffect.define<CheckBoxRequest>();

/** Whether a pending change covers any of `from`–`to`. Highlights and comments change no text. */
export function pendingOver(state: EditorState, from: number, to: number): boolean {
  for (const mark of state.field(parsedField).marks) {
    if (mark.kind === 'hl' || mark.kind === 'cmt') continue;
    for (const { open, content, close, carrier } of mark.segments) {
      const end = Math.max(open.to, content.to, close?.to ?? 0, carrier?.to ?? 0);
      if (open.from < to && end > from) return true;
    }
  }
  return false;
}

/** The box of a task item, in the width of the list marker and space it replaces. */
export class TaskBoxWidget extends WidgetType {
  readonly checked: boolean;
  readonly cols: number;

  constructor(checked: boolean, cols: number) {
    super();
    this.checked = checked;
    this.cols = cols;
  }

  override eq(other: TaskBoxWidget): boolean {
    return other.checked === this.checked && other.cols === this.cols;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'rl-list-mark rl-task';
    wrap.style.setProperty('--rl-cols', String(this.cols));
    const box = document.createElement('span');
    box.className = this.checked ? 'rl-box rl-box-checked' : 'rl-box';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.textContent = this.checked ? '✓' : '';
    wrap.append(box);
    wrap.addEventListener('mousedown', (event) => {
      // The caret stays where it was: the click is on the box, not in the line's source.
      event.preventDefault();
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      view.dispatch({
        effects: checkBoxEffect.of({ pos: view.posAtDOM(wrap), checked: !this.checked }),
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
