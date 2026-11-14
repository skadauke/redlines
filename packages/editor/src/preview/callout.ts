// Alerts in the preview (#311, design §5.2): a quote whose first line is a type in brackets,
// `> [!NOTE]`, is drawn as a box with an icon and a title, and a menu in the title asks for another
// type. The source shows while the selection touches the title line's syntax, as any syntax does.
//
// The editor never writes formats. The menu button only says what it wants, in `calloutMenuEffect`;
// the formatting plugin listens, shows the menu and makes the change, tracked or not (the way a
// task box's click does, task.ts). Without it the title is drawn and its menu does nothing.
//
// Only a quote at the left edge is an alert: GitHub reads none in a list item or another quote.
// A title after the type and a fold mark (`> [!info]- A title`) are read as well, and kept as text.

import type { EditorState, Text } from '@codemirror/state';
import { StateEffect } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import { ALERT_LINE } from '@redlines/format';
import { colorClass, colorsOf } from '../tracked/colors.ts';
import { parsedField, viewModeField } from '../tracked/field.ts';

type SyntaxNode = ReturnType<typeof import('@codemirror/language').syntaxTree>['topNode'];

/** A press of the title's menu button: where the alert's type word is (a place inside it, which a
 * format change can take for the alert), the type as it is now, and the button, which the menu hangs
 * from. */
export interface CalloutMenuRequest {
  pos: number;
  type: string;
  anchor: HTMLElement;
}

export const calloutMenuEffect = StateEffect.define<CalloutMenuRequest>();

/** An alert, as the preview draws it. Positions are in the document. */
export interface Callout {
  /** The word between `[!` and `]`, as written, and the type it names (lowercase). */
  word: string;
  type: string;
  /** What the title replaces: from the start of the quote's first line to the end of the type, its
   * fold mark and the space before a title. */
  from: number;
  to: number;
  /** Where the type's word starts. */
  wordFrom: number;
  /** A title that follows the type, as text. */
  title: string;
}

/** The names of GitHub's types, for the title; another type is named by its word. */
const NAMES: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

/** What a title says for a type: its name, or for a type that GitHub doesn't have, the word as the
 * file writes it (`word`, which is the type's own where none is given) with a capital. */
export function calloutName(type: string, word = type): string {
  return Object.hasOwn(NAMES, type) ? NAMES[type]! : word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The alert that a quote is, or null where it is none: a quote at the left edge of the document,
 * not in a list item or another quote, whose first line is a type in brackets and then, at most, a
 * fold mark and a title.
 */
export function calloutOf(state: { doc: Text }, quote: SyntaxNode): Callout | null {
  if (quote.name !== 'Blockquote' || quote.parent?.name !== 'Document') return null;
  const line = state.doc.lineAt(quote.from);
  if (quote.from !== line.from) return null;
  const lead = /^>[ \t]?/.exec(line.text)?.[0].length ?? 0;
  if (lead === 0) return null;
  const found = ALERT_LINE.exec(line.text.slice(lead));
  if (!found?.[1]) return null;
  const rest = line.text.slice(lead + found[0].length);
  // The markers of tracked changes (HTML comments) are no text: a type that one follows is as
  // alone on its line as it is without it.
  const shown = rest.replace(/<!--.*?-->/g, '');
  // `[!NOTE]more` is no alert: the type ends at a space, or at the end of the line.
  if (shown !== '' && !/^[+-]?(?:[ \t]|$)/.test(shown)) return null;
  // A fold mark and the space before a title belong to the title's syntax; the title is text.
  const after = rest === shown ? (/^[+-]?[ \t]*/.exec(rest)?.[0] ?? '') : '';
  const title = shown.slice(/^[+-]?[ \t]*/.exec(shown)?.[0].length ?? 0).trim();
  const word = found[1];
  return {
    word,
    type: word.toLowerCase(),
    from: line.from,
    to: line.from + lead + found[0].length + after.length,
    wordFrom: line.from + lead + 2,
    title,
  };
}

/** The SVG paths of the types' icons, in a 16-unit square, drawn as lines. */
const ICONS: Record<string, string[]> = {
  note: ['M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Z', 'M8 7.2v3.6', 'M8 5.1v.1'],
  tip: [
    'M6 12.2h4',
    'M6.6 14h2.8',
    'M8 2a4.2 4.2 0 0 0-2.3 7.7c.2.2.3.4.3.7v.8h4v-.8c0-.3.1-.5.3-.7A4.2 4.2 0 0 0 8 2Z',
  ],
  important: ['M2.5 3h11v8h-4.2L8 13.2 6.7 11H2.5Z', 'M8 5.3v2.6', 'M8 9.3v.1'],
  warning: ['M8 2.4 14.2 13H1.8Z', 'M8 6.4v3.2', 'M8 11.3v.1'],
  caution: ['M5.3 2h5.4L14 5.3v5.4L10.7 14H5.3L2 10.7V5.3Z', 'M8 5.3v3.3', 'M8 10.4v.1'],
};

const SVG = 'http://www.w3.org/2000/svg';

function drawIcon(type: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'rl-callout-icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of Object.hasOwn(ICONS, type) ? ICONS[type]! : ICONS['note']!) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** The little chevron of the menu button. */
function drawChevron(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M4.5 6.5 8 10l3.5-3.5');
  svg.append(path);
  return svg;
}

/** A pending change of the alert's type: its author's color class (empty in the views without
 * colors), and what a screen reader is told of it. */
export interface PendingCallout {
  color: string;
  note: string;
}

/**
 * The pending change of the type of the alert whose first line starts at `line`, if there is one:
 * the format change that stands alone on the line before it (format §2.6, "Alerts"), read as it
 * stands in the file.
 */
export function pendingCallout(state: EditorState, line: number): PendingCallout | null {
  const parsed = state.field(parsedField);
  for (const mark of parsed.marks) {
    if (mark.kind !== 'fmt') continue;
    for (const segment of mark.segments) {
      if ((segment.carrier?.to ?? segment.open.to) !== line) continue;
      if (!/was=callout-/.test(state.sliceDoc(segment.open.from, segment.open.to))) continue;
      const name = parsed.ledger.people.find(({ handle }) => handle === mark.entry.by)?.name;
      const redlines = state.field(viewModeField, false) === 'redlines';
      return {
        color: redlines ? colorClass(colorsOf(state).get(mark.entry.by) ?? 0) : '',
        note: `type changed by ${name ?? mark.entry.by}, pending`,
      };
    }
  }
  return null;
}

/** The title of an alert, in the place of the syntax of its first line: an icon, the type's name (or
 * nothing, where a title follows in the text), and the button of the menu. */
export class CalloutTitleWidget extends WidgetType {
  readonly callout: Callout;
  readonly pending: PendingCallout | null;

  constructor(callout: Callout, pending: PendingCallout | null) {
    super();
    this.callout = callout;
    this.pending = pending;
  }

  override eq(other: CalloutTitleWidget): boolean {
    return (
      other.callout.word === this.callout.word &&
      other.callout.title === this.callout.title &&
      other.pending?.color === this.pending?.color &&
      other.pending?.note === this.pending?.note
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const { callout, pending } = this;
    const head = document.createElement('span');
    head.className = 'rl-callout-head';
    if (pending) head.classList.add('rl-callout-pending');
    if (pending?.color) head.classList.add(pending.color);
    head.setAttribute('role', 'group');
    head.setAttribute(
      'aria-label',
      `${calloutName(callout.type, callout.word)} alert${pending ? `, ${pending.note}` : ''}`,
    );
    head.append(drawIcon(callout.type));
    if (callout.title === '') {
      const name = document.createElement('span');
      name.className = 'rl-callout-name';
      name.textContent = calloutName(callout.type, callout.word);
      head.append(name);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rl-callout-menu';
    button.setAttribute('aria-label', 'Alert type');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.append(drawChevron());
    const ask = () => {
      const from = view.posAtDOM(head);
      // A place inside the type's word, which any format change takes for the alert it is in.
      const pos = view.state.doc.lineAt(from).from + callout.wordFrom - callout.from + 1;
      view.dispatch({
        effects: calloutMenuEffect.of({ pos, type: callout.type, anchor: button }),
      });
    };
    button.addEventListener('mousedown', (event) => {
      // The caret stays where it was: the press is on the button, not in the line's source.
      event.preventDefault();
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      ask();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      ask();
    });
    head.append(button);
    return head;
  }

  /** The button handles its own presses; a press on the rest of the title puts the caret in the
   * line, which shows its source. */
  override ignoreEvent(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.rl-callout-menu') !== null;
  }
}
